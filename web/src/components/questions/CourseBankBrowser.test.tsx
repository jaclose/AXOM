// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Term } from "../../lib/types";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionSet } from "../../lib/library";
import { CourseBankBrowser } from "./CourseBankBrowser";

const state = vi.hoisted(() => ({
  questions: [] as QuestionRecord[],
  questionSets: [] as QuestionSet[],
  courses: [] as Course[],
  terms: [] as Term[],
}));

vi.mock("../../lib/store", () => ({ useStore: () => state }));

function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id, source: "imported", stem: `Question ${id}`,
    options: [{ key: "A", text: "Yes" }, { key: "B", text: "No" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", ...patch,
  };
}

function set(id: string, title: string, questionIds: string[], courseId: string, module: string): QuestionSet {
  return {
    id, title, questionIds, scope: { courseId, module, week: 1 },
    sourceDocumentIds: [], createdAt: "2026-10-14T00:00:00Z",
    tags: [], aiEnhanced: false, parserWarnings: [],
  };
}

beforeEach(() => {
  state.terms = [{ id: "t2", name: "Term 2" }, { id: "t4", name: "Term 4" }] as Term[];
  state.courses = [
    { id: "c2", termId: "t2", code: "BPM", name: "Biochemistry", modules: [{ id: "m2", name: "Biomolecules" }] },
    { id: "c4", termId: "t4", code: "NCRS", name: "Neuroscience", modules: [{ id: "m4", name: "Neuro" }] },
  ] as Course[];
  state.questions = [
    question("ready"),
    question("review-suggested", { extraction: { confidence: "medium", reviewed: false } }),
    question("unresolved", { needsReview: true }),
    question("t2"),
  ];
  state.questionSets = [
    set("imcq", "IMCQ 1", ["ready", "review-suggested", "unresolved", "missing"], "c4", "Neuro"),
    set("suggested", "IMCQ Suggested", ["review-suggested"], "c4", "Neuro"),
    set("unresolved", "IMCQ Unresolved", ["unresolved"], "c4", "Neuro"),
    set("pq", "School PQ 1", ["t2"], "c2", "Biomolecules"),
  ];
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CourseBankBrowser academic navigation", () => {
  it("identifies image-linked questions without previewing source or answer images", () => {
    state.questions[0] = question("ready", { attachments: [{
      id: "answer-slide", blobKey: "answer-slide", fileName: "review-slide.png", mimeType: "image/png",
      byteSize: 100, altText: "Private answer slide", role: "answer_reveal",
      createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
    }] });
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByText("1 with image references")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Private answer slide")).toBeNull();
    expect(screen.getByRole("button", { name: "Practice week" }).textContent).toContain("1 ready");
  });

  it("shows canonical ready, review-suggested, unresolved and missing counts without double-counting", () => {
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={onPractice} />);
    expect(screen.getByText(/3 stored · 1 ready · 1 review suggested · 1 unresolved · 1 missing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Practice IMCQ 1" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Practice IMCQ Suggested" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Practice IMCQ Unresolved" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Review the imported answer evidence before practice.")).toBeTruthy();
    expect(screen.getByText("Resolve the missing or conflicting answer evidence before practice.")).toBeTruthy();
  });

  it("practices only ready collections and deduplicates shared question IDs", async () => {
    const user = userEvent.setup();
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={onPractice} />);
    expect(screen.getByRole("button", { name: "Practice week" }).textContent).toContain("1 ready");
    await user.click(screen.getByRole("button", { name: "Practice week" }));
    expect(onPractice).toHaveBeenCalledTimes(1);
    expect(onPractice).toHaveBeenCalledWith([state.questionSets[0]]);
  });

  it("composes term, course, collection type, readiness and search without leaking other courses", async () => {
    const user = userEvent.setup();
    render(<CourseBankBrowser onPractice={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by term" }), "Term 4");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by course" }), "c4");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by collection type" }), "IMCQ");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by readiness" }), "review-suggested");
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "IMCQ");
    const bank = screen.getByRole("region", { name: "Course question bank" });
    expect(within(bank).getByText("IMCQ 1")).toBeTruthy();
    expect(within(bank).getByText("IMCQ Suggested")).toBeTruthy();
    expect(within(bank).queryByText("IMCQ Unresolved")).toBeNull();
    expect(within(bank).queryByText("School PQ 1")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by readiness" }), "unresolved");
    expect(within(bank).getByText("IMCQ 1")).toBeTruthy();
    expect(within(bank).getByText("IMCQ Unresolved")).toBeTruthy();
    expect(within(bank).queryByText("IMCQ Suggested")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by readiness" }), "missing");
    expect(within(bank).getByText("IMCQ 1")).toBeTruthy();
    expect(within(bank).queryByText("IMCQ Suggested")).toBeNull();
    expect(within(bank).queryByText("IMCQ Unresolved")).toBeNull();
  });

  it("explains unavailable sets rather than launching an empty practice block", () => {
    state.questions = [];
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Practice IMCQ 1" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Question records are unavailable on this device. Re-importing does not automatically restore this collection.")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Practice week" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("CourseBankBrowser explicit academic scope integrity", () => {
  it("holds duplicate original membership and never launches an unrelated course by fallback", () => {
    // Malformed original ID lists must remain held; the valid Term 2 PQ
    // cannot silently replace an explicitly requested Term 4 handoff.
    state.questionSets[0] = {
      ...state.questionSets[0], questionIds: ["ready", "ready", "review-suggested", "unresolved", "missing"],
    };
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={onPractice} />);
    expect(screen.queryByRole("button", { name: "Practice IMCQ 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice week" })).toBeNull();
    expect(screen.queryByText("School PQ 1")).toBeNull();
    expect(screen.getByRole("heading", { name: "Select an academic week" })).toBeTruthy();
    expect(onPractice).not.toHaveBeenCalled();
  });

  it("does not silently refile an explicitly requested unavailable week to Week 1", () => {
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 99 }} onPractice={onPractice} />);
    expect(screen.getByRole("heading", { name: "Select an academic week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Practice week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice IMCQ 1" })).toBeNull();
    expect(onPractice).not.toHaveBeenCalled();
  });
});

