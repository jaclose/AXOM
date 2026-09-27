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
    expect(screen.getByRole("button", { name: "Import Questions" })).toBeTruthy();
    expect(screen.getByText("PDF, DOCX, TXT, Markdown, CSV, JSON, or pasted text.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Current mastery")).toBeNull();
    expect(screen.queryByText("Attempt accuracy")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Insights/ })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Import"]);
    expect(container.querySelector('[data-tour="question-bank-entry"]')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Import Questions" }));
    expect(screen.getByLabelText("Choose a question file to import")).toBeTruthy();
  });

  it("routes Paste text into the real paste mode on the unified Import tab", async () => {
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Paste text" }));
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
    expect(screen.getByLabelText("Structured question text")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Parse and review" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("finalizes reviewed pasted text and routes to the reachable saved set", async () => {
    const user = userEvent.setup();
    render(<QuestionWorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Paste text" }));
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
    expect(screen.getByRole("heading", { name: state.questionSets[0].title })).toBeTruthy();
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
    const overview = screen.getByRole("tab", { name: "Overview" });
    const importTab = screen.getByRole("tab", { name: "Import" });

    expect(overview.getAttribute("aria-controls")).toBe("question-bank-panel-overview");
    expect(document.getElementById(overview.getAttribute("aria-controls")!)).toBe(screen.getByRole("tabpanel"));
    expect(overview.getAttribute("tabindex")).toBe("0");
    expect(importTab.hasAttribute("aria-controls")).toBe(false);
    expect(importTab.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("question-bank-tab-overview");
    expectRenderedTabControlsToResolve();

    overview.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(importTab);
    expect(importTab.getAttribute("aria-selected")).toBe("true");
    expect(importTab.getAttribute("aria-controls")).toBe("question-bank-panel-import");
    expect(document.getElementById("question-bank-panel-import")).toBe(screen.getByRole("tabpanel"));
    expect(overview.hasAttribute("aria-controls")).toBe(false);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("question-bank-tab-import");
    expectRenderedTabControlsToResolve();

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(overview);
    expect(overview.getAttribute("aria-controls")).toBe("question-bank-panel-overview");
    expect(importTab.hasAttribute("aria-controls")).toBe(false);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(importTab);
    expect(importTab.getAttribute("aria-controls")).toBe("question-bank-panel-import");
    expect(overview.hasAttribute("aria-controls")).toBe(false);
    expectRenderedTabControlsToResolve();
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
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Overview", "Import", "Source Library (1)"]);
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

  it("prioritizes continuation, recent sets, mapping review, and explicit metrics", async () => {
    seedReturningState();
    const user = userEvent.setup();
    const { container } = render(<QuestionWorkspacePage />);

    expect(screen.getByRole("button", { name: "Continue last session" })).toBeTruthy();
    expect(screen.getByText(/Starts a new tutor block with the same filters/)).toBeTruthy();
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

    const card = screen.getByRole("heading", { name: snapshot.title }).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Start tutor block" }));
    expect(screen.getByText("Stored order D")).toBeTruthy();
  });

  it("removes the mapping alert after every issue is resolved", () => {
    seedReturningState();
    render(<QuestionWorkspacePage />);
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

    expect(screen.getByRole("heading", { name: "Import another clean set" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Review .* due questions/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Retry .* misses/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Review due/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Retry incorrects/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Import questions" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Begin/ }));
    expect(screen.getByRole("heading", { name: "Import questions" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Tutor/ })).toBeNull();
  });
});
