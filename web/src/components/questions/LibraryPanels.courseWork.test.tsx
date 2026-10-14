// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import { QuestionSetList } from "./LibraryPanels";

const mocked = vi.hoisted(() => ({
  bulkAddTrackerItems: vi.fn(),
  store: {} as Record<string, unknown>,
}));

vi.mock("../../lib/store", () => ({ useStore: () => mocked.store }));
vi.mock("../../lib/ai", () => ({ resolveActiveProvider: () => null, enhanceQuestionSet: vi.fn() }));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuestionSetList course review work", () => {
  it("turns digest suggestions into module-linked review tasks", async () => {
    const set: QuestionSet = {
      id: "set-1",
      title: "Neuro misses",
      scope: { courseId: "ncrs", module: "Neuro", week: 2 },
      sourceDocumentIds: [],
      createdAt: "2026-10-13T10:00:00.000Z",
      questionIds: [],
      tags: [],
      aiEnhanced: true,
      parserWarnings: [],
      digest: {
        summary: "Review the weak areas.",
        pitfalls: [],
        suggestedReview: ["Cranial nerve nuclei"],
        generatedBy: "Local model",
        generatedAt: "2026-10-13T10:00:00.000Z",
      },
    };
    mocked.store = {
      questionSets: [set],
      questions: [],
      documents: [],
      tracker: [],
      terms: [{ id: "term-4", name: "Term 4" }],
      courses: [{ id: "ncrs", termId: "term-4", code: "NCRS", name: "Neuroscience", files: 0, modules: [{ id: "neuro", name: "Neuro" }] }],
      bulkAddTrackerItems: mocked.bulkAddTrackerItems,
      updateQuestionSet: vi.fn(),
      removeQuestionSet: vi.fn(),
    };

    const user = userEvent.setup();
    render(<QuestionSetList onRunSet={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Neuro misses" }));
    await user.click(screen.getByRole("button", { name: "Add review to Tracker" }));

    expect(mocked.bulkAddTrackerItems).toHaveBeenCalledWith([
      expect.objectContaining({
        path: "Term 4/Neuro/Week 2",
        label: "Review Cranial nerve nuclei",
        reviewTask: { source: "digest", sourceId: "set-1" },
      }),
    ]);
  });
});

describe("QuestionSetList explicit academic filing", () => {
  function setUpFiling(initialScope: QuestionSet["scope"]) {
    const candidate: QuestionSet = {
      id: "mixed-collection", title: "Neuro question collection", scope: initialScope,
      sourceDocumentIds: [], createdAt: "2026-10-14T10:00:00.000Z",
      questionIds: [], tags: [], parserWarnings: [], aiEnhanced: false,
    };
    const updateQuestionSet = vi.fn();
    mocked.store = {
      questionSets: [candidate], questions: [], documents: [], tracker: [],
      terms: [{ id: "t2", name: "Term 2" }, { id: "t4", name: "Term 4" }],
      courses: [
        { id: "c2", termId: "t2", name: "Neuroscience (T2)", code: "NB", modules: [{ id: "m2", name: "Neuro" }] },
        { id: "c4", termId: "t4", name: "Neuroscience (T4)", code: "NCRS", modules: [{ id: "m4", name: "Neuro" }] },
      ],
      updateQuestionSet, removeQuestionSet: vi.fn(), bulkAddTrackerItems: mocked.bulkAddTrackerItems,
    };
    return { candidate, updateQuestionSet };
  }

  it("requires an explicit course ID before assigning a repeated module name", async () => {
    const { updateQuestionSet } = setUpFiling({ module: "Neuro", week: 2 });
    const user = userEvent.setup();
    render(<QuestionSetList onRunSet={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Neuro question collection" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    const dialog = screen.getByRole("dialog", { name: "File Neuro question collection in a course" });
    expect(within(dialog).getByRole("button", { name: "Save course location" }).hasAttribute("disabled")).toBe(true);
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Destination course" }), "c4");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Destination module" }), "Neuro");
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Destination week" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Destination week" }), "3");
    await user.click(within(dialog).getByRole("button", { name: "Save course location" }));
    expect(updateQuestionSet).toHaveBeenCalledWith("mixed-collection", {
      scope: { courseId: "c4", module: "Neuro", week: 3 },
    });
  });

  it("supports leaving an uncertain week blank and explicitly removing a previous filing", async () => {
    const { updateQuestionSet } = setUpFiling({ courseId: "c4", module: "Neuro", week: 3 });
    const user = userEvent.setup();
    render(<QuestionSetList onRunSet={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Neuro question collection" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    const dialog = screen.getByRole("dialog", { name: "File Neuro question collection in a course" });
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Destination week" }));
    await user.click(within(dialog).getByRole("button", { name: "Save course location" }));
    expect(updateQuestionSet).toHaveBeenCalledWith("mixed-collection", {
      scope: { courseId: "c4", module: "Neuro" },
    });
    await user.click(screen.getByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: "Remove course filing" }));
    expect(updateQuestionSet).toHaveBeenCalledWith("mixed-collection", { scope: undefined });
  });
});
