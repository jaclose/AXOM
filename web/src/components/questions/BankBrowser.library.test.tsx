// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { BankBrowser } from "./BankBrowser";

const store = vi.hoisted(() => ({
  questions: [] as QuestionRecord[],
  courses: [] as unknown[],
  savedQuestionFilters: [] as unknown[],
  bulkTagQuestions: vi.fn(),
  bulkUpdateQuestions: vi.fn(),
  mergeTags: vi.fn(),
  renameTag: vi.fn(),
  removeTag: vi.fn(),
  addSavedQuestionFilter: vi.fn(() => "preset-1"),
  updateSavedQuestionFilter: vi.fn(),
  removeSavedQuestionFilter: vi.fn(),
  createQuestionSetFromFilter: vi.fn(() => "set-1"),
}));

vi.mock("../../lib/store", () => ({ useStore: () => store }));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

function makeQuestion(patch: Partial<QuestionRecord> & { id: string }): QuestionRecord {
  return {
    source: "imported", stem: "Question stem", options: [{ key: "A", text: "Alpha" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z", ...patch,
  };
}

beforeEach(() => {
  store.questions = [
    makeQuestion({ id: "cardio", stem: "Cardiac output", tags: ["cardiology", "high-yield"], status: "incorrect" }),
    makeQuestion({ id: "renal", stem: "Renal tubule", tags: ["renal"], status: "correct" }),
    makeQuestion({ id: "ethics", stem: "Ethics scenario", tags: ["ethics"], status: "unseen" }),
  ];
  store.savedQuestionFilters = [];
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("BankBrowser library", () => {
  it("shows live total and narrows by a tag chip", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("3");
    await user.click(screen.getByRole("button", { name: /renal 1/ }));
    expect(screen.getByRole("button", { name: "Renal tubule" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cardiac output" })).toBeNull();
  });

  it("composes a state facet with tags (deterministic AND)", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Incorrect" }));
    expect(screen.getByRole("button", { name: "Cardiac output" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Renal tubule" })).toBeNull();
  });

  it("debounced search matches stem text", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText("Search question bank"), "ethics");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cardiac output" })).toBeNull());
    expect(screen.getByRole("button", { name: "Ethics scenario" })).toBeTruthy();
  });

  it("selection persists to sessionStorage and survives a remount (reload)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BankBrowser onOpen={vi.fn()} />);
    const rows = screen.getAllByRole("button", { name: /^Select question \d+:/ });
    await user.click(rows[0]);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("axom.bank.selection.v1")!)).toContain("cardio"));
    unmount();
    render(<BankBrowser onOpen={vi.fn()} />);
    // The bulk toolbar returns because the selection was restored from sessionStorage.
    expect(screen.getByRole("region", { name: /Bulk actions/ })).toBeTruthy();
  });

  it("bulk-adds tags to the selection", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    await user.click(screen.getAllByRole("button", { name: /^Select question \d+:/ })[0]);
    const toolbar = screen.getByRole("region", { name: /Bulk actions/ });
    await user.type(within(toolbar).getByLabelText("Tags to apply"), "exam-1");
    await user.click(within(toolbar).getByRole("button", { name: "Apply" }));
    expect(store.bulkTagQuestions).toHaveBeenCalledWith(["cardio"], { add: ["exam-1"] });
  });

  it("creates a deterministic set from the current filter", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Create set/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("option", { name: "Recently added" })).toBeTruthy();
    expect(within(dialog).queryByText("Original import order")).toBeNull();
    await user.type(within(dialog).getByLabelText("Set name"), "Cardio finals");
    await user.click(within(dialog).getByRole("button", { name: /Create set/ }));
    expect(store.createQuestionSetFromFilter).toHaveBeenCalledWith(expect.objectContaining({ title: "Cardio finals", ordering: "import" }));
  });

  it("exposes accessible pressed state and labelled bulk region", async () => {
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    const controls = screen.getAllByRole("button", { name: /^Select question \d+:/ });
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Select question 1: Cardiac output",
      "Select question 2: Renal tubule",
      "Select question 3: Ethics scenario",
    ]);
    expect(controls.every((control) => control.getAttribute("aria-pressed") === "false")).toBe(true);
    const chip = screen.getByRole("button", { name: "Incorrect" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await user.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const cardiacControl = screen.getByRole("button", { name: "Select question 1: Cardiac output" });
    await user.click(cardiacControl);
    expect(cardiacControl.getAttribute("aria-label")).toBe("Deselect question 1: Cardiac output");
    expect(cardiacControl.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: /Bulk actions for 1 selected/ })).toBeTruthy();
  });

  it("truncates long question stems cleanly in selection names", () => {
    store.questions = [makeQuestion({
      id: "long",
      stem: `A very long but distinguishable question stem ${"with additional clinical context ".repeat(5)}`,
    })];
    render(<BankBrowser onOpen={vi.fn()} />);
    const control = screen.getByRole("button", { name: /^Select question 1:/ });
    const label = control.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Select question 1: A very long but distinguishable/);
    expect(label).toMatch(/…$/);
    expect(label.length).toBeLessThanOrEqual(100);
    expect(control.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("BankBrowser evidence readiness", () => {
  it("filters ready questions, review cases and known-bad options without conflating answered status", async () => {
    const options = [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }];
    store.questions = [
      makeQuestion({ id: "reviewed", stem: "Verified renal stem", options, correctKey: "A" }),
      makeQuestion({ id: "unreviewed", stem: "Provisional neuro stem", options, correctKey: "A", extraction: { confidence: "medium", reviewed: false } }),
      makeQuestion({ id: "invalid", stem: "Incomplete cardiac stem", options: [{ key: "A", text: "Only one" }], correctKey: "A" }),
    ];
    const user = userEvent.setup();
    render(<BankBrowser onOpen={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by answer readiness" }), "ready");
    expect(screen.getByRole("button", { name: "Verified renal stem" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Provisional neuro stem" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Incomplete cardiac stem" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by answer readiness" }), "review");
    expect(screen.queryByRole("button", { name: "Verified renal stem" })).toBeNull();
    expect(screen.getByRole("button", { name: "Provisional neuro stem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Incomplete cardiac stem" })).toBeTruthy();
  });
});
