// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal, deleteSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import type { SourceDocument } from "./library";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { createMediaBackupArchive, mediaBackupBytes, readPortableBackup } from "./backupArchive";
import { ATTACHMENT_EXPORT_KEY, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob, type QuestionImageAttachment } from "./questionAttachments";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), char => char.charCodeAt(0));
const pngBlob = () => new Blob([PNG_BYTES.buffer as ArrayBuffer], { type: "image/png" });
const attachment: QuestionImageAttachment = { id: "figure", blobKey: "private-library:figure", fileName: "figure.png", mimeType: "image/png", byteSize: PNG_BYTES.length, altText: "Test figure", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", role: "question" };
const refs = [{ id: "held-question", attachments: [attachment] }];
beforeEach(async () => { await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile); });
afterEach(async () => {
  await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB); request.onsuccess = () => resolve(); });
  await closeWorkspace();
});

describe("portable binary media backup", () => {
  it("round-trips distinct question references to one shared image without embedding base64 in workspace JSON", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length, questionId: "held-question", updatedAt: attachment.updatedAt });
    const secondAttachment = { ...attachment, id: "figure-second", assetId: "source-page-second" };
    const references = [...refs, { id: "second-use", attachments: [secondAttachment] }];
    expect(mediaBackupBytes(references)).toBe(PNG_BYTES.length);
    const exported = await createMediaBackupArchive({ _app: "AXOM", documents: [{ rawText: "kept" }] }, references);
    expect(exported.attachmentCount).toBe(1); expect(exported.missingBlobKeys).toEqual([]);
    const backup = await readPortableBackup(new File([exported.blob], "backup.zip"));
    expect(JSON.parse(backup.rawText).documents).toEqual([{ rawText: "kept" }]);
    expect(backup.rawText).not.toContain("base64");
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const staged = await backup.restoreMedia(references);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    const restored = await getQuestionAttachmentBlob(attachment.blobKey);
    expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(PNG_BYTES);
    expect(restored!.questionId).toBe("second-use");
    expect(await backup.restoreMedia(references)).toMatchObject({ restored: 0, skipped: 1 });
    await staged.rollback();
    expect(await getQuestionAttachmentBlob(attachment.blobKey)).toBeUndefined();
  });

  it("reports missing images and retains compatibility with existing JSON backups", async () => {
    expect((await createMediaBackupArchive({}, refs)).missingBlobKeys).toEqual([attachment.blobKey]);
    const payload = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: PNG_BASE64 }] };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "older.json"));
    expect(await backup.restoreMedia(refs)).toMatchObject({ restored: 1, skipped: 0 });
  });

  it.each([
    { defect: "truncated blob", bytes: "AB", recordSize: 4, mime: "image/png" },
    { defect: "empty blob", bytes: "", recordSize: 4, mime: "image/png" },
    { defect: "inaccurate stored length", bytes: "AXOM", recordSize: 2, mime: "image/png" },
    { defect: "mismatched stored MIME", bytes: "AXOM", recordSize: 4, mime: "image/jpeg" },
  ] as const)("does not count a $defect as a backed-up image", async ({ bytes, recordSize, mime }) => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([bytes], { type: mime }), mimeType: mime, byteSize: recordSize,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({}, refs);
    expect(exported.attachmentCount).toBe(0);
    expect(exported.missingBlobKeys).toEqual([attachment.blobKey]);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(zip.file("media/0")).toBeNull();
    expect(JSON.parse(await zip.file("workspace.json")!.async("string")).media).toEqual([]);
  });


  it("rejects a CRC-correct PNG container without required image-data chunks", async () => {
    const withoutImageData = new Uint8Array([
      ...PNG_BYTES.subarray(0, 33), ...PNG_BYTES.subarray(58),
    ]);
    const expected = { ...attachment, byteSize: withoutImageData.byteLength };
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([withoutImageData.buffer as ArrayBuffer], { type: "image/png" }),
      mimeType: "image/png", byteSize: withoutImageData.byteLength,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const result = await createMediaBackupArchive({}, [{ id: "held-question", attachments: [expected] }]);
    expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
  });

  it("does not certify a same-size fake PNG or a byte-corrupted valid PNG as backed up", async () => {
    for (const bytes of [
      new Uint8Array(PNG_BYTES.length).fill(0x58),
      (() => { const altered = new Uint8Array(PNG_BYTES); altered[45] ^= 1; return altered; })(),
    ]) {
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
        mimeType: "image/png", byteSize: PNG_BYTES.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const result = await createMediaBackupArchive({}, refs);
      expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
    }
  });

  it.each([
    { conflict: "MIME", changes: { mimeType: "image/jpeg" } },
    { conflict: "byte size", changes: { byteSize: 6 } },
  ] as const)("holds a shared storage key with contradictory $conflict instead of certifying its ZIP bytes", async ({ changes }) => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const conflictingAttachment: QuestionImageAttachment = { ...attachment, ...changes, id: "other-figure" };
    const references = [...refs, { id: "other-question", attachments: [conflictingAttachment] }];
    expect(mediaBackupBytes(references)).toBe(PNG_BYTES.length);
    const exported = await createMediaBackupArchive({ _app: "AXOM" }, references);
    expect(exported.attachmentCount).toBe(0);
    expect(exported.missingBlobKeys).toEqual([attachment.blobKey]);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(zip.file("media/0")).toBeNull();
    expect(JSON.parse(await zip.file("workspace.json")!.async("string")).media).toEqual([]);
    const backup = await readPortableBackup(new File([exported.blob], "conflicting.zip"));
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    await expect(backup.restoreMedia(references)).rejects.toThrow("conflicting image metadata");
    expect(await getQuestionAttachmentBlob(attachment.blobKey)).toBeUndefined();
  });

  it("fails closed on conflicting references when restoring an older JSON backup", async () => {
    const payload = {
      _app: "AXOM",
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: PNG_BASE64 }],
    };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "older.json"));
    const conflictingAttachment: QuestionImageAttachment = {
      ...attachment, id: "second-figure", byteSize: attachment.byteSize + 1,
    };
    await expect(backup.restoreMedia([...refs, { id: "other-question", attachments: [conflictingAttachment] }]))
      .rejects.toThrow("conflicting image metadata");
    expect(await getQuestionAttachmentBlob(attachment.blobKey)).toBeUndefined();
  });

  it("never overwrites existing bytes when a portable backup reuses their blob key", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([new Uint8Array(PNG_BYTES.length).fill(0x53).buffer as ArrayBuffer], { type: "image/png" }), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const payload = {
      _app: "AXOM",
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: PNG_BASE64 }],
    };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "collision.json"));
    await expect(backup.restoreMedia(refs)).rejects.toThrow("existing storage key with different bytes");
    expect(new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())[0]).toBe(0x53);
  });

  it("round-trips verified originals, retries safely and preserves a newer local edition", async () => {
    const original = new Blob(["original source"], { type: "text/plain" });
    const document: SourceDocument = { id: "source", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "original source", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    await saveSourceOriginal(document, original);
    const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    expect(exported).toMatchObject({ originalCount: 1, missingOriginalIds: [] });
    const backup = await readPortableBackup(new File([exported.blob], "originals.zip"));
    expect(backup.rawText).not.toContain("base64");
    await deleteSourceOriginal(document.id);
    const newer = { ...document, checksum: await sha256Hex("newer source") };
    await saveSourceOriginal(newer, new Blob(["newer source"]));
    expect(await backup.restoreOriginals([newer])).toEqual({ restored: 0, skipped: 1 });
    expect(await backup.restoreOriginals([document])).toEqual({ restored: 1, skipped: 0 });
    expect(await backup.restoreOriginals([document])).toEqual({ restored: 0, skipped: 1 });
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toBe("original source");
    expect(await (await readSourceOriginal(document.id, newer.checksum))?.text()).toBe("newer source");
    const { default: JSZip } = await import("jszip");
    const corrupted = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    corrupted.file("originals/0", "corrupted bytes");
    await expect(readPortableBackup(new File([await corrupted.generateAsync({ type: "arraybuffer" })], "corrupt.zip"))).rejects.toThrow("integrity check");
    const forged = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await forged.file("workspace.json")!.async("string"));
    manifest.originals.push(manifest.originals[0]);
    forged.file("workspace.json", JSON.stringify(manifest));
    await expect(readPortableBackup(new File([await forged.generateAsync({ type: "arraybuffer" })], "duplicate.zip"))).rejects.toThrow("invalid or missing original-file");
    await deleteSourceOriginal(document.id);
    expect(await createMediaBackupArchive({ documents: [document] }, [], [document])).toMatchObject({ originalCount: 0, missingOriginalIds: [document.id] });
  });

  it("rejects unrelated ZIPs and missing media before allowing a workspace restore", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(); zip.file("catalog.json", "{}");
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "library.zip"))).rejects.toThrow("not an AXOM workspace backup");
    zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 1, media: [{ file: "media/0", metadata: { ...attachment, questionId: "held-question" } }] }));
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "damaged.zip"))).rejects.toThrow("invalid or missing image");
  });
});
