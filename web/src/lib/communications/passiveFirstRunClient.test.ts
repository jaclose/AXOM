// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_RUN_WINDOW_MS } from "./passiveFirstRun";
import {
  PASSIVE_ATLAS_SESSION_KEY, PASSIVE_ATLAS_CHOICE_KEY,
  confirmAtlasCompanion, disableAtlasCompanion, dismissPassiveAtlas,
  notePassiveAtlasAction, readConfirmedAtlasCompanion, readPassiveAtlasProposal,
  readPassiveAtlasSession, startPassiveAtlasOnboarding,
} from "./passiveFirstRunClient";

const t = 1_900_000_000_000;
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("first-run Atlas local-only privacy boundary", () => {
  it("does not observe or persist anything without informed opt-in", () => {
    startPassiveAtlasOnboarding({ consent: false, changedFields: ["tools"], tools: ["questions"] }, t);
    notePassiveAtlasAction("visit-questions", t + 1000);
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
    expect(readPassiveAtlasProposal(t + 1000).status).toBe("off");
  });

  it("keeps only bounded semantic counts in this tab and never posts to a provider", () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network unavailable"));
    startPassiveAtlasOnboarding({
      consent: true, changedFields: ["tools", "questionTiming"],
      tools: ["questions", "anki"], questionTiming: "after-first-pass",
    }, t);
    notePassiveAtlasAction("visit-questions", t + 60_001);
    notePassiveAtlasAction("begin-practice", t + 70_000);
    notePassiveAtlasAction("review-source", t + 80_000);
    expect(readPassiveAtlasProposal(t + 100_000).status).toBe("ready");
    const raw = sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY) ?? "";
    expect(raw).toContain("begin-practice");
    expect(raw).not.toContain("clickX");
    expect(raw).not.toContain("journal");
    expect(raw).not.toContain("email");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("scopes confirmed choices to the account, with no cross-account bleed", () => {
    expect(confirmAtlasCompanion("juniper", t, accountA)).toBe(true);
    expect(readConfirmedAtlasCompanion(accountA)).toBe("juniper");
    expect(readConfirmedAtlasCompanion(accountB)).toBeNull();
    expect(readConfirmedAtlasCompanion()).toBeNull();
    expect(localStorage.getItem(PASSIVE_ATLAS_CHOICE_KEY + ":" + accountA)).toContain("juniper");
    expect(confirmAtlasCompanion("atlas", t, accountB)).toBe(true);
    disableAtlasCompanion(accountA);
    expect(readConfirmedAtlasCompanion(accountA)).toBeNull();
    expect(readConfirmedAtlasCompanion(accountB)).toBe("atlas");
  });

  it("a reviewed choice clears the temporary observation, and explicit decline does too", () => {
    startPassiveAtlasOnboarding({ consent: true, changedFields: [], tools: [] }, t);
    expect(readPassiveAtlasSession(t)).not.toBeNull();
    expect(confirmAtlasCompanion("juniper", t)).toBe(true);
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
    startPassiveAtlasOnboarding({ consent: true, changedFields: [], tools: [] }, t);
    dismissPassiveAtlas();
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
  });

  it("expires unaccepted aggregates without uploading or retaining the raw event history", () => {
    startPassiveAtlasOnboarding({ consent: true, changedFields: ["tools"], tools: ["questions"] }, t);
    expect(readPassiveAtlasSession(t + FIRST_RUN_WINDOW_MS)).not.toBeNull();
    expect(readPassiveAtlasSession(t + FIRST_RUN_WINDOW_MS + 9 * 60_000 + 1)).toBeNull();
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
  });
});
