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

  it.each(["json", "zip"])("rejects invalid nested course modules from a %s backup before staging", async (format) => {
    const payload = { terms: [], schemaVersion: SCHEMA_VERSION, courses: [
      { id: "valid-course", modules: [{ id: "m1", name: "NB1" }] },
      { id: "invalid-course", modules: [null] },
    ] };
    const file = format === "zip"
      ? new File([(await createMediaBackupArchive(payload, [])).blob], "invalid-course.zip")
      : new File([JSON.stringify(payload)], "invalid-course.json");
    const backup = await readPortableBackup(file);
    expect(() => parseImport(backup.rawText)).toThrow("invalid course module collection");
    expect(JSON.parse(backup.rawText).courses).toEqual(payload.courses);
  });

  it.each(["json", "zip"])("rejects unusable tracker paths from a %s backup without altering source records", async (format) => {
    const payload = { terms: [], schemaVersion: SCHEMA_VERSION, tracker: [
      { id: "valid-tracker", path: "T2/NB3/Lectures", label: "Retain valid" },
      { id: "invalid-tracker", path: null, label: "Retain invalid" },
    ] };
    const file = format === "zip"
      ? new File([(await createMediaBackupArchive(payload, [])).blob], "invalid-tracker.zip")
      : new File([JSON.stringify(payload)], "invalid-tracker.json");
    const backup = await readPortableBackup(file);
    expect(() => parseImport(backup.rawText)).toThrow("invalid Course Tracker path");
    expect(JSON.parse(backup.rawText).tracker).toEqual(payload.tracker);
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


  it.each(["object", "null", "null-entry", "empty-base64", "invalid-base64", "short", "long", "missing-question", "invalid-mime", "mixed"] as const)("rejects explicitly malformed JSON image declarations (%s) before staging", async scenario => {
    const valid = { ...attachment, questionId: "held-question", base64: "QVhPTQ==" };
    const invalid = scenario === "null-entry" ? null
      : { ...valid, ...(scenario === "empty-base64" || scenario === "mixed" ? { base64: "" }
        : scenario === "invalid-base64" ? { base64: "!!!" }
        : scenario === "short" ? { base64: "QQ==" }
        : scenario === "long" ? { base64: "QUJDREU=" }
        : scenario === "missing-question" ? { questionId: "" }
        : { mimeType: "text/plain" }) };
    const field = scenario === "object" ? valid : scenario === "null" ? null
      : scenario === "mixed" ? [valid, invalid] : [invalid];
    await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
    const file = new File([JSON.stringify({ [ATTACHMENT_EXPORT_KEY]: field })], "invalid-payload.json");
    await expect(readPortableBackup(file)).rejects.toThrow("invalid image payload declaration");
    expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
  });

  it.each([false, true])("preserves legacy JSON with absent or empty declarations (present: %s)", async present => {
    const file = new File([JSON.stringify(present ? { [ATTACHMENT_EXPORT_KEY]: [] } : {})], "metadata-only.json");
    const backup = await readPortableBackup(file);
    expect(await backup.restoreMedia(refs)).toMatchObject({ restored: 0, skipped: 0 });
  });

  describe.each([1, 2])("ZIP version %s declared payload integrity", version => {
    it.each(["empty", "short", "long", "valid"] as const)("checks %s bytes before the first staging write", async scenario => {
      const { default: JSZip } = await import("jszip");
      const fresh = { ...attachment, id: "fresh", blobKey: "fresh-image" };
      const references = [...refs, { id: "fresh-question", attachments: [fresh] }];
      const zip = new JSZip();
      zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: version, originals: [], media: [
        { file: "media/0", metadata: { ...fresh, questionId: "fresh-question" } },
        { file: "media/1", metadata: { ...attachment, questionId: "held-question" } },
      ] }));
      zip.file("media/0", "AXOM", { createFolders: false });
      zip.file("media/1", scenario === "empty" ? "" : scenario === "short" ? "A" : scenario === "long" ? "ABCDE" : "SAFE", { createFolders: false });
      await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
      const backup = await readPortableBackup(new File([await zip.generateAsync({ type: "arraybuffer" })], "payload.zip"));
      if (scenario === "valid") {
        expect(await backup.restoreMedia(references)).toMatchObject({ restored: 1, skipped: 1 });
        expect(await (await getQuestionAttachmentBlob(fresh.blobKey, { localOnly: true }))!.blob.text()).toBe("AXOM");
      } else {
        await expect(backup.restoreMedia(references)).rejects.toThrow("invalid image payload declaration");
        expect(await getQuestionAttachmentBlob(fresh.blobKey, { localOnly: true })).toBeUndefined();
      }
      expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
    });
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

  describe.each([1, 2])("ZIP version %s image manifest identity", version => {
    it.each(["path", "key", "identical", "trimmed", "legacy", "blank", "distinct", "legacy-distinct"] as const)("validates %s before staging any image", async scenario => {
      const { default: JSZip } = await import("jszip");
      const first = { file: "media/0", metadata: { ...attachment, questionId: "held-question" } };
      const second = {
        file: scenario === "path" || scenario === "identical" ? "media/0" : "media/1",
        metadata: {
          ...first.metadata,
          id: scenario === "identical" ? attachment.id : scenario === "legacy" || scenario === "blank" ? attachment.blobKey : "other-figure",
          blobKey: scenario === "key" || scenario === "identical" ? attachment.blobKey
            : scenario === "trimmed" ? ` ${attachment.blobKey} `
            : scenario === "legacy" || scenario === "legacy-distinct" ? undefined
            : scenario === "blank" ? " " : "other-key",
        },
      };
      const zip = new JSZip();
      zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: version, media: [first, second], originals: [] }));
      zip.file("media/0", "AXOM", { createFolders: false });
      zip.file("media/1", "DIFF", { createFolders: false });
      const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "identities.zip");
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      if (scenario === "distinct" || scenario === "legacy-distinct") {
        const backup = await readPortableBackup(file);
        expect(JSON.parse(backup.rawText).media).toHaveLength(2);
      } else {
        await expect(readPortableBackup(file)).rejects.toThrow("duplicate image identities");
      }
      expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
      expect(await getQuestionAttachmentBlob("other-key", { localOnly: true })).toBeUndefined();
      expect(await getQuestionAttachmentBlob("other-figure", { localOnly: true })).toBeUndefined();
    });
  });


  describe.each([1, 2])("ZIP version %s manifest path runtime types", version => {
    it.each(["single-array", "mixed", "reverse-mixed", "two-arrays", "nested-array", "number", "null", "object", "duplicate-string", "distinct"] as const)("checks %s image paths before staging", async scenario => {
      const { default: JSZip } = await import("jszip");
      const path = "media/0";
      const first = { file: scenario === "reverse-mixed" || scenario === "two-arrays" ? [path] : path, metadata: { ...attachment, questionId: "held-question" } };
      const second = { file: scenario === "distinct" ? "media/1" : scenario === "duplicate-string" || scenario === "reverse-mixed" ? path
        : scenario === "nested-array" ? [[path]] : scenario === "number" ? 0 : scenario === "null" ? null : scenario === "object" ? { path } : [path],
        metadata: { ...first.metadata, id: "second-figure", blobKey: "second-key" } };
      const media = scenario === "single-array" ? [second] : [first, second];
      const zip = new JSZip();
      zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: version, media, originals: [] }));
      zip.file(path, "AXOM", { createFolders: false });
      zip.file("media/1", "DIFF", { createFolders: false });
      await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
      const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "typed-image-path.zip");
      if (scenario === "distinct") {
        expect(JSON.parse((await readPortableBackup(file)).rawText).media).toEqual(media);
      } else {
        await expect(readPortableBackup(file)).rejects.toThrow(/invalid or missing image record|duplicate image identities/);
      }
      expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
      expect(await getQuestionAttachmentBlob("second-key", { localOnly: true })).toBeUndefined();
    });
  });

  it.each(["single-array", "mixed", "reverse-mixed", "two-arrays", "nested-array", "number", "null", "object", "duplicate-string", "distinct"] as const)("checks %s original paths before staging", async scenario => {
    const { default: JSZip } = await import("jszip");
    const original = new Blob(["original source"], { type: "text/plain" });
    const document: SourceDocument = { id: "typed-original", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-13", rawText: "original source", sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()), tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    const secondDocument = { ...document, id: "second-original" };
    const path = "originals/0";
    const first = { file: scenario === "reverse-mixed" || scenario === "two-arrays" ? [path] : path, documentId: document.id, sha256: document.checksum, byteSize: original.size, mimeType: original.type };
    const second = { ...first, documentId: secondDocument.id, file: scenario === "distinct" ? "originals/1" : scenario === "duplicate-string" || scenario === "reverse-mixed" ? path
      : scenario === "nested-array" ? [[path]] : scenario === "number" ? 0 : scenario === "null" ? null : scenario === "object" ? { path } : [path] };
    const originals = scenario === "single-array" ? [second] : [first, second];
    const zip = new JSZip();
    zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 2, media: [], documents: [document, secondDocument], originals }));
    zip.file(path, new Uint8Array(await original.arrayBuffer()), { createFolders: false });
    zip.file("originals/1", new Uint8Array(await original.arrayBuffer()), { createFolders: false });
    await saveSourceOriginal(document, original);
    const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "typed-original-path.zip");
    if (scenario === "distinct") {
      expect(JSON.parse((await readPortableBackup(file)).rawText).originals).toEqual(originals);
    } else {
      await expect(readPortableBackup(file)).rejects.toThrow("invalid or missing original-file record");
    }
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toBe("original source");
    expect(await readSourceOriginal(secondDocument.id, secondDocument.checksum)).toBeUndefined();
  });

  describe.each([1, 2])("ZIP version %s physical member identity", version => {
    it.each(["duplicate-media", "duplicate-workspace", "alias-first", "alias-last", "local-name", "count", "expanded", "valid"] as const)("checks %s before the ZIP map can collapse members", async scenario => {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const manifest = JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: version, media: [{ file: "media/0", metadata: { ...attachment, questionId: "held-question" } }], originals: [] });
      const alias = "media/../workspace.json";
      if (scenario === "alias-first") zip.file(alias, manifest, { createFolders: false });
      zip.file("workspace.json", manifest);
      if (scenario === "alias-last") zip.file(alias, manifest, { createFolders: false });
      zip.file("media/0", "AXOM", { createFolders: false });
      zip.file("media/1", "DIFF", { createFolders: false });
      if (scenario === "duplicate-workspace") zip.file("workspacE.json", manifest, { createFolders: false });
      const bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
      const view = new DataView(bytes.buffer);
      const end = bytes.length - 22, start = view.getUint32(end + 16, true);
      for (let cursor = start; cursor < end;) {
        const length = view.getUint16(cursor + 28, true);
        const name = String.fromCharCode(...bytes.subarray(cursor + 46, cursor + 46 + length));
        const local = view.getUint32(cursor + 42, true);
        if (scenario === "duplicate-media" && name === "media/1") {
          bytes[cursor + 46 + 6] = 48; bytes[local + 30 + 6] = 48;
        }
        if (scenario === "duplicate-workspace" && name === "workspacE.json") {
          bytes[cursor + 46 + 8] = 101; bytes[local + 30 + 8] = 101;
        }
        if (scenario === "local-name" && name === "media/1") bytes[local + 30 + 6] = 48;
        if (scenario === "expanded" && name === "media/1") view.setUint32(cursor + 24, 0x7fffffff, true);
        cursor += 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
      }
      if (scenario === "count") {
        view.setUint16(end + 8, 30001, true); view.setUint16(end + 10, 30001, true);
      }
      const file = new File([bytes.buffer], "physical.zip");
      await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
      if (scenario === "valid") {
        expect(JSON.parse((await readPortableBackup(file)).rawText).media).toHaveLength(1);
      } else {
        await expect(readPortableBackup(file)).rejects.toThrow(/ZIP member records|Too many files|safety limit/);
      }
      expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
    });
  });

  describe.each([1, 2])("ZIP version %s physical record consistency", version => {
    it.each(["store", "deflate", "stream-store", "stream-deflate", "flags", "method", "crc", "compressed-size", "size", "stream-crc", "descriptor-signature", "descriptor-crc", "descriptor-size", "hidden-member"] as const)("validates %s without changing existing media", async scenario => {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: version, media: [], originals: [] }));
      zip.file("media/0", "AXOM", { createFolders: false });
      const streamFiles = scenario.startsWith("stream-") || scenario.startsWith("descriptor-");
      let bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer", streamFiles, compression: scenario.includes("deflate") ? "DEFLATE" : "STORE" }));
      const view = new DataView(bytes.buffer);
      const end = bytes.length - 22, start = view.getUint32(end + 16, true);
      for (let cursor = start; cursor < end;) {
        const length = view.getUint16(cursor + 28, true);
        const name = String.fromCharCode(...bytes.subarray(cursor + 46, cursor + 46 + length));
        const local = view.getUint32(cursor + 42, true);
        const next = cursor + 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
        if (name === "media/0") {
          const descriptor = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + view.getUint32(cursor + 20, true);
          if (scenario === "flags") view.setUint16(local + 6, view.getUint16(local + 6, true) ^ 8, true);
          if (scenario === "method") view.setUint16(local + 8, 8, true);
          if (scenario === "crc" || scenario === "stream-crc") view.setUint32(local + 14, view.getUint32(cursor + 16, true) ^ 1, true);
          if (scenario === "compressed-size") view.setUint32(local + 18, 3, true);
          if (scenario === "size") view.setUint32(local + 22, 3, true);
          if (scenario === "descriptor-signature") view.setUint32(descriptor, 0, true);
          if (scenario === "descriptor-crc") view.setUint32(descriptor + 4, view.getUint32(descriptor + 4, true) ^ 1, true);
          if (scenario === "descriptor-size") view.setUint32(descriptor + 12, 3, true);
          if (scenario === "hidden-member") {
            // Remove only the directory record; the full local member survives.
            const shortened = new Uint8Array(bytes.length - (next - cursor));
            shortened.set(bytes.subarray(0, cursor));
            shortened.set(bytes.subarray(next), cursor);
            const footer = new DataView(shortened.buffer), newEnd = shortened.length - 22;
            footer.setUint16(newEnd + 8, 1, true);
            footer.setUint16(newEnd + 10, 1, true);
            footer.setUint32(newEnd + 12, view.getUint32(end + 12, true) - (next - cursor), true);
            bytes = shortened;
          }
          break;
        }
        cursor = next;
      }
      await putQuestionAttachmentBlob(attachment.blobKey, { blob: new Blob(["SAFE"]), mimeType: "image/png", byteSize: 4, questionId: "held-question", updatedAt: attachment.updatedAt });
      const file = new File([bytes.buffer], "record-consistency.zip");
      if (["store", "deflate", "stream-store", "stream-deflate"].includes(scenario)) {
        expect(JSON.parse((await readPortableBackup(file)).rawText).media).toEqual([]);
      } else {
        await expect(readPortableBackup(file)).rejects.toThrow("invalid or ambiguous ZIP member records");
      }
      expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.text()).toBe("SAFE");
    });
  });

  it("rejects unrelated ZIPs and missing media before allowing a workspace restore", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(); zip.file("catalog.json", "{}");
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "library.zip"))).rejects.toThrow("not an AXOM workspace backup");
    zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 1, media: [{ file: "media/0", metadata: { ...attachment, questionId: "held-question" } }] }));
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "damaged.zip"))).rejects.toThrow("invalid or missing image");
  });
});
