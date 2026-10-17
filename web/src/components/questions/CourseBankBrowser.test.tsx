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
    set("imcq", "IMCQ 1", ["ready", "ready", "review-suggested", "unresolved", "missing"], "c4", "Neuro"),
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
    expect(screen.getAllByText("Question records are unavailable on this device; restore or re-import this source.")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Practice week" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("CourseBankBrowser ambiguous curriculum scope", () => {
  it("does not infer a course from a repeated module name", async () => {
    state.courses[0] = { ...state.courses[0], modules: [{ id: "m2", name: "Neuro" }] };
    state.questionSets[2] = { ...state.questionSets[2], scope: { courseId: "c2", module: "Neuro", week: 1 } };
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
    expect(screen.getByRole("button", { name: "Practice IMCQ Suggested" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Practice IMCQ Unresolved" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("CourseBankBrowser shared curriculum aliases", () => {
  it("opens a verified long-form module when its incoming scope uses a short code", () => {
    state.courses[1] = { ...state.courses[1], modules: [{ id: "m4", name: "NB Block 2" }] };
    state.questionSets[0] = { ...state.questionSets[0], scope: { courseId: "c4", module: "NB Block 2", week: 1 } };
    render(<CourseBankBrowser initialScope={{ courseId: "c4", module: "NB2", week: 1 }} onPractice={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Week 1" })).toBeTruthy();
    expect(screen.getByText("IMCQ 1")).toBeTruthy();
    expect(screen.getByText("Term 4 / Neuroscience / NB Block 2")).toBeTruthy();
  });
});
