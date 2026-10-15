// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { dayKey } from "../lib/scoring";
import { localDateKey } from "../lib/dailyRollover";
import type { JournalImageAttachment } from "../lib/journalNotebook";
import * as localVault from "../lib/localVault";
import { useAccount } from "../lib/account/accountStore";
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
  useUi.setState({ journalDay: null, settingsRequest: null });
  useAccount.setState({ link: "unlinked", protection: "local-only", syncFailure: undefined });
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

  it("keeps the current page and draft open when a page-turn write cannot be confirmed", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const writing = screen.getByLabelText("Free writing");
    fireEvent.change(writing, { target: { value: "Do not turn away from this draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(useUi.getState().journalDay).toBeNull();
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(screen.getByDisplayValue("Do not turn away from this draft")).toBeTruthy();
    expect(screen.queryByDisplayValue("Yesterday was grounded.")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/still open.*export.*retry Save/i);
  });

  it("does not close to the Library until the current draft is durable", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep the notebook open" } });

    fireEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByLabelText("Journal notebook")).toBeTruthy();
    expect(screen.getByDisplayValue("Keep the notebook open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open today’s page/i })).toBeNull();
  });

  it("gates requested-day and editor-close transitions on the same exact write check", async () => {
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockImplementationOnce(() => new Promise<void>((resolve) => { confirmDurability = resolve; }))
      .mockRejectedValue(new Error("Forced durable write failure"));
    const assertExactWrite = vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    const assertWritesSince = vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByText("Yesterday was grounded.").closest("button")!);
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Yesterday remains visible until durable" } });

    act(() => { useUi.getState().remediateStandup(TODAY_KEY); });
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(useUi.getState().journalDay).toBe(TODAY_KEY);
    expect(screen.getByDisplayValue("Yesterday remains visible until durable")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today’s page" })).toBeNull();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(await screen.findByRole("dialog", { name: "New standup" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(useUi.getState().journalDay).toBeNull();
    expect(assertExactWrite).toHaveBeenCalledTimes(1);
    expect(assertWritesSince).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Cancel must not discard this" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit standup" })).toBeTruthy();
    expect(screen.getByDisplayValue("Cancel must not discard this")).toBeTruthy();
  });

  it("keeps a failed requested-day intent and its current draft intact", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced requested-day failure"));
    render(<JournalPage />);
    fireEvent.click(screen.getByText("Yesterday was grounded.").closest("button")!);
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep this page and the requested day" } });

    act(() => { useUi.getState().remediateStandup(TODAY_KEY); });

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(useUi.getState().journalDay).toBe(TODAY_KEY);
    expect(screen.getByDisplayValue("Keep this page and the requested day")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today’s page" })).toBeNull();
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

  it("reports an autosave only after the local vault confirms durability", async () => {
    vi.useFakeTimers();
    let confirmDurability!: () => void;
    vi.spyOn(localVault, "flushLocalVaultWrites").mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    const writing = screen.getByLabelText("Free writing");
    fireEvent.change(writing, { target: { value: "Local autosave text" } });
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Local autosave text", notebookStatus: "draft" });
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(screen.getByText("Saved to this workspace")).toBeTruthy();
  });

  it("warns on unload only while the visible draft is still dirty", async () => {
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Warn until this draft is durable" } });

    const dirtyUnload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved to this workspace")).toBeTruthy());
    const savedUnload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it("starts an immediate best-effort save on page hide or hidden visibility and removes lifecycle listeners", async () => {
    vi.useFakeTimers();
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites").mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const view = render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Persist on page hide without waiting 420 ms" } });

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Persist on page hide without waiting 420 ms" });
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Persist when the page becomes hidden" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(flush).toHaveBeenCalledTimes(2);
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Persist when the page becomes hidden" });
    await act(async () => { await Promise.resolve(); });

    view.unmount();
    expect(removeWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("reports Done as saved only after the completed entry is durable", async () => {
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    const assertExactWrite = vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    const assertWritesSince = vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "A completed durable page" } });

    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "A completed durable page", notebookStatus: "complete" });

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(screen.getByText("Saved to this workspace")).toBeTruthy();
    expect(assertExactWrite).toHaveBeenCalledTimes(1);
    expect(assertWritesSince).toHaveBeenCalledTimes(1);
  });

  it("does not claim or attempt completion for a blank new page", async () => {
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites");
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));

    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));

    expect(screen.getByRole("alert").textContent).toMatch(/write one line.*nothing has been saved yet/i);
    expect(screen.getByText("Ready to write")).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(flush).not.toHaveBeenCalled();
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))).toBeUndefined();
  });

  it("keeps failed saves open in memory and never labels them durable", async () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Still open in memory" } });

    await act(async () => { vi.advanceTimersByTime(450); await Promise.resolve(); });
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Still open in memory" });
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(screen.getByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/still open.*could not confirm.*local storage/i);
  });

  it("shows the exact account size refusal beside Journal images with recovery actions", async () => {
    useAccount.setState({
      link: "linked",
      protection: "blocked",
      syncFailure: { kind: "rejected", rejection: "too-large", status: 0, at: "2026-10-15T10:00:00.000Z" },
    });
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal/i }));

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toMatch(/Account protection blocked/);
    expect(warning.textContent).toMatch(/locally confirmed Journal copy remains on this device.*not protected in your account/);
    expect(warning.textContent).toMatch(/prepared workspace exceeds the 14 MB account limit/);
    fireEvent.click(within(warning).getByRole("button", { name: "Emergency recovery" }));
    expect(useUi.getState().settingsRequest).toBe("backup");
    fireEvent.click(within(warning).getByRole("button", { name: "Open Account" }));
    expect(useUi.getState().settingsRequest).toBe("account");
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
    expect(screen.getByText(/saved locally first in IndexedDB/i)).toBeTruthy();
    expect(screen.getByText(/owner-private backups when the workspace fits account limits/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing is uploaded/i)).toBeNull();
    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["not an image"], "notes.txt", { type: "text/plain" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain("Use a JPG, PNG, WebP, or GIF image.");

    fireEvent.click(screen.getByRole("button", { name: "Export study-desk.png" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove study-desk.png" }));
    await waitFor(() => expect(screen.queryByAltText("study-desk.png")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useStore.getState().journal[0].attachments).toEqual([]));
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
