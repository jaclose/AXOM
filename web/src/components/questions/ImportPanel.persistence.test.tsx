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
import { hasReviewedImportInFlight, persistReviewedImportOnce, settledReviewedImportSnapshot, type ReviewedImportPersistenceResult } from "../../lib/questionImportFinalization";
import type { SourceDocument } from "../../lib/library";
import { prepareReviewedImport } from "../../lib/questionImportSave";
import * as reviewedImportSave from "../../lib/questionImportSave";
import { pushToast } from "../../lib/toast";

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
  vi.restoreAllMocks();
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

  it("defers equivalent-import success until durable reuse completes, including after a failed repair", async () => {
    const user = userEvent.setup();
    const rawText = "1. Previously reviewed question?\\nA. Alpha\\nB. Beta\\nAnswer: B\\nExplanation: Stable explanation.";
    // Reproduce the equivalent path while controlling its awaited storage repair.
    // A stale account-epoch receipt is reported as a typed failed save.
    const realPrepare = reviewedImportSave.prepareReviewedImport;
    vi.spyOn(reviewedImportSave, "prepareReviewedImport").mockImplementation((...args) => {
      const prepared = realPrepare(...args);
      return prepared.ok
        ? { ...prepared, equivalent: { setId: "confirmed-set", questionIds: ["confirmed-question"] } }
        : prepared;
    });
    const settle: Array<(result: reviewedImportSave.SavedReviewedImport) => void> = [];
    const saved = vi.spyOn(reviewedImportSave, "saveReviewedImport").mockImplementation(
      () => new Promise<reviewedImportSave.SavedReviewedImport>((resolve) => { settle.push(resolve); }),
    );
    const toast = vi.mocked(pushToast);
    toast.mockClear();
    render(<ImportPanel seed={{
      drafts: parseQuestionBlocks(rawText), rawText, title: "Existing reviewed set",
      fileName: "reviewed-existing.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(settle).toHaveLength(1));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    settle[0]({ ok: false, message: "The account changed while importing questions.", rollbackFailures: [] });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Nothing was finalized", tone: "warn",
    })));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(settle).toHaveLength(2));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import already finalized" }));

    settle[1]({
      ok: true, reused: true, joined: false, setId: "confirmed-set", questionIds: ["confirmed-question"],
      documentId: undefined, reusedDocument: false, images: { attached: 0, missing: 0, problems: [] },
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Import already finalized", tone: "success",
    })));
    expect(toast.mock.calls.filter(([notice]) => notice.title === "Import already finalized")).toHaveLength(1);
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

    const finalizePaste = async (repeat = false) => {
      const view = render(<ImportPanel initialTab="paste" />);
      await user.type(screen.getByLabelText("Structured question text"), rawText);
      await user.click(screen.getByRole("button", { name: "Parse and review" }));
      const title = screen.getByLabelText("Set title");
      await user.clear(title);
      await user.type(title, "Retry-safe paste");
      if (repeat) {
        expect(screen.getByText(/1 exact question is already in your bank and left out/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
        return view;
      }
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
      return view;
    };

    const first = await finalizePaste();
    first.unmount();
    await finalizePaste(true);

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

    const finalizeQuestionsOnly = async (repeat = false) => {
      const view = render(<ImportPanel seed={seed} />);
      await user.click(screen.getByRole("button", { name: "Questions" }));
      if (repeat) {
        expect(screen.getByText(/1 exact question is already in your bank and left out/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
        return view;
      }
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
      return view;
    };

    const first = await finalizeQuestionsOnly();
    first.unmount();
    await finalizeQuestionsOnly(true);

    const state = useStore.getState();
    expect(state.questions.filter((question) => question.bank === "Retry-safe questions only")).toHaveLength(1);
    expect(state.questionSets.filter((set) => set.title === "Retry-safe questions only")).toHaveLength(1);
    expect(state.documents).toHaveLength(0);
  });

  it("preserves a settled duplicate warning while an unrelated import is awaiting its durable write", async () => {
    const user = userEvent.setup();
    const durableRaw = "1. Already saved question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Verified before another import.";
    const durableSeed = {
      drafts: parseQuestionBlocks(durableRaw), rawText: durableRaw, title: "Durable question source",
      fileName: "durable-questions.txt", fileType: "text", checksum: "durable-questions-checksum",
    };
    const saved = render(<ImportPanel seed={durableSeed} />);
    await user.click(screen.getByRole("button", { name: "Questions" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questions.filter((question) => question.bank === "Durable question source")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
      expect(hasReviewedImportInFlight()).toBe(false);
    });
    saved.unmount();

    const storage = useStore.persist.getOptions().storage;
    if (!storage) throw new Error("Persisted storage is required for this test.");
    let rejectWrite!: (reason?: unknown) => void;
    const blockedWrite = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    let blockNextWrite = true;
    let writeReleased = false;
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
      const pendingRaw = "1. Unrelated uncommitted question?\nA. One\nB. Two\nAnswer: B\nExplanation: Another source rationale.";
      const pending = render(<ImportPanel seed={{
        drafts: parseQuestionBlocks(pendingRaw), rawText: pendingRaw, title: "Unrelated pending source",
        fileName: "pending-other.txt", fileType: "text", checksum: "pending-other-checksum",
      }} />);
      await user.click(screen.getByRole("button", { name: "Questions" }));
      await user.click(screen.getByRole("button", { name: "Finalize import" }));
      await waitFor(() => {
        expect(blockNextWrite).toBe(false);
        expect(hasReviewedImportInFlight()).toBe(true);
        expect(useStore.getState().questions.filter((question) => question.bank === "Unrelated pending source")).toHaveLength(1);
      });
      const settled = settledReviewedImportSnapshot({
        questions: useStore.getState().questions,
        questionSets: useStore.getState().questionSets,
        documents: useStore.getState().documents,
      });
      expect(settled.questions.filter((question) => question.bank === "Durable question source")).toHaveLength(1);
      expect(settled.questions.filter((question) => question.bank === "Unrelated pending source")).toHaveLength(0);
      expect(settled.questionSets.filter((set) => set.title === "Durable question source")).toHaveLength(1);
      expect(settled.questionSets.filter((set) => set.title === "Unrelated pending source")).toHaveLength(0);
      pending.unmount();

      render(<ImportPanel seed={durableSeed} />);
      await user.click(screen.getByRole("button", { name: "Questions" }));
      // The pending question is not durable, but it must not erase evidence
      // that a different question was successfully imported before it.
      expect(screen.getByText(/1 exact question is already in your bank and left out/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);

      writeReleased = true;
      rejectWrite(new Error("Reject unrelated tentative import"));
      await waitFor(() => {
        expect(hasReviewedImportInFlight()).toBe(false);
        expect(useStore.getState().questions.filter((question) => question.bank === "Durable question source")).toHaveLength(1);
        expect(useStore.getState().questions.filter((question) => question.bank === "Unrelated pending source")).toHaveLength(0);
        expect(useStore.getState().questionSets.filter((set) => set.title === "Durable question source")).toHaveLength(1);
      });
    } finally {
      if (!writeReleased && !blockNextWrite) rejectWrite(new Error("Cleanup pending write"));
      useStore.persist.setOptions({ storage });
    }
  });

  it("keeps the last durable source-document links while a newer link update is tentative", async () => {
    const original = {
      id: "previously-durable-source", title: "Committed source", fileName: "source.txt", fileType: "text",
      uploadedAt: "2026-11-07T00:00:00.000Z", rawText: "Original source",
      sizeBytes: 15, tags: [], libraryOnly: false, linkedQuestionSetIds: ["existing-set"],
    } as SourceDocument;
    const tentativeDocument = { ...original, linkedQuestionSetIds: ["existing-set", "tentative-set"] };
    let resolveWrite!: (result: ReviewedImportPersistenceResult) => void;
    const blocked = new Promise<ReviewedImportPersistenceResult>((resolve) => { resolveWrite = resolve; });
    const persistence = { ...useStore.getState(), commitReviewedImport: () => blocked };
    const pending = persistReviewedImportOnce("apex-pending-source-update", persistence, {
      questions: [],
      documentWrite: {
        kind: "update", id: original.id, original,
        patch: { linkedQuestionSetIds: tentativeDocument.linkedQuestionSetIds },
      },
    });
    try {
      expect(hasReviewedImportInFlight()).toBe(true);
      const view = settledReviewedImportSnapshot({ questions: [], questionSets: [], documents: [tentativeDocument] });
      expect(view.documents).toEqual([original]);
      expect(tentativeDocument.linkedQuestionSetIds).toEqual(["existing-set", "tentative-set"]);
    } finally {
      resolveWrite({ ok: false, message: "Synthetic rejected source-link update", rollbackFailures: [] });
      await pending;
    }
    expect(hasReviewedImportInFlight()).toBe(false);
    const after = settledReviewedImportSnapshot({ questions: [], questionSets: [], documents: [tentativeDocument] });
    expect(after.documents).toEqual([tentativeDocument]);
  });

  it.each([
    { firstFails: true, expectedAdded: 1 },
    { firstFails: false, expectedAdded: 2 },
  ])("rebases queued source links onto durable commits when firstFails=$firstFails", async ({ firstFails, expectedAdded }) => {
    const user = userEvent.setup();
    // All three questions belong to one synthetic source. The first import
    // intentionally reviews only question 1; two independent later reviews
    // are prepared while an earlier vault write is still unsettled.
    const rawText = [
      "1. Existing source question?\nA. One\nB. Two\nAnswer: B\nExplanation: First explanation.",
      "2. Additional A source question?\nA. Three\nB. Four\nAnswer: A\nExplanation: Second explanation.",
      "3. Additional B source question?\nA. Five\nB. Six\nAnswer: B\nExplanation: Third explanation.",
    ].join("\n\n");
    const parsed = parseQuestionBlocks(rawText);
    expect(parsed).toHaveLength(3);
    const seeded = render(<ImportPanel seed={{
      drafts: parsed.slice(0, 1), rawText, title: "Durable existing set",
      fileName: "shared-review-source.txt", fileType: "text", checksum: "shared-review-source-checksum",
    }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questionSets).toHaveLength(1);
      expect(hasReviewedImportInFlight()).toBe(false);
    });
    seeded.unmount();

    const originalDocument = useStore.getState().documents[0];
    const originalSetId = useStore.getState().questionSets[0].id;
    expect(originalDocument.linkedQuestionSetIds).toEqual([originalSetId]);
    const snapshot = () => {
      const state = useStore.getState();
      return { questions: state.questions, questionSets: state.questionSets, documents: state.documents };
    };
    const prepare = (index: number, setTitle: string) => prepareReviewedImport({
      drafts: [{ ...parsed[index], source: "imported" as const }],
      destination: "both",
      document: {
        existingDocumentId: originalDocument.id, title: originalDocument.title,
        fileName: originalDocument.fileName, fileType: originalDocument.fileType,
        sizeBytes: originalDocument.sizeBytes, rawText: originalDocument.rawText,
        checksum: originalDocument.checksum,
      },
      sourceType: "imported", setTitle, parserWarnings: [],
    }, snapshot());

    const storage = useStore.persist.getOptions().storage;
    if (!storage) throw new Error("Persisted storage is required for the queued import regression.");
    let settleFirst!: (value?: void) => void;
    let rejectFirst!: (reason?: unknown) => void;
    let blockFirst = true;
    let firstWriteForwarded = 0;
    const blocked = new Promise<void>((resolve, reject) => { settleFirst = resolve; rejectFirst = reject; });
    useStore.persist.setOptions({
      storage: {
        getItem: (name) => storage.getItem(name),
        removeItem: (name) => storage.removeItem(name),
        setItem: (name, value) => {
          if (blockFirst) {
            blockFirst = false;
            // A successful release must actually persist the intercepted
            // payload. Merely resolving the gate skips the vault write and
            // makes assertVaultWrite correctly reject the synthetic import.
            // Rejecting the gate must never forward its tentative payload.
            return blocked.then(() => {
              firstWriteForwarded += 1;
              return storage.setItem(name, value);
            });
          }
          return storage.setItem(name, value);
        },
      },
    });

    let released = false;
    try {
      const first = prepare(1, "Queued A set");
      if (!first.ok) throw new Error("Synthetic first reviewed plan was rejected");
      const aId = first.plan.questionSet?.id;
      expect(aId).toBeTruthy();
      const pendingA = persistReviewedImportOnce(first.fingerprint, useStore.getState(), first.plan);
      await waitFor(() => {
        expect(blockFirst).toBe(false);
        expect(useStore.getState().questionSets.some((set) => set.id === aId)).toBe(true);
        expect(useStore.getState().documents[0].linkedQuestionSetIds).toContain(aId);
      });

      // This second plan is deliberately built from optimistic Zustand, as
      // ImportPanel.saveApproved currently does. Its absolute patch includes A.
      const second = prepare(2, "Queued B set");
      if (!second.ok) throw new Error("Synthetic second reviewed plan was rejected");
      const bId = second.plan.questionSet?.id;
      expect(bId).toBeTruthy();
      const write = second.plan.documentWrite;
      if (!write || write.kind !== "update") throw new Error("Expected same-source document update");
      expect(write.patch.linkedQuestionSetIds).toContain(aId);
      const pendingB = persistReviewedImportOnce(second.fingerprint, useStore.getState(), second.plan);

      released = true;
      if (firstFails) rejectFirst(new Error("Synthetic first vault write rejected"));
      else settleFirst();

      const [a, b] = await Promise.all([pendingA, pendingB]);
      expect(firstWriteForwarded).toBe(firstFails ? 0 : 1);
      expect(a.result.ok).toBe(!firstFails);
      expect(b.result.ok).toBe(true);
      const finalState = useStore.getState();
      const finalSource = finalState.documents.find((doc) => doc.id === originalDocument.id);
      expect(finalSource).toMatchObject({
        id: originalDocument.id, rawText: originalDocument.rawText,
        checksum: originalDocument.checksum,
      });
      const setIds = new Set(finalState.questionSets.map((set) => set.id));
      expect(finalSource?.linkedQuestionSetIds).toEqual(expect.arrayContaining([originalSetId, bId]));
      expect(finalSource?.linkedQuestionSetIds.every((id) => setIds.has(id))).toBe(true);
      expect(finalSource?.linkedQuestionSetIds.includes(aId!)).toBe(!firstFails);
      expect(finalState.questionSets.length).toBe(1 + expectedAdded);
      expect(finalState.questions.length).toBe(1 + expectedAdded);
      expect(finalState.questionSets.find((set) => set.id === bId)?.sourceDocumentIds).toEqual([originalDocument.id]);
      expect(finalState.questions.filter((q) => q.setId === bId)).toHaveLength(1);
      expect(hasReviewedImportInFlight()).toBe(false);
    } finally {
      if (!released && !blockFirst) rejectFirst(new Error("Test cleanup of pending first vault write"));
      useStore.persist.setOptions({ storage });
    }
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

// Invented teaching content.
const THORAX = [
  "1. Which vessel carries oxygenated blood from the lungs to the heart?",
  "A. Pulmonary vein", "B. Pulmonary artery", "C. Aorta", "D. Vena cava",
  "Answer: A", "Explanation: The pulmonary veins return oxygenated blood to the left atrium.",
  "",
  "2. Which nerve supplies the diaphragm?",
  "A. Vagus nerve", "B. Phrenic nerve", "C. Intercostal nerve", "D. Accessory nerve",
  "Answer: B", "Explanation: The phrenic nerve arises from the third to fifth cervical roots.",
].join("\n");
const THORAX_REVISED = [
  THORAX,
  "",
  "3. Which hormone lowers the concentration of glucose in blood?",
  "A. Glucagon", "B. Cortisol", "C. Insulin", "D. Adrenaline",
  "Answer: C", "Explanation: Insulin moves glucose into muscle and fat.",
].join("\n");

describe("Importing a file again", () => {
  const thoraxSeed = (rawText = THORAX, checksum = "thorax-checksum") => ({
    drafts: parseQuestionBlocks(rawText), rawText, title: "Thorax quiz", fileName: "thorax-quiz.txt", fileType: "text", checksum,
  });

  async function importThorax(user: ReturnType<typeof userEvent.setup>) {
    const view = render(<ImportPanel seed={thoraxSeed()} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questions).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
      // The panel reads an earlier import only from settled state, so the next
      // panel must not open while this save is still being written.
      expect(hasReviewedImportInFlight()).toBe(false);
    });
    view.unmount();
  }

  it("adds nothing, and leaves alone what the learner changed since the first import", async () => {
    const user = userEvent.setup();
    await importThorax(user);

    // The learner's own corrections: the set renamed and moved, a question refiled, retagged and annotated.
    const before = useStore.getState();
    const [first] = before.questionSets[0].questionIds;
    before.updateQuestionSet(before.questionSets[0].id, { title: "Thorax, week 4", scope: { module: "CPR", week: 4 } });
    before.updateQuestion(first, { module: "CPR", week: 4, tags: ["high-yield"], explanation: "My own note on the pulmonary veins." });
    await waitFor(() => expect(useStore.getState().questions.find((question) => question.id === first)?.week).toBe(4));

    render(<ImportPanel seed={thoraxSeed()} />);
    expect(screen.getByText(/^This file was imported on \d{4}-\d{2}-\d{2} as "Thorax, week 4"\. Every question here is already in your bank, so none is selected\./)).toBeTruthy();
    expect(screen.getAllByText("Already imported")).toHaveLength(2);
    expect((screen.getByRole("checkbox", { name: "Include question 1" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Include question 2" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Finalize import" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Include at least one question before finalizing.")).toBeTruthy();

    const after = useStore.getState();
    expect([after.questions.length, after.questionSets.length, after.documents.length]).toEqual([2, 1, 1]);
    expect(after.questionSets[0]).toMatchObject({ title: "Thorax, week 4", scope: { module: "CPR", week: 4 } });
    expect(after.questions.find((question) => question.id === first)).toMatchObject({
      module: "CPR", week: 4, tags: ["high-yield"], explanation: "My own note on the pulmonary veins.",
    });
  });

  it("brings in only what a changed version of the file adds", async () => {
    const user = userEvent.setup();
    await importThorax(user);
    const earlier = useStore.getState().questions.map((question) => question.id);

    render(<ImportPanel seed={thoraxSeed(THORAX_REVISED, "thorax-checksum-v2")} />);
    expect(screen.getByText(/^A different version of this file was imported on .* 2 of these 3 questions are already in your bank and are not selected\. 1 is new\./)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Include question 1" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Include question 3" }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => {
      expect(useStore.getState().questions).toHaveLength(3);
      expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull();
    });
    const state = useStore.getState();
    const added = state.questions.filter((question) => !earlier.includes(question.id));
    expect(added.map((question) => [question.stem, question.correctKey])).toEqual([["Which hormone lowers the concentration of glucose in blood?", "C"]]);
    expect(earlier.every((id) => state.questions.some((question) => question.id === id))).toBe(true);
    // The new version is its own source record: both stay in the library.
    expect(state.documents.map((document) => document.checksum).sort()).toEqual(["thorax-checksum", "thorax-checksum-v2"]);
    expect(state.questionSets).toHaveLength(2);
  });

  it("lets the learner take a question again on purpose, and says what that does", async () => {
    const user = userEvent.setup();
    await importThorax(user);
    render(<ImportPanel seed={thoraxSeed()} />);
    await user.click(screen.getByRole("button", { name: "Toggle editor for question 1" }));
    expect(screen.getByText(/already in your bank from an earlier import of this file, so it is not selected\. Select it only to bring in a second copy\./)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Include question 1" }));
    expect((screen.getByRole("button", { name: "Finalize import" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a question's source, page and evidence through a save and a reload of the store", async () => {
    const user = userEvent.setup();
    const drafts = parseQuestionBlocks(THORAX).map((draft, index) => ({ ...draft, sourcePage: index + 2, questionSourcePage: index + 2, answerEvidencePage: 7 }));
    render(<ImportPanel seed={{ ...thoraxSeed(), drafts, fileType: "pdf", pageTexts: ["title", "one", "two"] }} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(useStore.getState().questions).toHaveLength(2));

    // What the store would read back from the device after a reload.
    await useStore.persist.rehydrate();
    const state = useStore.getState();
    const document = state.documents[0];
    expect(document).toMatchObject({ fileName: "thorax-quiz.txt", checksum: "thorax-checksum", pageTexts: ["title", "one", "two"], rawText: THORAX });
    const ordered = state.questionSets[0].questionIds.map((id) => state.questions.find((question) => question.id === id)!);
    expect(ordered.map((question) => [question.sourcePage, question.sourceDocumentId, question.sourceFile?.name, question.questionNumber]))
      .toEqual([[2, document.id, "thorax-quiz.txt", 1], [3, document.id, "thorax-quiz.txt", 2]]);
    expect(ordered[0].extraction).toMatchObject({ reviewed: true, questionSourcePage: 2, answerEvidencePage: 7, answerEvidence: "Answer: A" });
  });
});

