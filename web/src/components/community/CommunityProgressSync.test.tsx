// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityProfileMissingError, readShareMode, syncSharedProgress } from "../../lib/community/community";
import { useCommunityShare } from "../../lib/community/shareStore";
import { isoDate } from "../../lib/scoring";
import { addDays } from "../../lib/community/progressBoard";
import { CommunityProgressSync, resetCommunityProgressSyncForTests } from "./CommunityProgressSync";

const state = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>> }));
vi.mock("../../lib/account/accountStore", () => {
  const useAccount = (select: (value: { user: { id: string } }) => unknown) => select({ user: { id: "me" } });
  useAccount.getState = () => ({ user: { id: "me" } });
  return { useAccount };
});
vi.mock("../../lib/store", () => {
  const useStore = (select: (value: typeof state) => unknown) => select(state);
  useStore.getState = () => state;
  return { useStore };
});
vi.mock("../../lib/community/community", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/community/community")>(),
  readShareMode: vi.fn(),
  syncSharedProgress: vi.fn(),
}));

const today = isoDate(new Date());
/** Lets the choice load, the first-run timer fire and the sync settle. */
async function settle() {
  for (let step = 0; step < 6; step++) await act(async () => { await vi.advanceTimersByTimeAsync(500); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetCommunityProgressSyncForTests();
  state.logs = [];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("automatic progress sync", () => {
  it("shares yesterday and today once the account's choice is on, and reports today as shared", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 25, cards: 3, quantity: 4, quantityKind: "questions" }];
    vi.mocked(readShareMode).mockResolvedValue("friends");
    vi.mocked(syncSharedProgress).mockImplementation(async (_id, _mode, entries) =>
      entries.map(entry => ({ day: entry.day, action: entry.minutes ? "inserted" as const : "skipped" as const })));
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).toHaveBeenCalledWith("me", "friends", [
      { day: addDays(today, -1), minutes: 0, cards: 0, questions: 0 },
      { day: today, minutes: 25, cards: 3, questions: 4 },
    ]);
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "me", mode: "friends", status: "shared" });
  });

  it("stays idle when nothing is logged today and never syncs while sharing is off", async () => {
    vi.mocked(readShareMode).mockResolvedValue("community");
    vi.mocked(syncSharedProgress).mockImplementation(async (_id, _mode, entries) => entries.map(entry => ({ day: entry.day, action: "skipped" as const })));
    render(<CommunityProgressSync />);
    await settle();
    expect(useCommunityShare.getState().status).toBe("idle");
    cleanup();
    vi.mocked(syncSharedProgress).mockClear();
    vi.mocked(readShareMode).mockResolvedValue("off");
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).not.toHaveBeenCalled();
  });

  it("asks to join Community when the account has no profile", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 10 }];
    vi.mocked(readShareMode).mockResolvedValue("friends");
    vi.mocked(syncSharedProgress).mockRejectedValue(new CommunityProfileMissingError("Join Community before sharing your daily totals."));
    render(<CommunityProgressSync />);
    await settle();
    expect(useCommunityShare.getState()).toMatchObject({ status: "needs-profile", message: "Join Community before sharing your daily totals." });
  });
});
