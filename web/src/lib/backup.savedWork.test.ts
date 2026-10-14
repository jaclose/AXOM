// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { exportStateWithAttachments, lastBackupAt, parseImport } from "./backup";
import { readPortableBackup } from "./backupArchive";
import { makeSeed } from "./seed";
import { sha256Hex } from "./checksum";
import { saveSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { putQuestionAttachmentBlob, setMissingAttachmentLoader, type QuestionImageAttachment } from "./questionAttachments";
import { splitCloudContent } from "./sync/cloudContent";
import { deferContent } from "./sync/deferredContent";
import { retainDownloadedContent } from "./sync/contentDownloads";

const attachment: QuestionImageAttachment = { id: "figure", blobKey: "offline-figure", fileName: "figure.png", mimeType: "image/png", byteSize: 4, altText: "Test figure", createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", role: "question" };
const attemptedDownload = vi.fn(async () => { throw new Error("Offline"); });
const accountRead = vi.hoisted(() => vi.fn(async () => { throw new Error("Account unavailable"); }));
vi.mock("./account/supabase", () => ({ accountOperationClient: accountRead }));
let exported: Blob | undefined;
let filename = "";
let dispose: () => void;

beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { exported = blob; return "blob:test"; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  attemptedDownload.mockClear(); accountRead.mockClear(); exported = undefined; filename = "";
  dispose = setMissingAttachmentLoader(attemptedDownload);
});
afterEach(async () => {
  dispose();
  await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB); request.onsuccess = () => resolve(); });
  await closeWorkspace(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function fixture() {
  const state = makeSeed();
  state.questions = [{ id: "q", stem: "Source question", options: [{ key: "A", text: "Answer" }], source: "manual", correctKey: "A", status: "unseen", tags: [], attempts: [], notes: "My saved note", attachments: [attachment, { ...attachment, id: "missing", blobKey: "unavailable-image" }], createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" }];
  const original = new Blob(["Source file text"], { type: "text/plain" });
  state.documents = [{ id: "document", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-14", rawText: "Source file text", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true }];
  const split = await splitCloudContent(state);
  const deferred = deferContent(split.workspace, "account-a", split.references, []);
  return { state, original, deferred };
}

describe("saved-work recovery without downloading content", () => {
  it("exports local images and exact originals while preserving deferred notes and references", async () => {
    const { state, original, deferred } = await fixture();
    await saveSourceOriginal(state.documents[0], original);
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4, questionId: "q", updatedAt: attachment.updatedAt });
    const result = await exportStateWithAttachments(deferred, "saved-work");
    expect(result).toMatchObject({ attachmentCount: 1, missingBlobKeys: ["unavailable-image"], originalCount: 1, missingOriginalIds: [], deferredSourceCount: 2 });
    expect(filename).toMatch(/^axom-saved-work-.*\.zip$/);
    expect(lastBackupAt()).toBeNull();
    expect(attemptedDownload).not.toHaveBeenCalled(); expect(accountRead).not.toHaveBeenCalled();
    const backup = await readPortableBackup(new File([exported!], filename));
    expect(JSON.parse(backup.rawText)._backupScope).toBe("saved-work");
    expect(backup.rawText).not.toContain("Source file text");
    const restored = parseImport(backup.rawText);
    expect(restored.deferredContent).toEqual(deferred.deferredContent);
    expect(restored.questions).toEqual([]);
    expect(restored.deferredContent?.questions[0].notes).toBe("My saved note");
    const local = { ...state, questions: [{ ...state.questions[0], notes: "Older device note" }] };
    const retained = await retainDownloadedContent(restored, local);
    expect(retained.deferredContent).toBeUndefined();
    expect(retained.questions[0].stem).toBe("Source question");
    expect(retained.questions[0].notes).toBe("My saved note");
    expect(retained.documents[0].rawText).toBe("Source file text");
    const different = { ...local, questions: [{ ...local.questions[0], stem: "Different edition" }] };
    expect((await retainDownloadedContent(restored, different)).deferredContent?.questions).toHaveLength(1);
    expect(attemptedDownload).not.toHaveBeenCalled(); expect(accountRead).not.toHaveBeenCalled();
  });

  it("keeps JSON recovery local too, and does not silently downgrade a failed full export", async () => {
    const { deferred } = await fixture();
    deferred.deferredContent!.documents = []; deferred.deferredContent!.sources = deferred.deferredContent!.sources.filter(ref => ref.collection === "questions");
    await expect(exportStateWithAttachments(deferred)).rejects.toThrow("Account unavailable");
    expect(exported).toBeUndefined();
    accountRead.mockClear();
    const result = await exportStateWithAttachments(deferred, "saved-work");
    expect(result).toMatchObject({ attachmentCount: 0, deferredSourceCount: 1, missingBlobKeys: ["offline-figure", "unavailable-image"] });
    expect(filename).toMatch(/^axom-saved-work-.*\.json$/);
    expect(parseImport(await exported!.text()).deferredContent).toEqual(deferred.deferredContent);
    expect(attemptedDownload).not.toHaveBeenCalled(); expect(accountRead).not.toHaveBeenCalled();
  });
});
