// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityProfileMissingError, readCommunityPreferences, syncSharedProgress } from "../../lib/community/community";
import { setCommunityShareMode, useCommunityShare } from "../../lib/community/shareStore";
import { isoDate } from "../../lib/scoring";
import { addDays } from "../../lib/community/progressBoard";
import { CommunityProgressSync, resetCommunityProgressSyncForTests, retryCommunityProgress } from "./CommunityProgressSync";

const state = vi.hoisted(() => ({ logs: [] as Array<Record<string, unknown>>, linked: true, applyingRemote: false }));
vi.mock("../../lib/account/accountStore", () => {
  const account = () => ({ user: { id: "me" }, link: state.linked ? "linked" : "unlinked", applyingRemote: state.applyingRemote });
  const useAccount = (select: (value: ReturnType<typeof account>) => unknown) => select(account());
  useAccount.getState = account;
  return { useAccount };
});
vi.mock("../../lib/store", () => {
  const useStore = (select: (value: typeof state) => unknown) => select(state);
  useStore.getState = () => state;
  return { useStore };
});
vi.mock("../../lib/community/community", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/community/community")>(),
  readCommunityPreferences: vi.fn(),
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
  state.linked = true;
  state.applyingRemote = false;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("automatic progress sync", () => {
  it("shares yesterday and today once the account's choice is on, and reports today as shared", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 25, cards: 3, quantity: 4, quantityKind: "questions" }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    vi.mocked(syncSharedProgress).mockImplementation(async (_id, _mode, entries) =>
      entries.map(entry => ({ day: entry.day, action: entry.minutes ? "inserted" as const : "skipped" as const })));
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).toHaveBeenCalledWith("me", "friends", [
      { day: addDays(today, -1), minutes: 0, cards: 0, questions: 0 },
      { day: today, minutes: 25, cards: 3, questions: 4 },
    ], { signal: expect.any(AbortSignal), consentRevision: 3 });
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "me", mode: "friends", revision: 3, status: "shared" });
  });

  it("stays idle when nothing is logged today and never syncs while sharing is off", async () => {
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "community", revision: 3 });
    vi.mocked(syncSharedProgress).mockImplementation(async (_id, _mode, entries) => entries.map(entry => ({ day: entry.day, action: "skipped" as const })));
    render(<CommunityProgressSync />);
    await settle();
    expect(useCommunityShare.getState().status).toBe("idle");
    cleanup();
    vi.mocked(syncSharedProgress).mockClear();
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "off", revision: 4 });
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).not.toHaveBeenCalled();
  });

  it("asks to join Community when the account has no profile", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 10 }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    vi.mocked(syncSharedProgress).mockRejectedValue(new CommunityProfileMissingError("Join Community before sharing your daily totals."));
    render(<CommunityProgressSync />);
    await settle();
    expect(useCommunityShare.getState()).toMatchObject({ status: "needs-profile", message: "Join Community before sharing your daily totals." });
  });

  it("aborts in-flight work when sharing is disabled and ignores its late success", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 25, cards: 0 }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    let finish!: (value: Awaited<ReturnType<typeof syncSharedProgress>>) => void;
    vi.mocked(syncSharedProgress).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<CommunityProgressSync />);
    await settle();
    const signal = vi.mocked(syncSharedProgress).mock.calls[0][3]?.signal;
    await act(async () => { setCommunityShareMode("me", "off", 4); });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish([{ day: today, action: "inserted" }]); });
    expect(useCommunityShare.getState()).toMatchObject({ mode: "off", status: "idle", lastSharedAt: undefined });
  });

  it("will not publish a retained unlinked workspace on account sign-in", async () => {
    state.linked = false;
    state.logs = [{ id: "a", dayKey: today, minutes: 25 }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).not.toHaveBeenCalled();
    expect(useCommunityShare.getState().status).toBe("needs-device");
  });

  it("defers automatic sharing while account work is being restored", async () => {
    state.applyingRemote = true;
    state.logs = [{ id: "a", dayKey: today, minutes: 25 }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    render(<CommunityProgressSync />);
    await settle();
    expect(syncSharedProgress).not.toHaveBeenCalled();
  });

  it("explicit retry runs after a network error even when consent is unchanged", async () => {
    state.logs = [{ id: "a", dayKey: today, minutes: 25 }];
    vi.mocked(readCommunityPreferences).mockResolvedValue({ discoverable: true, shareMode: "friends", revision: 3 });
    vi.mocked(syncSharedProgress).mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue([{ day: today, action: "inserted" }]);
    render(<CommunityProgressSync />);
    await settle();
    expect(useCommunityShare.getState().status).toBe("error");
    await act(async () => { await retryCommunityProgress("me"); });
    await settle();
    expect(syncSharedProgress).toHaveBeenCalledTimes(2);
    expect(useCommunityShare.getState().status).toBe("shared");
  });

});
