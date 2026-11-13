// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { exportStateWithAttachments, lastBackupAt, parseImport } from "./backup";
import { readPortableBackup } from "./backupArchive";
import { setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { makeSeed } from "./seed";
import { sha256Hex } from "./checksum";
import { saveSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { ATTACHMENT_EXPORT_KEY, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob, setMissingAttachmentLoader, type QuestionImageAttachment } from "./questionAttachments";
import { splitCloudContent } from "./sync/cloudContent";
import { deferContent } from "./sync/deferredContent";
import { retainDownloadedContent } from "./sync/contentDownloads";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), char => char.charCodeAt(0));
const pngBlob = () => new Blob([PNG_BYTES.buffer as ArrayBuffer], { type: "image/png" });
const attachment: QuestionImageAttachment = { id: "figure", blobKey: "offline-figure", fileName: "figure.png", mimeType: "image/png", byteSize: PNG_BYTES.length, altText: "Test figure", createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", role: "question" };
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
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length, questionId: "q", updatedAt: attachment.updatedAt });
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

  it("does not certify a complete export when referenced images or originals were omitted", async () => {
    localStorage.clear();
    const { state } = await fixture();
    const result = await exportStateWithAttachments(state);
    expect(result.missingBlobKeys).toEqual(["offline-figure", "unavailable-image"]);
    expect(result.missingOriginalIds).toEqual(["document"]);
    expect(filename).toMatch(/^axom-backup-.*\.zip$/);
    expect(lastBackupAt()).toBeNull();
  });

  it("certifies a complete export when every expected image and original is readable", async () => {
    localStorage.clear();
    const { state, original } = await fixture();
    await saveSourceOriginal(state.documents[0], original);
    for (const a of state.questions[0].attachments ?? []) {
      await putQuestionAttachmentBlob(a.blobKey, { blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length, questionId: "q", updatedAt: a.updatedAt });
    }
    const result = await exportStateWithAttachments(state);
    expect(result.missingBlobKeys).toEqual([]);
    expect(result.missingOriginalIds).toEqual([]);
    expect(filename).toMatch(/^axom-backup-.*\.zip$/);
    expect(lastBackupAt()).not.toBeNull();
  });

  it("does not certify an image-incomplete JSON export as a successful full backup", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    const result = await exportStateWithAttachments(state);
    expect(result.missingBlobKeys).toEqual(["offline-figure", "unavailable-image"]);
    expect(result.missingOriginalIds).toEqual([]);
    expect(filename).toMatch(/^axom-backup-.*\.json$/);
    expect(lastBackupAt()).toBeNull();
  });
  it("deduplicates compatible shared keys in a complete JSON backup and restores their bytes", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    state.questions[0].attachments = [
      attachment,
      { ...attachment, id: "another-reference", assetId: "another-source" },
    ];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png",
      byteSize: PNG_BYTES.length, questionId: "q", updatedAt: attachment.updatedAt,
    });
    const result = await exportStateWithAttachments(state);
    expect(result).toMatchObject({ attachmentCount: 1, missingBlobKeys: [], originalCount: 0 });
    expect(filename).toMatch(/\.json$/);
    expect(lastBackupAt()).not.toBeNull();
    const backup = await readPortableBackup(new File([exported!], filename));
    expect(JSON.parse(backup.rawText)[ATTACHMENT_EXPORT_KEY]).toHaveLength(1);
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const staged = await backup.restoreMedia([{ id: "q", attachments: state.questions[0].attachments }]);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    expect(new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer()))
      .toEqual(PNG_BYTES);
    await staged.rollback();
  });

  it.each([
    { name: "MIME", changes: { mimeType: "image/jpeg" } },
    { name: "declared byte size", changes: { byteSize: 5 } },
  ] as const)("does not certify conflicting JSON shared-key $name", async ({ changes }) => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    state.questions[0].attachments = [attachment, { ...attachment, ...changes, id: "contradiction" }];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png",
      byteSize: PNG_BYTES.length, questionId: "q", updatedAt: attachment.updatedAt,
    });
    const result = await exportStateWithAttachments(state);
    expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
    expect(lastBackupAt()).toBeNull();
    expect(filename).toMatch(/\.json$/);
    const backup = await readPortableBackup(new File([exported!], filename));
    expect(JSON.parse(backup.rawText)[ATTACHMENT_EXPORT_KEY]).toBeUndefined();
    await expect(backup.restoreMedia([{ id: "q", attachments: state.questions[0].attachments }]))
      .rejects.toThrow("conflicting image metadata");
  });

  it.each([
    { name: "truncated image", bytes: "AB", storedSize: 4, storedMime: "image/png" },
    { name: "lying stored size", bytes: "AXOM", storedSize: 2, storedMime: "image/png" },
    { name: "mismatched stored MIME", bytes: "AXOM", storedSize: 4, storedMime: "image/jpeg" },
  ] as const)("does not certify $name in complete JSON export", async ({ bytes, storedSize, storedMime }) => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    state.questions[0].attachments = [attachment];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([bytes], { type: storedMime }), mimeType: storedMime,
      byteSize: storedSize, questionId: "q", updatedAt: attachment.updatedAt,
    });
    const result = await exportStateWithAttachments(state);
    expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
    expect(lastBackupAt()).toBeNull();
    const backup = await readPortableBackup(new File([exported!], filename));
    expect(JSON.parse(backup.rawText)[ATTACHMENT_EXPORT_KEY]).toBeUndefined();
  });

  it("does not certify equal-length fake or damaged PNG bytes in a complete JSON backup", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    state.questions[0].attachments = [attachment];
    for (const bytes of [
      new Uint8Array(PNG_BYTES.length).fill(0x58),
      (() => { const altered = new Uint8Array(PNG_BYTES); altered[45] ^= 1; return altered; })(),
    ]) {
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
        mimeType: "image/png", byteSize: PNG_BYTES.length,
        questionId: "q", updatedAt: attachment.updatedAt,
      });
      const result = await exportStateWithAttachments(state);
      expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
      expect(lastBackupAt()).toBeNull();
    }
  });

  it("aborts a JSON export on account switch instead of downloading prior-account metadata", async () => {
    const { state } = await fixture();
    state.documents = [];
    state.questions[0].attachments = [{ ...attachment, blobKey: "missing-during-switch" }];
    dispose();
    dispose = setMissingAttachmentLoader(async () => {
      setQuestionAttachmentAccount("second-account");
      return undefined;
    });
    try {
      await expect(exportStateWithAttachments(state)).rejects.toThrow("account changed during export");
      expect(exported).toBeUndefined();
      expect(filename).toBe("");
    } finally {
      setQuestionAttachmentAccount(undefined);
    }
  });


  it("routes more than 4096 distinct image identities to ZIP even with less than 128 MiB of metadata", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    const images = Array.from({ length: 4097 }, (_, index) => ({
      ...attachment, id: `figure-${index}`, blobKey: `image-${index}`,
    }));
    state.questions[0].attachments = images;
    await putQuestionAttachmentBlob(images[0].blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "q", updatedAt: attachment.updatedAt,
    });

    const result = await exportStateWithAttachments(state);
    expect(filename).toMatch(/^axom-backup-.*\.zip$/);
    expect(result.attachmentCount).toBe(1);
    expect(result.missingBlobKeys).toHaveLength(4096);
    expect(lastBackupAt()).toBeNull();
    const portable = await readPortableBackup(new File([exported!], filename));
    expect(JSON.parse(portable.rawText).questions[0].attachments).toHaveLength(4097);
    expect(JSON.parse(portable.rawText)[ATTACHMENT_EXPORT_KEY]).toBeUndefined();
    await deleteQuestionAttachmentBlobs([images[0].blobKey]);
    const staged = await portable.restoreMedia([{ id: "q", attachments: [images[0]] }]);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    expect(new Uint8Array(await (await getQuestionAttachmentBlob(images[0].blobKey))!.blob.arrayBuffer()))
      .toEqual(PNG_BYTES);
    await staged.rollback();
  });


  it("falls back to a valid ZIP when the serialized JSON exceeds its import byte limit", async () => {
    localStorage.clear();
    const state = makeSeed();
    state.documents = []; state.questions = [];
    const nativeSize = Object.getOwnPropertyDescriptor(NativeBlob.prototype, "size")!.get!;
    let simulatedOversize = false;
    vi.spyOn(NativeBlob.prototype, "size", "get").mockImplementation(function (this: Blob) {
      const actual = nativeSize.call(this) as number;
      if (!simulatedOversize && this.type === "application/json") {
        simulatedOversize = true;
        return 256 * 1024 * 1024 + 1;
      }
      return actual;
    });
    const result = await exportStateWithAttachments(state);
    expect(simulatedOversize).toBe(true);
    expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [], originalCount: 0 });
    expect(filename).toMatch(/^axom-backup-.*\.zip$/);
    expect(lastBackupAt()).not.toBeNull();
    const imported = await readPortableBackup(new File([exported!], filename));
    expect(parseImport(imported.rawText).profile.userId).toBe(state.profile.userId);
  });

  it("refuses an unimportable oversized ZIP workspace before downloading or marking success", async () => {
    localStorage.clear();
    const { state } = await fixture(); // An original-backed export chooses ZIP.
    const nativeSize = Object.getOwnPropertyDescriptor(NativeBlob.prototype, "size")!.get!;
    vi.spyOn(NativeBlob.prototype, "size", "get").mockImplementation(function (this: Blob) {
      const actual = nativeSize.call(this) as number;
      return this.type === "application/json" ? 128 * 1024 * 1024 + 1 : actual;
    });
    await expect(exportStateWithAttachments(state))
      .rejects.toThrow(/ZIP workspace exceeds the 128 MB recovery safety limit/i);
    expect(exported).toBeUndefined();
    expect(filename).toBe("");
    expect(lastBackupAt()).toBeNull();
  });


});