describe("CourseBankBrowser ambiguous curriculum scope", () => {
  it("does not infer a course from a repeated module name", async () => {
    state.courses[0] = { ...state.courses[0], modules: [{ id: "m2", name: "Neuro" }] };
    // A second course must have its own source question. Moving a review
    // collection while keeping c4's question would be conflicting provenance.
    state.questions.push(question("c2-source", { setId: "unresolved", courseId: "c2", module: "Neuro", week: 1 }));
    state.questionSets[2] = { ...state.questionSets[2], questionIds: ["c2-source"],
      scope: { courseId: "c2", module: "Neuro", week: 1 } };
    const user = userEvent.setup();
    render(<CourseBankBrowser initialScope={{ module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("Multiple courses contain Neuro");
    expect(screen.getByRole("heading", { name: "Select an academic week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Practice week" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by term" }), "Term 4");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
  });
});

describe("CourseBankBrowser recovery routes", () => {
  it("routes review-suggested and unresolved records separately and imports missing IDs", async () => {
    const user = userEvent.setup();
    const onReviewQuestionIds = vi.fn();
    const onRestoreMissing = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }}
      onPractice={vi.fn()} onReviewQuestionIds={onReviewQuestionIds} onRestoreMissing={onRestoreMissing} />);
    await user.click(screen.getByRole("button", { name: "Review suggested mappings for IMCQ 1" }));
    expect(onReviewQuestionIds).toHaveBeenNthCalledWith(1, ["review-suggested"]);
    await user.click(screen.getByRole("button", { name: "Resolve unresolved questions for IMCQ 1" }));
    expect(onReviewQuestionIds).toHaveBeenNthCalledWith(2, ["unresolved"]);
    await user.click(screen.getByRole("button", { name: "Import missing source for IMCQ 1" }));
    expect(onRestoreMissing).toHaveBeenCalledTimes(1);
    expect(onRestoreMissing).toHaveBeenCalledWith({
      setId: "imcq", setTitle: "IMCQ 1", createdAt: "2026-10-14T00:00:00Z",
      expectedQuestionIds: ["ready", "review-suggested", "unresolved", "missing"],
      missingQuestionIds: ["missing"], sourceDocumentIds: [],
      scope: { courseId: "c4", module: "Neuro", week: 1 },
    });
    expect(screen.getByRole("button", { name: "Practice IMCQ Suggested" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Practice IMCQ Unresolved" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps two collections' missing recovery requests separate", async () => {
    state.questionSets.push(set("second", "Second IMCQ", ["ready", "missing-two"], "c4", "Neuro"));
    const user = userEvent.setup();
    const restore = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onRestoreMissing={restore} />);
    await user.click(screen.getByRole("button", { name: "Import missing source for IMCQ 1" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Second IMCQ" }));
    expect(restore.mock.calls.map(([request]) => [request.setId, request.missingQuestionIds])).toEqual([
      ["imcq", ["missing"]], ["second", ["missing-two"]],
    ]);
  });
});

describe("CourseBankBrowser shared curriculum aliases", () => {
  it("opens a verified long-form module when its incoming scope uses a short code", () => {
    state.courses[1] = { ...state.courses[1], modules: [{ id: "m4", name: "NB Block 2" }] };
    // The same questions also appear in the two review collections. Refile
    // those views alongside their source rather than borrowing a stale module.
    state.questionSets = state.questionSets.map((entry) =>
      entry.scope?.courseId === "c4" ? { ...entry, scope: { ...entry.scope, module: "NB Block 2" } } : entry);
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "NB2", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Week 1" })).toBeTruthy();
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
    expect(screen.getByText("Term 4 / Neuroscience / NB Block 2")).toBeTruthy();
  });
});

describe("CourseBankBrowser dynamic handoff isolation", () => {
  it("does not expose other-course Practice by searching an unavailable explicit week", async () => {
    const user = userEvent.setup();
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 99 }} onPractice={onPractice} />);
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "School");
    expect(screen.queryByText("School PQ 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice School PQ 1" })).toBeNull();
    expect(onPractice).not.toHaveBeenCalled();
  });

  it("keeps search within a verified explicit source week until the user navigates", async () => {
    const user = userEvent.setup();
    const onPractice = vi.fn();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={onPractice} />);
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "School");
    expect(screen.queryByText("School PQ 1")).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Search question sets" }));
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "IMCQ");
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
    expect(screen.queryByText("School PQ 1")).toBeNull();
  });

  it("discards a previous manual week after a new explicit handoff prop", async () => {
    const user = userEvent.setup();
    const onPractice = vi.fn();
    const view = render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={onPractice} />);
    await user.click(screen.getByRole("button", { name: /Biomolecules/ }));
    expect(screen.getByText("School PQ 1")).toBeTruthy();
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 99 }} onPractice={onPractice} />);
    expect(screen.queryByText("School PQ 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice week" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Select an academic week" })).toBeTruthy();
  });

  it("closes an old focused set immediately when the incoming Tracker scope changes", async () => {
    const user = userEvent.setup();
    const renderSet = (entry: QuestionSet) => <div data-testid="focused-set">{entry.title}</div>;
    const view = render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} renderSet={renderSet} />);
    await user.click(screen.getByRole("button", { name: /IMCQ 1/ }));
    expect(screen.getByTestId("focused-set").textContent).toBe("IMCQ 1");
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c2", module: "Biomolecules", week: 1 }} renderSet={renderSet} />);
    expect(screen.queryByTestId("focused-set")).toBeNull();
    expect(screen.getByText("School PQ 1")).toBeTruthy();
  });
});

