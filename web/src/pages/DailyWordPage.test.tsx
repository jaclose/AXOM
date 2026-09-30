// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDailyWordPuzzle, type DailyWordPuzzleState } from "../lib/dailyWord";
import { useStore } from "../lib/store";
import { DailyWordPage } from "./DailyWordPage";

const FIXED_NOW = new Date("2026-07-12T14:00:00.000Z");
const clipboardWrite = vi.fn<(value: string) => Promise<void>>();
const localValues = new Map<string, string>();
const memoryLocalStorage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key: string) => localValues.get(key) ?? null,
  key: (index: number) => [...localValues.keys()][index] ?? null,
  removeItem: (key: string) => { localValues.delete(key); },
  setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
};

vi.mock("../lib/clock", () => ({
  useClockNow: () => FIXED_NOW,
}));

vi.mock("../data/dailyWordWords", () => ({
  DAILY_WORD_ANSWERS: ["APPLE"],
  DAILY_WORD_ALLOWED_GUESSES: ["APPLE", "ALLEY", "LEVEL", "SHEEP", "BANAL", "SASSY", "CRANE", "BLUSH", "POINT", "MIGHT", "HELLO", "ENVOY"],
  dailyWordAnswersForVersion: (version: string) => ["general-1", "general-2"].includes(version) ? ["APPLE"] : undefined,
  WORD_LIST_VERSION: "general-2",
  DAILY_WORD_LIST_SENTINEL: "AXOM_WORD_LIST_SENTINEL_GENERAL_2_SCOWL_2026_02_25",
}));

beforeEach(() => {
  localValues.clear();
  vi.stubGlobal("localStorage", memoryLocalStorage);
  clipboardWrite.mockReset();
  clipboardWrite.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
  act(() => {
    const profile = useStore.getState().profile;
    useStore.setState({
      profile: {
        ...profile,
        name: "Daily Word Tester",
        timeZonePreference: { mode: "custom", customTimezone: "America/Grenada" },
      },
      dailyWordPuzzles: [],
    });
  });
});

