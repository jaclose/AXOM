// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../lib/library";
import type { QuestionRecord } from "../lib/questions";
import type { QuizSession } from "../lib/quiz";
import { useStore } from "../lib/store";
import { QuestionWorkspacePage } from "./QuestionWorkspacePage";
import { STORAGE_KEYS } from "../lib/brand";

const localValues = new Map<string, string>();
const localStorageStub: Storage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => { localValues.delete(key); },
  setItem: (key, value) => { localValues.set(key, String(value)); },
};

function question(patch: Partial<QuestionRecord>): QuestionRecord {
  return {
    id: "question",
    source: "imported",
    stem: "Question stem",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function set(id: string, title: string, questionId: string, createdAt: string): QuestionSet {
  return {
    id,
    title,
    sourceDocumentIds: [],
    createdAt,
    questionIds: [questionId],
    tags: [],
    aiEnhanced: false,
    parserWarnings: [],
  };
}

const session: QuizSession = {
  id: "session",
  mode: "tutor",
  startedAt: "2026-07-10T12:00:00.000Z",
  endedAt: "2026-07-10T12:05:00.000Z",
  timed: false,
  filters: { count: 10, status: "all" },
  questionIds: ["new"],
  answers: [],
};

beforeEach(async () => {
  localValues.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  await useStore.setState({ questions: [], questionSets: [], documents: [], quizSessions: [], quizBlocks: [] });
});

afterEach(async () => {
  cleanup();
  await useStore.setState({ questions: [], questionSets: [], documents: [], quizSessions: [], quizBlocks: [] });
  vi.unstubAllGlobals();
});

describe("QuestionWorkspacePage first use", () => {
  it("shows one focused entry path without empty analytics or unavailable tabs", async () => {
    const user = userEvent.setup();
    const { container } = render(<QuestionWorkspacePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Question Bank" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("region", { name: "Question bank library" })).toBeTruthy();
    expect(screen.queryByText("Current mastery")).toBeNull();
    expect(screen.queryByText("Attempt accuracy")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Insights/ })).toBeNull();
    expect(within(screen.getByRole("tablist", { name: "Question Bank sections" })).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Browse Courses / Question Sets", "Overview", "Import custom material"]);
    expect(container.querySelector('[data-tour="question-bank-entry"]')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add your own material" }));
    expect(screen.getByLabelText(/Choose question files or a ZIP to import/)).toBeTruthy();
  });

  it("routes Paste text into the real paste mode on the unified Import tab", async () => {
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Add your own material" }));
    await user.click(within(screen.getByLabelText("Import source type")).getByRole("button", { name: "Paste text" }));
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
    expect(screen.getByLabelText("Structured question text")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Parse and review" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("finalizes reviewed pasted text and routes to the reachable saved set", async () => {
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Add your own material" }));
    await user.click(within(screen.getByLabelText("Import source type")).getByRole("button", { name: "Paste text" }));
    await user.type(screen.getByLabelText("Structured question text"), [
      "1. Which option is correct?",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
      "Explanation: Beta follows from the source.",
    ].join("\n"));
    await user.click(screen.getByRole("button", { name: "Parse and review" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Question Sets (1)" }).getAttribute("aria-selected")).toBe("true"));
    const state = useStore.getState();
    expect(state.questions).toHaveLength(1);
    expect(state.questions[0]).toMatchObject({
      source: "pasted",
      correctKey: "B",
      correctAnswerText: "Beta",
      explanation: "Beta follows from the source.",
    });
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    expect(screen.getByRole("button", { name: state.questionSets[0].title })).toBeTruthy();
  });

  it("opens a same-route, missing-target-safe Question Bank tour", async () => {
    const user = userEvent.setup();
    const startHash = window.location.hash;
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Open Question Bank help tour" }));
    expect(screen.getByRole("dialog", { name: "Import" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Inspect mappings" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Inspect mappings" })).toBeNull();
    expect(window.location.hash).toBe(startHash);
  });

  it("uses a labelled roving tab pattern with arrow-key navigation", async () => {
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    const tabs = within(screen.getByRole("tablist", { name: "Question Bank sections" }));
    const browse = tabs.getByRole("tab", { name: "Browse Courses / Question Sets" });
    const overview = tabs.getByRole("tab", { name: "Overview" });
    const importTab = tabs.getByRole("tab", { name: "Import custom material" });
    expect(browse.getAttribute("aria-selected")).toBe("true");
    expect(browse.getAttribute("tabindex")).toBe("0");
    expect(overview.getAttribute("tabindex")).toBe("-1");
    browse.focus();
    for (const [key, target, id] of [
      ["{ArrowRight}", overview, "overview"], ["{ArrowRight}", importTab, "import"],
      ["{Home}", browse, "sets"], ["{End}", importTab, "import"],
    ] as const) {
      await user.keyboard(key);
      expect(document.activeElement).toBe(target);
      expect(target.getAttribute("aria-selected")).toBe("true");
      expect(target.getAttribute("aria-controls")).toBe(`question-bank-panel-${id}`);
      expect(document.getElementById(`question-bank-panel-${id}`)?.getAttribute("aria-labelledby")).toBe(target.id);
      expectRenderedTabControlsToResolve();
    }

  });

  it("keeps a saved Source Library reachable in the reduced first-use tab list", async () => {
    const user = userEvent.setup();
    useStore.setState({
      documents: [{
        id: "reference",
        title: "Saved reference",
        fileName: "reference.pdf",
        fileType: "pdf",
        uploadedAt: "2026-07-11T00:00:00.000Z",
        rawText: "Reference text",
        sizeBytes: 100,
        tags: [],
        linkedQuestionSetIds: [],
        libraryOnly: true,
      }],
    });
    render(<QuestionWorkspacePage />);

    const sourceTab = screen.getByRole("tab", { name: "Source Library (1)" });
    expect(within(screen.getByRole("tablist", { name: "Question Bank sections" })).getAllByRole("tab").map(item => item.textContent)).toEqual(["Browse Courses / Question Sets", "Overview", "Import custom material", "Source Library (1)"]);
    expect(sourceTab.hasAttribute("aria-controls")).toBe(false);
    await user.click(sourceTab);
    expect(sourceTab.getAttribute("aria-controls")).toBe("question-bank-panel-library");
    expect(document.getElementById("question-bank-panel-library")).toBe(screen.getByRole("tabpanel"));
    expectRenderedTabControlsToResolve();
  });
});

function expectRenderedTabControlsToResolve() {
  for (const renderedTab of screen.getAllByRole("tab")) {
    const controlledId = renderedTab.getAttribute("aria-controls");
    if (controlledId) expect(document.getElementById(controlledId)).not.toBeNull();
  }
}

describe("QuestionWorkspacePage returning state", () => {
  function seedReturningState() {
    const questions = [
      question({
        id: "old",
        stem: "Old unresolved question",
        setId: "old-set",
        correctKey: undefined,
        needsReview: true,
        attempts: [{ at: "2026-07-03T10:00:00.000Z", answerKey: "B", status: "incorrect" }],
      }),
      question({
        id: "new",
        stem: "New suggested question",
        setId: "new-set",
        extraction: { confidence: "medium", reviewed: false },
        attempts: [{ at: "2026-07-10T13:00:00+02:00", answerKey: "A", status: "correct" }],
      }),
      question({ id: "stable", stem: "Stable ready question", setId: "stable-set" }),
    ];
    useStore.setState({
      questions,
      questionSets: [
        set("old-set", "Older set", "old", "2026-07-03T00:00:00.000Z"),
        set("stable-set", "Stable fallback set", "stable", "not-a-date"),
        set("new-set", "Newest set", "new", "2026-07-01T00:00:00.000Z"),
      ],
      quizSessions: [session],
    });
  }

  it("offers a new quiz for a finished session, recent sets, mapping review, and explicit metrics", async () => {
    seedReturningState();
    const user = userEvent.setup();
    const { container } = render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("tab", { name: "Command Center" }));

    expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    const titles = [...container.querySelectorAll(".qset-grid.compact .qset-title-wrap h3")].map((node) => node.textContent);
    expect(screen.getByRole("heading", { name: "Recent sets" })).toBeTruthy();
    expect(titles).toEqual(["Newest set", "Older set", "Stable fallback set"]);
    const mappingRegion = screen.getByRole("region", { name: "2 questions need review" });
    expect(within(mappingRegion).getByText("1 Unresolved", { exact: false })).toBeTruthy();
    expect(within(mappingRegion).getByText("1 Review suggested", { exact: false })).toBeTruthy();
    const performance = screen.getByRole("region", { name: "Question Bank performance" });
    expect(within(performance).getByText("Current mastery")).toBeTruthy();
    expect(within(performance).getByText("Attempt accuracy")).toBeTruthy();
    expect(within(performance).getByText("Questions attempted")).toBeTruthy();
    expect(within(performance).getByText("Total attempts")).toBeTruthy();
    expect(container.querySelector('[data-tour="question-bank-entry"]')).toBeTruthy();

    await user.click(within(mappingRegion).getByRole("button", { name: "Review issues" }));
    expect(screen.getByRole("tab", { name: /Bank \(3\)/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /Mapping Review \(2\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Old unresolved question" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New suggested question" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stable ready question" })).toBeNull();
  });

  it("launches a recent snapshot set through the shared runner path without backlinks", async () => {
    const questions = ["B", "D", "A"].map((id) => question({
      id,
      stem: `Stored order ${id}`,
      setId: undefined,
    }));
    const snapshot: QuestionSet = {
      id: "snapshot-set",
      title: "Deterministic snapshot",
      sourceDocumentIds: [],
      createdAt: "2026-07-18T12:00:00.000Z",
      questionIds: ["D", "A", "B"],
      tags: [],
      aiEnhanced: false,
      parserWarnings: [],
      ordering: "random",
      seed: "creation-provenance",
    };
    useStore.setState({ questions, questionSets: [snapshot] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: snapshot.title }));
    const card = screen.getByRole("heading", { name: snapshot.title }).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Start tutor block" }));
    expect(screen.getByText("Stored order D")).toBeTruthy();
  });

  it("removes the mapping alert after every issue is resolved", async () => {
    seedReturningState();
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("tab", { name: "Command Center" }));
    expect(screen.getByRole("region", { name: "2 questions need review" })).toBeTruthy();

    act(() => {
      useStore.setState((state) => ({
        questions: (state.questions ?? []).map((item) => ({
          ...item,
          correctKey: item.correctKey ?? "A",
          needsReview: false,
          extraction: item.extraction ? { ...item.extraction, reviewed: true } : item.extraction,
        })),
      }));
    });

    expect(screen.queryByRole("region", { name: /questions need review/ })).toBeNull();
  });

  it("does not advertise or launch unresolved questions as runnable practice", async () => {
    const user = userEvent.setup();
    useStore.setState({
      questions: [question({
        id: "unresolved-due-miss",
        correctKey: undefined,
        needsReview: true,
        status: "incorrect",
        reviewDueAt: "2026-01-01T00:00:00.000Z",
      })],
    });
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("tab", { name: "Command Center" }));
    expect(screen.getByRole("heading", { name: "Import another clean set" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Review .* due questions/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Retry .* misses/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Review due/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Retry incorrects/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^Import questions/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Begin/ }));
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Tutor/ })).toBeNull();
  });
});

describe("QuestionWorkspacePage Course Tracker handoff", () => {
  it("waits for hydration before consuming a Tracker selection, runs it, and returns to Tracker", async () => {
    sessionStorage.clear();
    window.location.hash = "questions";
    const key = "axom.courseQuizLaunch.v1";
    sessionStorage.setItem(key, JSON.stringify({
      module: "Neuro", term: "Term 4", week: 2,
      questionIds: ["tracker-ready"], setIds: ["tracker-set"],
    }));
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(screen.queryByText("Verified course question")).toBeNull();

    act(() => {
      useStore.setState({
        questions: [question({ id: "tracker-ready", stem: "Verified course question", correctKey: "A" })],
        questionSets: [{
          ...set("tracker-set", "Course IMCQ", "tracker-ready", "2026-10-14T10:00:00.000Z"),
          scope: { courseId: "ncrs", module: "Neuro", week: 2 },
        }],
      });
    });
    await waitFor(() => expect(screen.getByText("Verified course question")).toBeTruthy());
    expect(sessionStorage.getItem(key)).toBeNull();

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Finish block" }));
    expect(screen.getByRole("heading", { name: "Block results" })).toBeTruthy();
    expect(useStore.getState().quizSessions.some((item) => item.questionIds.includes("tracker-ready"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Return to Course Tracker" }));
    expect(window.location.hash).toBe("#tracker");
    expect(screen.queryByText("Verified course question")).toBeNull();
    sessionStorage.clear();
  });
});

describe("QuestionWorkspacePage collection recovery routing", () => {
  it("opens the canonical mapping-review bank from a course collection", async () => {
    useStore.setState({
      questions: [question({ id: "uncertain", stem: "Needs source review", needsReview: true })],
      questionSets: [set("scope-review", "School IMCQ needing review", "uncertain", "2026-10-14T12:00:00Z")],
    });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Resolve unresolved questions for School IMCQ needing review" }));
    expect(screen.getByRole("tab", { name: "Bank (1)" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Needs source review" })).toBeTruthy();
  });

  it("sends missing local question records to the existing Import flow, not an empty quiz", async () => {
    useStore.setState({
      questions: [],
      questionSets: [set("missing-set", "Absent source PQ", "lost-question", "2026-10-14T12:00:00Z")],
    });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    expect(screen.getByRole("button", { name: "Practice Absent source PQ" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Import missing source for Absent source PQ" }));
    expect(screen.getByRole("tab", { name: "Import" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
    const recovery = screen.getByRole("region", { name: "Missing question recovery" });
    expect(within(recovery).getByRole("heading", { name: "Recover Absent source PQ" })).toBeTruthy();
    expect(recovery.textContent).toContain("1 of 1 original question records still missing");
    expect(recovery.textContent).toContain("It does not repair this collection automatically");
  });

  it("keeps a fresh finalized import separate and the original recovery unresolved", async () => {
    const original = { ...set("missing-set", "Original source PQ", "lost-question", "2026-10-14T12:00:00Z"),
      questionIds: ["kept", "lost-question"] };
    useStore.setState({ questions: [question({ id: "kept", notes: "Preserve this note" })], questionSets: [original] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Original source PQ" }));
    await user.click(within(screen.getByLabelText("Import source type")).getByRole("button", { name: "Paste text" }));
    await user.type(screen.getByLabelText("Structured question text"), [
      "1. Which option is correct?", "A. Alpha", "B. Beta", "Answer: B", "Explanation: Beta follows from the source.",
    ].join("\n"));
    await user.click(screen.getByRole("button", { name: "Parse and review" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(useStore.getState().questionSets).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Import" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Missing question recovery" }).textContent).toContain("1 of 1 original question records still missing");
    expect(useStore.getState().questionSets.find(item => item.id === original.id)).toEqual(original);
    expect(useStore.getState().questions.find(item => item.id === "kept")?.notes).toBe("Preserve this note");
    expect(useStore.getState().questions.some(item => item.id === "lost-question")).toBe(false);
  });

  it("retains intent through tab navigation and reacts to exact partial and complete records", async () => {
    const original = { ...set("missing-set", "Original source PQ", "lost-a", "2026-10-14T12:00:00Z"), questionIds: ["lost-a", "lost-b"] };
    useStore.setState({ questions: [], questionSets: [original] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Original source PQ" }));
    await user.click(screen.getByRole("button", { name: "Back to collection" }));
    await user.click(screen.getByRole("tab", { name: "Import" }));
    expect(screen.getByRole("region", { name: "Missing question recovery" }).textContent).toContain("2 of 2 original question records still missing");
    act(() => { useStore.setState({ questions: [question({ id: "lost-a" })] }); });
    expect(screen.getByRole("region", { name: "Missing question recovery" }).textContent).toContain("1 of 2 original question records still missing");
    act(() => { useStore.setState({ questions: [question({ id: "lost-a" }), question({ id: "lost-b", needsReview: true })] }); });
    const recovery = screen.getByRole("region", { name: "Missing question recovery" });
    expect(recovery.textContent).toContain("All original question records are present in this workspace");
    expect(recovery.textContent).toContain("2 present now. 1 ready to practice. 1 need answer review.");
    expect(recovery.textContent).toContain("not a saved backup or durable recovery");
    expect(recovery.textContent).not.toContain("records recovered");
    expect(useStore.getState().questionSets).toEqual([original]);
    act(() => { useStore.setState({ questions: [] }); });
    expect(recovery.textContent).toContain("2 of 2 original question records still missing");
    expect(recovery.textContent).toContain("0 present now. 0 ready to practice. 0 need answer review.");
  });

  it.each(["Cancel recovery", "Add your own material"])("clears recovery explicitly with %s", async (control) => {
    useStore.setState({ questionSets: [set("missing-set", "Absent source PQ", "lost-question", "2026-10-14T12:00:00Z")] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Absent source PQ" }));
    await user.click(screen.getByRole("button", { name: control }));
    expect(screen.queryByRole("region", { name: "Missing question recovery" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
  });

  it("keeps the unfinished import intact when cancelling only recovery", async () => {
    useStore.setState({ questionSets: [set("missing-set", "Absent source PQ", "lost-question", "2026-10-14T12:00:00Z")] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Absent source PQ" }));
    await user.click(within(screen.getByLabelText("Import source type")).getByRole("button", { name: "Paste text" }));
    await user.type(screen.getByLabelText("Structured question text"), "1. Keep this pending question?\nA. Alpha\nB. Beta\nAnswer: B");
    await user.click(screen.getByRole("button", { name: "Parse and review" }));
    expect(screen.getByText(/Keep this pending question\?/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel recovery" }));
    expect(screen.queryByRole("region", { name: "Missing question recovery" })).toBeNull();
    expect(screen.getByText(/Keep this pending question\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize import" })).toBeTruthy();
    expect(useStore.getState().questions).toHaveLength(0);
  });

  it("clears recovery when parsing an unrelated saved source", async () => {
    useStore.setState({
      questionSets: [set("missing-set", "Absent source PQ", "lost-question", "2026-10-14T12:00:00Z")],
      documents: [{ id: "other-source", title: "Other saved source", fileName: "other.txt", fileType: "text/plain",
        uploadedAt: "2026-10-14T12:00:00Z", rawText: "1. Which option?\nA. Alpha\nB. Beta\nAnswer: B", sizeBytes: 50,
        tags: [], linkedQuestionSetIds: [], libraryOnly: true }],
    });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Absent source PQ" }));
    await user.click(screen.getByRole("tab", { name: "Source Library (1)" }));
    await user.click(screen.getByRole("button", { name: "Parse into questions" }));
    expect(screen.queryByRole("region", { name: "Missing question recovery" })).toBeNull();
    expect(screen.getByRole("button", { name: "Finalize import" })).toBeTruthy();
  });

  it("stops claiming recovery if the original collection changes or disappears", async () => {
    const original = set("missing-set", "Absent source PQ", "lost-question", "2026-10-14T12:00:00Z");
    useStore.setState({ questionSets: [original] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Import missing source for Absent source PQ" }));
    act(() => { useStore.setState({ questionSets: [{ ...original, questionIds: ["new-id"] }], questions: [question({ id: "lost-question" })] }); });
    expect(screen.getByRole("region", { name: "Missing question recovery" }).textContent).toContain("The original collection changed");
    act(() => { useStore.setState({ questionSets: [] }); });
    expect(screen.getByRole("region", { name: "Missing question recovery" }).textContent).toContain("The original collection is no longer available");
  });
});

describe("QuestionWorkspacePage complete week block defaults", () => {
  it("prefills the actual unique ready question count across overlapping sets", async () => {
    const questions = [
      question({ id: "week-a", stem: "Question A" }),
      question({ id: "week-b", stem: "Question B" }),
      question({ id: "week-c", stem: "Question C" }),
      question({ id: "week-provisional", stem: "Unverified answer", needsReview: true }),
    ];
    const scope = { module: "Neuro", week: 2 };
    useStore.setState({
      questions,
      questionSets: [
        { ...set("week-set-one", "IMCQ 2", "week-a", "2026-10-14T12:00:00Z"),
          questionIds: ["week-a", "week-b", "week-provisional"], scope },
        { ...set("week-set-two", "Week 2 PQ", "week-b", "2026-10-14T12:00:00Z"),
          questionIds: ["week-b", "week-c"], scope },
      ],
    });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("button", { name: "Browse weeks" }));
    await user.click(screen.getByRole("button", { name: "Practice week" }));
    const dialog = screen.getByRole("dialog", { name: "Set up a tutor block" });
    expect(within(dialog).getByRole("spinbutton", { name: "Custom question count" })).toHaveProperty("value", "3");
    expect(within(dialog).getByRole("region", { name: "Practice source" }).textContent).toContain("3 questions in this block");
    await user.click(within(dialog).getByRole("button", { name: "Start tutor block" }));
    expect(screen.getByRole("heading", { name: /Tutor · 1 of 3/ })).toBeTruthy();
    expect(screen.queryByText("Unverified answer")).toBeNull();
  });
});

describe("QuestionWorkspacePage exact, fail-closed Course Tracker handoff", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());
  it("never starts a shortened course quiz while the second question is missing or awaiting review", async () => {
    const key = "axom.courseQuizLaunch.v1";
    sessionStorage.setItem(key, JSON.stringify({
      term: "Term 4", module: "NCRS", week: 2, questionIds: ["tracker-a", "tracker-b"],
      setIds: ["course-week-2"],
    }));
    useStore.setState({ questions: [question({ id: "tracker-a", stem: "Ready first" })] });
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    expect(screen.getByRole("heading", { name: /Course practice is waiting/ })).toBeTruthy();
    expect(screen.getByText(/1 of 2 questions ready on this device/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Tutor/ })).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(key)!).questionIds).toEqual(["tracker-a", "tracker-b"]);

    await act(async () => { await useStore.setState({ questions: [
      question({ id: "tracker-a", stem: "Ready first" }),
      question({ id: "tracker-b", stem: "Review second", needsReview: true }),
    ] }); });
    expect(screen.getByRole("status", { name: /Course practice is waiting/ }).textContent).toContain("1 require answer/source review");
    await user.click(screen.getByRole("button", { name: "Review 1 question" }));
    expect(screen.getByRole("button", { name: "Review second" })).toBeTruthy();
    expect(sessionStorage.getItem(key)).not.toBeNull();

    await act(async () => { await useStore.setState({ questions: [
      question({ id: "tracker-a", stem: "Ready first" }),
      question({ id: "tracker-b", stem: "Verified second", needsReview: false }),
    ] }); });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Tutor · 1 of 2" })).toBeTruthy());
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
    expect(screen.getByText("Ready first")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null")?.poolIds).toEqual(["tracker-a", "tracker-b"]));
    sessionStorage.clear();
  });

  it("does not consume malformed handoffs and allows explicit cancellation", async () => {
    const key = "axom.courseQuizLaunch.v1";
    sessionStorage.setItem(key, JSON.stringify({
      term: "Term 4", module: "NCRS", questionIds: ["duplicate", "duplicate"], setIds: [],
    }));
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);
    expect(screen.getByRole("heading", { name: "Course practice needs a valid selection" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Tutor/ })).toBeNull();
    expect(sessionStorage.getItem(key)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel course request" }));
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.queryByRole("heading", { name: /Course practice/ })).toBeNull();
  });
});

describe("QBank single-question medical-media integrity", () => {
  const baseAttachment = {
    id: "figure-needs-restoration", fileName: "essential-ecg.png", mimeType: "image/png" as const,
    byteSize: 20, blobKey: "figure-needs-restoration", assetId: "ecg-1",
    altText: "Essential ECG", role: "exhibit" as const,
    createdAt: "2026-10-14", updatedAt: "2026-10-14",
  };
  it("does not expose a direct Check answer pathway for a figure-essential question missing its image", async () => {
    const user = userEvent.setup();
    useStore.setState({ questions: [question({
      id: "medical-ecg", stem: "Interpret this ECG before answering.",
      attachments: [baseAttachment],
    })] });
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("tab", { name: "Bank (1)" }));
    await user.click(screen.getByRole("button", { name: "Interpret this ECG before answering." }));
    expect(screen.getByRole("dialog", { name: "Verify essential clinical figures" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    expect(screen.getByText(/cannot record an answer until the necessary clinical image/)).toBeTruthy();
  });
  it("does not block a text-only question merely because a personal note image is absent", async () => {
    const user = userEvent.setup();
    useStore.setState({ questions: [question({
      id: "plain-question", stem: "Text-only question with an unrelated study note.",
      attachments: [{ ...baseAttachment, role: undefined }],
    })] });
    render(<QuestionWorkspacePage />);
    await user.click(screen.getByRole("tab", { name: "Bank (1)" }));
    await user.click(screen.getByRole("button", { name: "Text-only question with an unrelated study note." }));
    expect(screen.getByRole("dialog", { name: "Question" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Verify essential clinical figures" })).toBeNull();
  });
});
