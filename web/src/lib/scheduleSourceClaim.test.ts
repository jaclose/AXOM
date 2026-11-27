import { describe, expect, it } from "vitest";
import { readScheduleSourceClaim, scheduleSourceReplayStatus, collectScheduleSourceReviewEvidence, captureScheduleReviewBinding, checkScheduleReviewBinding, snapshotScheduleReviewValue, captureScheduleReviewValueBinding, checkScheduleReviewValueBinding, type ScheduleSourceClaimV1 } from "./scheduleSourceClaim";

function claim(): ScheduleSourceClaimV1 {
  return {
    version: 1,
    source: { title: "Renal physiology", date: "2026-11-26", kind: "Lecture", activity: "lecture" },
    reviewedDate: "2026-11-27",
    destinationKey: "t4/ders/week 16",
  };
}

describe("versioned schedule source observations", () => {
  it("preserves the original date separately from the reviewed date", () => {
    const original = claim();
    const stored = JSON.parse(JSON.stringify(original));
    const result = readScheduleSourceClaim(stored);
    expect(result).toEqual({ state: "valid", claim: original });
    expect(stored).toEqual(original);
    if (result.state !== "valid") throw new Error("expected a valid claim");
    result.claim.source.title = "Changed";
    expect(stored.source.title).toBe("Renal physiology");
  });

  it("distinguishes absent legacy evidence, undated evidence and unsupported metadata", () => {
    const original = claim();
    expect(readScheduleSourceClaim(undefined)).toEqual({ state: "legacy-unknown" });
    expect(readScheduleSourceClaim(null)).toEqual({ state: "invalid" });
    expect(readScheduleSourceClaim({ ...original, version: 2 })).toEqual({ state: "invalid" });
    const undated = { ...original, source: { ...original.source, date: null }, reviewedDate: null };
    expect(readScheduleSourceClaim(undated)).toEqual({ state: "valid", claim: undated });
    expect(readScheduleSourceClaim({ ...original, source: { ...original.source, date: undefined } })).toEqual({ state: "invalid" });
  });

  it("rejects malformed date, category and destination metadata without repair", () => {
    const original = claim();
    const invalid = [
      { ...original, source: { ...original.source, date: "2026-02-29" } },
      { ...original, source: { ...original.source, date: "2026-13-01" } },
      { ...original, source: { ...original.source, title: " " } },
      { ...original, source: { ...original.source, kind: "Other" } },
      { ...original, source: { ...original.source, activity: "imcq" } },
      { ...original, reviewedDate: "2026-11-31" },
      { ...original, destinationKey: "T4/DERS/Week 16" },
      { ...original, destinationKey: "" },
    ];
    for (const value of invalid) {
      const before = JSON.stringify(value);
      expect(readScheduleSourceClaim(value)).toEqual({ state: "invalid" });
      expect(JSON.stringify(value)).toBe(before);
    }
    const leap = { ...original, source: { ...original.source, date: "2028-02-29" } };
    expect(readScheduleSourceClaim(leap).state).toBe("valid");
  });

  it("holds possible replay despite reviewed date or classification changes", () => {
    const original = claim();
    const fresh = { ...original, reviewedDate: "2026-11-26", source: {
      ...original.source, title: "RENAL  physiology", kind: "Assessment", activity: null,
    } };
    const stored = JSON.parse(JSON.stringify(original));
    for (const [a, b] of [[fresh, stored], [stored, fresh]]) {
      const before = JSON.stringify([a, b]);
      expect(scheduleSourceReplayStatus(a, b, " T4 / DERS / Week 16 ")).toBe("possible-replay");
      expect(JSON.stringify([a, b])).toBe(before);
    }
  });

  it("does not collapse distinct observations, moved records or unrelated destinations", () => {
    const original = claim();
    const differentDate = { ...original, source: { ...original.source, date: "2026-11-28" } };
    const undated = { ...original, source: { ...original.source, date: null } };
    const differentTitle = { ...original, source: { ...original.source, title: "Renal pathology" } };
    for (const other of [differentDate, undated, differentTitle]) {
      expect(scheduleSourceReplayStatus(original, other, original.destinationKey)).toBe("different");
      expect(scheduleSourceReplayStatus(other, original, original.destinationKey)).toBe("different");
    }
    expect(scheduleSourceReplayStatus(original, original, "t4/ders/week 17")).toBe("different");
    expect(scheduleSourceReplayStatus(original, { ...original, destinationKey: "t4/ders/week 17" }, original.destinationKey)).toBe("moved");
    expect(scheduleSourceReplayStatus(original, undefined, original.destinationKey)).toBe("legacy-unknown");
    expect(scheduleSourceReplayStatus(original, { ...original, version: 2 }, original.destinationKey)).toBe("invalid-claim");
    expect(scheduleSourceReplayStatus(undefined, original, original.destinationKey)).toBe("invalid-claim");
  });

  it("treats same-title undated observations only as possible replay, never an exact identity", () => {
    const original = claim();
    const undated = { ...original, source: { ...original.source, date: null } };
    expect(scheduleSourceReplayStatus(undated, undated, undated.destinationKey)).toBe("possible-replay");
    const accent = { ...original, source: { ...original.source, title: "Épreuve" } };
    const decomposed = { ...accent, source: { ...accent.source, title: "E\u0301preuve" } };
    expect(scheduleSourceReplayStatus(accent, decomposed, accent.destinationKey)).toBe("possible-replay");
    const different = { ...accent, source: { ...accent.source, title: "Epreuve" } };
    expect(scheduleSourceReplayStatus(accent, different, accent.destinationKey)).toBe("different");
  });
});

