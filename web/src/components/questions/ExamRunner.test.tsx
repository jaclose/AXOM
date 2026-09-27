// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { QuizBlock } from "../../lib/quiz";
import { ExamRunner } from "./ExamRunner";
import { createTextAnnotation } from "../../lib/questionAnnotations";
import { STORAGE_KEYS } from "../../lib/brand";

const mocked = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  saveQuizBlock: vi.fn(),
  updateQuestion: vi.fn(),
  recordQuestionAttempt: vi.fn(),
  addQuestionSet: vi.fn(),
  bulkAddTrackerItems: vi.fn(),
}));

vi.mock("../../lib/store", () => ({ useStore: () => mocked.store }));
vi.mock("../../lib/ai", () => ({
  resolveActiveProvider: () => null,
  explainSimply: vi.fn(),
  explainWhyWrong: vi.fn(),
  memoryHook: vi.fn(),
}));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

const question: QuestionRecord = {
  id: "question-1",
  source: "manual",
  stem: "Which option is correct?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B",
  correctAnswerText: "Beta",
  explanation: "Beta is correct.",
  setId: "set-1",
  status: "unseen",
  tags: [],
  attempts: [],
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const questionSet: QuestionSet = {
  id: "set-1",
  title: "Saved set",
  sourceDocumentIds: [],
  createdAt: "2026-07-10T00:00:00.000Z",
  questionIds: [question.id],
  tags: [],
  aiEnhanced: false,
  parserWarnings: [],
};

const savedBlock: QuizBlock = {
  id: "block-1",
  title: "Timed saved block",
  mode: "exam",
  timed: true,
  filters: { count: 10, status: "all", setIds: [questionSet.id] },
  createdAt: "2026-07-10T00:00:00.000Z",
};

function setStore() {
  mocked.store = {
    questions: [question],
    questionSets: [questionSet],
    quizBlocks: [savedBlock],
    quizSessions: [],
    saveQuizBlock: mocked.saveQuizBlock,
    saveQuizSession: vi.fn(),
    recordQuestionAttempt: mocked.recordQuestionAttempt,
    updateQuestion: mocked.updateQuestion,
    addAnkiCards: vi.fn(() => ({ saved: 1, errors: [] })),
    addQuestionSet: mocked.addQuestionSet,
    bulkAddTrackerItems: mocked.bulkAddTrackerItems,
    tracker: [],
  };
}

const localValues = new Map<string, string>();
const memoryLocalStorage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key: string) => localValues.get(key) ?? null,
  key: (index: number) => [...localValues.keys()][index] ?? null,
  removeItem: (key: string) => { localValues.delete(key); },
  setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryLocalStorage);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ExamRunner saved blocks and selection semantics", () => {
  it("restores an active question, picked answer, and position after refresh", () => {
    setStore();
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify({
      mode: "tutor", poolIds: [question.id], index: 0, answers: [], picked: "A",
      revealed: false, startedAt: "2026-07-10T01:00:00.000Z", timed: false,
      filters: { count: 1, status: "all", ordered: true },
    }));
    render(<ExamRunner mode="tutor" onClose={() => {}} />);
    expect(screen.getByText(question.stem)).toBeTruthy();
    expect(screen.getByRole("button", { name: /A\. Alpha/i }).getAttribute("aria-pressed")).toBe("true");
  });
  it("reopens a timed block as timed and advances lastRunAt only when Start is pressed", async () => {
    setStore();
    const user = userEvent.setup();
    render(
      <ExamRunner
        mode={savedBlock.mode}
        presetFilters={savedBlock.filters}
        presetTimed={savedBlock.timed}
        blockId={savedBlock.id}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /Timed/i })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: /Exam \(feedback at the end\)/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Saved set (1)" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "10" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(mocked.saveQuizBlock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Start exam block/i }));

    expect(mocked.saveQuizBlock).toHaveBeenCalledOnce();
    const updated = mocked.saveQuizBlock.mock.calls[0][0] as QuizBlock;
    expect(updated.id).toBe(savedBlock.id);
    expect(updated.timed).toBe(true);
    expect(Number.isNaN(Date.parse(updated.lastRunAt ?? ""))).toBe(false);
    expect(screen.getByText(question.stem)).toBeTruthy();
  });

  it("launches a snapshot set from explicit IDs in stored order without backlinks", async () => {
    const questions = ["B", "A", "D"].map((id) => ({
      ...question,
      id,
      stem: `Snapshot question ${id}`,
      setId: undefined,
    }));
    const snapshot: QuestionSet = {
      ...questionSet,
      id: "snapshot",
      title: "Snapshot set",
      questionIds: ["A", "D", "B"],
      ordering: "random",
      seed: "creation-only",
    };
    setStore();
    mocked.store = {
      ...mocked.store,
      questions,
      questionSets: [snapshot],
    };
    const user = userEvent.setup();
    render(<ExamRunner
      mode="tutor"
      presetFilters={{ count: 10, status: "all", setIds: [snapshot.id] }}
      onClose={() => {}}
    />);

    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Snapshot launch must not shuffle.");
    });
    try {
      await user.click(screen.getByRole("button", { name: /Start tutor block/i }));
      expect(screen.getByText("Snapshot question A")).toBeTruthy();
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Snapshot question D")).toBeTruthy();
  });

  it("announces answer, flag, and confidence selection while preserving shortcut guards", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    const optionA = screen.getByRole("button", { name: "A. Alpha" });
    const optionB = screen.getByRole("button", { name: "B. Beta" });
    expect(optionA.getAttribute("aria-pressed")).toBe("false");

    await user.click(optionA);
    expect(optionA.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(optionA, { key: "B" });
    expect(optionA.getAttribute("aria-pressed")).toBe("true");
    expect(optionB.getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(window, { key: "B" });
    expect(optionB.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "F" });
    expect(screen.getByRole("button", { name: "Flag question" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(optionA);
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    const confidence = screen.getByRole("button", { name: "Confidence 3 of 5" });
    expect(confidence.getAttribute("aria-pressed")).toBe("false");
    await user.click(confidence);
    expect(confidence.getAttribute("aria-pressed")).toBe("true");
  });

  it("persists the latest error classification and confidence when ArrowRight advances", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.selectOptions(screen.getByLabelText("Why did this go wrong?"), "knowledge-gap");
    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(mocked.recordQuestionAttempt).toHaveBeenCalledWith(question.id, expect.objectContaining({
      status: "incorrect",
      errorType: "knowledge-gap",
      confidence: 4,
    }));
  });

  it("renders a manually edited explanation verbatim in deferred results", async () => {
    const edited = "Answer choice B is wrong because receptor affinity alone does not determine signaling.";
    setStore();
    mocked.store = { ...mocked.store, questions: [{ ...question, explanation: edited }] };
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    expect(screen.getByText(edited).textContent).toBe(edited);
  });

  it("turns missed results into a fixed review set and Tracker review work", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [{ ...question, topic: "Renal clearance", category: "Physiology" }] };
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    expect(screen.getByText("What next?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create set from missed" }));
    expect(mocked.addQuestionSet).toHaveBeenCalledWith(expect.objectContaining({ questionIds: [question.id], ordering: "import", tags: ["missed-review"] }));
    await user.click(screen.getByRole("button", { name: "Add weak topics to Tracker" }));
    expect(mocked.bulkAddTrackerItems).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: "Review Renal clearance", kind: "Review Loop" }),
      expect.objectContaining({ label: "Review Physiology", kind: "Review Loop" }),
    ]));
    expect(screen.getByRole("button", { name: "Review set created" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Topics added to Tracker" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Review set created" }));
    expect(mocked.addQuestionSet).toHaveBeenCalledTimes(1);
  });

  it("does not retake a missed question after its answer mapping is marked wrong", async () => {
    const transitioning = { ...question, id: "mapping-transition" };
    setStore();
    mocked.store = { ...mocked.store, questions: [transitioning] };
    mocked.updateQuestion.mockImplementationOnce((_id, patch) => Object.assign(transitioning, patch));
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[transitioning.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: /Answer wrong/ }));
    await user.click(screen.getByRole("button", { name: "Finish block" }));

    expect(transitioning.needsReview).toBe(true);
    expect(screen.getByRole("heading", { name: "Block results" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retake .* missed/ })).toBeNull();
    expect(screen.getByText(/correct unresolved/)).toBeTruthy();
  });

  it("keeps one persisted highlight through rapid next/previous navigation", async () => {
    const startOffset = question.stem.indexOf("option");
    const annotated = {
      ...question,
      annotations: [createTextAnnotation({
        id: "ann-nav", target: "stem", sourceText: question.stem, startOffset,
        endOffset: startOffset + "option".length, tone: "yellow",
        now: "2026-07-16T12:00:00.000Z",
      })],
    };
    const second = { ...question, id: "question-2", stem: "Which second option is correct?" };
    setStore();
    mocked.store = { ...mocked.store, questions: [annotated, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[annotated.id, second.id]} onClose={() => {}} />);

    expect(screen.getByLabelText("Highlighted text: option")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getAllByLabelText("Highlighted text: option")).toHaveLength(1);
  });

  it("keeps utilities outside the question region and opens one panel at a time", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    const main = screen.getByRole("main", { name: "Tutor question workspace" });
    const questionRegion = main.querySelector(".tutor-question-region")!;
    expect(questionRegion.contains(screen.getByRole("button", { name: "A. Alpha" }))).toBe(true);

    await user.click(screen.getByRole("button", { name: "Calculator" }));
    expect(questionRegion.contains(screen.getByRole("dialog", { name: "Calculator" }))).toBe(false);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Question notes" }));
    expect(screen.queryByRole("dialog", { name: "Calculator" })).toBeNull();
    expect(questionRegion.contains(screen.getByLabelText("Question note"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Text settings" }));
    expect(screen.queryByLabelText("Question note")).toBeNull();
    expect(questionRegion.contains(screen.getByRole("group", { name: "Question text size" }))).toBe(false);
  });

  it("persists calculator value and notes across tool close and reopen", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Calculator" }));
    await user.click(screen.getByRole("button", { name: "7" }));
    await user.click(screen.getByRole("button", { name: "Close calculator tools" }));
    await user.click(screen.getByRole("button", { name: "Calculator" }));
    expect(document.querySelector(".quiz-calc-expr")?.textContent).toBe("7");

    await user.click(screen.getByRole("button", { name: "Question notes" }));
    await user.type(screen.getByLabelText("Question note"), "Local tutor note");
    await user.click(screen.getByRole("button", { name: "Close notes tools" }));
    expect(mocked.updateQuestion).toHaveBeenCalledWith(question.id, { notes: "Local tutor note" });
    await user.click(screen.getByRole("button", { name: "Question notes" }));
    expect((screen.getByLabelText("Question note") as HTMLTextAreaElement).value).toBe("Local tutor note");
  });

  it("resets calculator state for a brand-new Tutor session", async () => {
    setStore();
    const user = userEvent.setup();
    const first = render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Calculator" }));
    await user.click(screen.getByRole("button", { name: "7" }));
    expect(document.querySelector(".quiz-calc-expr")?.textContent).toBe("7");
    first.unmount();

    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Calculator" }));
    expect(document.querySelector(".quiz-calc-expr")?.textContent).toBe("0");
  });

  it("flushes a rapid note to the correct question before navigation", async () => {
    const second = { ...question, id: "question-2", stem: "Which second option is correct?", notes: undefined };
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Question notes" }));
    await user.type(screen.getByLabelText("Question note"), "Bound to first");
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));

    expect(mocked.updateQuestion).toHaveBeenCalledWith(question.id, { notes: "Bound to first" });
    expect(mocked.updateQuestion).not.toHaveBeenCalledWith(second.id, expect.objectContaining({ notes: expect.anything() }));
    expect((screen.getByLabelText("Question note") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps highlight mode active, toggles it off, and erases only one highlight", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Highlight tools" }));
    const yellow = screen.getByRole("button", { name: "Yellow persistent highlight" });
    await user.click(yellow);
    expect(yellow.getAttribute("aria-pressed")).toBe("true");

    selectText(screen.getByLabelText("Question stem"), 6, 12);
    expect(screen.getByLabelText("Highlighted text: option")).toBeTruthy();
    expect(yellow.getAttribute("aria-pressed")).toBe("true");

    selectText(screen.getByLabelText("Question stem"), 16, 23);
    expect(screen.getByLabelText("Highlighted text: correct")).toBeTruthy();
    expect(screen.getAllByLabelText(/Highlighted text:/)).toHaveLength(2);

    await user.click(yellow);
    expect(yellow.getAttribute("aria-pressed")).toBe("false");
    const updateCount = mocked.updateQuestion.mock.calls.length;
    selectText(screen.getByLabelText("Question stem"), 0, 5);
    expect(mocked.updateQuestion).toHaveBeenCalledTimes(updateCount);

    await user.click(screen.getByRole("button", { name: "Erase highlights" }));
    await user.click(screen.getByLabelText("Highlighted text: option"));
    expect(screen.queryByLabelText("Highlighted text: option")).toBeNull();
    expect(screen.getByLabelText("Highlighted text: correct")).toBeTruthy();
  });

  it("confirms clear-all, clears annotation mode with Escape, and restores tool focus", async () => {
    const first = createTextAnnotation({
      id: "first", target: "stem", sourceText: question.stem, startOffset: 6,
      endOffset: 12, tone: "yellow", now: "2026-07-16T12:00:00.000Z",
    });
    const second = createTextAnnotation({
      id: "second", target: "stem", sourceText: question.stem, startOffset: 16,
      endOffset: 23, tone: "cyan", now: "2026-07-16T12:00:00.000Z",
    });
    setStore();
    mocked.store = { ...mocked.store, questions: [{ ...question, annotations: [first, second] }] };
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Highlight tools" }));
    const cyan = screen.getByRole("button", { name: "Cyan persistent highlight" });
    await user.click(cyan);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("highlight tools")).toBeNull();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Highlight tools" }));

    const eraser = screen.getByRole("button", { name: "Erase highlights" });
    await user.click(eraser);
    expect(eraser.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(eraser.getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Highlight tools" }));
    await user.click(screen.getByRole("button", { name: "Clear highlights" }));
    expect(confirm).toHaveBeenCalledWith("Clear all 2 highlights from this question?");
    expect(screen.queryByLabelText(/Highlighted text:/)).toBeNull();
  });

  it("persists text scale and restores first-use guidance on request", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);
    expect(screen.getByText(/Highlight stays active/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Text settings" }));
    await user.click(screen.getByRole("button", { name: "Increase reading size" }));
    expect(localStorage.getItem("axom.quiz.reading-scale.v1")).toBe("1.1");
    expect(screen.getByRole("status").textContent).toContain("110%");

    await user.click(screen.getByRole("button", { name: "Tutor tips" }));
    await user.click(screen.getByRole("button", { name: "Show first-use tip again" }));
    expect(screen.getByText(/Highlight stays active/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem("axom.quiz.tutor-tips.v1")).toBe("dismissed");
  });
});

function selectText(root: HTMLElement, startOffset: number, endOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const end = cursor + node.data.length;
    nodes.push({ node, start: cursor, end });
    cursor = end;
  }
  const start = nodes.find((entry) => startOffset >= entry.start && startOffset <= entry.end);
  const end = nodes.find((entry) => endOffset >= entry.start && endOffset <= entry.end);
  if (!start || !end) throw new Error("Expected text nodes spanning the requested selection.");
  const range = document.createRange();
  range.setStart(start.node, startOffset - start.start);
  range.setEnd(end.node, endOffset - end.start);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.mouseUp(root);
}