afterEach(() => {
  cleanup();
  act(() => { useStore.setState({ dailyWordPuzzles: [] }); });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DailyWordPage input and scoring integration", () => {
  it("supports physical input, ignores unrelated fields, and renders duplicate-safe semantic results", async () => {
    render(<><input aria-label="Unrelated notes" /><DailyWordPage /></>);
    await openPuzzle();

    const notes = screen.getByRole("textbox", { name: "Unrelated notes" });
    notes.focus();
    fireEvent.keyDown(notes, { key: "A" });
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, blank." })).toBeTruthy();

    notes.blur();
    enterPhysicalWord("ALLEY");
    fireEvent.keyDown(window, { key: "Enter" });

    await screen.findByText("1 correct position; 2 present elsewhere.");
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, letter A, correct position." })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, letter L, present in word, wrong position." })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 3, letter L, not in word." })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 4, letter E, present in word, wrong position." })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 5, letter Y, not in word." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Letter L, present in word, wrong position" })).toBeTruthy();
  });

  it("supports on-screen entry, Backspace, and controlled invalid-word announcements", async () => {
    const user = userEvent.setup();
    render(<DailyWordPage />);
    await openPuzzle();

    await user.click(screen.getByRole("button", { name: "Letter A" }));
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(screen.getByRole("status").textContent).toContain("Enter five letters.");

    await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (let index = 0; index < 5; index += 1) await user.click(screen.getByRole("button", { name: "Letter Z" }));
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(screen.getByRole("status").textContent).toContain("Not recognized in AXOM’s current dictionary.");
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual([]);
  });

  it("rejects duplicate guesses without persisting a second copy", async () => {
    render(<DailyWordPage />);
    await openPuzzle();

    enterPhysicalWord("HELLO");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["HELLO"]));
    enterPhysicalWord("HELLO");
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("status").textContent).toBe("That word was already used.");
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["HELLO"]);
  });

  it("keeps TRAPE unresolved and offers a safe local mail draft without gameplay network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<DailyWordPage />);
    await openPuzzle();

    enterPhysicalWord("TRAPE");
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("status").textContent).toBe("Not recognized in AXOM’s current dictionary.");
    const suggestion = screen.getByRole("link", { name: "Suggest this word" }) as HTMLAnchorElement;
    const decoded = decodeURIComponent(suggestion.getAttribute("href") ?? "");
    expect(decoded).toContain("mailto:jafardabbagh@gmail.com");
    expect(decoded).toContain("[AXOM Suggestion] Daily Word: TRAPE");
    expect(decoded).toContain("Suggested word: TRAPE");
    expect(decoded).toContain("Dictionary version: general-2");
    expect(decoded).toContain("Route: #daily-word");
    expect(decoded).not.toContain(useStore.getState().profile.name);
    expect(decoded).not.toContain("APPLE");
    expect(decoded).not.toContain("2026-07-12");
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts HELLO and ENVOY through the expanded local dictionary", async () => {
    render(<DailyWordPage />);
    await openPuzzle();

    enterPhysicalWord("HELLO");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["HELLO"]));

    enterPhysicalWord("ENVOY");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["HELLO", "ENVOY"]));
  });

  it("wins through the on-screen keyboard, reveals the answer only then, and locks all input", async () => {
    const user = userEvent.setup();
    render(<DailyWordPage />);
    await openPuzzle();
    expect(screen.queryByText(/Answer:/)).toBeNull();

    for (const letter of "APPLE") await user.click(screen.getByRole("button", { name: `Letter ${letter}` }));
    await user.click(screen.getByRole("button", { name: "Enter" }));

    expect(await screen.findByRole("heading", { name: "Puzzle solved" })).toBeTruthy();
    expect(screen.getByText(/Answer:/).textContent).toContain("APPLE");
    expect((screen.getByRole("button", { name: "Enter" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Backspace" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Letter A/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(useStore.getState().dailyWordPuzzles[0]).toMatchObject({ guesses: ["APPLE"], completed: true, won: true });

    fireEvent.keyDown(window, { key: "Z" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["APPLE"]);
  });

  it("completes a six-guess loss, reveals the answer, and rejects further submission", async () => {
    const puzzle = activePuzzle(["ALLEY", "LEVEL", "SHEEP", "BANAL", "SASSY"]);
    act(() => { useStore.setState({ dailyWordPuzzles: [puzzle] }); });
    render(<DailyWordPage />);
    await openPuzzle();

    enterPhysicalWord("CRANE");
    fireEvent.keyDown(window, { key: "Enter" });

    expect(await screen.findByRole("heading", { name: "Puzzle complete" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Six guesses used");
    expect(screen.getByText(/Answer:/).textContent).toContain("APPLE");
    expect(useStore.getState().dailyWordPuzzles[0]).toMatchObject({ completed: true, won: false });
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toHaveLength(6);

    fireEvent.keyDown(window, { key: "A" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toHaveLength(6);
  });
});

describe("DailyWordPage persistence, sharing, and accessibility", () => {
  it("preserves an incomplete unknown-version puzzle without rescoring it", async () => {
    const unsupported = {
      ...createDailyWordPuzzle("2026-07-12", "America/Grenada", "missing-1", FIXED_NOW),
      guesses: ["HELLO"],
    };
    act(() => { useStore.setState({ dailyWordPuzzles: [unsupported] }); });
    render(<DailyWordPage />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/unavailable dictionary version/i);
    expect(useStore.getState().dailyWordPuzzles).toEqual([unsupported]);
  });

  it("rehydrates submitted rows from durable store state without duplicating them on remount", async () => {
    const first = render(<DailyWordPage />);
    await openPuzzle();
    enterPhysicalWord("ALLEY");
    fireEvent.keyDown(window, { key: "Enter" });
    await screen.findByText("1 correct position; 2 present elsewhere.");
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["ALLEY"]);

    first.unmount();
    render(<DailyWordPage />);
    await openPuzzle();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, letter A, correct position." })).toBeTruthy();
    expect(useStore.getState().dailyWordPuzzles).toHaveLength(1);
    expect(useStore.getState().dailyWordPuzzles[0].guesses).toEqual(["ALLEY"]);
  });

  it("copies a result with no answer, guesses, or personal data", async () => {
    act(() => { useStore.setState({ dailyWordPuzzles: [completedPuzzle(["CRANE", "APPLE"], true)] }); });
    render(<DailyWordPage />);
    await openPuzzle();

    fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledOnce());
    const shared = clipboardWrite.mock.calls[0][0];
    expect(shared).toContain("AXOM Daily Word #1 2/6");
    expect(shared).toContain("axom.info");
    expect(shared).not.toContain("APPLE");
    expect(shared).not.toContain("CRANE");
    expect(shared).not.toContain(useStore.getState().profile.name);
    expect(screen.getByRole("status").textContent).toContain("Result copied");
  });

  it("provides a focused manual-copy fallback when clipboard access fails", async () => {
    clipboardWrite.mockRejectedValueOnce(new Error("Denied"));
    act(() => { useStore.setState({ dailyWordPuzzles: [completedPuzzle(["APPLE"], true)] }); });
    render(<DailyWordPage />);
    await openPuzzle();

    fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    const fallback = await screen.findByRole("textbox", { name: "Manual copy result" });
    expect(document.activeElement).toBe(fallback);
    expect((fallback as HTMLTextAreaElement).value).not.toContain("APPLE");
    expect(screen.getByRole("status").textContent).toContain("Clipboard unavailable");
  });

  it("exposes a semantic heading, instructions, grid, labelled tiles, keyboard group, and one status region", async () => {
    render(<DailyWordPage />);
    await openPuzzle();

    expect(screen.getByRole("heading", { level: 1, name: "AXOM Daily Word" })).toBeTruthy();
    expect(screen.getByText("A daily five-letter word puzzle.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "How to play" })).toBeTruthy();
    expect(screen.getByText(/Dictionary general-2/)).toBeTruthy();
    const grid = screen.getByRole("grid", { name: "Six-row Daily Word puzzle for 2026-07-12" });
    expect(within(grid).getAllByRole("row")).toHaveLength(6);
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(30);
    expect(within(grid).getByRole("gridcell", { name: "Row 1, column 1, blank." })).toBeTruthy();
    expect(screen.getByRole("group", { name: "On-screen keyboard" })).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelector('[data-list-marker="AXOM_WORD_LIST_SENTINEL_GENERAL_2_SCOWL_2026_02_25"]')).toBeTruthy();
  });

  it("shows a deterministic next-puzzle countdown after completion", async () => {
    act(() => { useStore.setState({ dailyWordPuzzles: [completedPuzzle(["APPLE"], true)] }); });
    render(<DailyWordPage />);
    await openPuzzle();

    expect(screen.getByText(/Next word in/).textContent).toMatch(/Next word in \d+h \d+m/);
    expect(screen.getByLabelText(/Time until the next Daily Word puzzle:/)).toBeTruthy();
  });

  it("plays the on-board how-to once per announcement version, and typing skips it", async () => {
    const first = render(<DailyWordPage />);
    await openPuzzle();
    expect(await screen.findByRole("button", { name: /Skip/ })).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("axom.announcements.dismissed.v1")).toContain("daily-word-how-to-v1"));
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    first.unmount();

    render(<DailyWordPage />);
    await screen.findByRole("heading", { level: 1, name: "AXOM Daily Word" });
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    expect(screen.getByRole("button", { name: "How to play" })).toBeTruthy();
  });

  it("keeps first-view help safe when device metadata storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      ...memoryLocalStorage,
      getItem: vi.fn((key: string) => {
        if (key === "axom.announcements.dismissed.v1") throw new Error("blocked");
        return memoryLocalStorage.getItem(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        if (key === "axom.announcements.dismissed.v1") throw new Error("blocked");
        memoryLocalStorage.setItem(key, value);
      }),
    });
    render(<DailyWordPage />);
    await openPuzzle();

    expect(await screen.findByRole("button", { name: /Skip/ })).toBeTruthy();
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

async function openPuzzle() {
  await screen.findByRole("heading", { level: 1, name: "AXOM Daily Word" });
  await waitFor(() => expect(useStore.getState().dailyWordPuzzles).toHaveLength(1));
}

function enterPhysicalWord(word: string) {
  for (const letter of word) fireEvent.keyDown(window, { key: letter });
}

function activePuzzle(guesses: string[] = [], version = "general-1"): DailyWordPuzzleState {
  return {
    ...createDailyWordPuzzle("2026-07-12", "America/Grenada", version, FIXED_NOW),
    guesses,
    updatedAt: new Date(FIXED_NOW.getTime() + guesses.length * 1_000).toISOString(),
  };
}

function completedPuzzle(guesses: string[], won: boolean): DailyWordPuzzleState {
  const completedAt = "2026-07-12T14:10:00.000Z";
  return {
    ...activePuzzle(guesses, "general-2"),
    completed: true,
    won,
    completedAt,
    updatedAt: completedAt,
  };
}
