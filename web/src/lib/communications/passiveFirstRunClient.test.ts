// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_RUN_WINDOW_MS } from "./passiveFirstRun";
import { useAccount } from "../account/accountStore";
import {
  PASSIVE_ATLAS_SESSION_KEY, PASSIVE_ATLAS_CHOICE_KEY,
  confirmAtlasCompanion, disableAtlasCompanion, dismissPassiveAtlas,
  notePassiveAtlasAction, readConfirmedAtlasCompanion, readConfirmedAtlasPriority, discardAtlasObservationOnAccountChange, readPassiveAtlasProposal,
  readPassiveAtlasSession, startPassiveAtlasOnboarding,
} from "./passiveFirstRunClient";

const t = 1_900_000_000_000;
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  useAccount.setState({ phase: "signed-out", user: null });
  vi.restoreAllMocks();
});

describe("first-run Atlas local-only privacy boundary", () => {
  it("does not observe or persist anything without informed opt-in", () => {
    startPassiveAtlasOnboarding({ consent: false, changedFields: ["tools"], tools: ["questions"] }, t);
    notePassiveAtlasAction("visit-questions", t + 1000);
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
    expect(readPassiveAtlasProposal(t + 1000).status).toBe("off");
  });

  it("rejects a guest observation after a reload into a different account", () => {
    startPassiveAtlasOnboarding({ consent: true, changedFields: ["tools"], tools: ["questions"] }, t);
    expect(readPassiveAtlasSession(t)).not.toBeNull();
    useAccount.setState({ phase: "signed-in", user: {
      id: accountA, email: "first@example.com", displayName: "First", emailConfirmed: true,
    } });
    expect(readPassiveAtlasSession(t + 100)).toBeNull();
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
    expect(readPassiveAtlasProposal(t + 100).status).toBe("off");
  });

  it("discards unaccepted first-run observations when the active account changes", () => {
    startPassiveAtlasOnboarding({ consent: true, changedFields: ["tools"], tools: ["questions"] }, t);
    expect(readPassiveAtlasSession(t)).not.toBeNull();
    expect(discardAtlasObservationOnAccountChange(null, accountA)).toBe(true);
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
    confirmAtlasCompanion("juniper", t, accountA);
    expect(discardAtlasObservationOnAccountChange(accountA, accountA)).toBe(false);
    expect(readConfirmedAtlasCompanion(accountA)).toBe("juniper");
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

  it("stores only the accepted layout suggestion, not the observation, and isolates it by account", () => {
    startPassiveAtlasOnboarding({
      consent: true, changedFields: ["tools", "questionTiming"], tools: ["questions"],
      questionTiming: "after-first-pass",
    }, t);
    notePassiveAtlasAction("visit-questions", t + 65000);
    notePassiveAtlasAction("begin-practice", t + 75000);
    const recommendation = readPassiveAtlasProposal(t + 85000);
    expect(recommendation.status).toBe("ready");
    expect(confirmAtlasCompanion("juniper", t + 85000, accountA, "question-bank")).toBe(true);
    expect(readConfirmedAtlasPriority(accountA)).toBe("question-bank");
    expect(readConfirmedAtlasPriority(accountB)).toBeNull();
    const saved = localStorage.getItem(PASSIVE_ATLAS_CHOICE_KEY + ":" + accountA) ?? "";
    expect(saved).not.toContain("counts");
    expect(saved).not.toContain("begin-practice");
    expect(saved).not.toContain("tools");
    expect(saved).not.toContain("questionTiming");
    disableAtlasCompanion(accountA);
    expect(readConfirmedAtlasPriority(accountA)).toBeNull();
  });

  it("notifies UI of confirmed changes without exposing user data", () => {
    const observer = vi.fn();
    window.addEventListener("axom:atlas-companion-changed", observer);
    try {
      expect(confirmAtlasCompanion("juniper", t, accountA)).toBe(true);
      disableAtlasCompanion(accountA);
      expect(observer).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("axom:atlas-companion-changed", observer);
    }
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