describe("schedule review evidence across the active account", () => {
  it("surfaces a matching moved-away record without treating it as an exact duplicate", () => {
    const original = claim();
    const rows = [{ recordId: "old", path: "T4/DERS/Week 17", sourceClaim: original }];
    const before = JSON.stringify(rows);
    expect(collectScheduleSourceReviewEvidence(original, rows)).toEqual({
      state: "valid",
      matches: [{ recordId: "old", currentPathKey: "t4/ders/week 17", status: "moved-away" }],
      unresolvedAtDestination: [],
    });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("requires matching observations for moved-in rows and ignores unrelated paths", () => {
    const original = claim();
    const other = { ...original, destinationKey: "t4/ders/week 17" };
    const unrelated = { ...other, source: { ...other.source, title: "Cardiac physiology" } };
    const rows = [
      { recordId: "moved", path: original.destinationKey, sourceClaim: other },
      { recordId: "unrelated", path: original.destinationKey, sourceClaim: unrelated },
      { recordId: "other", path: other.destinationKey, sourceClaim: other },
      { recordId: "other-legacy", path: other.destinationKey, sourceClaim: undefined, legacyIdentityMatches: true },
    ];
    expect(collectScheduleSourceReviewEvidence(original, rows)).toEqual({
      state: "valid",
      matches: [{ recordId: "moved", currentPathKey: original.destinationKey, status: "moved-in" }],
      unresolvedAtDestination: [],
    });
  });

  it("preserves every counterpart and repeated row ID in a deterministic order", () => {
    const original = claim();
    const alternate = { ...original, source: { ...original.source, kind: "Assessment", activity: null } };
    const rows = [
      { recordId: "z", path: original.destinationKey, sourceClaim: original },
      { recordId: "a", path: original.destinationKey, sourceClaim: alternate },
      { recordId: "a", path: original.destinationKey, sourceClaim: alternate },
      { recordId: "b", path: original.destinationKey, sourceClaim: { ...original, source: { ...original.source, date: "2026-11-28" } } },
    ];
    const result = collectScheduleSourceReviewEvidence(original, rows);
    expect(result).toEqual({
      state: "valid",
      matches: ["a", "a", "z"].map(recordId => ({ recordId, currentPathKey: original.destinationKey, status: "possible-replay" })),
      unresolvedAtDestination: [],
    });
    expect(collectScheduleSourceReviewEvidence(original, [...rows].reverse())).toEqual(result);
    expect(rows.map(row => row.recordId)).toEqual(["z", "a", "a", "b"]);
  });

  it("separates unknown and invalid claims from source matches without hiding unresolved rows", () => {
    const original = claim();
    const rows = [
      { recordId: "z", path: original.destinationKey, sourceClaim: undefined },
      { recordId: "a", path: original.destinationKey, sourceClaim: { ...original, version: 2 }, legacyIdentityMatches: true },
      { recordId: "m", path: original.destinationKey, sourceClaim: undefined, legacyIdentityMatches: true },
    ];
    const result = collectScheduleSourceReviewEvidence(original, rows);
    expect(result).toEqual({
      state: "valid", matches: [],
      unresolvedAtDestination: [
        { recordId: "a", status: "invalid-claim", legacyIdentityMatches: true },
        { recordId: "m", status: "legacy-unknown", legacyIdentityMatches: true },
        { recordId: "z", status: "legacy-unknown", legacyIdentityMatches: false },
      ],
    });
    expect(collectScheduleSourceReviewEvidence(original, [...rows].reverse())).toEqual(result);
    expect(collectScheduleSourceReviewEvidence(undefined, rows)).toEqual({ state: "invalid-candidate" });
  });

  it("distinguishes undated observations from dated records and preserves source bytes", () => {
    const original = claim();
    const undated = { ...original, source: { ...original.source, date: null }, reviewedDate: null };
    const rows = [
      { recordId: "dated", path: original.destinationKey, sourceClaim: original },
      { recordId: "undated", path: original.destinationKey, sourceClaim: undated },
    ];
    const before = JSON.stringify(rows);
    expect(collectScheduleSourceReviewEvidence(undated, rows)).toEqual({
      state: "valid", matches: [{ recordId: "undated", currentPathKey: original.destinationKey, status: "possible-replay" }],
      unresolvedAtDestination: [],
    });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("ephemeral schedule review binding", () => {
  function inputFor<T extends { recordId: string; path: string; sourceClaim: unknown }>(rows: readonly T[]) {
    return {
      workspaceLease: {},
      candidateBatchSnapshot: JSON.stringify([claim()]),
      rows: rows.map(row => ({ recordId: row.recordId, recordSnapshot: JSON.stringify(row) })),
    };
  }

  it("rejects changes hidden by the deliberately lossy review projection", () => {
    const original = claim();
    const moved = { ...original, destinationKey: "t4/ders/week 15" };
    const pairs = [
      [original, { ...original, reviewedDate: "2026-11-28" }],
      [original, { ...original, source: { ...original.source, kind: "Assessment", activity: "imcq" } }],
      [moved, { ...moved, destinationKey: "t4/ders/week 14" }],
      [original, { ...original, source: { ...original.source, title: "RENAL physiology" } }],
      [{ ...original, version: 2 }, { ...original, version: 3 }],
    ];
    for (const [beforeClaim, afterClaim] of pairs) {
      const beforeRows = [{ recordId: "a", path: original.destinationKey, sourceClaim: beforeClaim }];
      const afterRows = [{ ...beforeRows[0], sourceClaim: afterClaim }];
      // This old projection must remain equal: it is review evidence, not a CAS token.
      expect(collectScheduleSourceReviewEvidence(original, beforeRows)).toEqual(
        collectScheduleSourceReviewEvidence(original, afterRows));
      const input = inputFor(beforeRows);
      const captured = captureScheduleReviewBinding(input);
      if (captured.state !== "captured") throw new Error("expected a captured binding");
      expect(checkScheduleReviewBinding(captured.binding, {
        ...input, rows: inputFor(afterRows).rows,
      })).toBe("stale-records");
    }
  });

  it("binds the full candidate batch and non-reused workspace lease, including ABA", () => {
    const input = inputFor([]);
    const captured = captureScheduleReviewBinding(input);
    if (captured.state !== "captured") throw new Error("expected a captured binding");
    expect(checkScheduleReviewBinding(captured.binding, input)).toBe("current");
    expect(checkScheduleReviewBinding(captured.binding, { ...input, workspaceLease: {} })).toBe("stale-scope");
    const returnedToA = { ...input, workspaceLease: {} };
    expect(checkScheduleReviewBinding(captured.binding, returnedToA)).toBe("stale-scope");
    expect(checkScheduleReviewBinding(captured.binding, {
      ...input, candidateBatchSnapshot: JSON.stringify([claim(), claim()]),
    })).toBe("stale-candidates");
    const c = claim();
    const two = { ...input, candidateBatchSnapshot: JSON.stringify([c, { ...c, reviewedDate: null }]) };
    const second = captureScheduleReviewBinding(two);
    if (second.state !== "captured") throw new Error("expected a captured binding");
    expect(checkScheduleReviewBinding(second.binding, {
      ...two, candidateBatchSnapshot: JSON.stringify([{ ...c, reviewedDate: null }, c]),
    })).toBe("stale-candidates");
  });

  it("refuses duplicate record IDs without selecting a winner", () => {
    const input = inputFor([{ recordId: "a", path: claim().destinationKey, sourceClaim: claim() }]);
    const captured = captureScheduleReviewBinding(input);
    if (captured.state !== "captured") throw new Error("expected a captured binding");
    const duplicate = { ...input, rows: [...input.rows, { ...input.rows[0] }] };
    expect(captureScheduleReviewBinding(duplicate)).toEqual({ state: "duplicate-record-id" });
    expect(checkScheduleReviewBinding(captured.binding, duplicate)).toBe("duplicate-record-id");
    const conflicting = { ...input, rows: [...input.rows, { recordId: "a", recordSnapshot: "{}" }] };
    expect(captureScheduleReviewBinding(conflicting)).toEqual({ state: "duplicate-record-id" });
  });

  it("detects additions, removals, changes to editable fields and preserves input order", () => {
    const c = claim();
    const records = [{ recordId: "z", path: c.destinationKey, sourceClaim: c, note: "before" },
      { recordId: "a", path: "other", sourceClaim: undefined, note: "unrelated" }];
    const input = inputFor(records);
    const before = JSON.stringify(input.rows);
    const captured = captureScheduleReviewBinding(input);
    if (captured.state !== "captured") throw new Error("expected a captured binding");
    expect(JSON.stringify(input.rows)).toBe(before);
    expect(checkScheduleReviewBinding(captured.binding, { ...input, rows: [...input.rows].reverse() })).toBe("current");
    expect(checkScheduleReviewBinding(captured.binding, { ...input, rows: input.rows.slice(0, 1) })).toBe("stale-records");
    expect(checkScheduleReviewBinding(captured.binding, {
      ...input, rows: [...input.rows, { recordId: "new", recordSnapshot: "{}" }],
    })).toBe("stale-records");
    const edited = inputFor([{ ...records[0], note: "after" }, records[1]]);
    expect(checkScheduleReviewBinding(captured.binding, { ...input, rows: edited.rows })).toBe("stale-records");
    input.rows[0].recordSnapshot = "{}";
    expect(checkScheduleReviewBinding(captured.binding, input)).toBe("stale-records");
    expect(Object.isFrozen(captured.binding)).toBe(true);
    expect(Object.isFrozen(captured.binding.rows)).toBe(true);
    expect(Object.isFrozen(captured.binding.rows[0])).toBe(true);
  });

  it("fails closed when snapshot evidence is missing", () => {
    const input = inputFor([]);
    for (const value of [
      { ...input, candidateBatchSnapshot: "" },
      { ...input, rows: [{ recordId: "", recordSnapshot: "{}" }] },
      { ...input, rows: [{ recordId: "a", recordSnapshot: "" }] },
    ]) expect(captureScheduleReviewBinding(value)).toEqual({ state: "invalid-input" });
  });
});

describe("strict value snapshots for schedule review confirmation", () => {
  it("refuses all five lossy JSON.stringify collision pairs at the binding boundary", () => {
    const pairs = [
      [{}, { field: undefined }],
      [{ field: null }, { field: NaN }],
      [{ field: null }, { field: Infinity }],
      [{ field: 0 }, { field: -0 }],
      [{ field: [null] }, { field: Array(1) }],
    ];
    for (const [valid, invalid] of pairs) {
      expect(JSON.stringify(valid)).toBe(JSON.stringify(invalid));
      const input = { workspaceLease: {}, candidateBatch: [], rows: [{ recordId: "a", record: valid }] };
      const changed = { ...input, rows: [{ recordId: "a", record: invalid }] };
      const captured = captureScheduleReviewValueBinding(input);
      if (captured.state !== "captured") throw new Error("valid snapshot refused");
      expect(checkScheduleReviewValueBinding(captured.binding, input)).toBe("current");
      expect(checkScheduleReviewValueBinding(captured.binding, changed)).toBe("invalid-input");
      expect(captureScheduleReviewValueBinding(changed)).toEqual({ state: "invalid-input" });
      expect(captureScheduleReviewValueBinding({ ...input, candidateBatch: [invalid] })).toEqual({ state: "invalid-input" });
    }
  });

  it("preserves ordinary nested JSON, array ordering, unknown fields and special property names", () => {
    const original = JSON.parse('{"z":[1,true,null,"x"],"__proto__":{"value":1},"future":{"version":7,"raw":"x"}}');
    const before = JSON.stringify(original);
    const snapshot = snapshotScheduleReviewValue(original);
    if (snapshot === undefined) throw new Error("valid snapshot refused");
    expect(JSON.parse(snapshot)).toEqual(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(snapshotScheduleReviewValue({ future: original.future, z: original.z, ["__proto__"]: original["__proto__"] })).toBe(snapshot);
    expect(snapshotScheduleReviewValue({ ...original, z: [...original.z].reverse() }) === snapshot).toBe(false);
    expect(snapshotScheduleReviewValue({ ...original, future: { ...original.future, raw: "y" } }) === snapshot).toBe(false);
    const repeated = { a: original, b: original };
    expect(snapshotScheduleReviewValue(repeated)).toBe(snapshotScheduleReviewValue(JSON.parse(JSON.stringify(repeated))));
    expect(snapshotScheduleReviewValue(Object.freeze(original))).toBe(snapshot);
  });

  it("rejects non-JSON properties and objects without invoking getters or custom JSON hooks", () => {
    let calls = 0;
    const getter = Object.defineProperty({}, "x", { enumerable: true, get() { calls++; return 1; } });
    const custom = { toJSON() { calls++; return {}; } };
    const hidden = Object.defineProperty({}, "x", { value: 1 });
    const arrayExtra = Object.assign([1], { note: "hidden by JSON" });
    const symbolKey = { [Symbol("x")]: 1 };
    const cycle = Object.assign({}, { self: {} });
    cycle.self = cycle;
    for (const value of [getter, custom, hidden, arrayExtra, symbolKey, cycle,
      new Date(0), new Map(), new Set(), BigInt(1), Symbol("x"), undefined,
      () => 1, -Infinity, Object.create({ inherited: 1 })]) {
      expect(snapshotScheduleReviewValue(value)).toBe(undefined);
    }
    expect(calls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(getter, "x")?.get !== undefined).toBe(true);
    expect(cycle.self).toBe(cycle);
  });

  it("fails closed on excessive depth, node count and scalar length", () => {
    let deep = {};
    for (let i = 0; i < 70; i++) deep = { child: deep };
    expect(snapshotScheduleReviewValue(deep)).toBe(undefined);
    expect(snapshotScheduleReviewValue(Array(100_001).fill(null))).toBe(undefined);
    expect(snapshotScheduleReviewValue("x".repeat(2_000_001))).toBe(undefined);
    expect(snapshotScheduleReviewValue([{}, null, "", 0])).toBe('[{},null,"",0]');
  });

  it("binds valid whole records and candidate order, rejects duplicate IDs and renewed leases", () => {
    const input = { workspaceLease: {}, candidateBatch: [{ id: "one" }, { id: "two" }],
      rows: [{ recordId: "a", record: { title: "Before", future: 1 } },
        { recordId: "b", record: { title: "Other" } }] };
    const captured = captureScheduleReviewValueBinding(input);
    if (captured.state !== "captured") throw new Error("valid snapshot refused");
    const binding = captured.binding;
    expect(checkScheduleReviewValueBinding(binding, { ...input, rows: [...input.rows].reverse() })).toBe("current");
    expect(checkScheduleReviewValueBinding(binding, { ...input, candidateBatch: [...input.candidateBatch].reverse() })).toBe("stale-candidates");
    expect(checkScheduleReviewValueBinding(binding, { ...input, rows: [{ ...input.rows[0], record: { title: "Before", future: 2 } }, input.rows[1]] })).toBe("stale-records");
    expect(checkScheduleReviewValueBinding(binding, { ...input, rows: [...input.rows, input.rows[0]] })).toBe("duplicate-record-id");
    expect(checkScheduleReviewValueBinding(binding, { ...input, workspaceLease: {} })).toBe("stale-scope");
    expect(checkScheduleReviewValueBinding(binding, { ...input, workspaceLease: {} })).toBe("stale-scope");
    expect(checkScheduleReviewValueBinding(binding, { ...input, candidateBatch: [{ id: undefined }] })).toBe("invalid-input");
    expect(checkScheduleReviewValueBinding(binding, { ...input, rows: input.rows.slice(1) })).toBe("stale-records");
  });
});
