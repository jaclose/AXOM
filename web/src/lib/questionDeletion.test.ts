// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import {
  deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob,
  putQuestionAttachmentBlob,
  type QuestionImageAttachment,
} from "./questionAttachments";

const TEST_BLOB_KEYS = [
  `private-library:sha256:${"b".repeat(64)}`,
  "question-owned-delete-test",
] as const;

beforeEach(async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  await deleteQuestionAttachmentBlobs(TEST_BLOB_KEYS);
  useStore.getState().replaceAll(makeSeed());
});

afterEach(async () => {
  await deleteQuestionAttachmentBlobs(TEST_BLOB_KEYS);
  vi.unstubAllGlobals();
});

function attachment(blobKey: string): QuestionImageAttachment {
  return {
    id: blobKey,
    blobKey,
    fileName: "shared.png",
    mimeType: "image/png",
    byteSize: 4,
    altText: "Shared source figure",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

function addQuestion(id: string, image: QuestionImageAttachment) {
  const result = useStore.getState().addQuestion({
    id,
    source: "manual",
    stem: `Question ${id}`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "A",
    status: "unanswered",
    tags: [],
    attempts: [],
    attachments: [image],
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  });
  expect(result.ok).toBe(true);
}

describe("question deletion integrity", () => {
  it("unlinks the deleted question from every set without deleting session history", () => {
    const questionId = "delete-me";
    useStore.getState().addQuestion({
      id: questionId,
      source: "manual",
      stem: "Question to delete",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "A",
      status: "incorrect",
      tags: [],
      attempts: [{ at: "2026-07-10T00:00:00.000Z", answerKey: "B", status: "incorrect" }],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
    useStore.getState().addQuestionSet({
      id: "set-1", title: "Set", sourceDocumentIds: [], createdAt: "2026-07-10T00:00:00.000Z",
      questionIds: [questionId], tags: [], aiEnhanced: false, parserWarnings: [],
    });
    useStore.getState().saveQuizSession({
      id: "session-1", mode: "tutor", startedAt: "2026-07-10T00:00:00.000Z",
      endedAt: "2026-07-10T00:01:00.000Z", timed: false, filters: { count: 1, status: "all" },
      questionIds: [questionId], answers: [{ questionId, answerKey: "B", correct: false, flagged: false }],
    });

    useStore.getState().removeQuestion(questionId);

    expect(useStore.getState().questions.some((question) => question.id === questionId)).toBe(false);
    expect(useStore.getState().questionSets[0].questionIds).toEqual([]);
    expect(useStore.getState().quizSessions[0].id).toBe("session-1");
  });

  it("preserves canonical private-library bytes when deleting one of two sibling questions", async () => {
    const blobKey = TEST_BLOB_KEYS[0];
    const image = attachment(blobKey);
    await putQuestionAttachmentBlob(blobKey, {
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: 4,
      questionId: "private-library",
      updatedAt: image.updatedAt,
    });
    addQuestion("shared-media-a", image);
    addQuestion("shared-media-b", image);

    useStore.getState().removeQuestion("shared-media-a");

    expect(useStore.getState().questions.find((question) => question.id === "shared-media-b")?.attachments?.[0].blobKey)
      .toBe(blobKey);
    expect((await getQuestionAttachmentBlob(blobKey, { localOnly: true }))?.byteSize).toBe(4);
  });

  it("still deletes ordinary question-owned attachment bytes", async () => {
    const blobKey = TEST_BLOB_KEYS[1];
    const image = attachment(blobKey);
    await putQuestionAttachmentBlob(blobKey, {
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: 4,
      questionId: "owned-media",
      updatedAt: image.updatedAt,
    });
    addQuestion("owned-media", image);

    useStore.getState().removeQuestion("owned-media");

    await vi.waitFor(async () => {
      expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true })).toBeUndefined();
    });
  });
});
