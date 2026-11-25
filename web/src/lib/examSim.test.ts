// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXAM_SIM_SUSPENDED_KEY, answersFromItems, blockCounts, clearSuspendedBlock, clockElapsedMs, formatClock,
  discardSuspendedBlock, inspectSuspendedBlock, pauseClock, resumeClock, reviewIndices, writeSuspendedBlock, type SuspendedBlock,
} from "./examSim";
import { blockAnswers, elapsedSeconds, resumeBlock, suspendBlock } from "./exam/engine";
import { searchLabValues, LAB_SECTIONS } from "../data/labValues";

const ids = ["a", "b", "c", "d"];
const items = {
  a: { answerKey: "B", marked: false, struck: [], seconds: 40, visited: true },
  b: { marked: true, struck: ["A"], seconds: 12, visited: true },
  c: { answerKey: "C", marked: true, struck: [], seconds: 80, visited: true },
};

describe("exam simulation engine", () => {
  it("clears only the finalized run and preserves valid legacy recovery", () => {
    localStorage.clear();
    sessionStorage.clear();
    const startedAt = "2026-10-15T12:00:00.000Z";
    const legacy: SuspendedBlock = {
      version: 1, skin: "nbme", mode: "exam", poolIds: ["legacy"], index: 0, items: {}, elapsedMs: 0,
      notes: "legacy", startedAt, suspendedAt: startedAt,
    };
    const current: SuspendedBlock = {
      ...legacy, runId: "current", poolIds: ["current"], notes: "current",
      startedAt: "2026-10-15T13:00:00.000Z", suspendedAt: "2026-10-15T13:01:00.000Z",
    };
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, JSON.stringify(legacy));
    writeSuspendedBlock(current);
    clearSuspendedBlock("current");

    expect(JSON.parse(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)!)).toEqual(legacy);
    expect(localStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run:current`)).toBeNull();
  });

  it("groups items for Item Review", () => {
    expect(blockCounts(ids, items)).toEqual({ answered: 2, incomplete: 2, marked: 2, seen: 3, total: 4 });
    expect(reviewIndices(ids, items, "incomplete")).toEqual([1, 3]);
    expect(reviewIndices(ids, items, "marked")).toEqual([1, 2]);
    expect(reviewIndices(ids, items, "all")).toEqual([0, 1, 2, 3]);
  });

  it("scores only trusted keys and keeps unanswered items as wrong", () => {
    const answers = answersFromItems(ids, items, (id) => (id === "d" ? undefined : "B"));
    expect(answers.map((answer) => answer.correct)).toEqual([true, false, false, undefined]);
    expect(answers[2]).toMatchObject({ answerKey: "C", flagged: true, seconds: 80 });
  });

  it("pauses the block clock on suspend and resumes without counting the gap", () => {
    const running = { elapsedMs: 60_000, runningSince: 1_000 };
    expect(clockElapsedMs(running, 31_000)).toBe(90_000);
    const paused = pauseClock(running, 31_000);
    expect(clockElapsedMs(paused, 999_999)).toBe(90_000);
    expect(clockElapsedMs(resumeClock(paused, 500_000), 510_000)).toBe(100_000);
    expect(formatClock(1799)).toBe("00:29:59");
  });

  it("carries the official NBME lab table and searches it", () => {
    expect(LAB_SECTIONS.map((section) => section.id)).toEqual(["serum", "abg", "csf", "hematologic", "urine", "bmi"]);
    expect(searchLabValues("sodium")[0]).toMatchObject({ range: "136–146 mEq/L", section: "Serum" });
    expect(searchLabValues("csf glucose")).toEqual([expect.objectContaining({ range: "40–70 mg/dL" })]);
    expect(searchLabValues("Na+")[0].name).toBe("Sodium (Na⁺)");
    expect(searchLabValues("")).toEqual([]);
  });
});

describe("explicit simulation recovery", () => {
  const at = "2026-11-25T05:00:00Z";
  const block: SuspendedBlock = {
    version: 1, runId: "selected", skin: "nbme", mode: "exam", poolIds: ["a"], index: 0,
    items: { a: items.a }, elapsedMs: 40000, notes: "original", startedAt: at, suspendedAt: at,
  };
  const scopedKey = `${EXAM_SIM_SUSPENDED_KEY}:run:selected`;
  const maxDurationMs = Math.floor(Number.MAX_SAFE_INTEGER / 2);
  const maxDurationSeconds = maxDurationMs / 1000;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("distinguishes verified absence, present and malformed recovery", () => {
    expect(inspectSuspendedBlock()).toEqual({ status: "absent" });
    writeSuspendedBlock(block);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block });
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, "{broken");
    expect(inspectSuspendedBlock()).toEqual({ status: "unreadable" });
    expect(discardSuspendedBlock(block)).toBe(false);
    expect(localStorage.getItem(scopedKey)).toBe(JSON.stringify(block));
  });

  it.each([
    ["coercible non-string skin", { skin: ["nbme"] }],
    ["missing index", { index: undefined }],
    ["fractional index", { index: 0.5 }],
    ["negative index", { index: -1 }],
    ["out-of-range index", { index: 1 }],
    ["invalid elapsed time", { elapsedMs: "invalid" }],
    ["negative elapsed time", { elapsedMs: -1 }],
    ["nonfinite elapsed time", { elapsedMs: Infinity }],
    ["invalid time limit", { timeLimitSeconds: "90" }],
    ["finite but frozen elapsed clock", { elapsedMs: 1e308 }],
    ["elapsed outside representable domain", { elapsedMs: maxDurationMs + 1 }],
    ["finite but overflowing time limit", { timeLimitSeconds: 1e308 }],
    ["time limit outside representable domain", { timeLimitSeconds: Math.ceil(maxDurationSeconds) + 1 }],
    ["finite but frozen item time", { items: { a: { ...items.a, seconds: 1e308 } } }],
    ["item outside representable domain", { items: { a: { ...items.a, seconds: Math.ceil(maxDurationSeconds) + 1 } } }],
    ["overflowing total item time", { poolIds: ["a", "b"], items: {
      a: { ...items.a, seconds: 1e308 }, b: { ...items.b, seconds: 1e308 },
    } }],
    ["aggregate outside domain with individually representable items", { poolIds: ["a", "b"], items: {
      a: { ...items.a, seconds: Math.floor(maxDurationSeconds * 0.75) },
      b: { ...items.b, seconds: Math.floor(maxDurationSeconds * 0.75) },
    } }],
    ["invalid notes", { notes: {} }],
    ["invalid timestamp", { startedAt: "invalid" }],
    ["invalid strike list", { items: { a: { ...items.a, struck: {} } } }],
    ["invalid strike key", { items: { a: { ...items.a, struck: [5] } } }],
    ["invalid answer", { items: { a: { ...items.a, answerKey: 1 } } }],
    ["invalid item seconds", { items: { a: { ...items.a, seconds: "5" } } }],
    ["negative item seconds", { items: { a: { ...items.a, seconds: -1 } } }],
    ["invalid mark", { items: { a: { ...items.a, marked: "false" } } }],
    ["invalid visited state", { items: { a: { ...items.a, visited: 0 } } }],
    ["invalid submitted state", { items: { a: { ...items.a, submitted: "false" } } }],
    ["null item", { items: { a: null } }],
    ["out-of-pool item", { items: { z: items.a } }],
    ["duplicate pool IDs", { poolIds: ["a", "a"] }],
    ["prototype pool ID", { poolIds: ["a", "constructor"] }],
    ["invalid evidence map", { sourceEvidenceV1: [] }],
    ["invalid evidence value", { sourceEvidenceV1: { a: 4 } }],
  ] as const)("holds matching malformed mirrors without changing bytes (%s)", (_name, patch) => {
    writeSuspendedBlock(block);
    const raw = JSON.stringify({ ...block, ...patch });
    localStorage.setItem(scopedKey, raw);
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, raw);
    const pointer = sessionStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run-id`);
    expect(inspectSuspendedBlock()).toEqual({ status: "unreadable" });
    expect(discardSuspendedBlock(JSON.parse(raw) as SuspendedBlock)).toBe(false);
    expect(localStorage.getItem(scopedKey)).toBe(raw);
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(raw);
    expect(sessionStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run-id`)).toBe(pointer);
  });

  it("accepts sparse legacy recovery with fractional time and optional fields absent", () => {
    const legacy = {
      ...block, runId: undefined, poolIds: ["a", "b"],
      items: { a: { ...items.a, seconds: 40.5 } },
    };
    const raw = JSON.stringify(legacy);
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, raw);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: JSON.parse(raw) });
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(raw);
  });

  it("preserves fractional durations through the actual resume and answer-recording engine", () => {
    const fractional: SuspendedBlock = {
      ...block, elapsedMs: 40000.5, timeLimitSeconds: 90.5,
      items: { a: { ...items.a, seconds: 40.5 } },
    };
    writeSuspendedBlock(fractional);
    const recovered = inspectSuspendedBlock();
    expect(recovered).toEqual({ status: "present", block: fractional });
    if (recovered.status !== "present") throw new Error("Expected recoverable examination");
    const now = Date.parse(at);
    const resumed = resumeBlock(recovered.block, fractional.poolIds, now);
    expect(elapsedSeconds(resumed, now + 1000)).toBe(41);
    expect(blockAnswers(resumed, now + 1000, () => "B")[0]).toMatchObject({ seconds: 42, correct: true });
    const suspended = suspendBlock(resumed, now + 1000, {
      skin: fractional.skin, timeLimitSeconds: fractional.timeLimitSeconds, runId: fractional.runId,
    });
    expect(suspended.elapsedMs).toBe(41000.5);
    expect(suspended.items.a.seconds).toBe(41.5);
    expect(suspended.timeLimitSeconds).toBe(90.5);
    writeSuspendedBlock(suspended);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: JSON.parse(JSON.stringify(suspended)) });
  });

  it("keeps representable aggregate durations and leaves room for subsequent clock ticks", () => {
    const seconds = Math.floor(maxDurationSeconds * 0.49);
    const large: SuspendedBlock = {
      ...block, elapsedMs: maxDurationMs, timeLimitSeconds: Math.floor(maxDurationSeconds),
      poolIds: ["a", "b"], items: {
        a: { ...items.a, seconds }, b: { ...items.b, seconds },
      },
    };
    writeSuspendedBlock(large);
    const recovered = inspectSuspendedBlock();
    expect(recovered).toEqual({ status: "present", block: large });
    if (recovered.status !== "present") throw new Error("Expected recoverable examination");
    const now = Date.parse(at);
    const resumed = resumeBlock(recovered.block, large.poolIds, now);
    expect(elapsedSeconds(resumed, now + 1000) - elapsedSeconds(resumed, now)).toBe(1);
    const answers = blockAnswers(resumed, now + 1000, () => "B");
    expect(answers[0].seconds).toBe(seconds + 1);
    expect(answers[1].seconds).toBe(seconds);
    expect(Number.isSafeInteger(answers.reduce((sum, answer) => sum + (answer.seconds ?? Number.NaN), 0))).toBe(true);
    expect(Number.isSafeInteger((large.timeLimitSeconds ?? 0) * 1000)).toBe(true);
  });

  it.each(["clock", "item", "aggregate"] as const)("refuses a resumed snapshot crossing the %s duration bound before writing", (boundary) => {
    const near: SuspendedBlock = {
      ...block,
      elapsedMs: boundary === "clock" ? maxDurationMs : 40000,
      poolIds: ["a", "b"],
      items: {
        a: { ...items.a, seconds: boundary === "item" ? maxDurationSeconds
          : boundary === "aggregate" ? maxDurationSeconds - 2 : 40 },
        b: { ...items.b, seconds: boundary === "aggregate" ? 2 : 0 },
      },
    };
    writeSuspendedBlock(near);
    const before = localStorage.getItem(scopedKey);
    const legacy = localStorage.getItem(EXAM_SIM_SUSPENDED_KEY);
    const pointerKey = `${EXAM_SIM_SUSPENDED_KEY}:run-id`;
    const pointer = sessionStorage.getItem(pointerKey);
    const now = Date.parse(at);
    const resumed = resumeBlock(near, near.poolIds, now);
    const next = suspendBlock(resumed, now + 1000, { skin: near.skin, runId: near.runId });
    expect(() => writeSuspendedBlock(next)).toThrow(/previous recovery has not been changed/);
    expect(localStorage.getItem(scopedKey)).toBe(before);
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(legacy);
    expect(sessionStorage.getItem(pointerKey)).toBe(pointer);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: near });
  });

  it("accepts an actual resumed clock reaching exactly the reader bound", () => {
    const near = { ...block, elapsedMs: maxDurationMs - 1000 };
    writeSuspendedBlock(near);
    const now = Date.parse(at);
    const next = suspendBlock(resumeBlock(near, near.poolIds, now), now + 1000, {
      skin: near.skin, runId: near.runId,
    });
    expect(next.elapsedMs).toBe(maxDurationMs);
    writeSuspendedBlock(next);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: JSON.parse(JSON.stringify(next)) });
  });

  it("refuses an invalid first write without creating a discovery pointer or mirrors", () => {
    expect(() => writeSuspendedBlock({ ...block, elapsedMs: Infinity })).toThrow();
    expect(inspectSuspendedBlock()).toEqual({ status: "absent" });
    expect(localStorage.getItem(scopedKey)).toBeNull();
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBeNull();
    expect(sessionStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run-id`)).toBeNull();
  });

  it("refuses invalid legacy and distinct-run writes without replacing the prior recovery", () => {
    const legacy = { ...block, runId: undefined };
    writeSuspendedBlock(legacy);
    const raw = localStorage.getItem(EXAM_SIM_SUSPENDED_KEY);
    expect(() => writeSuspendedBlock({ ...legacy, index: -1 })).toThrow();
    expect(() => writeSuspendedBlock({ ...block, runId: "other", elapsedMs: maxDurationMs + 1 })).toThrow();
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(raw);
    expect(localStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run:other`)).toBeNull();
    expect(sessionStorage.getItem(`${EXAM_SIM_SUSPENDED_KEY}:run-id`)).toBeNull();
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: JSON.parse(JSON.stringify(legacy)) });
  });

  it("accepts valid tutor recovery with source evidence and optional timing", () => {
    const tutor: SuspendedBlock = {
      ...block, mode: "tutor", timeLimitSeconds: 180,
      sourceEvidenceV1: { a: "a".repeat(64) },
      items: { a: { ...items.a, submitted: true } },
    };
    writeSuspendedBlock(tutor);
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: tutor });
  });

  it("holds an orphan or divergent same-run copy without rewriting either", () => {
    localStorage.setItem(scopedKey, JSON.stringify(block));
    expect(inspectSuspendedBlock()).toEqual({ status: "unreadable" });
    writeSuspendedBlock(block);
    const divergent = { ...block, notes: "unseen changes" };
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, JSON.stringify(divergent));
    expect(inspectSuspendedBlock()).toEqual({ status: "unreadable" });
    expect(discardSuspendedBlock(block)).toBe(false);
    expect(localStorage.getItem(scopedKey)).toBe(JSON.stringify(block));
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(JSON.stringify(divergent));
  });

  it("confirms exact target removal and preserves a different legacy run", () => {
    const other = { ...block, runId: "other", notes: "unrelated" };
    writeSuspendedBlock(other);
    writeSuspendedBlock(block);
    expect(discardSuspendedBlock(block)).toBe(true);
    expect(localStorage.getItem(scopedKey)).toBeNull();
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(JSON.stringify(other));
    expect(inspectSuspendedBlock()).toEqual({ status: "present", block: other });
  });

  it("discards only the exact no-ID legacy snapshot", () => {
    const legacy = { ...block, runId: undefined };
    writeSuspendedBlock(legacy);
    expect(discardSuspendedBlock(legacy)).toBe(true);
    expect(inspectSuspendedBlock()).toEqual({ status: "absent" });
  });

  it.each(["scoped", "legacy"] as const)("holds on %s read refusal before removal", (copy) => {
    writeSuspendedBlock(block);
    const target = copy === "scoped" ? scopedKey : EXAM_SIM_SUSPENDED_KEY;
    const get = Storage.prototype.getItem;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (this === localStorage && key === target) throw new Error("Synthetic read refusal");
      return get.call(this, key);
    });
    try {
      expect(inspectSuspendedBlock()).toEqual({ status: "unreadable" });
      expect(discardSuspendedBlock(block)).toBe(false);
    } finally {
      read.mockRestore();
    }
    expect(localStorage.getItem(scopedKey)).toBe(JSON.stringify(block));
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe(JSON.stringify(block));
  });
});
