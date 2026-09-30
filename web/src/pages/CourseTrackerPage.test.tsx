// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Toaster } from "../components/shell/Toaster";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useToasts } from "../lib/toast";
import type { TrackerItem } from "../lib/types";
import {
  CourseTrackerPage,
  descendantScopes,
  extractTrackerImportFile,
  groupItemsBySection,
  TRACKER_IMPORT_EXAMPLE,
} from "./CourseTrackerPage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

beforeEach(() => {
  useStore.setState(makeSeed());
  useToasts.setState({ toasts: [] });
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("prompt", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Course Tracker comprehension layout", () => {
  it("shows plan-relative progress and recalculates edited targets without rewriting history", () => {
    const state = useStore.getState();
    useStore.setState({
      tracker: [{ ...state.tracker[0], id: "plan-progress", label: "Planned lecture", kind: "Lecture", passes: 4, ankiPasses: 2, yield: "high", studyPlanOverride: { lecturePasses: 6 } }],
    });
    render(<CourseTrackerPage />);
    const progress = screen.getByRole("progressbar", { name: "Study-plan progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText("4 of 6 passes · 2 remaining")).toBeTruthy();
    expect(screen.getByText("1 item · 0 plan complete · 1 in progress · 0 not started")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit study plan" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Lecture passes"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("4 passes recorded · Target of 2 reached")).toBeTruthy();
    expect(screen.getByText("This scope is complete")).toBeTruthy();
    expect(useStore.getState().tracker[0]).toMatchObject({ passes: 4, ankiPasses: 2, yield: "high" });

    fireEvent.click(screen.getByRole("button", { name: "Edit study plan" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Lecture passes"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(progress.getAttribute("aria-valuenow")).toBe("67");
    expect(screen.queryByText("This scope is complete")).toBeNull();
    expect(useStore.getState().tracker[0].passes).toBe(4);
  });

  it("edits name, type and note in the same dialog as the study plan (I3-29)", () => {
    const state = useStore.getState();
    useStore.setState({ tracker: [{ ...state.tracker[0], id: "edit-me", label: "Old name", kind: "Lecture", passes: 1, note: undefined }] });
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);
    render(<CourseTrackerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Old name" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item · Old name" });
    expect(prompt).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renal clearance" } });
    fireEvent.change(within(dialog).getByLabelText("Note (optional)"), { target: { value: "Weak on free water" } });
    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: "PQ" } });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Study plan" }));
    expect(screen.getByRole("dialog", { name: "Study plan · Old name" })).toBeTruthy();
    // Question sets complete in three rounds: no lecture-pass field to misread.
    expect(within(dialog).queryByLabelText("Lecture passes")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));
    expect(useStore.getState().tracker[0]).toMatchObject({ label: "Renal clearance", kind: "PQ", note: "Weak on free water" });
  });

  it("keeps previously recorded passes visible when a learner lowers the target", () => {
    const state = useStore.getState();
    useStore.setState({ tracker: [{ ...state.tracker[0], kind: "Lecture", passes: 6, studyPlanOverride: { lecturePasses: 2 } }] });
    render(<CourseTrackerPage />);
    expect(screen.getByText("6 passes recorded · Target of 2 reached")).toBeTruthy();
    const sixth = screen.getByTitle("6 lecture passes");
    expect(sixth.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sixth);
    expect(useStore.getState().tracker[0].passes).toBe(5);
  });

  it("lets the learner record and undo the sixth pass in a six-pass plan", () => {
    const state = useStore.getState();
    useStore.setState({
      tracker: [{ ...state.tracker[0], id: "six-passes", label: "Six-pass lecture", kind: "Lecture", passes: 5, studyPlanOverride: { lecturePasses: 6 } }],
    });
    render(<CourseTrackerPage />);
    const sixth = screen.getByTitle("6 lecture passes");
    expect(sixth.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(sixth);
    expect(useStore.getState().tracker[0].passes).toBe(6);
    expect(sixth.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("This scope is complete")).toBeTruthy();
    fireEvent.click(sixth);
    expect(useStore.getState().tracker[0].passes).toBe(5);
    expect(sixth.getAttribute("aria-pressed")).toBe("false");
  });

  it("edits priority without enabling inherited methods or replacing hidden plan settings", () => {
    const state = useStore.getState();
    const item = { ...state.tracker[0], id: "personalized-item", label: "Personalized lecture", studyPlanOverride: {
      reviewAfterDays: 7, customContext: "Keep my original context",
      methods: [{ id: "custom" as const, enabled: true, label: "Whiteboard", timing: "ongoing" as const }],
    } };
    useStore.setState({ tracker: [item], profile: { ...state.profile, studyWorkflow: {
      configured: true, lecturePasses: 4, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }],
    } } });
    render(<CourseTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit study plan" }));
    const dialog = screen.getByRole("dialog", { name: "Study plan · Personalized lecture" });
    expect(within(dialog).getByRole("button", { name: "Anki" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(dialog).getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(within(dialog).getByLabelText("Priority"), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));
    expect(useStore.getState().tracker[0].studyPlanOverride).toEqual(item.studyPlanOverride);
    expect(useStore.getState().tracker[0].explicitPriority).toBe(4);
    expect(useStore.getState().profile.studyWorkflow?.methods).toEqual([{ id: "anki", enabled: false }, { id: "notes", enabled: true }]);
  });

  it("places immediate import/add controls before a separate suggestions card and preserves tracker data", () => {
    const before = structuredClone(useStore.getState().tracker);
    const { container } = render(<CourseTrackerPage />);
    const utilities = screen.getByRole("complementary", { name: "Course Tracker utilities" });
    const workArea = screen.getByRole("region", { name: "Selected Course Tracker scope" });
    const importButton = within(utilities).getByRole("button", { name: "Import lectures or items" });
    const addButton = within(utilities).getByRole("button", { name: "Add course or module" });
    const suggestions = within(utilities).getByText("Suggested next moves").closest(".glass-card")!;

    expect(importButton.compareDocumentPosition(suggestions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(addButton.compareDocumentPosition(suggestions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(workArea).getByText("Items")).toBeTruthy();
    expect(container.querySelectorAll("[data-module-tour]").length).toBeGreaterThanOrEqual(5);
    expect(useStore.getState().tracker).toEqual(before);
  });

  it("opens import and module workflows immediately", () => {
    render(<CourseTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Import lectures or items" }));
    expect(screen.getByRole("dialog", { name: "Import tracker items" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Structured tracker import example" }) as HTMLTextAreaElement).value).toBe(TRACKER_IMPORT_EXAMPLE);
    expect(screen.getByText(/No GPT or provider is required/)).toBeTruthy();
    expect(screen.getByText(/sensitive or private information/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Add course or module" }));
    expect(screen.getByRole("dialog", { name: "Add course module" })).toBeTruthy();
  });

  it("reviews, edits, and imports schedule candidates before persistence", () => {
    render(<CourseTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Import schedule" }));
    const dialog = screen.getByRole("dialog", { name: "Import course schedule" });
    expect(within(dialog).getByRole("button", { name: "Add schedule files" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Or paste schedule rows"), { target: { value: "2026-09-01,Unique Renal Seminar,Lecture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review schedule" }));
    expect(within(dialog).getByText("1 ready")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Edited Renal Seminar" } });
    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: "Assessment" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import selected (1)" }));
    expect(useStore.getState().tracker.some((item) => item.label === "Edited Renal Seminar" && item.kind === "Assessment" && item.assessmentDate === "2026-09-01")).toBe(true);
  });

  it("opens suggestions for inspection without mutating pass history", () => {
    const before = useStore.getState().tracker.map((item) => ({ id: item.id, passes: item.passes }));
    render(<CourseTrackerPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
    expect(useStore.getState().tracker.map((item) => ({ id: item.id, passes: item.passes }))).toEqual(before);
  });

  it("defers a recommendation in one tap until tomorrow, with Undo", () => {
    render(<><CourseTrackerPage /><Toaster /></>);
    fireEvent.click(screen.getAllByRole("button", { name: /^Defer / })[0]);
    expect(screen.queryByRole("dialog", { name: "When should this return?" })).toBeNull();
    const snoozed = useStore.getState().tracker.find((item) => item.recommendationSnoozedUntil);
    expect(snoozed && Date.parse(snoozed.recommendationSnoozedUntil!) > Date.now()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(useStore.getState().tracker.find((item) => item.id === snoozed!.id)?.recommendationSnoozedUntil).toBeUndefined();
  });

  it("exposes a plain Help entry point and stable module-tour anchors", () => {
    const { container } = render(<CourseTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText(/A short guide to importing, organizing, passes, weak items, and suggestions/)).toBeTruthy();
    expect(container.querySelector('[data-module-tour="tracker-import-add"]')).toBeTruthy();
    expect(container.querySelector('[data-module-tour="tracker-structure"]')).toBeTruthy();
    expect(container.querySelector('[data-module-tour="tracker-passes"]')).toBeTruthy();
    expect(container.querySelector('[data-module-tour="tracker-weak-items"]')).toBeTruthy();
    expect(container.querySelector('[data-module-tour="tracker-suggestions"]')).toBeTruthy();
    expect(screen.getByText("How passes work").closest("details")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start short tour" }));
    expect(screen.getByRole("dialog", { name: "Import or add" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Import or add" })).toBeNull();
    expect(useStore.getState().profile.promisePromptStatus).toBeUndefined();
  });

  it("uses utility/work-area regions that can stack without changing DOM order at mobile width", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<CourseTrackerPage />);
    const utilities = screen.getByRole("complementary", { name: "Course Tracker utilities" });
    const workArea = screen.getByRole("region", { name: "Selected Course Tracker scope" });
    expect(utilities.compareDocumentPosition(workArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(utilities).getByRole("button", { name: "Import lectures or items" })).toBeTruthy();
  });
});

describe("Course Tracker file extraction", () => {
  it("routes a PDF through the production extractor seam and preserves its filename and warnings", async () => {
    const buffer = new Uint8Array([37, 80, 68, 70]).buffer;
    const file = { name: "course schedule.pdf", type: "application/pdf", arrayBuffer: vi.fn(async () => buffer) } as unknown as File;
    const pdfExtractor = vi.fn(async () => ({ pages: ["Week 1"], text: "Week 1", empty: false, warnings: ["review extraction"] }));

    const result = await extractTrackerImportFile(file, pdfExtractor);
    expect(pdfExtractor).toHaveBeenCalledWith(buffer);
    expect(result).toEqual({
      fileName: "course schedule.pdf",
      extraction: { pages: ["Week 1"], text: "Week 1", empty: false, warnings: ["review extraction"] },
    });
  });

  it("reads Markdown locally without a provider", async () => {
    const file = { name: "modules.md", type: "text/markdown", text: vi.fn(async () => "Week 1:\r\n- Cardiac cycle") } as unknown as File;
    await expect(extractTrackerImportFile(file)).resolves.toMatchObject({
      fileName: "modules.md",
      extraction: { text: "Week 1:\n- Cardiac cycle", warnings: [] },
    });
  });
});

describe("Course Tracker subsections", () => {
  function item(id: string, path: string) {
    const base = useStore.getState().tracker[0];
    return { ...base, id, label: `Item ${id}`, path, kind: "Lecture" as const, passes: 0, ankiPasses: 0 };
  }

  it("groups items under the next path segment and lists deeper subsections", () => {
    const items = [item("a", "Term 4/Cardio/Week 1"), item("b", "Term 4/Cardio/Week 2"), item("c", "Term 4/Renal"), item("d", "Term 4")];
    const groups = groupItemsBySection("Term 4", items);
    expect(groups.map((group) => [group.key, group.path, group.items.length])).toEqual([
      ["", "Term 4", 1], ["Cardio", "Term 4/Cardio", 2], ["Renal", "Term 4/Renal", 1],
    ]);
    expect(descendantScopes("Term 4", ["Term 4", "Term 4/Renal", "Term 4/Cardio", "Term 4/Cardio/Week 10", "Term 4/Cardio/Week 2", "Term 5"]))
      .toEqual(["Term 4/Cardio", "Term 4/Cardio/Week 2", "Term 4/Cardio/Week 10", "Term 4/Renal"]);
  });

  it("narrows to one subsection from the picker, remembers it, and shows a breadcrumb back", () => {
    useStore.setState({ tracker: [item("a", "Term 4/Cardio/Week 1"), item("b", "Term 4/Renal/Week 1"), item("c", "Term 5/Neuro")] });
    render(<CourseTrackerPage />);
    fireEvent.change(screen.getByLabelText("Jump to a subsection"), { target: { value: "Term 4" } });
    expect(screen.getByText("Item a")).toBeTruthy();
    expect(screen.queryByText("Item c")).toBeNull();
    expect(screen.getByRole("button", { name: /^Cardio/ }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.change(screen.getByLabelText("Jump to a subsection"), { target: { value: "Term 4/Renal" } });
    expect(screen.queryByText("Item a")).toBeNull();
    expect(screen.getByText("Item b")).toBeTruthy();
    expect(localStorage.getItem("axom.tracker.scope.v1")).toBe("Term 4/Renal");

    fireEvent.click(within(screen.getByRole("navigation", { name: "Tracker location" })).getByRole("button", { name: "Term 4" }));
    expect(screen.getByText("Item a")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Show only this" })[0]);
    expect(screen.queryByText("Item b")).toBeNull();
  });
});

describe("Course Tracker primary focus", () => {
  it("stars a subsection, pins it, and opens on it next time", () => {
    const make = (id: string, path: string): TrackerItem => ({ id, path, label: `${id} lecture`, kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-09-01T12:00:00.000Z" });
    useStore.setState({ tracker: [make("a", "Term 4/Cardio/Week 1"), make("b", "Term 4/Renal/Week 1")], profile: { ...useStore.getState().profile, primaryTrackerScopes: [] } });
    render(<CourseTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Make Term 4 a primary focus" }));
    expect(useStore.getState().profile.primaryTrackerScopes?.map((scope) => scope.path)).toEqual(["Term 4"]);
    const pinned = screen.getByLabelText("Primary focus");
    expect(within(pinned).getByText("Term 4")).toBeTruthy();
    cleanup();
    render(<CourseTrackerPage />);
    expect(screen.getByRole("button", { name: "Primary focus" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Course Tracker first use (Wave 2)", () => {
  const treeNames = (depth: number) => [...document.querySelectorAll(`.tree-node.depth${depth} > span:not(.tree-count)`)].map((node) => node.textContent).filter(Boolean);
  const workflow = (methods: Array<[string, boolean]>) => ({ configured: true, methods: methods.map(([id, enabled]) => ({ id, enabled })) }) as never;

  it("starts clean with the three ways in, and a template loads in teaching order", () => {
    useStore.setState({ tracker: [], terms: [], courses: [] });
    render(<CourseTrackerPage />);
    expect(screen.getByRole("heading", { name: "Build it the way your school runs." })).toBeTruthy();
    expect(screen.queryByText("No items here")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Load St\. George's University MD/ }));
    expect(treeNames(0)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "Boards"]);
    fireEvent.click(screen.getByText("Term 1"));
    fireEvent.click(screen.getByText("BPM 500"));
    expect(treeNames(2)).toEqual(["FTM 1", "FTM 2", "MSK", "CPR 1", "CPR 2", "BSCE 1"]);
    expect(screen.getByRole("heading", { name: "Add the lectures, and progress fills itself in." })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Paste a lecture list/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows card rounds under the student's own app, and none without one", () => {
    const item: TrackerItem = { id: "l1", path: "Term 1/BPM 500/MSK", label: "Bone", kind: "Lecture", passes: 1, ankiPasses: 1, yield: "none", updated: "2026-09-01T12:00:00.000Z" };
    useStore.setState((state) => ({ tracker: [item], profile: { ...state.profile, studyWorkflow: workflow([["noji", true], ["anki", false]]) } }));
    const { unmount } = render(<CourseTrackerPage />);
    expect(screen.getByTitle("Noji rounds (orange → yellow → purple)")).toBeTruthy();
    expect(screen.queryByTitle(/^Anki rounds/)).toBeNull();
    unmount();

    useStore.setState((state) => ({ profile: { ...state.profile, studyWorkflow: workflow([["lecture-passes", true]]) } }));
    render(<CourseTrackerPage />);
    expect(screen.queryByTitle(/rounds \(orange/)).toBeNull();
    expect(document.querySelector(".mastery-shard.no-cards")).toBeTruthy();
  });
});
