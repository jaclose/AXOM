// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vaultCheckpoint: vi.fn(() => 0),
  vaultFlush: vi.fn(async () => {}),
  vaultAssertWrite: vi.fn(),
  vaultAssertWritesSince: vi.fn(),
}));

vi.mock("../../lib/store", () => ({ useStore: Object.assign(() => mocked.store, { getState: () => ({ ...mocked.store, profile: { userId: "test-user" } }), subscribe: () => () => {} }) }));
vi.mock("../../lib/localVault", () => ({
  getVaultWriteCheckpoint: mocked.vaultCheckpoint,
  flushLocalVaultWrites: mocked.vaultFlush,
  assertVaultWrite: mocked.vaultAssertWrite,
  assertVaultWritesSince: mocked.vaultAssertWritesSince,
}));
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
  sessionStorage.clear();
  mocked.vaultCheckpoint.mockReturnValue(0);
  mocked.vaultFlush.mockResolvedValue(undefined);
  mocked.vaultAssertWrite.mockImplementation(() => undefined);
  mocked.vaultAssertWritesSince.mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
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
      filters: { count: 1, status: "incorrect", ordered: true, setIds: ["weekly-set"], categories: ["Anatomy"] },
    }));
    render(<ExamRunner mode="tutor" onClose={() => {}} />);
    expect(screen.getByText(question.stem)).toBeTruthy();
    expect(screen.getByRole("button", { name: /A\. Alpha/i }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!).filters).toMatchObject({
      status: "incorrect", setIds: ["weekly-set"], categories: ["Anatomy"], ordered: true,
    });
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
    expect(screen.getByRole("region", { name: "Practice source" }).textContent).toContain("Saved set");
    expect(screen.getByRole("button", { name: "10" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Question pool")).toHaveProperty("value", "all");
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

    await user.click(screen.getByRole("button", { name: "End early" }));
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
    await user.click(screen.getByRole("button", { name: "End early" }));

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

    await user.click(screen.getByRole("button", { name: "End early" }));

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

  it("keeps a pick and its strike-outs on a question the learner steps away from", async () => {
    // Before the block was held by the exam engine, stepping back dropped the
    // pick on screen, and every move cleared the strike-outs.
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Submit & next" }));
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Eliminate option A" }));
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(screen.getByRole("button", { name: "A. Alpha" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Restore option A" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Submit & next" }));
    expect(screen.getByRole("button", { name: "B. Beta" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Restore option A" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("counts the pick on screen as the answer when an exam block is left", async () => {
    // "End block" has always taken the pick on screen as the answer. Leaving
    // through Close now follows the same rule.
    setStore();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "End early" }));

    expect(committedAttempts()).toEqual([{ questionId: question.id, attempt: expect.objectContaining({ answerKey: "B", status: "correct" }) }]);
    confirm.mockRestore();
  });

  it("does not count a tutor pick that was never checked", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExamRunner mode="tutor" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "End early" }));

    expect(mocked.recordQuestionAttempt).toHaveBeenCalledTimes(1);
    const { session } = mocked.commitQuizRun.mock.calls[0][0];
    expect(session.answers).toEqual([
      expect.objectContaining({ questionId: question.id, answerKey: "B", correct: true }),
      { questionId: second.id, flagged: false },
    ]);
    expect(session.score).toEqual({ correct: 1, scored: 1, total: 2, pct: 100 });
    confirm.mockRestore();
  });

  it("shows a checked tutor question as checked however the learner comes back to it", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    const result = () => document.querySelector(".result-banner[role='status']")?.textContent ?? "";
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(result()).toContain("Incorrect");

    // Forward again: the second question is still checked, not offered as new.
    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(result()).toMatch(/^Correct/);
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    expect(mocked.recordQuestionAttempt).toHaveBeenCalledTimes(2);
  });

  it("writes the resume snapshot in the shape it had before the exam engine", async () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, second] };
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id, second.id]} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "A. Alpha" }));
    await user.click(screen.getByRole("button", { name: "Sure" }));
    await user.click(screen.getByRole("button", { name: "Submit & next" }));
    await user.click(screen.getByRole("button", { name: "B. Beta" }));

    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!);
    expect(Object.keys(snapshot).sort()).toEqual(["answers", "elapsedMs", "filters", "index", "items", "mode", "notes", "pausedMs", "picked", "poolIds", "revealed", "runId", "startedAt", "timed"]);
    expect(snapshot).toMatchObject({ mode: "exam", poolIds: [question.id, second.id], index: 1, picked: "B", revealed: false });
    expect(snapshot.answers).toEqual([
      { questionId: question.id, answerKey: "A", correct: false, flagged: false, seconds: expect.any(Number), certainty: "sure" },
      { questionId: second.id, answerKey: "B", correct: true, flagged: false, seconds: expect.any(Number) },
    ]);
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

