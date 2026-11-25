// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal, deleteSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import type { SourceDocument } from "./library";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { createMediaBackupArchive, mediaBackupBytes, readPortableBackup } from "./backupArchive";
import { parseImport } from "./backup";
import { SCHEMA_VERSION } from "./seed";
import { setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { ATTACHMENT_EXPORT_KEY, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob, type QuestionImageAttachment } from "./questionAttachments";

const attachment: QuestionImageAttachment = { id: "figure", blobKey: "private-library:figure", fileName: "figure.png", mimeType: "image/png", byteSize: 4, altText: "Test figure", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", role: "question" };
const refs = [{ id: "held-question", attachments: [attachment] }];
beforeEach(async () => { await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile); });
afterEach(async () => {
  setQuestionAttachmentAccount(undefined);
  await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB); request.onsuccess = () => resolve(); });
  await closeWorkspace();
});

describe("portable binary media backup", () => {
  it.each(["json", "zip"])("rejects malformed tasks from a %s backup before staging", async (format) => {
    const payload = { terms: [], schemaVersion: SCHEMA_VERSION, tasks: { id: "preserve-this-source" } };
    const file = format === "zip"
      ? new File([(await createMediaBackupArchive(payload, [])).blob], "invalid.zip")
      : new File([JSON.stringify(payload)], "invalid.json");
    const backup = await readPortableBackup(file);
    expect(() => parseImport(backup.rawText)).toThrow("invalid workspace collection (tasks)");
    expect(JSON.parse(backup.rawText).tasks).toEqual(payload.tasks);
  });

  it.each(["json", "zip"])("rejects future workspace schema in a %s backup before staging media", async (format) => {
    const payload = { terms: [], schemaVersion: SCHEMA_VERSION + 1, futureOnlyRecord: { preserved: true } };
    const file = format === "zip"
      ? new File([(await createMediaBackupArchive(payload, [])).blob], "future.zip")
      : new File([JSON.stringify(payload)], "future.json");
    const backup = await readPortableBackup(file);
    expect(() => parseImport(backup.rawText)).toThrow("newer workspace schema");
    expect(JSON.parse(backup.rawText).futureOnlyRecord).toEqual(payload.futureOnlyRecord);
  });


  it("round-trips distinct question references to one shared image without embedding base64 in workspace JSON", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
    const secondAttachment = { ...attachment, id: "figure-second", assetId: "source-page-second" };
    const references = [...refs, { id: "second-use", attachments: [secondAttachment] }];
    expect(mediaBackupBytes(references)).toBe(4);
    const exported = await createMediaBackupArchive({ _app: "AXOM", documents: [{ rawText: "kept" }] }, references);
    expect(exported.attachmentCount).toBe(1); expect(exported.missingBlobKeys).toEqual([]);
    const backup = await readPortableBackup(new File([exported.blob], "backup.zip"));
    expect(JSON.parse(backup.rawText).documents).toEqual([{ rawText: "kept" }]);
    expect(backup.rawText).not.toContain("base64");
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const staged = await backup.restoreMedia(references);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    const restored = await getQuestionAttachmentBlob(attachment.blobKey);
    expect(await restored!.blob.text()).toBe("AXOM");
    expect(restored!.questionId).toBe("second-use");
    expect(await backup.restoreMedia(references)).toMatchObject({ restored: 0, skipped: 1 });
    await staged.rollback();
    expect(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.text()).toBe("AXOM");
  });

  it("counts actual ZIP entries and reserves a manifest entry", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
    await expect(createMediaBackupArchive({}, refs, [], {}, { maxEntries: 1 })).rejects.toThrow("Too many files");
    const result = await createMediaBackupArchive({}, refs, [], {}, { maxEntries: 2 });
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["media/0", "workspace.json"]);
    expect((await readPortableBackup(new File([result.blob], "budget.zip"))).rawText).toContain("media/0");
  });

  it("budgets workspace UTF-8 bytes rather than string length", async () => {
    const payload = { label: "漢字🌍" };
    const first = await createMediaBackupArchive(payload, []);
    const backup = await readPortableBackup(new File([first.blob], "budget.zip"));
    const bytes = new Blob([backup.rawText]).size;
    expect(bytes).toBeGreaterThan(backup.rawText.length);
    await expect(createMediaBackupArchive(payload, [], [], {}, { maxWorkspaceBytes: bytes - 1 })).rejects.toThrow("safety limit");
    await expect(createMediaBackupArchive(payload, [], [], {}, { maxWorkspaceBytes: bytes })).resolves.toMatchObject({ attachmentCount: 0 });
  });

  it("rejects ZIP overhead when expanded entries fit", async () => {
    const payload = { label: "small backup" };
    const first = await createMediaBackupArchive(payload, []);
    const backup = await readPortableBackup(new File([first.blob], "budget.zip"));
    const expanded = new Blob([backup.rawText]).size;
    expect(first.blob.size).toBeGreaterThan(expanded);
    await expect(createMediaBackupArchive(payload, [], [], {}, { maxBytes: expanded })).rejects.toThrow("archive safety limit");
    await expect(createMediaBackupArchive(payload, [], [], {}, { maxBytes: first.blob.size })).resolves.toMatchObject({ attachmentCount: 0 });
  });

  it("rejects an aggregate binary budget without changing stored bytes", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
    await expect(createMediaBackupArchive({}, refs, [], {}, { maxBytes: 3 })).rejects.toThrow("archive safety limit");
    expect(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.text()).toBe("AXOM");
  });

  it("reports missing images and retains compatibility with existing JSON backups", async () => {
    expect((await createMediaBackupArchive({}, refs)).missingBlobKeys).toEqual([attachment.blobKey]);
    const payload = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: "QVhPTQ==" }] };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "older.json"));
    expect(await backup.restoreMedia(refs)).toMatchObject({ restored: 1, skipped: 0 });
  });

  it("never overwrites existing bytes when a portable backup reuses their blob key", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const payload = {
      _app: "AXOM",
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: "QVhPTQ==" }],
    };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "collision.json"));
    await expect(backup.restoreMedia(refs)).rejects.toThrow("existing storage key with different bytes");
    expect(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.text()).toBe("SAFE");
  });

  it("writes one original entry for identical duplicate identities without removing metadata", async () => {
    const original = new Blob(["duplicate source"], { type: "text/plain" });
    const document: SourceDocument = { id: "duplicate-source", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "duplicate source", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    const copy = { ...document, title: "Another label" };
    await saveSourceOriginal(document, original);
    const documents = [document, copy];
    const exported = await createMediaBackupArchive({ documents }, [], documents);
    expect(exported).toMatchObject({ originalCount: 1, missingOriginalIds: [] });
    const backup = await readPortableBackup(new File([exported.blob], "duplicates.zip"));
    expect(JSON.parse(backup.rawText).documents).toEqual(documents);
    await deleteSourceOriginal(document.id);
    expect(await backup.restoreOriginals(documents)).toEqual({ restored: 1, skipped: 0 });
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toBe("duplicate source");
  });

  it.each([false, true])("rejects competing original identities in either order (reverse: %s)", async reverse => {
    const original = new Blob(["first source"], { type: "text/plain" });
    const document: SourceDocument = { id: "competing-source", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "first source", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    const other = { ...document, checksum: await sha256Hex("other source") };
    await saveSourceOriginal(document, original);
    const documents = reverse ? [other, document] : [document, other];
    await expect(createMediaBackupArchive({ documents }, [], documents)).rejects.toThrow("Conflicting original-file identities");
    await expect(createMediaBackupArchive({ documents: [documents[0]], deferredContent: { documents: [documents[1]] } }, [], [document])).rejects.toThrow("Conflicting original-file identities");
    await expect(createMediaBackupArchive({}, [], [document])).rejects.toThrow("identity is missing");
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toBe("first source");
  });


  it.each([
    ["active conflict", "conflict", "active"],
    ["active reverse conflict", "reverse", "active"],
    ["deferred conflict", "conflict", "deferred"],
    ["deferred reverse conflict", "reverse", "deferred"],
    ["missing checksum", "missing", "active"],
    ["malformed checksum", "malformed", "active"],
    ["identical claims", "same", "active"],
    ["prefixed checksum", "prefix", "deferred"],
    ["unrelated legacy document", "unrelated", "active"],
  ])("validates all inbound original claims: %s", async (_, scenario, placement) => {
    const { default: JSZip } = await import("jszip");
    const original = new Blob(["inbound original"], { type: "text/plain" });
    const document: SourceDocument = { id: "inbound", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "inbound original", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    const otherDigest = await sha256Hex("other edition");
    const other = { ...document, checksum: scenario === "missing" ? undefined : scenario === "malformed" ? 123 : scenario === "prefix" ? `sha256:${document.checksum}` : scenario === "same" ? document.checksum : otherDigest, id: scenario === "unrelated" ? "unrelated" : document.id };
    const ordered = scenario === "reverse" ? [document, other] : [other, document];
    const manifest = {
      _backupFormat: "axom-media-backup", _backupVersion: 2, media: [],
      documents: placement === "active" ? ordered : [ordered[0]],
      deferredContent: { documents: placement === "deferred" ? [ordered[1]] : [] },
      originals: [{ file: "originals/0", documentId: document.id, sha256: document.checksum, byteSize: original.size, mimeType: original.type }],
    };
    const zip = new JSZip();
    zip.file("workspace.json", JSON.stringify(manifest));
    zip.file("originals/0", new Uint8Array(await original.arrayBuffer()), { createFolders: false });
    const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "inbound.zip");
    const prior = { ...document, checksum: otherDigest };
    await saveSourceOriginal(prior, new Blob(["other edition"], { type: "text/plain" }));
    if (["same", "prefix", "unrelated"].includes(scenario)) {
      const backup = await readPortableBackup(file);
      expect(JSON.parse(backup.rawText)).toEqual(JSON.parse(JSON.stringify(manifest)));
    } else {
      await expect(readPortableBackup(file)).rejects.toThrow("invalid or missing original-file");
    }
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
    expect(await (await readSourceOriginal(prior.id, prior.checksum))?.text()).toBe("other edition");
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

  it.each([false, true])("rejects a stale ZIP image restore (return to original account: %s)", async returnToOriginal => {
    setQuestionAttachmentAccount("backup-test-a");
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({}, refs);
    const backup = await readPortableBackup(new File([exported.blob], "scope.zip"));
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const pending = backup.restoreMedia(refs);
    setQuestionAttachmentAccount("backup-test-b");
    if (returnToOriginal) setQuestionAttachmentAccount("backup-test-a");
    await expect(pending).rejects.toThrow("account changed");
    setQuestionAttachmentAccount("backup-test-b");
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("backup-test-a");
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
  });

  it.each([false, true])("rejects a previously read JSON backup after an account transition (return: %s)", async returnToOriginal => {
    setQuestionAttachmentAccount("backup-test-a");
    const payload = { [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: "QVhPTQ==" }] };
    const backup = await readPortableBackup(new File([JSON.stringify(payload)], "scope.json"));
    setQuestionAttachmentAccount("backup-test-b");
    if (returnToOriginal) setQuestionAttachmentAccount("backup-test-a");
    await expect(backup.restoreMedia(refs)).rejects.toThrow("account changed");
    await expect(backup.restoreOriginals([])).rejects.toThrow("account changed");
    setQuestionAttachmentAccount("backup-test-b");
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("backup-test-a");
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
  });

  it("does not restore verified originals into a replacement account", async () => {
    setQuestionAttachmentAccount("backup-test-a");
    const original = new Blob(["private source"], { type: "text/plain" });
    const document: SourceDocument = { id: "scope-source", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "private source", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    await saveSourceOriginal(document, original);
    const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    const backup = await readPortableBackup(new File([exported.blob], "scope.zip"));
    setQuestionAttachmentAccount("backup-test-b");
    await expect(backup.restoreOriginals([document])).rejects.toThrow("account changed");
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
    setQuestionAttachmentAccount("backup-test-a");
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toBe("private source");
  });

  it("rejects unrelated ZIPs and missing media before allowing a workspace restore", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(); zip.file("catalog.json", "{}");
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "library.zip"))).rejects.toThrow("not an AXOM workspace backup");
    zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 1, media: [{ file: "media/0", metadata: { ...attachment, questionId: "held-question" } }] }));
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "damaged.zip"))).rejects.toThrow("invalid or missing image");
  });
});
