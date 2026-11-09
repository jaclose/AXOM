import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as images from "./questionImportImages";
import * as attachments from "./questionAttachments";
import * as vault from "./localVault";
import { getQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { parseQuestionBlocks } from "./questionParse";
import { prepareReviewedImport, saveReviewedImport, type ReviewedImportStore } from "./questionImportSave";

const attachment: attachments.QuestionImageAttachment = {
  id: "A-image", blobKey: "shared-image-key", fileName: "diagram.png", mimeType: "image/png",
  byteSize: 1, createdAt: "2026-11-09", updatedAt: "2026-11-09", altText: "Synthetic diagram",
};
function preparedImport() {
  const drafts = parseQuestionBlocks("1. Which test label is red?\nA. Red\nB. Blue\nC. Green\nD. Black\nAnswer: A\nExplanation: A is the supplied test label.")
    .map(draft => ({ ...draft, source: "imported" as const, attachmentNames: ["diagram.png"] }));
  const prepared = prepareReviewedImport({ drafts, destination: "set", document: null, sourceType: "imported", setTitle: "Synthetic scope test", parserWarnings: [] }, { questions: [], questionSets: [], documents: [] });
  if (!prepared.ok) throw new Error("Synthetic import was not prepared.");
  prepared.equivalent = { setId: "existing-source", questionIds: prepared.plan.questions.map(q => q.id) };
  return prepared;
}
function plainStore(): ReviewedImportStore {
  return {
    addQuestion: vi.fn(() => ({ ok: true, errors: [] })), removeQuestion: vi.fn(),
    addQuestionSet: vi.fn(), removeQuestionSet: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), removeDocument: vi.fn(),
    updateQuestion: vi.fn(),
    // Production ImportPanel/MassImport pass the ordinary store without an
    // optional assertCurrent adapter. The save operation must own this guard.
  };
}
function switchAccount(back: boolean) {
  setQuestionAttachmentAccount("B");
  if (back) setQuestionAttachmentAccount("A");
}
beforeEach(() => {
  resetQuestionAttachmentScopeForTests(); setQuestionAttachmentAccount("A");
  vi.spyOn(vault, "flushLocalVaultWrites").mockResolvedValue(undefined);
  vi.spyOn(vault, "assertVaultWrite").mockImplementation(() => {});
  vi.spyOn(vault, "assertVaultWritesSince").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each([false, true])("reviewed import cancellation (returns to A: %s)", back => {
  it("cannot link an image to the later workspace after its asynchronous creation", async () => {
    const store = plainStore();
    vi.spyOn(images, "attachNamedImages").mockImplementationOnce(async () => {
      await Promise.resolve(); switchAccount(back);
      return { attachments: [attachment], problems: [] };
    });
    await saveReviewedImport(preparedImport(), store, [new File(["A"], "diagram.png", { type: "image/png" })]).catch(() => undefined);
    expect(store.updateQuestion).not.toHaveBeenCalled();
  });

  it("does not roll back a later account's metadata or delete its same-key image when A's write fails", async () => {
    const store = plainStore();
    vi.spyOn(images, "attachNamedImages").mockResolvedValueOnce({ attachments: [attachment], problems: [] });
    vi.mocked(store.updateQuestion).mockImplementationOnce(async () => {
      await Promise.resolve(); switchAccount(back); throw new Error("Synthetic interrupted write");
    });
    const deletion = vi.spyOn(attachments, "deleteQuestionAttachmentBlobs").mockResolvedValue(undefined);
    await saveReviewedImport(preparedImport(), store, [new File(["A"], "diagram.png", { type: "image/png" })]).catch(() => undefined);
    expect(store.updateQuestion).toHaveBeenCalledTimes(1);
    expect(deletion).not.toHaveBeenCalled();
  });

  it("does not start a second named file under a later account after the first file returns", async () => {
    const startedOwners: string[] = [];
    const create = vi.spyOn(attachments, "createQuestionAttachment").mockImplementation(async () => {
      startedOwners.push(getQuestionAttachmentScope().owner);
      await Promise.resolve(); switchAccount(back);
      return { status: "failed", message: "Synthetic interrupted image" };
    });
    await images.attachNamedImages({ names: ["first.png", "second.png"], files: [new File(["A"], "first.png", { type: "image/png" }), new File(["A"], "second.png", { type: "image/png" })], questionId: "same-question" }).catch(() => undefined);
    expect(create).toHaveBeenCalledTimes(1);
    expect(startedOwners).toEqual(["account:A"]);
  });
});
