// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import type { QuestionAttempt, QuestionRecord } from "../../lib/questions";
import type { QuizBlock } from "../../lib/quiz";
import { ExamRunner } from "./ExamRunner";
import { createTextAnnotation } from "../../lib/questionAnnotations";
import { STORAGE_KEYS } from "../../lib/brand";

const mocked = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  saveQuizBlock: vi.fn(),
  updateQuestion: vi.fn(),
  recordQuestionAttempt: vi.fn(),
  commitQuizRun: vi.fn(),
  saveQuizSession: vi.fn(),
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
    saveQuizSession: mocked.saveQuizSession,
    recordQuestionAttempt: mocked.recordQuestionAttempt,
    commitQuizRun: mocked.commitQuizRun,
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

/** The attempts an exam block saved, in the one commit that carries its result. */
function committedAttempts(): Array<{ questionId: string; attempt: Omit<QuestionAttempt, "at"> }> {
  return mocked.commitQuizRun.mock.calls.at(-1)?.[0].attempts ?? [];
}

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

  it("adds up the time across visits when an exam answer is revisited", () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setStore();
    const second = { ...question, id: "question-two", stem: "Second stem: which is right?" };
    mocked.store = { ...mocked.store, questions: [question, second] };
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    now += 20_000;
    fireEvent.click(screen.getByRole("button", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & next" }));
    now += 5_000;
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    now += 7_000;
    fireEvent.click(screen.getByRole("button", { name: "Submit & next" }));
    now += 3_000;
    fireEvent.click(screen.getByRole("button", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & finish" }));

    // Question 1: 20 s, then 7 s on the second visit. Question 2: 5 s before
    // stepping back, then 3 s.
    const spent = Object.fromEntries(committedAttempts().map(({ questionId, attempt }) => [questionId, attempt.timeSpentSeconds]));
    expect(spent).toEqual({ [question.id]: 27, [second.id]: 8 });
    vi.restoreAllMocks();
  });

  it("does not count the time AXOM spends hidden behind another tab", () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setStore();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={() => {}} />);
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    now += 10_000;
    setHidden(true);
    now += 60_000;
    setHidden(false);
    now += 5_000;
    fireEvent.click(screen.getByRole("button", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & finish" }));

    // 10 s before the tab was hidden and 5 s after it came back. The minute away is not time on the question.
    expect(committedAttempts().map(({ attempt }) => attempt.timeSpentSeconds)).toEqual([15]);
    delete (document as { hidden?: boolean }).hidden;
    vi.restoreAllMocks();
  });

  it("keeps a changed last answer when the exam is submitted", () => {
    setStore();
    const second = { ...question, id: "question-two", stem: "Second stem: which is right?" };
    mocked.store = { ...mocked.store, questions: [question, second] };
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & next" }));
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    // Back on question 1, change the answer, go forward, then finish.
    fireEvent.click(screen.getByRole("button", { name: "B. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & next" }));
    fireEvent.click(screen.getByRole("button", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & next" }));
    fireEvent.click(screen.getByRole("button", { name: "B. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit & finish" }));
    const picked = Object.fromEntries(committedAttempts().map(({ questionId, attempt }) => [questionId, attempt.answerKey]));
    expect(picked).toEqual({ [question.id]: "B", [second.id]: "B" });
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

describe("ExamRunner keeps what was answered", () => {
  const second: QuestionRecord = { ...question, id: "question-two", stem: "Second stem: which is right?" };

  it("saves a tutor answer when it is checked, not when the learner moves on", async () => {
    // Regression: the attempt was only written by "Next question", so leaving
    // the block from the explanation saved nothing at all.
    setStore();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    expect(mocked.recordQuestionAttempt).toHaveBeenCalledTimes(1);
    expect(mocked.recordQuestionAttempt).toHaveBeenCalledWith(question.id, expect.objectContaining({
      answerKey: "A", status: "incorrect", mode: "tutor", quizSessionId: expect.any(String),
    }));

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(confirm).toHaveBeenCalledWith("Leave this block? Answered questions are saved. Unanswered ones are not scored.");
    expect(onClose).toHaveBeenCalledTimes(1);
    // The block is kept as a session that ended early, under the same run id.
    const runId = mocked.recordQuestionAttempt.mock.calls[0][1].quizSessionId;
    expect(mocked.commitQuizRun).toHaveBeenCalledWith({
      attempts: [],
      session: expect.objectContaining({ id: runId, mode: "tutor", endedEarly: true, questionIds: [question.id] }),
    });
    confirm.mockRestore();
  });

  it("writes the error type and confidence against the same run instead of a second attempt", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.selectOptions(screen.getByLabelText("Why did this go wrong?"), "missed-clue");
    await user.click(screen.getByRole("button", { name: "Confidence 2 of 5" }));

    const runIds = new Set(mocked.recordQuestionAttempt.mock.calls.map(([, attempt]) => attempt.quizSessionId));
    expect(runIds.size).toBe(1);
    expect(mocked.recordQuestionAttempt.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      status: "incorrect", errorType: "missed-clue", confidence: 2,
    }));
  });

  it("records how sure the learner was only when they said so before checking", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Sure" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    expect(mocked.recordQuestionAttempt.mock.calls[0][1]).toEqual(expect.objectContaining({ certainty: "sure" }));
    // Once the answer is showing, the question can no longer be asked honestly.
    expect(screen.queryByRole("group", { name: "How sure are you?" })).toBeNull();
  });

  it("leaves certainty out of the attempt when the learner skips it", async () => {
    setStore();
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    expect(mocked.recordQuestionAttempt.mock.calls[0][1]).not.toHaveProperty("certainty");
  });

  it("keeps the answered questions of an exam block the learner leaves early", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & next" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    const run = mocked.commitQuizRun.mock.calls[0][0];
    expect(run.attempts).toEqual([{
      questionId: question.id,
      attempt: expect.objectContaining({ answerKey: "B", status: "correct", mode: "exam", quizSessionId: run.session.id }),
    }]);
    expect(run.session).toEqual(expect.objectContaining({
      endedEarly: true,
      score: { correct: 1, scored: 1, total: 2, pct: 100 },
    }));
    confirm.mockRestore();
  });

  it("saves nothing when a block is left before any question is answered", async () => {
    setStore();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    expect(mocked.recordQuestionAttempt).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("saves an exam block's attempts and result as one commit under one run id", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Submit & next" }));
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    expect(mocked.recordQuestionAttempt).not.toHaveBeenCalled();
    expect(mocked.saveQuizSession).not.toHaveBeenCalled();
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    const run = mocked.commitQuizRun.mock.calls[0][0];
    expect(run.session.endedEarly).toBeUndefined();
    expect(run.attempts.map((entry: { attempt: { quizSessionId: string } }) => entry.attempt.quizSessionId))
      .toEqual([run.session.id, run.session.id]);
  });

  it("resumes a block in the mode it was started in, whichever button reopened it", () => {
    setStore();
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify({
      mode: "exam", runId: "run-restored", poolIds: [question.id], index: 0, answers: [],
      revealed: false, startedAt: "2026-07-10T01:00:00.000Z", timed: false,
      filters: { count: 1, status: "all", ordered: true },
    }));
    render(<ExamRunner mode="tutor" onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: /Exam · 1 of 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit & finish" })).toBeTruthy();
  });

  it("after a refresh, writes only the tutor answers the workspace never received", () => {
    const savedAlready: QuestionRecord = {
      ...question,
      attempts: [{ at: "2026-07-10T01:01:00.000Z", answerKey: "A", status: "incorrect", errorType: "missed-clue", quizSessionId: "run-restored", mode: "tutor" }],
    };
    setStore();
    mocked.store = { ...mocked.store, questions: [savedAlready, second] };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify({
      mode: "tutor", runId: "run-restored", poolIds: [savedAlready.id, second.id], index: 1,
      answers: [
        { questionId: savedAlready.id, answerKey: "A", correct: false, flagged: false, seconds: 12 },
        { questionId: second.id, answerKey: "B", correct: true, flagged: false, seconds: 9 },
      ],
      picked: "B", revealed: true, startedAt: "2026-07-10T01:00:00.000Z", timed: false,
      filters: { count: 2, status: "all", ordered: true },
    }));
    render(<ExamRunner mode="tutor" onClose={() => {}} />);

    // The first answer is on disk with its error type, so it is left alone.
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    expect(mocked.commitQuizRun.mock.calls[0][0].attempts).toEqual([{
      questionId: second.id,
      attempt: expect.objectContaining({ answerKey: "B", status: "correct", quizSessionId: "run-restored", timeSpentSeconds: 9 }),
    }]);
  });

  it("does not re-save anything when resuming a block saved before runs had an id", () => {
    setStore();
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify({
      mode: "tutor", poolIds: [question.id], index: 0,
      answers: [{ questionId: question.id, answerKey: "A", correct: false, flagged: false }],
      picked: "A", revealed: true, startedAt: "2026-07-10T01:00:00.000Z", timed: false,
      filters: { count: 1, status: "all", ordered: true },
    }));
    render(<ExamRunner mode="tutor" onClose={() => {}} />);

    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    expect(mocked.recordQuestionAttempt).not.toHaveBeenCalled();
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