describe("ExamRunner durable finalization", () => {
  it("keeps the recovery snapshot until the exact workspace write is confirmed", async () => {
    setStore();
    mocked.vaultCheckpoint.mockReturnValue(7);
    let releaseWrite!: () => void;
    mocked.vaultFlush.mockReturnValue(new Promise<void>((resolve) => { releaseWrite = resolve; }));
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Exam · 1 of 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "B. Beta" })).toHaveProperty("disabled", true);
    expect(screen.getAllByRole("button", { name: "Saving…" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Block results")).toBeNull();

    releaseWrite();
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
    expect(mocked.vaultAssertWrite).toHaveBeenCalledWith(8);
    expect(mocked.vaultAssertWritesSince).toHaveBeenCalledWith(7);
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
  });

  it("keeps a failed finish recoverable and retries under the same id", async () => {
    setStore();
    mocked.vaultFlush.mockRejectedValueOnce(new Error("Synthetic vault refusal"));
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/answers are still open and recoverable/i);
    const retained = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!);
    expect(retained).toMatchObject({ runId: expect.any(String), picked: "B" });
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Block results")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry submit & finish" }));
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(2);
    const [first, retried] = mocked.commitQuizRun.mock.calls.map(([run]) => run);
    expect(retried.session.id).toBe(first.session.id);
    expect(retried.attempts[0].attempt.quizSessionId).toBe(first.session.id);
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
  });

  it("does not claim browser recovery when every snapshot write fails", async () => {
    setStore();
    mocked.vaultFlush.mockRejectedValueOnce(new Error("Synthetic vault refusal"));
    const originalSetItem = memoryLocalStorage.setItem.bind(memoryLocalStorage);
    const storageWrite = vi.spyOn(memoryLocalStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.quizActiveSession)) throw new Error("Synthetic browser storage refusal");
      originalSetItem(key, value);
    });
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toMatch(/could not create or update browser recovery/i);
    expect(warning.textContent).not.toMatch(/open and recoverable/i);
    expect(screen.getByRole("heading", { name: "Exam · 1 of 1" })).toBeTruthy();
    storageWrite.mockRestore();
  });

  it("does not close an answered block when save-and-exit durability fails", async () => {
    setStore();
    mocked.vaultAssertWritesSince.mockImplementationOnce(() => { throw new Error("Synthetic finalization refusal"); });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "End early" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/final save not confirmed/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry save & exit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(2);
    expect(mocked.commitQuizRun.mock.calls[1][0].session.id).toBe(mocked.commitQuizRun.mock.calls[0][0].session.id);
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
    confirm.mockRestore();
  });

  it("finishing one run keeps another tab's recovery mirror discoverable", async () => {
    setStore();
    const startedAt = "2026-07-10T01:00:00.000Z";
    const current = {
      mode: "exam", runId: "run-current", poolIds: [question.id], index: 0,
      answers: [{ questionId: question.id, answerKey: "B", correct: true, flagged: false, seconds: 5 }],
      picked: "B", revealed: false, startedAt, timed: false,
      filters: { count: 1, status: "all", ordered: true },
    };
    const other = { ...current, runId: "run-other", picked: "A", answers: [] };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(current));
    localStorage.setItem(`${STORAGE_KEYS.quizActiveSession}:run:${other.runId}`, JSON.stringify(other));
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!).runId).toBe("run-other");
    expect(JSON.parse(localStorage.getItem(`${STORAGE_KEYS.quizActiveSession}:run:run-other`)!).runId).toBe("run-other");
    expect(localStorage.getItem(`${STORAGE_KEYS.quizActiveSession}:run:run-current`)).toBeNull();
  });

  it("finishing one run preserves another tab's valid legacy snapshot without a run id", async () => {
    setStore();
    const current = {
      mode: "exam", runId: "run-current", poolIds: [question.id], index: 0,
      answers: [{ questionId: question.id, answerKey: "B", correct: true, flagged: false, seconds: 5 }],
      picked: "B", revealed: false, startedAt: "2026-07-10T01:00:00.000Z", timed: false,
      filters: { count: 1, status: "all", ordered: true },
    };
    const legacy = {
      ...current, runId: undefined, picked: "A", answers: [],
      startedAt: "2026-07-10T02:00:00.000Z",
    };
    sessionStorage.setItem(`${STORAGE_KEYS.quizActiveSession}:run-id`, current.runId);
    localStorage.setItem(`${STORAGE_KEYS.quizActiveSession}:run:${current.runId}`, JSON.stringify(current));
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(legacy));
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!)).toEqual(legacy);
    expect(localStorage.getItem(`${STORAGE_KEYS.quizActiveSession}:run:run-current`)).toBeNull();
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

