import { beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import type { DailyWordPuzzleState } from "./types";

function puzzle(patch: Partial<DailyWordPuzzleState> = {}): DailyWordPuzzleState {
  return {
    puzzleId: "daily-word:general-1:2026-07-12",
    puzzleDate: "2026-07-12",
    timezone: "America/Grenada",
    wordListVersion: "general-1",
    guesses: [],
    completed: false,
    won: false,
    startedAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    ...patch,
  };
}

beforeEach(() => {
  useStore.setState(makeSeed());
});

describe("Daily Games workspace persistence", () => {
  it("keeps hints and a reveal through upserts and a whole-workspace replace", () => {
    useStore.getState().upsertDailyWordPuzzle(puzzle({ hintsUsed: 2, updatedAt: "2026-07-12T10:02:00.000Z" }));
    expect(useStore.getState().dailyWordPuzzles[0]).toMatchObject({ hintsUsed: 2 });
    useStore.getState().upsertDailyWordPuzzle(puzzle({
      hintsUsed: 3, revealed: true, completed: true, won: false,
      completedAt: "2026-07-12T10:03:00.000Z", updatedAt: "2026-07-12T10:03:00.000Z",
    }));
    const saved = useStore.getState();
    useStore.getState().replaceAll({ ...saved });
    expect(useStore.getState().dailyWordPuzzles[0]).toMatchObject({ hintsUsed: 3, revealed: true, completed: true, won: false });
  });

  it("upserts one record per puzzleId and never lets stale progress replace a completion", () => {
    const store = useStore.getState();
    store.upsertDailyWordPuzzle(puzzle({ guesses: ["APPLE"], updatedAt: "2026-07-12T10:01:00.000Z" }));
    useStore.getState().upsertDailyWordPuzzle(puzzle({
      guesses: ["APPLE", "BERRY"],
      completed: true,
      won: true,
      completedAt: "2026-07-12T10:02:00.000Z",
      updatedAt: "2026-07-12T10:02:00.000Z",
    }));
    useStore.getState().upsertDailyWordPuzzle(puzzle({ guesses: [], updatedAt: "2026-07-12T10:03:00.000Z" }));

    expect(useStore.getState().dailyWordPuzzles).toHaveLength(1);
    expect(useStore.getState().dailyWordPuzzles[0]).toMatchObject({
      completed: true,
      won: true,
      guesses: ["APPLE", "BERRY"],
    });
  });

  it("scoped reset clears only Daily Word history and preserves enablement and unrelated workspace data", () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        experimentalFlags: { ...state.profile.experimentalFlags, dailyGames: true },
      },
      dailyWordPuzzles: [puzzle()],
    }));
    const tasks = structuredClone(useStore.getState().tasks);

    useStore.getState().resetDailyWordPuzzles();

    expect(useStore.getState().dailyWordPuzzles).toEqual([]);
    expect(useStore.getState().profile.experimentalFlags?.dailyGames).toBe(true);
    expect(useStore.getState().tasks).toEqual(tasks);
  });

  it("starter reset returns Daily Games to disabled with empty history", () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        experimentalFlags: { ...state.profile.experimentalFlags, dailyGames: true },
      },
      dailyWordPuzzles: [puzzle()],
    }));

    useStore.getState().resetToSeed();

    expect(useStore.getState().profile.experimentalFlags?.dailyGames).toBe(false);
    expect(useStore.getState().dailyWordPuzzles).toEqual([]);
  });
});
