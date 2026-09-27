// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseQuestionBlocks } from "../../lib/questionParse";
import { useStore } from "../../lib/store";
import { ImportPanel } from "./ImportPanel";
import { importFromCsv } from "../../lib/questionImport";
import { questionMappingStatus } from "../../lib/questions";
import { parseImport, toPortableState } from "../../lib/backup";
import { DB_NAME } from "../../lib/localVault";

vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../lib/ai", () => ({
  checkProviderHealth: vi.fn(async () => ({ ok: false, detail: "No provider" })),
  cleanExplanation: vi.fn(),
  enhanceQuestionSet: vi.fn(),
  generateQuestionDrafts: vi.fn(),
  loadAiSettings: vi.fn(() => ({ mode: "demo" })),
  mapAnswerFromText: vi.fn(),
  resolveActiveProvider: vi.fn(() => null),
}));

const original = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
};

const localValues = new Map<string, string>();
const localStorageStub: Storage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => { localValues.delete(key); },
  setItem: (key, value) => { localValues.set(key, String(value)); },
};

beforeEach(async () => {
  localValues.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", localStorageStub);
  await deleteDatabase(DB_NAME);
  await useStore.setState({ questions: [], questionSets: [], documents: [] });
});
afterEach(async () => {
  cleanup();
  await useStore.setState(original);
  vi.unstubAllGlobals();
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe("Import Center persistence invariant", () => {
  it("preserves B, D, A, C, E through ImportPanel and the real store", async () => {
    const user = userEvent.setup();
    const rawText = [
      "1. One?", "A. a1", "B. b1", "C. c1", "D. d1", "E. e1", "",
      "2. Two?", "A. a2", "B. b2", "C. c2", "D. d2", "E. e2", "",
      "3. Three?", "A. a3", "B. b3", "C. c3", "D. d3", "E. e3", "",
      "4. Four?", "A. a4", "B. b4", "C. c4", "D. d4", "E. e4", "",
      "5. Five?", "A. a5", "B. b5", "C. c5", "D. d5", "E. e5", "",
      "Answer key:", "1. B", "2. D", "3. A", "4. C", "5. E",
    ].join("\n");
    const drafts = parseQuestionBlocks(rawText);

    render(<ImportPanel seed={{
      drafts,
      rawText,
      title: "Mixed mapping invariant",
      fileName: "mixed.txt",
      fileType: "text",
    }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questionSets).toHaveLength(1);
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });

    const state = useStore.getState();
    const savedSet = state.questionSets.find((set) => set.title === "Mixed mapping invariant");
    expect(savedSet).toBeDefined();
    const keys = savedSet!.questionIds.map((id) => state.questions.find((question) => question.id === id)?.correctKey);
    expect(keys).toEqual(["B", "D", "A", "C", "E"]);
  });

  it("persists the raw explanation candidate beside cleaned prose and cleanup operations", async () => {
    const user = userEvent.setup();
    const rawText = [
      "1. Which option?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "Answer key:", "1. B", "",
      "Explanations:",
      "1. Explanation: Beta follows from the finding.",
      "Learning Objective: Recognize the relevant finding.",
    ].join("\n");
    const drafts = parseQuestionBlocks(rawText);

    render(<ImportPanel seed={{ drafts, rawText, title: "Explanation audit", fileName: "audit.txt", fileType: "text" }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questions
        .some((question) => question.bank === "Explanation audit")).toBe(true);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const saved = useStore.getState().questions.find((question) => question.bank === "Explanation audit");
    expect(saved?.explanation).toBe("Beta follows from the finding.");
    expect(saved?.extraction?.explanationRawCandidate).toContain("Explanation:");
    expect(saved?.extraction?.explanationRawCandidate).toContain("Learning Objective:");
    expect(saved?.extraction?.explanationCleanupOperations).toEqual(expect.arrayContaining([
      "remove-explanation-label",
      "remove-objective-metadata",
    ]));
    expect(saved?.extraction?.explanationSourceSnippet).toContain("Explanation:");
    expect(saved?.extraction?.explanationDetectionConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps each explanation and answer attached to its own question through persistence", async () => {
    const user = userEvent.setup();
    const rawText = [
      "1. First mechanism?", "A. First alpha", "B. First beta", "Answer: B", "Explanation: First explanation.", "",
      "2. Second mechanism?", "A. Second alpha", "B. Second beta", "Answer: A", "Reasoning: Second explanation.",
    ].join("\n");
    const drafts = parseQuestionBlocks(rawText);
    render(<ImportPanel seed={{ drafts, rawText, title: "Association invariant", fileName: "association.txt", fileType: "text" }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questions
        .filter((question) => question.bank === "Association invariant")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const saved = useStore.getState().questions
      .filter((question) => question.bank === "Association invariant")
      .sort((left, right) => (left.questionNumber ?? 0) - (right.questionNumber ?? 0));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ correctKey: "B", correctAnswerText: "First beta", explanation: "First explanation." });
    expect(saved[1]).toMatchObject({ correctKey: "A", correctAnswerText: "Second alpha", explanation: "Second explanation." });
  });

  it("keeps repeat finalization idempotent in the real store", async () => {
    const user = userEvent.setup();
    const rawText = "1. Stable question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable explanation.";
    const drafts = parseQuestionBlocks(rawText);
    render(<ImportPanel seed={{ drafts, rawText, title: "One transaction", fileName: "once.txt", fileType: "text" }} />);

    await user.dblClick(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.questions.filter((question) => question.bank === "One transaction")).toHaveLength(1);
      expect(state.questionSets.filter((set) => set.title === "One transaction")).toHaveLength(1);
      expect(state.documents.filter((document) => document.fileName === "once.txt")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
  });

  it("keeps an uploaded source immutable while review-gating edited extraction text", async () => {
    const user = userEvent.setup();
    const originalText = "1. Original stem?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Original rationale.";
    const revisedText = "1. Revised stem?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Revised rationale.";
    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(originalText), rawText: originalText, title: "Edited extraction",
      fileName: "immutable.txt", fileType: "text", sizeBytes: new TextEncoder().encode(originalText).byteLength,
      checksum: "original-checksum",
    }} />);

    await user.click(screen.getByRole("button", { name: "Back to source" }));
    const source = screen.getByLabelText("Edit extracted source text from immutable.txt");
    await user.clear(source);
    await user.type(source, revisedText);
    await user.click(screen.getByRole("button", { name: "Parse and review" }));
    await user.click(screen.getByRole("button", { name: /Revised stem/ }));
    await user.click(screen.getByRole("button", { name: "Mark source review complete" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const state = useStore.getState();
    const document = state.documents.find((item) => item.fileName === "immutable.txt");
    const question = state.questions.find((item) => item.bank === "Edited extraction");
    expect(document).toMatchObject({ rawText: originalText, checksum: "original-checksum" });
    expect(question).toMatchObject({ stem: "Revised stem?", sourceDocumentId: document?.id });
    expect(question?.extraction?.parserRuleIds).toEqual(expect.arrayContaining([
      "import.source-text-edited",
      "import.user-reviewed",
    ]));
  });

  it("normalizes a whitespace-only set title to an identifiable destination", async () => {
    const user = userEvent.setup();
    const rawText = "1. Stable question?\nA. Alpha\nB. Beta\nAnswer: B";
    render(<ImportPanel seed={{ drafts: parseQuestionBlocks(rawText), rawText, title: "Initial", fileName: "title.txt", fileType: "text" }} />);
    const title = screen.getByLabelText("Set title");
    await user.clear(title);
    await user.type(title, "   ");
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questionSets.some((set) => set.title === "Untitled set")).toBe(true);
      expect(useStore.getState().questions.some((question) => question.bank === "Untitled set")).toBe(true);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
  });

  it("persists a structured drift candidate only after the learner confirms it", async () => {
    const user = userEvent.setup();
    const rawText = [
      "question,a,b,c,answer",
      '"Which cell releases histamine?","Mast cells","CD4+ T lymphocytes","B lymphocytes","A. Mast cell"',
    ].join("\n");
    const drafts = importFromCsv(rawText).drafts;
    render(<ImportPanel seed={{ drafts, rawText, title: "Structured trust", fileName: "trust.csv", fileType: "csv" }} />);
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: /Which cell releases histamine/ }));
    await user.click(screen.getByRole("button", { name: "Confirm mapped answer A" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questions
        .some((question) => question.bank === "Structured trust")).toBe(true);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const candidate = useStore.getState().questions.find((question) => question.bank === "Structured trust");
    expect(candidate?.correctKey).toBe("A");
    expect(candidate?.needsReview).toBeUndefined();
    expect(candidate && questionMappingStatus(candidate)).toBe("ready");
    expect(candidate?.extraction?.parserRuleIds).toContain("answer.explicit-letter-text-drift");
    expect(candidate?.extraction?.parserRuleIds).toContain("answer.user-reviewed-mapping");

    const restored = parseImport(JSON.stringify({
      _app: "AXOM",
      ...toPortableState(useStore.getState()),
    }));
    const reloaded = restored.questions.find((question) => question.id === candidate!.id);
    expect(reloaded).toMatchObject({
      correctKey: "A",
      extraction: {
        reviewed: true,
        reviewedAt: expect.any(String),
      },
    });
    expect(reloaded?.needsReview).toBeUndefined();
    expect(reloaded?.extraction?.parserRuleIds).toContain("answer.user-reviewed-mapping");
    expect(questionMappingStatus(reloaded!)).toBe("ready");
  });

  it("does not duplicate an exact reviewed import after navigation and re-entry", async () => {
    const user = userEvent.setup();
    const rawText = "1. Retry-safe question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable rationale.";
    const first = render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(rawText), rawText, title: "Retry-safe set",
      fileName: "retry.txt", fileType: "text", checksum: "retry-checksum",
    }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questions).toHaveLength(1);
      expect(useStore.getState().questionSets).toHaveLength(1);
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const original = useStore.getState();
    const source = original.documents[0];
    first.unmount();

    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(source.rawText),
      rawText: source.rawText,
      title: "Retry-safe set",
      fileName: source.fileName,
      fileType: source.fileType,
      sourceDocumentId: source.id,
      sizeBytes: source.sizeBytes,
      checksum: source.checksum,
    }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questions).toHaveLength(1);
      expect(useStore.getState().questionSets).toHaveLength(1);
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    expect(useStore.getState().documents[0].linkedQuestionSetIds).toEqual([original.questionSets[0].id]);
  });

  it("does not duplicate an exact pasted import after navigation and re-entry", async () => {
    const user = userEvent.setup();
    const rawText = "1. Pasted retry-safe question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable rationale.";

    const finalizePaste = async () => {
      const view = render(<ImportPanel initialTab="paste" />);
      await user.type(screen.getByLabelText("Structured question text"), rawText);
      await user.click(screen.getByRole("button", { name: "Parse and review" }));
      const title = screen.getByLabelText("Set title");
      await user.clear(title);
      await user.type(title, "Retry-safe paste");
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
      return view;
    };

    const first = await finalizePaste();
    first.unmount();
    await finalizePaste();

    const state = useStore.getState();
    expect(state.questions.filter((question) => question.bank === "Retry-safe paste")).toHaveLength(1);
    expect(state.questionSets.filter((set) => set.title === "Retry-safe paste")).toHaveLength(1);
    expect(state.documents).toHaveLength(0);
  });

  it("does not duplicate an exact questions-only file import after re-entry", async () => {
    const user = userEvent.setup();
    const rawText = "1. Questions-only retry?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable rationale.";
    const seed = {
      drafts: parseQuestionBlocks(rawText), rawText, title: "Retry-safe questions only",
      fileName: "questions-only.txt", fileType: "text", checksum: "questions-only-checksum",
    };

    const finalizeQuestionsOnly = async () => {
      const view = render(<ImportPanel seed={seed} />);
      await user.click(screen.getByRole("button", { name: "Questions" }));
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
      return view;
    };

    const first = await finalizeQuestionsOnly();
    first.unmount();
    await finalizeQuestionsOnly();

    const state = useStore.getState();
    expect(state.questions.filter((question) => question.bank === "Retry-safe questions only")).toHaveLength(1);
    expect(state.questionSets.filter((set) => set.title === "Retry-safe questions only")).toHaveLength(1);
    expect(state.documents).toHaveLength(0);
  });

  it("joins a tentative real-store import on remount and does not report success when durability fails", async () => {
    const user = userEvent.setup();
    const storage = useStore.persist.getOptions().storage;
    if (!storage) throw new Error("Persisted storage is required for this test.");
    let rejectWrite!: (reason?: unknown) => void;
    let writeReleased = false;
    const blockedWrite = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    let blockNextWrite = true;
    useStore.persist.setOptions({
      storage: {
        getItem: (name) => storage.getItem(name),
        removeItem: (name) => storage.removeItem(name),
        setItem: (name, value) => {
          if (blockNextWrite) {
            blockNextWrite = false;
            return blockedWrite;
          }
          return storage.setItem(name, value);
        },
      },
    });

    try {
      const rawText = "1. Pending remount question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable rationale.";
      const seed = {
        drafts: parseQuestionBlocks(rawText), rawText, title: "Pending remount",
        fileName: "pending-remount.txt", fileType: "text", checksum: "pending-remount-checksum",
      };
      const first = render(<ImportPanel seed={seed} />);
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => {
        expect(useStore.getState().questions.filter((question) => question.bank === "Pending remount")).toHaveLength(1);
      });
      first.unmount();

      render(<ImportPanel seed={seed} />);
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      expect(await screen.findByRole("button", { name: /Finalizing/ })).toBeTruthy();

      writeReleased = true;
      rejectWrite(new Error("Forced durable write failure"));
      await waitFor(() => {
        expect(useStore.getState().questions.filter((question) => question.bank === "Pending remount")).toHaveLength(0);
        expect(useStore.getState().questionSets.filter((set) => set.title === "Pending remount")).toHaveLength(0);
        expect(useStore.getState().documents.filter((document) => document.fileName === "pending-remount.txt")).toHaveLength(0);
        expect(screen.getByRole("button", { name: "Finalize import" })).toBeTruthy();
      });
    } finally {
      if (!writeReleased) rejectWrite(new Error("Test cleanup released the durable write."));
      useStore.persist.setOptions({ storage });
    }
  });

  it("persists reviewed provenance while keeping the original source immutable", async () => {
    const user = userEvent.setup();
    const rawText = "1. Provenance question?\nA. Alpha\nB. Beta\nAnswer: B";
    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(rawText), rawText, title: "Provenance set",
      fileName: "original-source.txt", fileType: "text", checksum: "immutable-checksum",
    }} />);
    await user.click(screen.getByRole("button", { name: /Provenance question/ }));
    const reference = screen.getByLabelText("Reference / source");
    await user.clear(reference);
    await user.type(reference, "Reviewed lecture handout");
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    expect(useStore.getState().questions[0]).toMatchObject({
      citation: "Reviewed lecture handout",
      sourceDocumentId: useStore.getState().documents[0].id,
    });
    expect(useStore.getState().documents[0]).toMatchObject({
      rawText,
      fileName: "original-source.txt",
      checksum: "immutable-checksum",
    });
  });

  it("keeps one shared source association and omits a removed candidate from every reverse link", async () => {
    const user = userEvent.setup();
    const rawText = [
      "1. First retained?", "A. Alpha", "B. Beta", "Answer: B", "",
      "2. Removed malformed?", "A. Only one option",
      "3. Third retained?", "A. Gamma", "B. Delta", "Answer: A",
    ].join("\n");
    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(rawText), rawText, title: "Shared source",
      fileName: "shared.txt", fileType: "text", checksum: "shared-checksum",
    }} />);
    await user.click(screen.getByRole("button", { name: "Remove question 2" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    await waitFor(() => {
      expect(useStore.getState().questions).toHaveLength(2);
      expect(useStore.getState().questionSets).toHaveLength(1);
      expect(useStore.getState().documents).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const state = useStore.getState();
    const savedSet = state.questionSets[0];
    const savedDocument = state.documents[0];
    expect(savedSet.questionIds).toHaveLength(2);
    expect(savedSet.sourceDocumentIds).toEqual([savedDocument.id]);
    expect(savedDocument.linkedQuestionSetIds).toEqual([savedSet.id]);
    expect(state.questions.map((item) => item.questionNumber)).toEqual(expect.arrayContaining([1, 3]));
    expect(state.questions.every((item) => item.sourceDocumentId === savedDocument.id)).toBe(true);
    expect(state.questions.some((item) => item.questionNumber === 2)).toBe(false);
  });
});
