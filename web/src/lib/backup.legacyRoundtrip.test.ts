// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStateWithAttachments, lastBackupAt, parseImport } from "./backup";
import { readPortableBackup } from "./backupArchive";
import { sha256Hex } from "./checksum";
import { saveSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import {
  ATTACHMENT_EXPORT_KEY,
  deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob,
  putQuestionAttachmentBlob,
  type QuestionImageAttachment,
} from "./questionAttachments";
import { setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { makeSeed } from "./seed";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), char => char.charCodeAt(0));
const pngBlob = () => new Blob([PNG_BYTES.buffer as ArrayBuffer], { type: "image/png" });
const exampleImage: QuestionImageAttachment = {
  id: "sample-image", blobKey: "sample-image", fileName: "source.png", mimeType: "image/png",
  byteSize: PNG_BYTES.length, altText: "Fabricated recovery fixture",
  createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", role: "question",
};
const legacyImage = (id: string): QuestionImageAttachment => {
  const old: Partial<QuestionImageAttachment> = { ...exampleImage, id };
  delete old.blobKey;
  return old as QuestionImageAttachment;
};

let downloaded: Blob | undefined;
let downloadedName = "";

beforeEach(async () => {
  await openEmptyWorkspace();
  localStorage.clear();
  setQuestionAttachmentAccount(undefined);
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { downloaded = blob; return "blob:r109"; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloadedName = this.download;
  });
  downloaded = undefined;
  downloadedName = "";
});
afterEach(async () => {
  setQuestionAttachmentAccount(undefined);
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB);
    request.onsuccess = () => resolve();
  });
  await closeWorkspace();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function legacyExportState(id: string) {
  const state = makeSeed();
  state.questions = [{
    id: "legacy-question", stem: "Synthetic image-backed prompt", options: [{ key: "A", text: "Synthetic option" }],
    source: "manual", correctKey: "A", status: "unseen", tags: [], attempts: [], notes: "Retain this note",
    attachments: [legacyImage(id)],
    createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z",
  }];
  const original = new Blob(["Fabricated source bytes"], { type: "text/plain" });
  state.documents = [{
    id: "legacy-source", title: "Fabricated original", fileName: "synthetic.txt",
    fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Fabricated source bytes",
    sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()),
    tags: [], linkedQuestionSetIds: [], libraryOnly: true,
  }];
  await saveSourceOriginal(state.documents[0], original);
  return state;
}

describe("R109: legacy id-only image completeness at the portable export/import boundary", () => {
  it("discloses missing root and deferred legacy images in a complete JSON backup before restore", async () => {
    const raw = {
      _app: "AXOM", _backupScope: "complete",
      questions: [{ id: "root-question", attachments: [legacyImage("legacy-root")] }],
      deferredContent: { questions: [{ id: "deferred-question", attachments: [legacyImage("legacy-deferred")] }] },
    };
    const backup = await readPortableBackup(new File([JSON.stringify(raw)], "legacy-incomplete.json"));
    expect(backup.omissions).toEqual({
      missingBlobKeys: ["legacy-root", "legacy-deferred"], missingOriginalIds: [],
    });
    expect(JSON.parse(backup.rawText).questions[0].attachments[0].blobKey).toBeUndefined();
  });

  it("does not misreport a JSON image whose embedded bytes match a legacy id-only reference", async () => {
    const id = "legacy-json-present";
    const raw = {
      _app: "AXOM", _backupScope: "complete", terms: [],
      questions: [{ id: "json-question", attachments: [legacyImage(id)] }],
      [ATTACHMENT_EXPORT_KEY]: [{ ...exampleImage, id, blobKey: id, questionId: "json-question", base64: PNG_BASE64 }],
    };
    const backup = await readPortableBackup(new File([JSON.stringify(raw)], "legacy-complete.json"));
    expect(backup.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    const parsed = parseImport(backup.rawText);
    expect(parsed.questions[0].attachments?.[0].blobKey).toBe(id);
    expect(await backup.restoreMedia([{ id: "json-question", attachments: parsed.questions[0].attachments }]))
      .toMatchObject({ restored: 1, skipped: 0 });
    const recovered = await getQuestionAttachmentBlob(id);
    expect(new Uint8Array(await recovered!.blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("round-trips a legacy id-only image from a complete ZIP without changing learner source metadata", async () => {
    const id = "legacy-zip-present";
    const state = await legacyExportState(id);
    await putQuestionAttachmentBlob(id, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "legacy-question", updatedAt: exampleImage.updatedAt,
    });
    const exported = await exportStateWithAttachments(state);
    expect(exported).toMatchObject({ attachmentCount: 1, missingBlobKeys: [], originalCount: 1, missingOriginalIds: [] });
    expect(downloadedName).toMatch(/\.zip$/);
    expect(lastBackupAt()).not.toBeNull();
    expect(state.questions[0].attachments![0].blobKey).toBeUndefined();
    const backup = await readPortableBackup(new File([downloaded!], downloadedName));
    expect(backup.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    const source = JSON.parse(backup.rawText);
    expect(source.questions[0].attachments[0].blobKey).toBeUndefined();
    const imported = parseImport(backup.rawText);
    expect(imported.questions[0].attachments?.[0].blobKey).toBe(id);
    expect(imported.questions[0].notes).toBe("Retain this note");
    await deleteQuestionAttachmentBlobs([id]);
    expect(await getQuestionAttachmentBlob(id)).toBeUndefined();
    expect(await backup.restoreMedia([{ id: "legacy-question", attachments: imported.questions[0].attachments }]))
      .toMatchObject({ restored: 1, skipped: 0 });
    const recovered = await getQuestionAttachmentBlob(id);
    expect(new Uint8Array(await recovered!.blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("discloses absent id-only bytes in a declared complete exported ZIP and withholds a complete receipt", async () => {
    const id = "legacy-zip-missing";
    const state = await legacyExportState(id);
    const exported = await exportStateWithAttachments(state);
    expect(exported).toMatchObject({ attachmentCount: 0, missingBlobKeys: [id], originalCount: 1, missingOriginalIds: [] });
    expect(downloadedName).toMatch(/\.zip$/);
    expect(lastBackupAt()).toBeNull();
    const backup = await readPortableBackup(new File([downloaded!], downloadedName));
    expect(backup.omissions).toEqual({ missingBlobKeys: [id], missingOriginalIds: [] });
  });
});
