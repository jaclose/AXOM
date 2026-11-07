import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_WINDOW_MS, beginPassiveFirstRun, capturePassiveFirstRun, proposePassiveAtlas,
  serializePassiveFirstRun, restorePassiveFirstRun, type PassiveSession,
} from "./passiveFirstRun";

const initial = (changedFields: Array<"tools" | "questionTiming"> = ["tools", "questionTiming"]) =>
  beginPassiveFirstRun({
    consent: true, now: 1_000_000, changedFields,
    tools: ["questions", "anki"], questionTiming: "after-first-pass",
  })!;

function exercised(session: PassiveSession) {
  const first = capturePassiveFirstRun(session, "visit-questions", 1_065_000);
  const second = capturePassiveFirstRun(first, "begin-practice", 1_075_000);
  return capturePassiveFirstRun(second, "review-source", 1_085_000);
}

describe("Living Atlas passive first-run evidence, not personality surveillance", () => {
  it("never starts observing without express consent", () => {
    expect(beginPassiveFirstRun({ consent: false, now: 0, changedFields: ["tools"], tools: ["questions"] })).toBeNull();
  });

  it("ignores default setup choices until a user actually changes them", () => {
    const blank = initial([]);
    expect(proposePassiveAtlas(blank, 1_120_000).status).toBe("insufficient");
    expect(proposePassiveAtlas(blank, 1_120_000).suggestion).toBeUndefined();
  });

  it("discards arbitrary clicks, cursor positions, text, private content and unsupported events", () => {
    const session = initial();
    const invalid = capturePassiveFirstRun(session, { kind: "click", x: 55, y: 99, journal: "secret note" } as never, 1_100_000);
    expect(invalid).toEqual(session);
    const serialized = serializePassiveFirstRun(invalid);
    expect(serialized).not.toContain("secret note");
    expect(serialized).not.toContain("\"x\"");
    expect(serialized).not.toContain("\"y\"");
    expect(serialized).not.toContain("journal");
  });

  it("keeps only bounded aggregate event counts without a clickstream timeline", () => {
    let session = initial();
    for (let i = 0; i < 20; i++) session = capturePassiveFirstRun(session, "visit-questions", 1_070_000+i);
    expect(session.counts["visit-questions"]).toBe(2);
    const serialized = serializePassiveFirstRun(session);
    expect(serialized).not.toContain("1_070_000");
    expect(serialized).not.toContain("events");
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(["changedFields", "consent", "counts", "expiresAt", "questionTiming", "startedAt", "tools", "version"].sort());
  });

  it("does not call navigation, scrolling or a brief session personality evidence", () => {
    let session = initial([]);
    session = capturePassiveFirstRun(session, "visit-tracker", 1_065_000);
    session = capturePassiveFirstRun(session, "visit-reports", 1_075_000);
    session = capturePassiveFirstRun(session, "explore-content", 1_085_000);
    const result = proposePassiveAtlas(session, 1_130_000);
    expect(result.status).toBe("insufficient");
    expect(result.suggestion).toBeUndefined();
  });

  it("suggests a provisional match only from enough distinct, meaningful evidence", () => {
    const session = exercised(initial());
    const result = proposePassiveAtlas(session, 1_120_000);
    expect(result.status).toBe("ready");
    expect(result.suggestion?.id).toMatch(/^[a-z]+$/);
    expect(result.alternatives).toHaveLength(2);
    expect(result.confidenceLabel).toBe("provisional");
    expect(result.explanation.some(x => /practice|setup|study/i.test(x))).toBe(true);
    expect(result.proposedConfig.requiresApproval).toBe(true);
    expect(result.proposedConfig.automaticallyChangesAccount).toBe(false);
    expect(result.proposedConfig.subscribesToEmail).toBe(false);
  });

  it("is order-independent and does not claim mastery or psychological diagnosis", () => {
    const session = initial();
    const a = exercised(session);
    const b = capturePassiveFirstRun(
      capturePassiveFirstRun(
        capturePassiveFirstRun(session, "review-source", 1_085_000), "begin-practice", 1_075_000
      ), "visit-questions", 1_065_000
    );
    expect(proposePassiveAtlas(a, 1_120_000).suggestion?.id).toBe(proposePassiveAtlas(b, 1_120_000).suggestion?.id);
    const out = proposePassiveAtlas(a, 1_120_000);
    expect(JSON.stringify(out)).not.toMatch(/diagnosis|IQ|mastery score|psychological certainty/i);
  });

  it("ends the bounded observation after the window, never accepting late events", () => {
    const session = initial();
    const expired = capturePassiveFirstRun(session, "begin-practice", session.startedAt + FIRST_RUN_WINDOW_MS + 1);
    expect(expired).toEqual(session);
    expect(proposePassiveAtlas(session, session.startedAt + FIRST_RUN_WINDOW_MS + 1).status).toBe("insufficient");
  });

  it("restores only allowlisted aggregate data and rejects poisoned session payloads", () => {
    const original = initial();
    const payload = JSON.parse(serializePassiveFirstRun(original));
    payload.journal = "private entry";
    payload.counts["raw-scroll"] = 200000;
    payload.counts["visit-questions"] = 999999;
    const restored = restorePassiveFirstRun(JSON.stringify(payload));
    expect(restored?.counts["visit-questions"]).toBeLessThanOrEqual(2);
    expect(Object.hasOwn(restored?.counts ?? {}, "raw-scroll")).toBe(false);
    expect(serializePassiveFirstRun(restored!)).not.toContain("private entry");
    expect(restorePassiveFirstRun("not-json")).toBeNull();
  });
});
