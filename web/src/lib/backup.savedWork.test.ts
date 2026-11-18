// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { exportStateWithAttachments, lastBackupAt, parseImport } from "./backup";
import { readPortableBackup } from "./backupArchive";
import { makeSeed } from "./seed";
import { sha256Hex } from "./checksum";
import { saveSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { ATTACHMENT_EXPORT_KEY, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob, setMissingAttachmentLoader, type QuestionImageAttachment } from "./questionAttachments";
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
      await putQuestionAttachmentBlob(a.blobKey, { blob: new Blob(["AXOM"]), mimeType: "image/png", byteSize: 4, questionId: "q", updatedAt: a.updatedAt });
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

  it("marks present but malformed image bytes incomplete in both ZIP and JSON exports", async () => {
    const { state, original } = await fixture();
    await saveSourceOriginal(state.documents[0], original);
    await putQuestionAttachmentBlob("unavailable-image", {
      blob: new Blob(["AXOM"], { type: "image/png" }),
      mimeType: "image/png", byteSize: 4, questionId: "q", updatedAt: attachment.updatedAt,
    });
    const originalDocuments = state.documents;
    const originalAttachments = state.questions[0].attachments;
    const damaged = [
      { label: "truncated bytes", blob: new Blob(["AX"], { type: "image/png" }), mimeType: "image/png" as const, byteSize: 2 },
      { label: "wrong record format", blob: new Blob(["AXOM"], { type: "image/png" }), mimeType: "image/jpeg" as const, byteSize: 4 },
      { label: "wrong blob format", blob: new Blob(["AXOM"], { type: "image/jpeg" }), mimeType: "image/png" as const, byteSize: 4 },
    ];
    for (const bad of damaged) {
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: bad.blob, mimeType: bad.mimeType, byteSize: bad.byteSize,
        questionId: "q", updatedAt: attachment.updatedAt,
      });
      for (const format of ["zip", "json"] as const) {
        localStorage.clear();
        state.documents = format === "zip" ? originalDocuments : [];
        const exportedCopy = await exportStateWithAttachments(state);
        expect(exportedCopy.missingBlobKeys, `${bad.label} in ${format}`).toEqual([attachment.blobKey]);
        expect(exportedCopy.attachmentCount).toBe(1);
        expect(filename.endsWith(`.${format}`)).toBe(true);
        expect(lastBackupAt()).toBeNull();
        expect(state.questions[0].attachments).toBe(originalAttachments);
      }
    }
  });

  it("deduplicates valid shared JSON images and refuses contradictory blob-key metadata in either order", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = []; // Force the small JSON export path, not ZIP.
    const first = { ...state.questions[0], attachments: [attachment] };
    const second = { ...first, id: "q-other", attachments: [{ ...attachment, id: "figure-other" }] };
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob(["AXOM"], { type: "image/png" }), mimeType: "image/png",
      byteSize: 4, questionId: "q", updatedAt: attachment.updatedAt,
    });

    state.questions = [first, second];
    const valid = await exportStateWithAttachments(state);
    expect(valid).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    expect(filename).toMatch(/\.json$/);
    expect(JSON.parse(await exported!.text())[ATTACHMENT_EXPORT_KEY]).toHaveLength(1);
    expect(lastBackupAt()).not.toBeNull();

    for (const conflicting of [
      { ...second, attachments: [{ ...attachment, id: "different-size", byteSize: 3 }] },
      { ...second, attachments: [{ ...attachment, id: "different-format", mimeType: "image/jpeg" as const }] },
    ]) {
      for (const reversed of [false, true]) {
        localStorage.clear();
        state.questions = reversed ? [conflicting, first] : [first, conflicting];
        const refused = await exportStateWithAttachments(state);
        expect(refused, `conflicting ${conflicting.attachments[0].id}, reversed=${reversed}`).toMatchObject({
          attachmentCount: 0, missingBlobKeys: [attachment.blobKey],
        });
        expect(filename).toMatch(/\.json$/);
        expect(JSON.parse(await exported!.text())[ATTACHMENT_EXPORT_KEY]).toBeUndefined();
        expect(lastBackupAt()).toBeNull();
        expect(await (await getQuestionAttachmentBlob(attachment.blobKey))?.blob.text()).toBe("AXOM");
        expect(state.questions).toHaveLength(2);
      }
    }
  });


  it("round-trips shared-key JSON bytes with coherent surviving-reference provenance and reversible staging", async () => {
    localStorage.clear();
    const { state } = await fixture();
    state.documents = [];
    const first = { ...state.questions[0], id: "q-first", attachments: [attachment] };
    const later = { ...state.questions[0], id: "q-later", attachments: [{
      ...attachment, id: "figure-later", updatedAt: "2026-11-15T00:00:00Z",
    }] };
    state.questions = [first, later];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob(["AXOM"], { type: "image/png" }),
      mimeType: "image/png", byteSize: 4, questionId: first.id, updatedAt: attachment.updatedAt,
    });

    expect(await exportStateWithAttachments(state)).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    expect(filename).toMatch(/\.json$/);
    const backup = await readPortableBackup(new File([exported!], filename));
    const imported = parseImport(backup.rawText);
    expect(imported.questions.map(q => q.attachments?.[0]?.updatedAt))
      .toEqual([attachment.updatedAt, later.attachments[0].updatedAt]);

    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();

    const staged = await backup.restoreMedia(imported.questions);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    const stored = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true });
    expect(await stored?.blob.text()).toBe("AXOM");
    expect(stored).toMatchObject({
      mimeType: "image/png", byteSize: 4,
      questionId: later.id, updatedAt: later.attachments[0].updatedAt,
    });
    const repeat = await backup.restoreMedia(imported.questions);
    expect(repeat).toMatchObject({ restored: 0, skipped: 1 });
    await repeat.rollback();
    expect(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))?.blob.text()).toBe("AXOM");
    await staged.rollback();
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
  });

  it("refuses historical JSON with contradictory shared-key media references before writing any bytes", async () => {
    const { state } = await fixture();
    state.documents = [];
    const first = { ...state.questions[0], attachments: [attachment] };
    const second = { ...state.questions[0], id: "q-second", attachments: [{
      ...attachment, id: "figure-second",
    }] };
    state.questions = [first, second];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob(["AXOM"], { type: "image/png" }),
      mimeType: "image/png", byteSize: 4, questionId: first.id, updatedAt: attachment.updatedAt,
    });
    expect(await exportStateWithAttachments(state)).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    const valid = JSON.parse(await exported!.text());

    for (const conflicting of [
      { ...second.attachments[0], byteSize: 3 },
      { ...second.attachments[0], mimeType: "image/jpeg" },
    ]) {
      for (const reversed of [false, true]) {
        const raw = structuredClone(valid);
        raw.questions = reversed ? [raw.questions[1], raw.questions[0]] : raw.questions;
        const conflictRef = raw.questions.find((q: { id: string }) => q.id === second.id);
        conflictRef.attachments = [conflicting];
        const backup = await readPortableBackup(new File([JSON.stringify(raw)], "historical.json"));
        const imported = parseImport(backup.rawText);
        await deleteQuestionAttachmentBlobs([attachment.blobKey]);
        await expect(backup.restoreMedia(imported.questions)).rejects.toThrow(/conflicting image references/i);
        expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
        expect(imported.questions).toHaveLength(2);
      }
    }
  });

});
