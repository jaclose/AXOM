// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { dayKey } from "../lib/scoring";
import { localDateKey } from "../lib/dailyRollover";
import type { JournalImageAttachment } from "../lib/journalNotebook";
import { JournalPage } from "./JournalPage";

// Derive dates exactly the way the app does — hard-coded calendar dates made
// this suite expire two days after it was written (found 2026-07-15).
const TODAY_KEY = dayKey();
const LOCAL_TODAY = localDateKey();
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const YESTERDAY_KEY = shiftKey(TODAY_KEY, -1);

const localImage: JournalImageAttachment = {
  id: "local-image",
  name: "study-desk.png",
  type: "image/png",
  size: 4,
  createdAt: "2026-07-13T12:00:00.000Z",
  dataUrl: "data:image/png;base64,YXhvbQ==",
};

beforeEach(() => {
  useStore.setState({
    ...makeSeed(),
    activeDayKey: TODAY_KEY,
    lastActiveLocalDate: LOCAL_TODAY,
    dayPlans: [],
    logs: [],
    tasks: [],
    journal: [{
      id: "yesterday",
      date: `${YESTERDAY_KEY}T12:00:00`,
      today: "Yesterday was grounded.",
      tomorrow: "Continue.",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    }],
  });
  useUi.setState({ journalDay: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Journal notebook foundation", () => {
  it("opens the premium notebook and turns pages with buttons without losing text", async () => {
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    expect(await screen.findByRole("heading", { name: "Today’s page" })).toBeTruthy();

    const reflection = screen.getByLabelText("Today — did you do what you set out to do?");
    fireEvent.change(reflection, { target: { value: "A sentence that must survive the turn." } });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next journal page" }));
    expect(await screen.findByDisplayValue("A sentence that must survive the turn.")).toBeTruthy();

    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))?.today)
      .toBe("A sentence that must survive the turn.");
  });

  it("supports keyboard page turns away from form controls", async () => {
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const notebook = await screen.findByLabelText("Journal notebook");
    fireEvent.keyDown(notebook, { key: "ArrowLeft" });
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("Journal notebook"), { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Today’s page" })).toBeTruthy();
  });

  it("marks the notebook reduced-motion and keeps all writing controls semantic", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const notebook = await screen.findByLabelText("Journal notebook");
    expect(notebook.getAttribute("data-motion")).toBe("reduced");
    expect(screen.getByLabelText("Free writing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Include in journal" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your day, recorded" })).toBeTruthy();
  });

  it("autosaves free writing into the IndexedDB-backed workspace state", async () => {
    vi.useFakeTimers();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const writing = screen.getByLabelText("Free writing");
    fireEvent.change(writing, { target: { value: "Local autosave text" } });
    expect(screen.getByText("Saving locally…")).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Local autosave text", notebookStatus: "draft" });
    expect(screen.getByText("Saved locally")).toBeTruthy();
  });

  it("rejects unsafe files, removes a local image, and exports without a network call", async () => {
    useStore.setState({
      journal: [{
        id: "today",
        date: `${TODAY_KEY}T12:00:00`,
        today: "Saved page",
        tomorrow: "",
        blockers: "",
        energy: "",
        rating: "Daily review",
        attachments: [localImage],
      }],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createObjectURL = vi.fn(() => "blob:journal-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["not an image"], "notes.txt", { type: "text/plain" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain("Use a JPG, PNG, WebP, or GIF image.");

    fireEvent.click(screen.getByRole("button", { name: "Export study-desk.png" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove study-desk.png" }));
    await waitFor(() => expect(screen.queryByAltText("study-desk.png")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().journal[0].attachments).toEqual([]);
  });

  it("never renders malformed attachment metadata injected by an imported workspace", async () => {
    useStore.setState({
      journal: [{
        id: "unsafe-import",
        date: `${TODAY_KEY}T12:00:00`,
        today: "Imported text remains intact.",
        tomorrow: "",
        blockers: "",
        energy: "",
        rating: "Daily review",
        attachments: [{
          id: "unsafe-svg",
          name: "unsafe.svg",
          type: "image/svg+xml",
          size: 100,
          createdAt: "not-a-date",
          dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        } as unknown as JournalImageAttachment, {
          id: "mismatched-prefix",
          name: "claimed.png",
          type: "image/png",
          size: 4,
          createdAt: "2026-07-13T12:00:00.000Z",
          dataUrl: "data:image/jpeg;base64,YXhvbQ==",
        }],
      }],
    });

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    expect(await screen.findByDisplayValue("Imported text remains intact.")).toBeTruthy();
    expect(screen.queryByAltText("unsafe.svg")).toBeNull();
    expect(screen.queryByAltText("claimed.png")).toBeNull();
    expect(screen.queryByRole("button", { name: /Export unsafe|Export claimed/ })).toBeNull();
  });

  it("includes the day's summary automatically, with the user's corrections and omissions", async () => {
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.click(screen.getByRole("button", { name: "Correct Focused time" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Correct Focused time" }), { target: { value: "45 min after correcting a late log" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide Energy and readiness" }));
    const recorded = screen.getByRole("region", { name: "Your day, recorded" });
    expect(within(recorded).getByText(/Focused time: 45 min after correcting a late log/)).toBeTruthy();
    expect(within(recorded).queryByText(/Energy and readiness/)).toBeNull();
    expect(screen.getByText(/Every visible line is included in your page automatically/)).toBeTruthy();
  });
});
