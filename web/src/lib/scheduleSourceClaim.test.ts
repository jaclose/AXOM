import { describe, expect, it } from "vitest";
import { readScheduleSourceClaim, scheduleSourceReplayStatus, collectScheduleSourceReviewEvidence, type ScheduleSourceClaimV1 } from "./scheduleSourceClaim";

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