describe("CourseBankBrowser repeated Tracker handoffs", () => {
  it("does not resurrect a prior manual week after an A to B to A handoff", async () => {
    const user = userEvent.setup();
    const view = render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Biomolecules/ }));
    expect(screen.getByText("School PQ 1")).toBeTruthy();
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 99 }} onPractice={vi.fn()} />);
    expect(screen.queryByText("School PQ 1")).toBeNull();
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.queryByText("School PQ 1")).toBeNull();
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
  });

  it("clears an old term filter when a different explicit Tracker handoff arrives", async () => {
    const user = userEvent.setup();
    const view = render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by term" }), "Term 2");
    expect(screen.getByRole("combobox", { name: "Filter by term" }).getAttribute("value")).toBeNull();
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c2", module: "Biomolecules", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByText("School PQ 1")).toBeTruthy();
    view.rerender(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Filter by term" }) as HTMLSelectElement).value).toBe("");
  });
});

describe("CourseBankBrowser explicit handoff search after manual outline selection", () => {
  it("never turns a click on the same module into cross-course search", async () => {
    const user = userEvent.setup();
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "Neuro", week: 1 }} onPractice={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Neuro.*weeks/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "School");
    expect(screen.queryByText("School PQ 1")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Biomolecules.*weeks/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search question sets" }), "School");
    expect(screen.getByText("School PQ 1")).toBeTruthy();
  });
});