describe("ExamRunner answer-key integrity", () => {
  it("does not launch an invalid correct key or duplicate answer keys as scorable practice", async () => {
    setStore();
    const invalidKey = { ...question, id: "invalid-key", stem: "Invalid answer key", correctKey: "Z", setId: undefined };
    const ambiguousOptions = { ...question, id: "duplicate-key", stem: "Ambiguous options", correctKey: "A",
      options: [{ key: "A", text: "First A" }, { key: "A", text: "Second A" }], setId: undefined };
    mocked.store = { ...mocked.store, questions: [question, invalidKey, ambiguousOptions] };
    const user = userEvent.setup();
    render(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Practice source" }).textContent).toContain("1 matches your filters");
    await user.click(screen.getByRole("button", { name: "Start tutor block" }));
    expect(screen.getByText(question.stem)).toBeTruthy();
    expect(screen.queryByText("Invalid answer key")).toBeNull();
    expect(screen.queryByText("Ambiguous options")).toBeNull();
  });
});

describe("ExamRunner atomic session recovery", () => {
  const second: QuestionRecord = { ...question, id: "restored-second", stem: "Second restored question" };

  it("preserves a timed exam snapshot until every question arrives, then restores its position and answers", async () => {
    setStore();
    const now = new Date().toISOString();
    const pendingSnapshot = {
      mode: "exam", runId: "late-hydration-run", poolIds: [question.id, second.id], index: 1,
      answers: [{ questionId: question.id, answerKey: "B", correct: true, flagged: true, seconds: 18 }],
      picked: "A", revealed: false, startedAt: now, timed: true,
      filters: { count: 2, status: "all", ordered: true },
    };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(pendingSnapshot));
    mocked.store = { ...mocked.store, questions: [] };
    const onClose = vi.fn();
    const { rerender } = render(<ExamRunner mode="tutor" onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Recover your saved question block" })).toBeTruthy();
    expect(screen.getByText("0 of 2 questions are ready on this device")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!)).toEqual(pendingSnapshot);
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    expect(mocked.saveQuizSession).not.toHaveBeenCalled();

    mocked.store = { ...mocked.store, questions: [question] };
    rerender(<ExamRunner mode="tutor" onClose={onClose} />);
    expect(screen.getByText("1 of 2 questions are ready on this device")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!)).toEqual(pendingSnapshot);

    mocked.store = { ...mocked.store, questions: [question, second] };
    rerender(<ExamRunner mode="tutor" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Exam · 2 of 2" })).toBeTruthy());
    expect(screen.getByText(second.stem)).toBeTruthy();
    expect(screen.getByRole("button", { name: "A. Alpha" }).getAttribute("aria-pressed")).toBe("true");
    const resumed = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!);
    expect(resumed.poolIds).toEqual([question.id, second.id]);
    expect(resumed.index).toBe(1);
    expect(resumed.runId).toBe("late-hydration-run");
    expect(resumed.answers).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: question.id, answerKey: "B", flagged: true }),
    ]));
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    expect(mocked.saveQuizSession).not.toHaveBeenCalled();
  });

  it("does not silently score a saved block while a stored answer mapping needs review", async () => {
    setStore();
    const awaiting = { ...question, needsReview: true };
    const snapshot = {
      mode: "tutor", runId: "review-resume", poolIds: [question.id], index: 0,
      answers: [], picked: "B", revealed: false, startedAt: new Date().toISOString(),
      timed: false, filters: { count: 1, status: "all", ordered: true },
    };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(snapshot));
    mocked.store = { ...mocked.store, questions: [awaiting] };
    const { rerender } = render(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    expect(screen.getByText("0 of 1 questions are ready on this device")).toBeTruthy();
    expect(screen.getByText(/needs answer or source review/)).toBeTruthy();
    expect(mocked.recordQuestionAttempt).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBe(JSON.stringify(snapshot));

    mocked.store = { ...mocked.store, questions: [{ ...awaiting, needsReview: false }] };
    rerender(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tutor · 1 of 1" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "B. Beta" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ExamRunner live answer-evidence changes", () => {
  it.each([
    ["correct answer rekeyed", { correctKey: "A" }],
    ["choice text changed", { options: [{ key: "A", text: "Alpha edited" }, { key: "B", text: "Beta" }] }],
    ["source mapping becomes provisional", { extraction: { confidence: "low" as const, reviewed: false } }],
  ])("leaves an open exam question unscored when its %s", async (_label, change) => {
    setStore();
    const user = userEvent.setup();
    const { rerender } = render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    mocked.store = { ...mocked.store, questions: [{ ...question, ...change }] };
    rerender(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    const saved = mocked.commitQuizRun.mock.calls.at(-1)?.[0];
    expect(saved.session.score).toMatchObject({ correct: 0, scored: 0, total: 1 });
    expect(saved.attempts).toEqual([
      expect.objectContaining({ questionId: question.id, attempt: expect.objectContaining({ status: "needs-review", answerKey: "B" }) }),
    ]);
    expect(screen.getByText(/1 unscored \(answer mapping unavailable or changed during the block\)/)).toBeTruthy();
  });

  it("continues scoring when only a learner note changes, not the answer content", async () => {
    setStore();
    const user = userEvent.setup();
    const { rerender } = render(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    mocked.store = { ...mocked.store, questions: [{ ...question, notes: "Review later" }] };
    rerender(<ExamRunner mode="exam" retakeIds={[question.id]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    expect(mocked.commitQuizRun.mock.calls.at(-1)?.[0].session.score).toMatchObject({ correct: 1, scored: 1, total: 1 });
  });
});

describe("Late tutor recovery and extended option shortcuts", () => {
  it("replays already-checked tutor answers exactly once after full delayed hydration", async () => {
    setStore();
    const second: QuestionRecord = { ...question, id: "late-second", stem: "Hydrated second stem" };
    const snapshot = {
      mode: "tutor", runId: "late-tutor-answered",
      poolIds: [question.id, second.id], index: 1,
      answers: [{ questionId: question.id, answerKey: "B", correct: true, flagged: false, seconds: 14 }],
      picked: undefined, revealed: false, startedAt: new Date().toISOString(), timed: false,
      filters: { count: 2, status: "all", ordered: true },
    };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(snapshot));
    mocked.store = { ...mocked.store, questions: [] };
    const { rerender } = render(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Recover your saved question block" })).toBeTruthy();
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();

    mocked.store = { ...mocked.store, questions: [question] };
    rerender(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();

    mocked.store = { ...mocked.store, questions: [question, second] };
    rerender(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tutor · 2 of 2" })).toBeTruthy());
    await waitFor(() => expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1));
    expect(mocked.commitQuizRun.mock.calls[0][0].attempts).toEqual([{
      questionId: question.id,
      attempt: expect.objectContaining({ answerKey: "B", status: "correct", quizSessionId: "late-tutor-answered" }),
    }]);
    mocked.store = { ...mocked.store, questions: [question, second].map((entry) => ({ ...entry, notes: "late sync" })) };
    rerender(<ExamRunner mode="tutor" onClose={vi.fn()} />);
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
  });

  it("uses F as a real sixth answer and M to mark, preserving F-as-flag on older five-choice questions", () => {
    setStore();
    const expanded: QuestionRecord = {
      ...question, stem: "Six options, choose Foxtrot",
      correctKey: "F",
      options: ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, text: key === "F" ? "Foxtrot" : `Option ${key}` })),
    };
    mocked.store = { ...mocked.store, questions: [expanded] };
    render(<ExamRunner mode="exam" retakeIds={[expanded.id]} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByRole("button", { name: "F. Foxtrot" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Flag question" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.getByRole("button", { name: "Flag question" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "F", shiftKey: true });
    expect(screen.getByRole("button", { name: "F. Foxtrot" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Flag question" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Exact retake recovery", () => {
  it("keeps every duplicate-ID claimant out of an exact retake", () => {
    setStore();
    mocked.store = { ...mocked.store, questions: [question, { ...question, needsReview: true }] };
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Prepare your requested questions" })).toBeTruthy();
    expect(screen.getByText(/question ID is claimed by multiple records/i)).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
  });

  it("waits for the entire requested set and preserves its requested order during late hydration", async () => {
    setStore();
    const second: QuestionRecord = { ...question, id: "requested-first", stem: "Retake question loaded later" };
    mocked.store = { ...mocked.store, questions: [question] };
    const { rerender } = render(<ExamRunner mode="tutor" retakeIds={[second.id, question.id]} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Prepare your requested questions" })).toBeTruthy();
    expect(screen.getByText("1 of 2 questions are ready on this device")).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();

    mocked.store = { ...mocked.store, questions: [question, { ...second, needsReview: true }] };
    rerender(<ExamRunner mode="tutor" retakeIds={[second.id, question.id]} onClose={vi.fn()} />);
    expect(screen.getByText(/needs answer or source review/)).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();

    mocked.store = { ...mocked.store, questions: [question, second] };
    rerender(<ExamRunner mode="tutor" retakeIds={[second.id, question.id]} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tutor · 1 of 2" })).toBeTruthy());
    expect(screen.getByText(second.stem)).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null")?.poolIds).toEqual([second.id, question.id]));
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    expect(mocked.saveQuizSession).not.toHaveBeenCalled();
  });
});

describe("Sparse snapshot safety on large QBank blocks", () => {
  it("keeps an unsubmitted tutor selection only in picked, never in checked answers", () => {
    setStore();
    render(<ExamRunner mode="tutor" retakeIds={[question.id]} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "A" });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!);
    expect(saved.picked).toBe("A");
    expect(saved.answers).toEqual([]);
    expect(mocked.recordQuestionAttempt).not.toHaveBeenCalled();
  });

  it("retains all pool IDs but snapshots only answered items in a 240-question block", () => {
    setStore();
    const many: QuestionRecord[] = Array.from({ length: 240 }, (_, i) => ({
      ...question, id: `stress-${i}`, stem: `Stem for question ${i + 1}`, setId: undefined,
      questionNumber: i + 1,
    }));
    mocked.store = { ...mocked.store, questions: many };
    render(<ExamRunner mode="exam" presetFilters={{ count: many.length, status: "all", ordered: true }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start exam block" }));
    expect(screen.getByRole("heading", { name: "Exam · 1 of 240" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "B" });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession)!);
    expect(saved.poolIds).toHaveLength(240);
    expect(saved.answers).toEqual([
      expect.objectContaining({ questionId: "stress-0", answerKey: "B" }),
    ]);
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
  });
});
