// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { deflateSync } from "node:zlib";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal, deleteSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import type { SourceDocument } from "./library";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { MAX_ZIP_BACKUP_BYTES, MAX_ZIP_BACKUP_ENTRIES, assertRestorableZipBudget, assertRestorableZipEntryCounts, projectedZipSerializedOverhead, preflightRestorableZipCandidateBudget, backupOriginalDocuments, collectVerifiedMediaBackupPayloads, createMediaBackupArchive, mediaBackupBytes, readPortableBackup } from "./backupArchive";
import { ATTACHMENT_EXPORT_KEY, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob, type QuestionImageAttachment } from "./questionAttachments";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), char => char.charCodeAt(0));

function crcCorrectPngWithIdat(data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set([73, 68, 65, 84], 4); // IDAT
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.byteLength; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(8 + data.byteLength, (crc ^ 0xffffffff) >>> 0);
  return Uint8Array.from([...PNG_BYTES.subarray(0, 33), ...chunk, ...PNG_BYTES.subarray(-12)]);
}

/** Build CRC-correct 1x1 PNGs so tests exercise semantic palette admission,
 * not a corrupted checksum or an incidental decoder failure. */
function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = name.charCodeAt(i);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
function palettePng(palettes: readonly Uint8Array[], options: {
  afterIdat?: boolean; color?: number; bitDepth?: 1 | 2 | 4 | 8;
  pixelIndex?: number; interlace?: 0 | 1; width?: number; height?: number;
  inflatedRows?: Uint8Array;
} = {}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width ?? 1); view.setUint32(4, options.height ?? 1);
  const depth = options.bitDepth ?? 1;
  ihdr[8] = depth; ihdr[9] = options.color ?? 3; ihdr[12] = options.interlace ?? 0;
  const paletteChunks = palettes.map(palette => pngChunk("PLTE", palette));
  // One packed sample by default; supplied rows exercise PNG filter reconstruction.
  const inflated = options.inflatedRows ?? Uint8Array.from([0, (options.pixelIndex ?? 0) << (8 - depth)]);
  const idat = pngChunk("IDAT", deflateSync(inflated));
  return Uint8Array.from([
    ...PNG_BYTES.subarray(0, 8), ...pngChunk("IHDR", ihdr),
    ...(!options.afterIdat ? paletteChunks.flatMap(chunk => [...chunk]) : []),
    ...idat,
    ...(options.afterIdat ? paletteChunks.flatMap(chunk => [...chunk]) : []),
    ...pngChunk("IEND", new Uint8Array()),
  ]);
}

/** Pack one nonzero sample in the final Adam7 pass while all earlier
 * passes contain legal index-zero pixels. This catches pass-order blind spots. */
function lateAdam7IndexedRows(width: number, height: number, depth: 1 | 2 | 4 | 8): Uint8Array {
  const passes = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ];
  const raw: number[] = [];
  for (const [pass, [x, y, dx, dy]] of passes.entries()) {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    for (let row = 0; row < h; row++) {
      const packed = new Uint8Array(Math.ceil(w * depth / 8));
      if (pass === 6 && row === h - 1) {
        const bit = (w - 1) * depth;
        packed[bit >>> 3] = 1 << (8 - depth - (bit & 7));
      }
      raw.push(0, ...packed); // filter None
    }
  }
  return Uint8Array.from(raw);
}

const pngBlob = () => new Blob([PNG_BYTES.buffer as ArrayBuffer], { type: "image/png" });
const attachment: QuestionImageAttachment = { id: "figure", blobKey: "private-library:figure", fileName: "figure.png", mimeType: "image/png", byteSize: PNG_BYTES.length, altText: "Test figure", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", role: "question" };
const refs = [{ id: "held-question", attachments: [attachment] }];
beforeEach(async () => { await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile); });
afterEach(async () => {
  await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase(SOURCE_ORIGINALS_DB); request.onsuccess = () => resolve(); });
  await closeWorkspace();
});

describe("portable binary media backup", () => {

  it("matches ZIP entry acceptance at 30,000 including real JSZip directory and original entries", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("workspace.json", "{}");
    zip.file("media/0", PNG_BYTES);
    zip.file("originals/0", "source");
    // Count actual JSZip entries, including any implicit directory records.
    const initialEntries = Object.keys(zip.files).length;
    expect(initialEntries).toBeGreaterThanOrEqual(3);
    for (let index = 1; index <= 30_000 - initialEntries; index++) {
      zip.file(`media/${index}`, "");
    }
    const exactlyAccepted = Object.keys(zip.files).length;
    expect(exactlyAccepted).toBe(30_000);
    expect(() => assertRestorableZipBudget(exactlyAccepted, 12)).not.toThrow();
    zip.file("media/over-the-limit", "");
    expect(Object.keys(zip.files)).toHaveLength(30_001);
    expect(() => assertRestorableZipBudget(Object.keys(zip.files).length, 12))
      .toThrow(/30,000.*entries/i);
  }, 60_000);

  it("matches both 2 GiB ZIP expanded and serialized archive limits without allocating gigabytes", () => {
    const twoGiB = 2 * 1024 * 1024 * 1024;
    expect(() => assertRestorableZipBudget(3, twoGiB)).not.toThrow();
    expect(() => assertRestorableZipBudget(3, twoGiB + 1)).toThrow(/expanded.*2 GB/i);
    expect(() => assertRestorableZipBudget(3, 10, twoGiB)).not.toThrow();
    expect(() => assertRestorableZipBudget(3, 10, twoGiB + 1)).toThrow(/archive.*2 GB/i);
    expect(() => assertRestorableZipBudget(3, Number.POSITIVE_INFINITY)).toThrow(/expanded.*2 GB/i);
  });

  it("rejects an oversized serialized ZIP before returning any downloadable backup", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const originalSize = Object.getOwnPropertyDescriptor(NativeBlob.prototype, "size")!.get!;
    vi.spyOn(NativeBlob.prototype, "size", "get").mockImplementation(function (this: Blob) {
      const real = originalSize.call(this) as number;
      return this.type === "application/zip" ? 2 * 1024 * 1024 * 1024 + 1 : real;
    });
    try {
      await expect(createMediaBackupArchive({}, refs)).rejects.toThrow(/archive.*2 GB/i);
    } finally {
      vi.restoreAllMocks();
    }
  });


  it("discloses missing ZIP image and checksum-original bytes from source references even with a complete scope label", async () => {
    const originalBytes = new Blob(["Synthetic absent source bytes"], { type: "text/plain" });
    const document: SourceDocument = {
      id: "missing-original", title: "Uncached source", fileName: "uncached.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Metadata retained",
      sizeBytes: originalBytes.size, checksum: await sha256Hex(await originalBytes.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    // No original or image is saved: only their references survive in the ZIP.
    const exported = await createMediaBackupArchive(
      { _app: "AXOM", _backupScope: "complete", documents: [document], questions: refs },
      refs, [document],
    );
    const backup = await readPortableBackup(new File([exported.blob], "partial.zip"));
    expect(backup.omissions).toEqual({
      missingBlobKeys: [attachment.blobKey],
      missingOriginalIds: [document.id],
    });
    expect(JSON.parse(backup.rawText)._backupScope).toBe("complete");
    expect(JSON.parse(backup.rawText).documents[0].checksum).toBe(document.checksum);
    expect(await backup.restoreOriginals([document])).toEqual({ restored: 0, skipped: 0 });
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
  });

  it("discloses omitted private-review images even when their review document has no original checksum", async () => {
    const review: SourceDocument = {
      id: "review-document-no-checksum", title: "Private review metadata",
      fileName: "review.json", fileType: "axom-private-bank-review",
      uploadedAt: "2026-11-15", sizeBytes: 0, tags: [],
      linkedQuestionSetIds: [], libraryOnly: true,
      rawText: JSON.stringify({ pkg: { questions: [{
        id: "review-question", assets: [{
          id: "private-review-image", checksum: "unavailable-review-image",
          mimeType: "image/png", filename: "review.png",
          byteSize: PNG_BYTES.length, role: "question",
        }],
      }] } }),
    };
    const exported = await createMediaBackupArchive(
      { _app: "AXOM", _backupScope: "complete", documents: [review], questions: [] },
      [], [review],
    );
    const backup = await readPortableBackup(new File([exported.blob], "private-review-partial.zip"));
    expect(backup.omissions).toEqual({
      missingBlobKeys: ["private-library:unavailable-review-image"],
      missingOriginalIds: [],
    });
  });

  it.each([1, 2] as const)(
    "discloses missing root and deferred legacy id-only image references from v%d ZIPs", async version => {
      const legacyAttachment = (id: string) => {
        const old: Partial<QuestionImageAttachment> = { ...attachment, id };
        delete old.blobKey;
        return old;
      };
      // Old payloads may have no blobKey even when id, MIME, timestamps, and size
      // are valid. Import normalizes their storage key to id.
      const payload = {
        _app: "AXOM", _backupScope: "complete",
        questions: [{ id: "legacy-root-question", attachments: [legacyAttachment("legacy-root-image")] }],
        deferredContent: {
          questions: [{ id: "legacy-deferred-question", attachments: [legacyAttachment("legacy-deferred-image")] }],
        },
      };
      const exported = await createMediaBackupArchive(payload, [], []);
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
      const workspace = JSON.parse(await zip.file("workspace.json")!.async("string"));
      workspace._backupVersion = version;
      zip.file("workspace.json", JSON.stringify(workspace));
      const backup = await readPortableBackup(
        new File([await zip.generateAsync({ type: "blob" })], `legacy-v${version}.zip`),
      );
      expect(backup.omissions).toEqual({
        missingBlobKeys: ["legacy-root-image", "legacy-deferred-image"],
        missingOriginalIds: [],
      });
      expect(JSON.parse(backup.rawText)._backupScope).toBe("complete");
    },
  );

  it("does not falsely report a legacy id-only image when matching ZIP bytes exist", async () => {
    const legacyId = "legacy-present-image";
    const historical: Partial<QuestionImageAttachment> = { ...attachment, id: legacyId };
    delete historical.blobKey;
    await putQuestionAttachmentBlob(legacyId, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "legacy-present-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive(
      { _app: "AXOM", _backupScope: "complete",
        questions: [{ id: "legacy-present-question", attachments: [historical] }] },
      [{ id: "legacy-present-question", attachments: [{ ...attachment, id: legacyId, blobKey: legacyId }] }],
    );
    const backup = await readPortableBackup(new File([exported.blob], "legacy-present.zip"));
    expect(backup.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
  });

  it("does not claim omitted ZIP files for complete available assets or accept an archive label as integrity proof", async () => {
    const original = new Blob(["Available source bytes"], { type: "text/plain" });
    const document: SourceDocument = {
      id: "available-original", title: "Available", fileName: "available.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Available source bytes",
      sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(document, original);
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive(
      { _app: "AXOM", _backupScope: "complete", documents: [document], questions: refs },
      refs, [document],
    );
    const complete = await readPortableBackup(new File([exported.blob], "complete.zip"));
    expect(complete.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    // An older or manually modified archive may omit the media entry while retaining
    // an unchanged complete label. The reader must re-derive rather than trust it.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    zip.remove(manifest.media[0].file);
    manifest.media = [];
    zip.file("workspace.json", JSON.stringify(manifest));
    const truncated = await readPortableBackup(new File([await zip.generateAsync({ type: "blob" })], "older-partial.zip"));
    expect(truncated.omissions.missingBlobKeys).toEqual([attachment.blobKey]);
    expect(truncated.omissions.missingOriginalIds).toEqual([]);
  });

  it("round-trips images with two verified originals and supports staged image rollback", async () => {
    const firstBlob = new Blob(["first source"], { type: "text/plain" });
    const secondBlob = new Blob(["second source"], { type: "text/plain" });
    const document = async (id: string, blob: Blob): Promise<SourceDocument> => ({
      id, title: id, fileName: `${id}.txt`, fileType: "text/plain",
      uploadedAt: "2026-10-13", rawText: await blob.text(),
      sizeBytes: blob.size, checksum: await sha256Hex(await blob.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    });
    const first = await document("first-original", firstBlob);
    const second = await document("second-original", secondBlob);
    await saveSourceOriginal(first, firstBlob);
    await saveSourceOriginal(second, secondBlob);
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({ documents: [first, second] }, refs, [first, second]);
    expect(exported).toMatchObject({
      attachmentCount: 1, originalCount: 2, missingBlobKeys: [], missingOriginalIds: [],
    });
    const portable = await readPortableBackup(new File([exported.blob], "mixed-originals.zip"));
    await deleteSourceOriginal(first.id);
    await deleteSourceOriginal(second.id);
    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const staged = await portable.restoreMedia(refs);
    expect(staged).toMatchObject({ restored: 1, skipped: 0 });
    expect(await portable.restoreOriginals([first, second])).toEqual({ restored: 2, skipped: 0 });
    expect(await (await readSourceOriginal(first.id, first.checksum))?.text()).toBe("first source");
    expect(await (await readSourceOriginal(second.id, second.checksum))?.text()).toBe("second source");
    const recovered = await getQuestionAttachmentBlob(attachment.blobKey);
    expect(new Uint8Array(await recovered!.blob.arrayBuffer())).toEqual(PNG_BYTES);
    await staged.rollback();
    expect(await getQuestionAttachmentBlob(attachment.blobKey)).toBeUndefined();
  });

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

  it.each([
    { label: "MIME", change: { mimeType: "image/jpeg" as const } },
    { label: "byte size", change: { byteSize: PNG_BYTES.length + 1 } },
  ])("rejects ZIP media with a contradictory workspace $label before consent", async ({ change }) => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    // The archived media itself is valid; only the workspace reference lies.
    const exported = await createMediaBackupArchive({
      _app: "AXOM",
      questions: [{ id: "held-question", attachments: [{ ...attachment, ...change }] }],
    }, refs);
    expect(exported).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    await expect(readPortableBackup(new File([exported.blob], "zip-reference-conflict.zip")))
      .rejects.toThrow(/ZIP backup image does not match its reference/i);
  });

  it("rejects contradictory shared-key ZIP references before consent even when image bytes are missing", async () => {
    const conflicting = { ...attachment, id: "second-figure", byteSize: attachment.byteSize + 1 };
    const questions = [
      { id: "held-question", attachments: [attachment] },
      { id: "other-question", attachments: [conflicting] },
    ];
    const exported = await createMediaBackupArchive({ _app: "AXOM", questions }, questions);
    expect(exported).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
    await expect(readPortableBackup(new File([exported.blob], "zip-references-conflict.zip")))
      .rejects.toThrow(/conflicting image metadata/i);
  });

  it("accepts matching shared-key ZIP references while disclosing only truly omitted media", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const missing = { ...attachment, id: "missing-figure", blobKey: "private-library:missing-figure" };
    const questions = [
      { id: "held-question", attachments: [attachment, missing] },
      { id: "other-question", attachments: [{ ...attachment, id: "second-use" }] },
    ];
    const exported = await createMediaBackupArchive({ _app: "AXOM", questions }, questions);
    expect(exported).toMatchObject({ attachmentCount: 1, missingBlobKeys: [missing.blobKey] });
    const backup = await readPortableBackup(new File([exported.blob], "zip-compatible-references.zip"));
    expect(backup.omissions).toEqual({ missingBlobKeys: [missing.blobKey], missingOriginalIds: [] });
  });

  it.each(["duplicate storage key", "duplicate archive path"] as const)(
    "rejects a ZIP with %s media entries before exposing workspace state", async kind => {
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const exported = await createMediaBackupArchive({}, refs);
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
      const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
      const original = manifest.media[0];
      if (kind === "duplicate storage key") {
        zip.file("media/1", PNG_BYTES);
        manifest.media.push({ ...original, file: "media/1" });
      } else {
        manifest.media.push({
          ...original,
          metadata: { ...original.metadata, blobKey: "private-library:another-figure" },
        });
      }
      zip.file("workspace.json", JSON.stringify(manifest));
      const ambiguous = await zip.generateAsync({ type: "blob" });
      await expect(readPortableBackup(new File([ambiguous], "ambiguous.zip")))
        .rejects.toThrow(/duplicate image/i);
    },
  );

  it.each(["non-image payload", "CRC-correct PNG with invalid zlib data"] as const)(
    "rejects a ZIP with %s before exposing workspace data", async defect => {
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const exported = await createMediaBackupArchive({}, refs);
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
      const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
      // Keep the manifest internally consistent; a byte-length-only guard
      // must not be allowed to stand in for actual media integrity.
      const damaged = defect === "non-image payload"
        ? new Uint8Array(PNG_BYTES.length)
        : crcCorrectPngWithIdat(Uint8Array.from([0, 1, 2, 3]));
      manifest.media[0].metadata.byteSize = damaged.byteLength;
      zip.file("media/0", damaged);
      zip.file("workspace.json", JSON.stringify(manifest));
      const corrupted = await zip.generateAsync({ type: "blob" });
      await expect(readPortableBackup(new File([corrupted], "corrupted.zip")))
        .rejects.toThrow(/backup image failed.*integrity/i);
    },
  );

  it("accepts distinct legacy ZIP media IDs when both omit an explicit blobKey", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({}, refs);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    const original = manifest.media[0];
    delete original.metadata.blobKey;
    manifest.media.push({
      file: "media/1",
      metadata: { ...original.metadata, id: "legacy-second", questionId: "second-use" },
    });
    zip.file("media/1", PNG_BYTES);
    manifest._backupVersion = 1;
    zip.file("workspace.json", JSON.stringify(manifest));
    const legacy = await zip.generateAsync({ type: "blob" });
    await expect(readPortableBackup(new File([legacy], "legacy.zip")))
      .resolves.toMatchObject({ rawText: expect.any(String), restoreMedia: expect.any(Function) });
  });

  it.each(["same-size non-image", "CRC-correct PNG with invalid zlib", "truncated PNG payload"] as const)(
    "rejects a JSON backup with %s before exposing workspace state", async defect => {
      const bytes = defect === "same-size non-image" ? new Uint8Array(PNG_BYTES.length)
        : defect === "CRC-correct PNG with invalid zlib" ? crcCorrectPngWithIdat(Uint8Array.from([0, 1, 2, 3]))
          : PNG_BYTES;
      const base64 = defect === "truncated PNG payload" ? PNG_BASE64.slice(0, -8)
        : btoa(String.fromCharCode(...bytes));
      const raw = {
        _app: "AXOM",
        [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", byteSize: bytes.length, base64 }],
      };
      await expect(readPortableBackup(new File([JSON.stringify(raw)], "corrupt.json")))
        .rejects.toThrow(/backup image failed.*integrity/i);
    },
  );

  it.each(["declared MIME", "declared byte size"] as const)(
    "rejects embedded JSON media with incompatible %s before asking to replace the workspace",
    async defect => {
      // A structurally valid embedded PNG cannot certify a reference claiming
      // JPEG bytes or an incompatible size, even when its storage key exists.
      const referenced = defect === "declared MIME"
        ? { ...attachment, mimeType: "image/jpeg" as const }
        : { ...attachment, byteSize: attachment.byteSize + 1 };
      const raw = {
        _app: "AXOM",
        questions: [{ id: "held-question", attachments: [referenced] }],
        [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "held-question", base64: PNG_BASE64 }],
      };
      await expect(readPortableBackup(new File([JSON.stringify(raw)], "mismatched-reference.json")))
        .rejects.toThrow(/image.*reference|conflicting image metadata/i);
    },
  );

  it("rejects conflicting shared-key JSON references before asking for recovery consent", async () => {
    const raw = {
      _app: "AXOM",
      questions: [
        { id: "question-a", attachments: [{ ...attachment, id: "first-use" }] },
        { id: "question-b", attachments: [{ ...attachment, id: "second-use", byteSize: attachment.byteSize + 1 }] },
      ],
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, id: "first-use", questionId: "question-a", base64: PNG_BASE64 }],
    };
    await expect(readPortableBackup(new File([JSON.stringify(raw)], "conflicting-references.json")))
      .rejects.toThrow(/conflicting image metadata/i);
  });

  it("accepts consistent shared-key JSON references without a false omission", async () => {
    const raw = {
      _app: "AXOM",
      questions: [
        { id: "question-a", attachments: [{ ...attachment, id: "first-use" }] },
        { id: "question-b", attachments: [{ ...attachment, id: "second-use" }] },
      ],
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, id: "first-use", questionId: "question-a", base64: PNG_BASE64 }],
    };
    const recovered = await readPortableBackup(new File([JSON.stringify(raw)], "consistent-references.json"));
    expect(recovered.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
  });

  it("rejects a malformed embedded JSON image record instead of silently omitting it", async () => {
    const raw = {
      _app: "AXOM",
      [ATTACHMENT_EXPORT_KEY]: [{ ...attachment, questionId: "", base64: PNG_BASE64 }],
    };
    await expect(readPortableBackup(new File([JSON.stringify(raw)], "malformed.json")))
      .rejects.toThrow(/invalid or missing image record/i);
  });

  it.each(["different bytes", "different declared size"] as const)(
    "rejects JSON images sharing a storage key with %s before workspace adoption", async conflict => {
      const first = palettePng([Uint8Array.from([12, 34, 56])]);
      const second = conflict === "different bytes"
        ? palettePng([Uint8Array.from([13, 34, 56])])
        : palettePng([Uint8Array.from([12, 34, 56, 78, 90, 12])]);
      const asBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
      const raw = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: [
        { ...attachment, id: "first-use", questionId: "question-a", blobKey: "shared:figure", byteSize: first.length, base64: asBase64(first) },
        { ...attachment, id: "second-use", questionId: "question-b", blobKey: "shared:figure", byteSize: second.length, base64: asBase64(second) },
      ] };
      await expect(readPortableBackup(new File([JSON.stringify(raw)], "ambiguous.json")))
        .rejects.toThrow(/conflicting image records/i);
    },
  );

  it("accepts identical JSON media shared by two question references and restores one immutable blob", async () => {
    const bytes = palettePng([Uint8Array.from([12, 34, 56])]);
    const base64 = btoa(String.fromCharCode(...bytes));
    const shared = { ...attachment, blobKey: "shared:figure", byteSize: bytes.length };
    const raw = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: [
      { ...shared, id: "first-use", questionId: "question-a", base64 },
      { ...shared, id: "second-use", questionId: "question-b", base64 },
    ] };
    const backup = await readPortableBackup(new File([JSON.stringify(raw)], "shared.json"));
    const references = [
      { id: "question-a", attachments: [{ ...shared, id: "first-use" }] },
      { id: "question-b", attachments: [{ ...shared, id: "second-use" }] },
    ];
    const staged = await backup.restoreMedia(references);
    expect(staged).toMatchObject({ restored: 1, skipped: 1 });
    const recovered = await getQuestionAttachmentBlob(shared.blobKey);
    expect(new Uint8Array(await recovered!.blob.arrayBuffer())).toEqual(bytes);
    await staged.rollback();
    expect(await getQuestionAttachmentBlob(shared.blobKey)).toBeUndefined();
  });

  it("rejects oversized JSON files before reading or parsing their contents", async () => {
    const file = new File(["{}"], "oversize.json");
    Object.defineProperty(file, "size", { value: 256 * 1024 * 1024 + 1 });
    const read = vi.spyOn(file, "text");
    await expect(readPortableBackup(file)).rejects.toThrow(/256 MB safety limit/i);
    expect(read).not.toHaveBeenCalled();
  });

  it("bounds JSON image-list count before normalizing and inflating thousands of records", async () => {
    const entries = Array.from({ length: 4097 }, (_, i) => ({
      ...attachment, id: `image-${i}`, questionId: `question-${i}`, base64: PNG_BASE64,
    }));
    const raw = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: entries };
    await expect(readPortableBackup(new File([JSON.stringify(raw)], "too-many.json")))
      .rejects.toThrow(/too many image records/i);
  });

  it("rejects cumulative declared JSON image work before allocating image buffers", async () => {
    const entries = Array.from({ length: 17 }, (_, i) => ({
      ...attachment, id: `image-${i}`, questionId: `question-${i}`,
      blobKey: `unique-${i}`, byteSize: 8 * 1024 * 1024, base64: PNG_BASE64,
    }));
    const raw = { _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: entries };
    await expect(readPortableBackup(new File([JSON.stringify(raw)], "oversized-images.json")))
      .rejects.toThrow(/total image size exceeds the 128 MB/i);
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


  it("round-trips a valid indexed PNG through ZIP and JSON with identical recovered bytes", async () => {
    const bytes = palettePng([Uint8Array.from([12, 34, 56])]);
    const references = [{ id: "held-question", attachments: [{ ...attachment, byteSize: bytes.length }] }];
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
      mimeType: "image/png", byteSize: bytes.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const zip = await createMediaBackupArchive({}, references);
    const json = await collectVerifiedMediaBackupPayloads(references);
    expect(zip).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    expect(json).toMatchObject({ missingBlobKeys: [] });
    expect(json.payloads).toHaveLength(1);

    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const jsonBackup = await readPortableBackup(new File([
      JSON.stringify({ _app: "AXOM", [ATTACHMENT_EXPORT_KEY]: json.payloads }),
    ], "indexed.json"));
    expect(await jsonBackup.restoreMedia(references)).toMatchObject({ restored: 1, skipped: 0 });
    expect(new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())).toEqual(bytes);

    await deleteQuestionAttachmentBlobs([attachment.blobKey]);
    const zipBackup = await readPortableBackup(new File([zip.blob], "indexed.zip"));
    expect(await zipBackup.restoreMedia(references)).toMatchObject({ restored: 1, skipped: 0 });
    expect(new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())).toEqual(bytes);
  });

  it("holds malformed or forbidden PLTE chunks in both ZIP and JSON export", async () => {
    const rgb = Uint8Array.from([12, 34, 56]);
    const invalid = [
      { label: "empty palette", bytes: palettePng([new Uint8Array()]) },
      { label: "incomplete RGB entry", bytes: palettePng([Uint8Array.from([1, 2, 3, 4])]) },
      { label: "too many entries for indexed bit depth", bytes: palettePng([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])]) },
      { label: "duplicate palette", bytes: palettePng([rgb, rgb]) },
      { label: "palette after image data", bytes: palettePng([rgb], { afterIdat: true }) },
      { label: "palette forbidden in grayscale", bytes: palettePng([rgb], { color: 0 }) },
    ];
    for (const { label, bytes } of invalid) {
      const references = [{ id: "held-question", attachments: [{ ...attachment, byteSize: bytes.length }] }];
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
        mimeType: "image/png", byteSize: bytes.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const zip = await createMediaBackupArchive({}, references);
      const json = await collectVerifiedMediaBackupPayloads(references);
      expect(zip.attachmentCount, label).toBe(0);
      expect(zip.missingBlobKeys, label).toEqual([attachment.blobKey]);
      expect(json.payloads, label).toEqual([]);
      expect(json.missingBlobKeys, label).toEqual([attachment.blobKey]);
    }
  });

  it("rejects palette indices absent from CRC-correct 1/2/4/8-bit indexed pixels, including Adam7", async () => {
    const palette = Uint8Array.from([12, 34, 56]); // one legal palette entry: index 0 only
    for (const depth of [1, 2, 4, 8] as const) {
      for (const interlace of [0, 1] as const) {
        const bytes = palettePng([palette], { bitDepth: depth, pixelIndex: 1, interlace });
        const references = [{ id: "held-question", attachments: [{ ...attachment, byteSize: bytes.length }] }];
        await putQuestionAttachmentBlob(attachment.blobKey, {
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
          mimeType: "image/png", byteSize: bytes.length,
          questionId: "held-question", updatedAt: attachment.updatedAt,
        });
        const zip = await createMediaBackupArchive({}, references);
        const json = await collectVerifiedMediaBackupPayloads(references);
        expect(zip.attachmentCount, `depth ${depth} interlace ${interlace}`).toBe(0);
        expect(zip.missingBlobKeys).toEqual([attachment.blobKey]);
        expect(json.payloads).toEqual([]);
        expect(json.missingBlobKeys).toEqual([attachment.blobKey]);
      }
    }
  });

  it("checks nonfirst Adam7 passes and cross-byte packed palette indices", async () => {
    const palettes = [
      Uint8Array.from([12, 34, 56]), // index 1 missing
      Uint8Array.from([12, 34, 56, 78, 90, 12]), // index 1 present
    ];
    for (const depth of [1, 2, 4, 8] as const) {
      const rows = lateAdam7IndexedRows(9, 5, depth);
      for (const palette of palettes) {
        const valid = palette.length === 6;
        const bytes = palettePng([palette], {
          bitDepth: depth, width: 9, height: 5, interlace: 1, inflatedRows: rows,
        });
        const references = [{ id: "held-question", attachments: [{ ...attachment, byteSize: bytes.length }] }];
        await putQuestionAttachmentBlob(attachment.blobKey, {
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
          mimeType: "image/png", byteSize: bytes.length,
          questionId: "held-question", updatedAt: attachment.updatedAt,
        });
        const zip = await createMediaBackupArchive({}, references);
        const json = await collectVerifiedMediaBackupPayloads(references);
        expect(zip.attachmentCount, `Adam7 depth ${depth} palette ${palette.length / 3}`).toBe(valid ? 1 : 0);
        expect(zip.missingBlobKeys).toEqual(valid ? [] : [attachment.blobKey]);
        expect(json.payloads.length).toBe(valid ? 1 : 0);
        expect(json.missingBlobKeys).toEqual(valid ? [] : [attachment.blobKey]);
      }
    }
  });

  it("reconstructs filtered indexed rows before checking palette cardinality", async () => {
    const palette = Uint8Array.from([12, 34, 56, 78, 90, 12]); // indices 0 and 1
    const samples = [
      { label: "valid Sub/Up/Average/Paeth filters", valid: true,
        bytes: palettePng([palette], { bitDepth: 8, width: 2, height: 5,
          inflatedRows: Uint8Array.from([
            0, 0, 1, // None => [0,1]
            1, 0, 1, // Sub  => [0,1]
            2, 0, 0, // Up   => [0,1]
            3, 0, 1, // Average => [0,1]
            4, 0, 0, // Paeth => [0,1]
          ]) }) },
      { label: "Up filter reconstructs invalid index 2", valid: false,
        bytes: palettePng([palette], { bitDepth: 8, width: 2, height: 2,
          inflatedRows: Uint8Array.from([0, 0, 1, 2, 0, 1]) }) },
      { label: "valid Adam7 index 1", valid: true,
        bytes: palettePng([palette], { interlace: 1, pixelIndex: 1 }) },
    ];
    for (const { label, valid, bytes } of samples) {
      const references = [{ id: "held-question", attachments: [{ ...attachment, byteSize: bytes.length }] }];
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
        mimeType: "image/png", byteSize: bytes.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const zip = await createMediaBackupArchive({}, references);
      const json = await collectVerifiedMediaBackupPayloads(references);
      expect(zip.attachmentCount, label).toBe(valid ? 1 : 0);
      expect(json.payloads.length, label).toBe(valid ? 1 : 0);
      expect(zip.missingBlobKeys, label).toEqual(valid ? [] : [attachment.blobKey]);
      expect(json.missingBlobKeys, label).toEqual(valid ? [] : [attachment.blobKey]);
      if (valid) {
        await deleteQuestionAttachmentBlobs([attachment.blobKey]); // only synthetic fixture
        const portable = await readPortableBackup(new File([zip.blob], "indexed-verified.zip"));
        expect(await portable.restoreMedia(references)).toMatchObject({ restored: 1, skipped: 0 });
        expect(new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())).toEqual(bytes);
      }
    }
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

  it("does not certify CRC-correct empty, invalid-zlib or undecodable PNG scanlines", async () => {
    for (const idat of [
      new Uint8Array(), // No compressed image data
      Uint8Array.from([0x78, 0x9c, 1, 2, 3]), // Invalid zlib stream, valid PNG chunk CRC
      deflateSync(Uint8Array.from([5, 0, 0, 0, 0])), // Valid zlib but invalid filter byte
      deflateSync(Uint8Array.from([0, 0])), // Valid zlib but truncated RGBA scanline
    ]) {
      const bytes = crcCorrectPngWithIdat(idat);
      const ref = { ...attachment, byteSize: bytes.length };
      await putQuestionAttachmentBlob(attachment.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
        mimeType: "image/png", byteSize: bytes.length,
        questionId: "held-question", updatedAt: attachment.updatedAt,
      });
      const result = await createMediaBackupArchive({}, [{ id: "held-question", attachments: [ref] }]);
      expect(result).toMatchObject({ attachmentCount: 0, missingBlobKeys: [attachment.blobKey] });
    }
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

  it("preflights 29,999 present near-limit images serially before ZIP allocation", async () => {
    // 29,999 verified image files + media/ + workspace.json = 30,001.
    // No 2 GiB fixture is needed: the candidate probe reports verified sizes
    // without allocating or retaining each binary payload in the archive.
    let active = 0;
    let peakActive = 0;
    let inspected = 0;
    await expect(preflightRestorableZipCandidateBudget(
      MAX_ZIP_BACKUP_ENTRIES - 1, 0,
      async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await Promise.resolve();
        active -= 1;
        inspected += 1;
        return 64 * 1024;
      },
      async () => { throw new Error("unexpected original probe"); },
    )).rejects.toThrow("30,000 file entries");
    expect(inspected).toBe(MAX_ZIP_BACKUP_ENTRIES - 1);
    expect(peakActive).toBe(1);
  }, 30_000);

  it("preserves partial near-cap recovery and skips binary probing when the candidate count fits", async () => {
    let inspected = 0;
    const availability = await preflightRestorableZipCandidateBudget(
      MAX_ZIP_BACKUP_ENTRIES - 1, 0,
      async index => {
        inspected += 1;
        return index % 2 ? 64 * 1024 : null; // unavailable or corrupt, not admitted
      },
      async () => null,
    );
    expect(inspected).toBe(MAX_ZIP_BACKUP_ENTRIES - 1);
    expect(availability?.mediaAvailable.filter(Boolean)).toHaveLength(14_999);
    expect(availability?.mediaAvailable[0]).toBe(false);
    expect(availability?.mediaAvailable[1]).toBe(true);
    let unnecessaryReads = 0;
    const skipped = await preflightRestorableZipCandidateBudget(
      MAX_ZIP_BACKUP_ENTRIES - 2, 0,
      async () => { unnecessaryReads += 1; return 64 * 1024; },
      async () => { unnecessaryReads += 1; return 1; },
    );
    expect(skipped).toBeNull();
    expect(unnecessaryReads).toBe(0);
  }, 30_000);

  it("counts verified originals and bytes without retaining candidate buffers", async () => {
    // Mixed media/originals need both auto-created directories.
    const mediaCandidates = MAX_ZIP_BACKUP_ENTRIES - 3;
    await expect(preflightRestorableZipCandidateBudget(
      mediaCandidates, 1,
      async () => 1,
      async () => 1,
    )).rejects.toThrow("30,000 file entries");

    await expect(preflightRestorableZipCandidateBudget(
      mediaCandidates, 1,
      async index => index === 0 ? null : 1,
      async () => 1,
    )).resolves.toMatchObject({ originalsAvailable: [true] });

    await expect(preflightRestorableZipCandidateBudget(
      MAX_ZIP_BACKUP_ENTRIES - 1, 0,
      async () => MAX_ZIP_BACKUP_BYTES,
      async () => null,
    )).rejects.toThrow("archive size"); // Expanded bytes fit exactly; streamed ZIP overhead does not.
  }, 30_000);

  it("pins missing-candidate availability against a second-pass storage race", async () => {
    // A missing item becoming readable after preflight may not expand the
    // second-pass candidate set and cause a late 2 GiB memory failure.
    const availability = await preflightRestorableZipCandidateBudget(
      MAX_ZIP_BACKUP_ENTRIES - 1, 0,
      async index => index === 0 ? null : 64 * 1024,
      async () => null,
    );
    expect(availability?.mediaAvailable[0]).toBe(false);
    expect(availability?.mediaAvailable[1]).toBe(true);
    expect(availability?.mediaAvailable.filter(Boolean)).toHaveLength(MAX_ZIP_BACKUP_ENTRIES - 2);
  }, 30_000);

  it("rejects streamed ZIP size overflow even when ZIP file count fits", async () => {
    // 300 candidate images each declare 8 MiB: fewer than 30,000 entries.
    // At image 256, expanded bytes reach exactly 2 GiB, while the mandatory
    // ZIP headers/directories exceed the serialized archive limit first.
    const declaredBytes = 300 * 8 * 1024 * 1024;
    expect(declaredBytes).toBeGreaterThan(MAX_ZIP_BACKUP_BYTES);
    let inspected = 0;
    await expect(preflightRestorableZipCandidateBudget(
      300, 0,
      async () => { inspected += 1; return 8 * 1024 * 1024; },
      async () => { throw new Error("Unexpected original probe"); },
      declaredBytes,
    )).rejects.toThrow(/archive size/);
    expect(inspected).toBe(256); // The 256th probe crosses the stricter streamed archive budget.

    inspected = 0;
    const partial = await preflightRestorableZipCandidateBudget(
      300, 0,
      async index => { inspected += 1; return index % 2 === 0 ? null : 8 * 1024 * 1024; },
      async () => null,
      declaredBytes,
    );
    expect(inspected).toBe(300);
    expect(partial?.mediaAvailable.filter(Boolean)).toHaveLength(150);
    expect(partial?.mediaAvailable[0]).toBe(false);

    // The fast path remains single-pass when both budgets are safely below cap.
    let fastPathReads = 0;
    const skipped = await preflightRestorableZipCandidateBudget(
      300, 0,
      async () => { fastPathReads += 1; return 1; },
      async () => { fastPathReads += 1; return 1; },
      MAX_ZIP_BACKUP_BYTES - 1,
    );
    expect(skipped).toBeNull();
    expect(fastPathReads).toBe(0);
  });

  it("includes mandatory workspace JSON in near-2 GiB verified-byte preflight", async () => {
    // 256 x 8 MiB equals 2 GiB, leaving no room for even the smallest
    // workspace.json. Reject in probe phase, before JSZip retains those bytes.
    let inspected = 0;
    await expect(preflightRestorableZipCandidateBudget(
      300, 0,
      async () => { inspected += 1; return 8 * 1024 * 1024; },
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      1,
    )).rejects.toThrow(/expanded size/);
    expect(inspected).toBe(256);

    // Metadata-only recovery remains acceptable when the actual bytes fit.
    const sparse = await preflightRestorableZipCandidateBudget(
      300, 0,
      async index => index === 0 ? 8 * 1024 * 1024 : null,
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      1,
    );
    expect(sparse?.mediaAvailable.filter(Boolean)).toHaveLength(1);
  });

  it("reserves streamed ZIP headers and directory records before near-2 GiB image retention", async () => {
    const count = 256;
    const bytesPerImage = 8 * 1024 * 1024 - 180;
    const workspaceBytes = 20_000;
    const expandedWithoutZipHeaders = count * bytesPerImage + workspaceBytes;
    expect(expandedWithoutZipHeaders).toBeLessThan(MAX_ZIP_BACKUP_BYTES);
    // Even the mandatory streamed members, WITHOUT ZIP64/extra fields,
    // exceed the serialized ceiling. This is not merely a conservative hold.
    const minimalHeaders = 22
      + 30 + 46 + 2 * "workspace.json".length
      + 30 + 46 + 2 * "media/".length
      + Array.from({ length: count }, (_, index) =>
        30 + 46 + 16 + 2 * `media/${index}`.length).reduce((a, b) => a + b, 0);
    expect(expandedWithoutZipHeaders + minimalHeaders).toBeGreaterThan(MAX_ZIP_BACKUP_BYTES);
    expect(expandedWithoutZipHeaders + projectedZipSerializedOverhead(count, 0))
      .toBeGreaterThan(MAX_ZIP_BACKUP_BYTES);

    // R91 accepted this expanded-size-positive boundary. The serialized ZIP
    // cannot fit, so the first pass must fail before retaining binary files.
    let inspected = 0;
    await expect(preflightRestorableZipCandidateBudget(
      count, 0,
      async () => { inspected += 1; return bytesPerImage; },
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      workspaceBytes,
    )).rejects.toThrow(/archive size/i);
    expect(inspected).toBeGreaterThan(0);
    expect(inspected).toBeLessThanOrEqual(count);

    // A missing image must not consume either binary or header budget.
    const sparse = await preflightRestorableZipCandidateBudget(
      count, 0,
      async index => index % 2 === 0 ? bytesPerImage : null,
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      workspaceBytes,
    );
    expect(sparse?.mediaAvailable.filter(Boolean)).toHaveLength(count / 2);
    expect(sparse?.mediaAvailable[1]).toBe(false);
  });

  it("conservatively bounds a real STORE streaming ZIP envelope and preserves partial roundtrip", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const workspaceJson = JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 2, media: [], originals: [] });
    zip.file("workspace.json", workspaceJson);
    zip.file("media/0", PNG_BYTES);
    zip.file("originals/0", "source");
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
    const expanded = new Blob([workspaceJson]).size + PNG_BYTES.length + new Blob(["source"]).size;
    expect(blob.size - expanded).toBeGreaterThan(0);
    expect(blob.size - expanded).toBeLessThanOrEqual(projectedZipSerializedOverhead(1, 1));

    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const missing = { ...attachment, id: "missing", blobKey: "private-library:missing" };
    const exported = await createMediaBackupArchive(
      { recoveryMarker: "streamed-overhead-roundtrip" },
      [{ id: "held-question", attachments: [attachment, missing] }],
    );
    expect(exported.attachmentCount).toBe(1);
    expect(exported.missingBlobKeys).toEqual([missing.blobKey]);
    const readback = await readPortableBackup(new File([exported.blob], "streamed-overhead-roundtrip.zip"));
    expect(JSON.parse(readback.rawText)).toMatchObject({ recoveryMarker: "streamed-overhead-roundtrip" });
  });

  it("reserves projected media descriptors before near-2 GiB ZIP binary retention", async () => {
    // R90 accepted 256 x (8 MiB - 1) plus the empty manifest, but writing
    // descriptors for admitted images makes the expanded ZIP exceed 2 GiB.
    const candidateCount = 256;
    const size = 8 * 1024 * 1024 - 1;
    const baselineJson = JSON.stringify({
      _backupFormat: "axom-media-backup", _backupVersion: 2, media: [], originals: [],
    });
    const baselineBytes = new Blob([baselineJson]).size;
    const manifestDelta = (candidateIndex: number, admittedIndex: number) => (
      new Blob([JSON.stringify({
        file: `media/${admittedIndex}`,
        metadata: { ...attachment, questionId: `question-${candidateIndex}`, blobKey: `private-library:media-${candidateIndex}`, byteSize: size },
      })]).size + Number(admittedIndex > 0)
    );
    const projectedJsonBytes = baselineBytes
      + Array.from({ length: candidateCount }, (_, i) => manifestDelta(i, i)).reduce((a, b) => a + b, 0);
    expect(candidateCount * size + baselineBytes).toBeLessThanOrEqual(MAX_ZIP_BACKUP_BYTES);
    expect(candidateCount * size + projectedJsonBytes).toBeGreaterThan(MAX_ZIP_BACKUP_BYTES);
    let inspected = 0;
    await expect(preflightRestorableZipCandidateBudget(
      candidateCount, 0,
      async () => { inspected += 1; return size; },
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      baselineBytes,
      manifestDelta,
    )).rejects.toThrow(/expanded size/);
    expect(inspected).toBe(candidateCount); // failure occurs before any JSZip media retention

    inspected = 0;
    const sparse = await preflightRestorableZipCandidateBudget(
      candidateCount, 0,
      async index => { inspected += 1; return index % 2 === 0 ? size : null; },
      async () => null,
      MAX_ZIP_BACKUP_BYTES + 1,
      baselineBytes,
      manifestDelta,
    );
    expect(inspected).toBe(candidateCount);
    expect(sparse?.mediaAvailable.filter(Boolean)).toHaveLength(candidateCount / 2);
    expect(sparse?.mediaAvailable[1]).toBe(false);
  });

  it("reserves only admitted original descriptors in byte-risk ZIP preflight", async () => {
    // Original data can be near the expanded limit even with just 17 records.
    // Their manifest entries must participate in the first-pass budget.
    const size = 128 * 1024 * 1024 - 1;
    const originalDescriptor = (_index: number, admittedIndex: number) => (
      64 + Number(admittedIndex > 0)
    );
    await expect(preflightRestorableZipCandidateBudget(
      0, 17, async () => null, async () => size,
      MAX_ZIP_BACKUP_BYTES + 1, 10, undefined, originalDescriptor,
    )).rejects.toThrow(/expanded size/);
    const sparse = await preflightRestorableZipCandidateBudget(
      0, 17, async () => null, async index => index % 2 === 0 ? size : null,
      MAX_ZIP_BACKUP_BYTES + 1, 10, undefined, originalDescriptor,
    );
    expect(sparse?.originalsAvailable.filter(Boolean)).toHaveLength(9);
  });

  it("exports a partial, restorable ZIP when declared media bytes exceed 2 GiB but most blobs are absent", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const missing = Array.from({ length: 260 }, (_, index) => ({
      id: `unavailable-q-${index}`,
      attachments: [{
        ...attachment, id: `unavailable-media-${index}`,
        blobKey: `private-library:unavailable-${index}`,
        byteSize: 8 * 1024 * 1024,
      }],
    }));
    const exported = await createMediaBackupArchive(
      { recoveryMarker: "byte-budget-partial" }, [...refs, ...missing],
    );
    expect(exported.attachmentCount).toBe(1);
    expect(exported.missingBlobKeys).toHaveLength(260);
    const portable = await readPortableBackup(new File([exported.blob], "byte-budget-partial.zip"));
    expect(JSON.parse(portable.rawText)).toMatchObject({ recoveryMarker: "byte-budget-partial" });
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(Object.keys(zip.files)).toHaveLength(3); // workspace.json, media/, media/0
  });

  it("counts only verified ZIP entries, including actual JSZip directories and workspace", () => {
    // Metadata candidates are not admitted files: absent or invalid binary
    // records must remain diagnosable in a recoverable partial backup.
    expect(() => assertRestorableZipEntryCounts(MAX_ZIP_BACKUP_ENTRIES - 2, 0)).not.toThrow();
    expect(() => assertRestorableZipEntryCounts(MAX_ZIP_BACKUP_ENTRIES - 1, 0))
      .toThrow(/30,000 file entries/);
    expect(() => assertRestorableZipEntryCounts(MAX_ZIP_BACKUP_ENTRIES - 4, 1)).not.toThrow();
    expect(() => assertRestorableZipEntryCounts(MAX_ZIP_BACKUP_ENTRIES - 3, 1))
      .toThrow(/30,000 file entries/);
  });

  it("preserves a restorable metadata-only ZIP with over-budget missing image references", async () => {
    // R87 rejected the 29,999 *candidate keys* before discovering all were
    // missing. Honest partial backups must report those gaps, not abort.
    const manyReferences = Array.from({ length: MAX_ZIP_BACKUP_ENTRIES - 1 }, (_, index) => ({
      id: `held-question-${index}`,
      attachments: [{ ...attachment, id: `figure-${index}`, blobKey: `private-library:figure-${index}` }],
    }));
    const exported = await createMediaBackupArchive({ recoveryMarker: "offline-rescue" }, manyReferences);
    expect(exported.attachmentCount).toBe(0);
    expect(exported.missingBlobKeys).toHaveLength(MAX_ZIP_BACKUP_ENTRIES - 1);
    expect(exported.missingBlobKeys[0]).toBe("private-library:figure-0");
    expect(exported.missingBlobKeys.at(-1)).toBe(`private-library:figure-${MAX_ZIP_BACKUP_ENTRIES - 2}`);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(Object.keys(zip.files)).toEqual(["workspace.json"]);
    const portable = await readPortableBackup(new File([exported.blob], "partial-rescue.zip"));
    expect(JSON.parse(portable.rawText)).toMatchObject({ recoveryMarker: "offline-rescue" });
  }, 120_000);

  it("preserves valid images while reporting absent images and eligible originals", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const missing = { ...attachment, id: "missing-figure", blobKey: "private-library:missing-figure" };
    const original: SourceDocument = {
      id: "missing-original", title: "Missing original", fileName: "missing.txt",
      fileType: "text/plain", uploadedAt: "2026-11-13", rawText: "",
      sizeBytes: 1, checksum: "a".repeat(64), tags: [],
      linkedQuestionSetIds: [], libraryOnly: true,
    };
    const exported = await createMediaBackupArchive({}, [{ id: "held-question", attachments: [attachment, missing] }], [original]);
    expect(exported).toMatchObject({
      attachmentCount: 1, originalCount: 0,
      missingBlobKeys: [missing.blobKey], missingOriginalIds: [original.id],
    });
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(Object.keys(zip.files)).toHaveLength(3); // workspace.json, media/, media/0
    await expect(readPortableBackup(new File([exported.blob], "mixed-partial.zip")))
      .resolves.toHaveProperty("restoreMedia");
  });

  it("does not count repeated question references as distinct ZIP media entries", async () => {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question-0", updatedAt: attachment.updatedAt,
    });
    const repeatedReferences = Array.from({ length: MAX_ZIP_BACKUP_ENTRIES + 1 }, (_, index) => ({
      id: `held-question-${index}`, attachments: [attachment],
    }));
    const exported = await createMediaBackupArchive({}, repeatedReferences);
    expect(exported).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(Object.keys(zip.files)).toHaveLength(3); // workspace.json, media/, media/0
  });

  it("rejects unrelated ZIPs and missing media before allowing a workspace restore", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(); zip.file("catalog.json", "{}");
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "library.zip"))).rejects.toThrow("not an AXOM workspace backup");
    zip.file("workspace.json", JSON.stringify({ _backupFormat: "axom-media-backup", _backupVersion: 1, media: [{ file: "media/0", metadata: { ...attachment, questionId: "held-question" } }] }));
    await expect(readPortableBackup(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" })).buffer], "damaged.zip"))).rejects.toThrow("invalid or missing image");
  });

  it("holds JPEG containers with no frame or image scan instead of certifying ZIP or JSON recovery", async () => {
    const malformed = [
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]),
      // Well-formed 1x1 frame segment, but no image scan payload.
      Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9]),
      // Correct frame and SOS headers, but no entropy bytes between SOS and EOI.
      Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
        0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xd9]),
    ];
    for (const [index, bytes] of malformed.entries()) {
      const jpeg = { ...attachment, id: `jpeg-corrupt-${index}`,
        blobKey: `private-library:jpeg-corrupt-${index}`,
        fileName: "damaged.jpg", mimeType: "image/jpeg" as const, byteSize: bytes.byteLength };
      await putQuestionAttachmentBlob(jpeg.blobKey, {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" }),
        mimeType: jpeg.mimeType, byteSize: jpeg.byteSize,
        questionId: "held-question", updatedAt: jpeg.updatedAt,
      });
      const jpegRefs = [{ id: "held-question", attachments: [jpeg] }];
      expect(await collectVerifiedMediaBackupPayloads(jpegRefs))
        .toMatchObject({ payloads: [], missingBlobKeys: [jpeg.blobKey] });
      const exported = await createMediaBackupArchive({}, jpegRefs);
      expect(exported).toMatchObject({ attachmentCount: 0, missingBlobKeys: [jpeg.blobKey] });
      const zip = await readPortableBackup(new File([exported.blob], "incomplete-jpeg.zip"));
      expect(zip.rawText).toContain('"media":[]');
      // A forged ZIP bypassing export must fail before workspace adoption.
      const { default: JSZip } = await import("jszip");
      const hostile = new JSZip();
      hostile.file("media/0", bytes);
      hostile.file("workspace.json", JSON.stringify({
        _backupFormat: "axom-media-backup", _backupVersion: 2,
        media: [{ file: "media/0", metadata: { ...jpeg, questionId: "held-question" } }],
        originals: [],
      }));
      const hostileBlob = await hostile.generateAsync({ type: "blob" });
      await expect(readPortableBackup(new File([hostileBlob], "fake-jpeg.zip")))
        .rejects.toThrow(/image.*integrity/i);
    }
  });

  it("preserves a real baseline JPEG through verified JSON and ZIP backup restoration", async () => {
    // A genuine 1x1 RGB JPEG, not a marker-only mock with no compressed scan.
    // Pillow-generated 1×1 RGB baseline JPEG (287 bytes; SHA-256 03cc6abc…c728).
    // Segment lengths were verified; the previous hand-copied fixture had stray DQT bytes.
    // Encoder-produced 287-byte fixture, split into fixed chunks to avoid accidental truncation.
    const jpegBase64 = [
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQO",
      "DwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcH",
      "BwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
      "KCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAA",
      "AAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAA",
      "AAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCTgKoO/9k=",
    ].join("");
    const jpegBytes = Uint8Array.from(atob(jpegBase64), char => char.charCodeAt(0));
    expect(jpegBytes.byteLength).toBe(287);
    expect(await sha256Hex(jpegBytes.buffer as ArrayBuffer))
      .toBe("03cc6abccd8c5f7a8db7515de080e595ea020c00c4553bec5c6f39c32fadc728");
    const jpeg = { ...attachment, id: "jpeg-valid", blobKey: "private-library:jpeg-valid",
      fileName: "figure.jpg", mimeType: "image/jpeg" as const, byteSize: jpegBytes.byteLength };
    const jpegRefs = [{ id: "held-question", attachments: [jpeg] }];
    await putQuestionAttachmentBlob(jpeg.blobKey, {
      blob: new Blob([jpegBytes.buffer as ArrayBuffer], { type: "image/jpeg" }),
      mimeType: jpeg.mimeType, byteSize: jpeg.byteSize,
      questionId: "held-question", updatedAt: jpeg.updatedAt,
    });
    const json = await collectVerifiedMediaBackupPayloads(jpegRefs);
    expect(json).toMatchObject({ missingBlobKeys: [] });
    expect(json.payloads).toHaveLength(1);
    const exported = await createMediaBackupArchive({}, jpegRefs);
    expect(exported).toMatchObject({ attachmentCount: 1, missingBlobKeys: [] });
    const read = await readPortableBackup(new File([exported.blob], "verified-jpeg.zip"));
    await deleteQuestionAttachmentBlobs([jpeg.blobKey]);
    const restored = await read.restoreMedia(jpegRefs);
    expect(restored.restored).toBe(1);
    const fetched = await getQuestionAttachmentBlob(jpeg.blobKey);
    expect(new Uint8Array(await fetched!.blob.arrayBuffer())).toEqual(jpegBytes);
  });


  it("records SHA-256 for new ZIP images and rejects equal-size CRC-valid substitution before recovery consent", async () => {
    const { default: JSZip } = await import("jszip");
    // Two *different pixels* (red and green), each a CRC-correct 1x1 RGBA PNG
    // with a valid 13-byte zlib IDAT. MIME, size and structural checks all pass.
    const original = crcCorrectPngWithIdat(deflateSync(Uint8Array.from([0, 255, 0, 0, 255])));
    const substitute = crcCorrectPngWithIdat(deflateSync(Uint8Array.from([0, 0, 255, 0, 255])));
    expect(original.byteLength).toBe(substitute.byteLength);
    expect(await sha256Hex(original)).not.toBe(await sha256Hex(substitute));
    const tagged = { ...attachment, byteSize: original.byteLength };
    await putQuestionAttachmentBlob(tagged.blobKey, {
      blob: new Blob([original as BlobPart], { type: "image/png" }),
      mimeType: "image/png", byteSize: original.byteLength,
      questionId: "held-question", updatedAt: tagged.updatedAt,
    });
    const exported = await createMediaBackupArchive({ questions: [{ id: "held-question", attachments: [tagged] }] },
      [{ id: "held-question", attachments: [tagged] }]);
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    expect(manifest._backupVersion).toBe(3);
    expect(manifest.media[0].sha256).toBe(await sha256Hex(original));
    const intact = await readPortableBackup(new File([exported.blob], "digest-intact.zip"));
    expect(intact.omissions.missingBlobKeys).toEqual([]);
    zip.file(manifest.media[0].file, substitute);
    await expect(readPortableBackup(new File([await zip.generateAsync({ type: "blob" })], "digest-substituted.zip")))
      .rejects.toThrow(/image.*(digest|integrity|checksum)/i);
  });


  it("reports unavailable SHA-256 verification for intact v3 media while preserving digestless legacy recovery", async () => {
    const { default: JSZip } = await import("jszip");
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({ questions: refs }, refs);
    const oldZip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const oldManifest = JSON.parse(await oldZip.file("workspace.json")!.async("string"));
    expect(oldManifest._backupVersion).toBe(3);
    oldManifest._backupVersion = 2;
    delete oldManifest.media[0].sha256;
    oldZip.file("workspace.json", JSON.stringify(oldManifest));
    const historicalZip = await oldZip.generateAsync({ type: "blob" });

    const cryptoWithSubtle = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: cryptoWithSubtle.getRandomValues.bind(cryptoWithSubtle),
      subtle: undefined,
    });
    try {
      // This archive was exported successfully with working WebCrypto. It has
      // not become corrupt merely because the restoring runtime lacks SHA-256.
      await expect(readPortableBackup(new File([exported.blob], "intact-v3-no-crypto.zip")))
        .rejects.toThrow(/SHA-256.*unavailable/i);
      // A digestless v2 archive has never required SHA-256 for image media.
      const legacy = await readPortableBackup(new File([historicalZip], "digestless-v2-no-crypto.zip"));
      expect(legacy.omissions.missingBlobKeys).toEqual([]);
      await expect(createMediaBackupArchive({ questions: refs }, refs))
        .rejects.toThrow(/SHA-256.*unavailable/i);
    } finally {
      vi.stubGlobal("crypto", cryptoWithSubtle);
    }
  });

  it("reports missing WebCrypto capability instead of corrupt original-file bytes", async () => {
    const original = new Blob(["Portable original for hash verification"], { type: "text/plain" });
    const document: SourceDocument = {
      id: "verified-source", title: "Verified Source", fileName: "source.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Source metadata",
      sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(document, original);
    const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    expect(exported).toMatchObject({ originalCount: 1, missingOriginalIds: [] });

    const cryptoWithSubtle = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: cryptoWithSubtle.getRandomValues.bind(cryptoWithSubtle),
      subtle: undefined,
    });
    try {
      await expect(readPortableBackup(new File([exported.blob], "intact-original-no-crypto.zip")))
        .rejects.toThrow(/SHA-256.*unavailable/i);
    } finally {
      vi.stubGlobal("crypto", cryptoWithSubtle);
    }
  });

  it("refuses an original-only v3 export when WebCrypto is absent before export", async () => {
    const original = new Blob(["Exact locally cached original without an image"], { type: "text/plain" });
    const document: SourceDocument = {
      id: "no-crypto-original-only", title: "Original without image", fileName: "source.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Original-only source",
      sizeBytes: original.size, checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(document, original);
    const cryptoWithSubtle = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: cryptoWithSubtle.getRandomValues.bind(cryptoWithSubtle),
      subtle: undefined,
    });
    try {
      // A v3 archive with originals[] is unreadable in this runtime. Never
      // certify it as a complete backup or misreport its present source as omitted.
      await expect(createMediaBackupArchive({ documents: [document] }, [], [document]))
        .rejects.toThrow(/SHA-256.*unavailable/i);
      expect(await (await readSourceOriginal(document.id, document.checksum))?.text())
        .toBe("Exact locally cached original without an image");
    } finally {
      vi.stubGlobal("crypto", cryptoWithSubtle);
    }
    const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    expect(exported).toMatchObject({ attachmentCount: 0, originalCount: 1, missingOriginalIds: [] });
    const readable = await readPortableBackup(new File([exported.blob], "original-only-valid.zip"));
    expect(readable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
  });

  it("still discloses genuinely unavailable original bytes in a partial ZIP without WebCrypto", async () => {
    const absent = new Blob(["Missing original bytes"], { type: "text/plain" });
    const document: SourceDocument = {
      id: "no-crypto-missing-original", title: "Missing original", fileName: "missing.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Metadata retained",
      sizeBytes: absent.size, checksum: await sha256Hex(await absent.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const cryptoWithSubtle = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: cryptoWithSubtle.getRandomValues.bind(cryptoWithSubtle),
      subtle: undefined,
    });
    try {
      const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
      expect(exported).toMatchObject({ attachmentCount: 0, originalCount: 0, missingOriginalIds: [document.id] });
      const readable = await readPortableBackup(new File([exported.blob], "original-missing-partial.zip"));
      expect(readable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [document.id] });
    } finally {
      vi.stubGlobal("crypto", cryptoWithSubtle);
    }
  });

  it("rejects absent or malformed new-format image digests but permits legacy v1/v2 archives", async () => {
    const { default: JSZip } = await import("jszip");
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngBlob(), mimeType: "image/png", byteSize: PNG_BYTES.length,
      questionId: "held-question", updatedAt: attachment.updatedAt,
    });
    const exported = await createMediaBackupArchive({ questions: refs }, refs);
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    expect(manifest._backupVersion).toBe(3);
    delete manifest.media[0].sha256;
    zip.file("workspace.json", JSON.stringify(manifest));
    await expect(readPortableBackup(new File([await zip.generateAsync({ type: "blob" })], "no-digest-v3.zip")))
      .rejects.toThrow(/image.*(digest|integrity|checksum)/i);
    for (const version of [1, 2]) {
      manifest._backupVersion = version;
      zip.file("workspace.json", JSON.stringify(manifest));
      const recovered = await readPortableBackup(
        new File([await zip.generateAsync({ type: "blob" })], "legacy-digestless.zip"),
      );
      expect(recovered.omissions.missingBlobKeys).toEqual([]);
    }
    manifest._backupVersion = 2;
    manifest.media[0].sha256 = "invalid-digest";
    zip.file("workspace.json", JSON.stringify(manifest));
    await expect(readPortableBackup(new File([await zip.generateAsync({ type: "blob" })], "malformed-legacy-digest.zip")))
      .rejects.toThrow(/image.*(digest|integrity|checksum)/i);
  });

  it.each(["zip", "json"] as const)(
    "rejects conflicting root/deferred source digests before %s recovery consent",
    async format => {
      const original = new Blob(["Verifiable study source"], { type: "text/plain" });
      const source: SourceDocument = {
        id: "shared-original-id", title: "Canonical source", fileName: "source.txt",
        fileType: "text/plain", uploadedAt: "2026-11-15",
        rawText: "Verifiable study source", sizeBytes: original.size,
        checksum: await sha256Hex(await original.arrayBuffer()),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      const contradictory = { ...source, checksum: "f".repeat(64) };
      await saveSourceOriginal(source, original);
      const payload = {
        _app: "AXOM", _backupScope: "complete",
        documents: [contradictory],
        deferredContent: { documents: [source] },
      };
      const input = format === "zip"
        ? new File([(await createMediaBackupArchive(payload, [], [source])).blob], "contradictory.zip")
        : new File([JSON.stringify(payload)], "contradictory.json");
      // Both referenced records have valid SHA-256 syntax. Last-wins Maps
      // previously concealed the first claim when the second matched bytes.
      await expect(readPortableBackup(input))
        .rejects.toThrow(/conflicting source.document checksums/i);
      expect(await (await readSourceOriginal(source.id, source.checksum))?.text())
        .toBe("Verifiable study source");
    },
  );

  it("exports a mirrored original only once and produces a readable ZIP", async () => {
    const { default: JSZip } = await import("jszip");
    const original = new Blob(["Duplicate eligible source bytes"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "mirrored-export-id", title: "Root", fileName: "source.txt", fileType: "text/plain",
      uploadedAt: "2026-11-17", rawText: "Test source", sizeBytes: original.size,
      checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const alias: SourceDocument = {
      ...source, title: "Deferred alias", fileName: "renamed.txt",
      checksum: `sha256:${source.checksum}`, fileType: "txt",
    };
    await saveSourceOriginal(source, original);
    const payload = {
      documents: [source],
      deferredContent: { documents: [alias] },
    };
    const exported = await createMediaBackupArchive(payload, [], [source, alias]);
    expect(exported.originalCount).toBe(1);
    expect(exported.missingOriginalIds).toEqual([]);
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    expect(manifest.originals).toHaveLength(1);
    expect(manifest.originals[0].documentId).toBe(source.id);
    const readback = await readPortableBackup(new File([exported.blob], "mirrored-original.zip"));
    expect(readback.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    expect(await (await readSourceOriginal(source.id, source.checksum))?.text())
      .toBe("Duplicate eligible source bytes");
  });

  it("reports missing mirrored originals once, without claiming a complete backup", async () => {
    const source: SourceDocument = {
      id: "uncached-mirror", title: "Missing", fileName: "uncached.txt", fileType: "text/plain",
      uploadedAt: "2026-11-17", rawText: "", sizeBytes: 20,
      checksum: "c".repeat(64), tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const payload = { documents: [source], deferredContent: { documents: [{ ...source }] } };
    const exported = await createMediaBackupArchive(payload, [], [source, { ...source }]);
    expect(exported.originalCount).toBe(0);
    expect(exported.missingOriginalIds).toEqual([source.id]);
    const readback = await readPortableBackup(new File([exported.blob], "missing-mirror.zip"));
    expect(readback.omissions.missingOriginalIds).toEqual([source.id]);
  });

  it("refuses conflicting eligible original digests before exporting a ZIP", async () => {
    const original = new Blob(["Stable original"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "conflicting-mirror", title: "Root", fileName: "source.txt", fileType: "text/plain",
      uploadedAt: "2026-11-17", rawText: "Stable original", sizeBytes: original.size,
      checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(source, original);
    const contradictory = { ...source, checksum: "f".repeat(64) };
    await expect(createMediaBackupArchive({ documents: [source, contradictory] }, [], [source, contradictory]))
      .rejects.toThrow(/conflicting source.document checksums/i);
    expect(await (await readSourceOriginal(source.id, source.checksum))?.text())
      .toBe("Stable original");
  });

  it("accepts matching root/deferred source digests in a complete ZIP", async () => {
    const original = new Blob(["Mirrored source"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "mirrored-source", title: "Root title", fileName: "mirrored.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15",
      rawText: "Mirrored source", sizeBytes: original.size,
      checksum: await sha256Hex(await original.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(source, original);
    const payload = {
      documents: [source],
      deferredContent: { documents: [{ ...source, title: "Deferred title", checksum: `sha256:${source.checksum}` }] },
    };
    const exported = await createMediaBackupArchive(payload, [], [source]);
    const backup = await readPortableBackup(new File([exported.blob], "mirrored.zip"));
    expect(backup.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    expect(await backup.restoreOriginals([source])).toMatchObject({ restored: 0, skipped: 1 });
  });

  it.each([
    { label: "internal duplicate", fileType: "axom-internal", checksum: "same" },
    { label: "missing type duplicate", fileType: undefined, checksum: "same" },
    { label: "invalid digest duplicate", fileType: "text/plain", checksum: "malformed" },
  ])("discloses a missing source original despite a later $label", async ({ fileType, checksum }) => {
    const bytes = new Blob(["A source that is not cached locally"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "alias-missing-source", title: "Original metadata", fileName: "original.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Unmodified text",
      sizeBytes: bytes.size, checksum: await sha256Hex(await bytes.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const alias = { ...source, fileType, checksum: checksum === "same" ? source.checksum : checksum };
    const payload = { documents: [source], deferredContent: { documents: [alias] } };
    const exported = await createMediaBackupArchive(payload, [], [source]);
    expect(exported.originalCount).toBe(0);
    const portable = await readPortableBackup(new File([exported.blob], "source-alias-missing.zip"));
    expect(portable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [source.id] });
  });

  it("matches an included original to any eligible root/deferred record rather than last-wins alias", async () => {
    const bytes = new Blob(["A source still available in the archive"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "alias-present-source", title: "Original metadata", fileName: "original.txt",
      fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Source retained",
      sizeBytes: bytes.size, checksum: await sha256Hex(await bytes.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    await saveSourceOriginal(source, bytes);
    const exported = await createMediaBackupArchive({
      documents: [source],
      deferredContent: { documents: [{ ...source, checksum: "historical-invalid-digest" }] },
    }, [], [source]);
    expect(exported.originalCount).toBe(1);
    const portable = await readPortableBackup(new File([exported.blob], "source-alias-present.zip"));
    expect(portable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
  });

  it("backs up, reads, and restores checksum-bound originals whose historical fileType is blank", async () => {
    const bytes = new Blob(["Historical blank-type source original, not metadata only"], { type: "text/plain" });
    const source: SourceDocument = {
      id: "blank-type-original-present", title: "Historical original", fileName: "source.txt",
      fileType: "", uploadedAt: "2026-11-17", rawText: "Source text",
      sizeBytes: bytes.size, checksum: await sha256Hex(await bytes.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    // The ordinary complete-export selector uses exactly this candidate helper.
    // Previously it chose JSON and could certify a copy with no original bytes.
    expect(backupOriginalDocuments([source])).toEqual([source]);
    await saveSourceOriginal(source, bytes);
    const exported = await createMediaBackupArchive({
      _app: "AXOM", _backupScope: "complete", documents: [source],
    }, [], backupOriginalDocuments([source]));
    expect(exported).toMatchObject({
      originalCount: 1, missingOriginalIds: [], missingBlobKeys: [],
    });
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
    expect(manifest.originals).toHaveLength(1);
    expect(manifest.originals[0]).toMatchObject({ documentId: source.id, sha256: source.checksum });
    const portable = await readPortableBackup(new File([exported.blob], "blank-type-original.zip"));
    expect(JSON.parse(portable.rawText).documents).toEqual([source]);
    expect(portable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
    await deleteSourceOriginal(source.id);
    expect(await readSourceOriginal(source.id, source.checksum)).toBeUndefined();
    expect(await portable.restoreOriginals([source])).toEqual({ restored: 1, skipped: 0 });
    expect(await (await readSourceOriginal(source.id, source.checksum))?.text())
      .toBe("Historical blank-type source original, not metadata only");
  });

  it("discloses absent blank-type originals instead of certifying an incomplete export", async () => {
    const source: SourceDocument = {
      id: "blank-type-original-missing", title: "Lost historical original", fileName: "source.txt",
      fileType: "", uploadedAt: "2026-11-17", rawText: "Preserved metadata",
      sizeBytes: 17, checksum: "e".repeat(64),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const internal = { ...source, fileType: "axom-internal", checksum: "f".repeat(64) };
    expect(backupOriginalDocuments([internal, source])).toEqual([source]);
    const exported = await createMediaBackupArchive({
      _app: "AXOM", _backupScope: "complete", documents: [source],
      deferredContent: { documents: [internal] },
    }, [], [internal, source]);
    expect(exported.originalCount).toBe(0);
    expect(exported.missingOriginalIds).toEqual([source.id]);
    const portable = await readPortableBackup(new File([exported.blob], "blank-type-omitted.zip"));
    expect(portable.omissions.missingOriginalIds).toEqual([source.id]);
    expect(JSON.parse(portable.rawText).documents).toEqual([source]);
  });

  it("rejects two cached blank-type versions of one original before exporting a misleading complete ZIP", async () => {
    const firstBytes = new Blob(["Historical original revision one"], { type: "text/plain" });
    const secondBytes = new Blob(["Historical original revision two"], { type: "text/plain" });
    const first: SourceDocument = {
      id: "blank-multiversion-id", title: "Root original", fileName: "source.txt",
      fileType: "", uploadedAt: "2026-11-17", rawText: "Root metadata",
      sizeBytes: firstBytes.size, checksum: await sha256Hex(await firstBytes.arrayBuffer()),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    const second: SourceDocument = {
      ...first, title: "Deferred revision", sizeBytes: secondBytes.size,
      checksum: await sha256Hex(await secondBytes.arrayBuffer()),
    };
    // The IndexedDB store retains immutable versions by (id, checksum).
    // Deduplicating only by id would archive one while certifying both.
    await saveSourceOriginal(first, firstBytes);
    await saveSourceOriginal(second, secondBytes);
    expect(await (await readSourceOriginal(first.id, first.checksum))?.text()).toBe("Historical original revision one");
    expect(await (await readSourceOriginal(second.id, second.checksum))?.text()).toBe("Historical original revision two");
    expect(() => backupOriginalDocuments([first, second]))
      .toThrow(/conflicting source.document checksums/i);
    await expect(createMediaBackupArchive({
      _app: "AXOM", _backupScope: "complete",
      documents: [first], deferredContent: { documents: [second] },
    }, [], [first, second])).rejects.toThrow(/conflicting source.document checksums/i);
    // A refused export must not delete or rewrite either cached original.
    expect(await (await readSourceOriginal(first.id, first.checksum))?.text()).toBe("Historical original revision one");
    expect(await (await readSourceOriginal(second.id, second.checksum))?.text()).toBe("Historical original revision two");
  });

  it.each(["json", "zip"] as const)(
    "rejects an existing $format archive with two incompatible blank-type source versions before recovery consent",
    async format => {
      const firstBytes = new Blob(["Old archive original A"], { type: "text/plain" });
      const secondBytes = new Blob(["Old archive original B"], { type: "text/plain" });
      const first: SourceDocument = {
        id: "ambiguous-blank-restore", title: "Root", fileName: "source.txt",
        fileType: "", uploadedAt: "2026-11-17", rawText: "Metadata",
        sizeBytes: firstBytes.size, checksum: await sha256Hex(await firstBytes.arrayBuffer()),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      const second: SourceDocument = {
        ...first, title: "Deferred", sizeBytes: secondBytes.size,
        checksum: await sha256Hex(await secondBytes.arrayBuffer()),
      };
      const conflict = {
        _app: "AXOM", _backupScope: "complete",
        documents: [first], deferredContent: { documents: [second] },
      };
      let file: File;
      if (format === "json") {
        file = new File([JSON.stringify(conflict)], "blank-original-conflict.json");
      } else {
        await saveSourceOriginal(first, firstBytes);
        const exported = await createMediaBackupArchive({
          _app: "AXOM", _backupScope: "complete", documents: [first],
        }, [], [first]);
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
        const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
        manifest.deferredContent = { documents: [second] };
        zip.file("workspace.json", JSON.stringify(manifest));
        file = new File([await zip.generateAsync({ type: "arraybuffer" })], "blank-original-conflict.zip");
      }
      await expect(readPortableBackup(file)).rejects.toThrow(/conflicting source.document checksums/i);
      if (format === "zip") {
        expect(await (await readSourceOriginal(first.id, first.checksum))?.text()).toBe("Old archive original A");
      }
    },
  );

  it("keeps compatible blank-type duplicates and explicitly typed originals authoritative", async () => {
    const blank: SourceDocument = {
      id: "blank-version-typed-precedence", title: "Blank metadata", fileName: "source.txt",
      fileType: "", uploadedAt: "2026-11-17", rawText: "Metadata",
      sizeBytes: 4, checksum: "a".repeat(64),
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    expect(backupOriginalDocuments([blank, { ...blank, checksum: `sha256:${blank.checksum}` }]))
      .toEqual([blank]);
    const typed = { ...blank, fileType: "text/plain", checksum: "c".repeat(64) };
    const otherBlank = { ...blank, checksum: "b".repeat(64) };
    expect(backupOriginalDocuments([blank, otherBlank, typed])).toEqual([typed]);
  });

  it.each(["json", "zip"] as const)(
    "preserves a verified original when same-ID internal or untyped metadata has another valid digest in $format",
    async format => {
      const bytes = new Blob(["Authoritative external original bytes"], { type: "text/plain" });
      const source: SourceDocument = {
        id: "historical-mixed-source", title: "External original", fileName: "original.txt",
        fileType: "text/plain", uploadedAt: "2026-11-17", rawText: "External source",
        sizeBytes: bytes.size, checksum: await sha256Hex(await bytes.arrayBuffer()),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      const internal = { ...source, fileType: "axom-private-bank-review", checksum: "b".repeat(64), sizeBytes: 999 };
      const untyped = { ...source, fileType: undefined, checksum: "c".repeat(64) };
      const emptyType = { ...source, fileType: "", checksum: "d".repeat(64) };
      const documentRecords = [internal, untyped, emptyType, source] as SourceDocument[];
      // Only a checksum-bound external original may claim the immutable bytes.
      // Metadata records keep their own content and are not aliases to the bytes.
      expect(backupOriginalDocuments(documentRecords)).toEqual([source]);
      await saveSourceOriginal(source, bytes);
      const payload = {
        _app: "AXOM", _backupScope: "complete",
        documents: [source], deferredContent: { documents: [internal, untyped, emptyType] },
      };
      const exported = format === "zip"
        ? await createMediaBackupArchive(payload, [], documentRecords)
        : null;
      if (exported) {
        expect(exported.originalCount).toBe(1);
        expect(exported.missingOriginalIds).toEqual([]);
      }
      const file = format === "zip"
        ? new File([exported!.blob], "historical-mixed-source.zip")
        : new File([JSON.stringify(payload)], "historical-mixed-source.json");
      const portable = await readPortableBackup(file);
      // The cached local source is not embedded in a JSON backup; only the ZIP
      // contains portable original bytes that a second device could restore.
      expect(portable.omissions).toEqual({
        missingBlobKeys: [], missingOriginalIds: format === "json" ? [source.id] : [],
      });
      expect(await (await readSourceOriginal(source.id, source.checksum))?.text())
        .toBe("Authoritative external original bytes");
    },
  );

  it.each(["absent", "null"] as const)(
    "archives a checksum-verified $type historical source without inventing its MIME",
    async type => {
      const bytes = new Blob(["Historical source without a MIME declaration"], { type: "text/plain" });
      const document = {
        id: `legacy-no-type-${type}`, title: "Historical original", fileName: "source.txt",
        ...(type === "null" ? { fileType: null } : {}),
        uploadedAt: "2026-11-17", rawText: "Historical bytes", sizeBytes: bytes.size,
        checksum: await sha256Hex(await bytes.arrayBuffer()),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      } as unknown as SourceDocument;
      // Complete export selects ZIP using this predicate. The prior
      // typeof-fileType check silently routed it to JSON and certified it.
      expect(backupOriginalDocuments([document])).toEqual([document]);
      await saveSourceOriginal(document, bytes);
      const exported = await createMediaBackupArchive({
        _app: "AXOM", _backupScope: "complete", documents: [document],
      }, [], backupOriginalDocuments([document]));
      expect(exported).toMatchObject({
        originalCount: 1, missingOriginalIds: [], missingBlobKeys: [],
      });
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
      const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
      expect(manifest.originals).toEqual([expect.objectContaining({
        documentId: document.id, sha256: document.checksum, mimeType: "text/plain",
      })]);
      const portable = await readPortableBackup(new File([exported.blob], "legacy-no-type.zip"));
      expect(portable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
      await deleteSourceOriginal(document.id);
      expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
      expect(await portable.restoreOriginals([document])).toEqual({ restored: 1, skipped: 0 });
      expect(await (await readSourceOriginal(document.id, document.checksum))?.text())
        .toBe("Historical source without a MIME declaration");
    },
  );

  it("reports an uncached absent-type source as omitted rather than a complete backup", async () => {
    const document = {
      id: "absent-type-uncached", title: "Missing original", fileName: "missing.txt",
      checksum: "a".repeat(64), uploadedAt: "2026-11-17", sizeBytes: 12,
    } as unknown as SourceDocument;
    expect(backupOriginalDocuments([document])).toEqual([document]);
    const exported = await createMediaBackupArchive({
      _app: "AXOM", _backupScope: "complete", documents: [document],
    }, [], backupOriginalDocuments([document]));
    expect(exported).toMatchObject({ originalCount: 0, missingOriginalIds: [document.id] });
    const portable = await readPortableBackup(new File([exported.blob], "absent-type-missing.zip"));
    expect(portable.omissions.missingOriginalIds).toEqual([document.id]);
  });

  it.each(["json", "zip"] as const)(
    "rejects conflicting absent/null-type original versions before $format recovery consent",
    async format => {
      const root = {
        id: "absent-type-conflict", title: "First original", checksum: "a".repeat(64),
      } as unknown as SourceDocument;
      const deferred = {
        ...root, title: "Second original", fileType: null, checksum: "b".repeat(64),
      } as unknown as SourceDocument;
      expect(() => backupOriginalDocuments([root, deferred]))
        .toThrow(/conflicting source.document checksums/i);
      const metadata = { _app: "AXOM", _backupScope: "complete",
        documents: [root], deferredContent: { documents: [deferred] } };
      if (format === "json") {
        await expect(readPortableBackup(new File([JSON.stringify(metadata)], "ambiguous.json")))
          .rejects.toThrow(/conflicting source.document checksums/i);
      } else {
        const exported = await createMediaBackupArchive({
          _app: "AXOM", _backupScope: "complete", documents: [root],
        }, [], [root]);
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(new Uint8Array(await exported.blob.arrayBuffer()));
        const manifest = JSON.parse(await zip.file("workspace.json")!.async("string"));
        manifest.deferredContent = { documents: [deferred] };
        zip.file("workspace.json", JSON.stringify(manifest));
        const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "ambiguous.zip");
        await expect(readPortableBackup(file)).rejects.toThrow(/conflicting source.document checksums/i);
      }
    },
  );

  it("keeps explicitly typed original authoritative over missing-type aliases and excludes internal claims", () => {
    const unspecified = {
      id: "missing-type-precedence", title: "Deferred metadata", checksum: "a".repeat(64),
    } as unknown as SourceDocument;
    const typed = { ...unspecified, fileType: "application/pdf", checksum: "b".repeat(64) };
    const internal = { ...unspecified, fileType: "axom-private-analysis", checksum: "c".repeat(64) };
    expect(backupOriginalDocuments([unspecified, internal, typed])).toEqual([typed]);
    expect(backupOriginalDocuments([internal])).toEqual([]);
  });

  it("rejects conflicting JSON source digests between two eligible external originals", async () => {
    const source = {
      id: "json-no-type-source", fileType: "text/plain",
      checksum: "a".repeat(64), title: "Expected source",
    };
    const payload = {
      _app: "AXOM", _backupScope: "complete",
      documents: [source],
      deferredContent: { documents: [{ ...source, fileType: "text/plain", checksum: "b".repeat(64) }] },
    };
    await expect(readPortableBackup(new File([JSON.stringify(payload)], "conflicting-no-type.json")))
      .rejects.toThrow(/conflicting source.document checksums/i);
  });


  it.each([
    { format: "json", mismatch: "size" },
    { format: "zip", mismatch: "size" },
    { format: "json", mismatch: "file type" },
    { format: "zip", mismatch: "file type" },
  ] as const)(
    "rejects same-digest root/deferred original aliases with conflicting $mismatch in $format before recovery",
    async ({ format, mismatch }) => {
      const source: SourceDocument = {
        id: "alias-metadata-original", title: "Original title", fileName: "source.txt",
        fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Immutable metadata",
        sizeBytes: 17, checksum: "a".repeat(64),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      const alias = mismatch === "size"
        ? { ...source, sizeBytes: source.sizeBytes + 1 }
        : { ...source, fileType: "application/pdf" };
      const payload = {
        _app: "AXOM", _backupScope: "complete",
        documents: [source],
        deferredContent: { documents: [alias] },
      };
      // No original bytes are needed for the identity contradiction. The
      // reader must refuse the metadata before Replace/Merge or staging.
      const backup = format === "zip"
        ? new File([(await createMediaBackupArchive(payload, [], [])).blob], "source-alias-metadata.zip")
        : new File([JSON.stringify(payload)], "source-alias-metadata.json");
      await expect(readPortableBackup(backup))
        .rejects.toThrow(/conflicting source.document (size|file type)/i);
    },
  );

  it.each(["zip", "json"] as const)(
    "preserves same-digest mirrored source edits and historically internal aliases in $format",
    async format => {
      const source: SourceDocument = {
        id: "mirror-original-identity", title: "Root source", fileName: "source.txt",
        fileType: "text/plain", uploadedAt: "2026-11-15", rawText: "Source metadata",
        sizeBytes: 21, checksum: "b".repeat(64),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      const payload = {
        _app: "AXOM", _backupScope: "complete",
        documents: [source],
        deferredContent: { documents: [
          { ...source, title: "Renamed deferred source", fileName: "renamed.txt", checksum: `sha256:${source.checksum}` },
          // Historical SourceDocument.fileType accepts MIME or extension labels.
          // Do not reject these semantically compatible representations.
          { ...source, fileType: "txt", title: "Legacy extension label" },
          // An internal record may share its ID but is not a claim about the
          // external original's MIME or byte length.
          { ...source, fileType: "axom-internal", sizeBytes: 99 },
        ] },
      };
      const input = format === "zip"
        ? new File([(await createMediaBackupArchive(payload, [], [])).blob], "matching-source-alias.zip")
        : new File([JSON.stringify(payload)], "matching-source-alias.json");
      const portable = await readPortableBackup(input);
      expect(portable.omissions).toEqual({
        missingBlobKeys: [],
        // Neither JSON nor a ZIP with no original members has source bytes.
        missingOriginalIds: [source.id],
      });
    },
  );

  it.each(["complete", "saved-work"] as const)(
    "discloses missing source-original bytes in historical $scope JSON even with duplicate aliases",
    async scope => {
      const root: SourceDocument = {
        id: "r128-json-root-original", title: "Root original", fileName: "source.txt",
        fileType: "text/plain", uploadedAt: "2026-11-17", rawText: "Root metadata",
        sizeBytes: 19, checksum: "a".repeat(64),
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      };
      // Historical deferred metadata omits fileType entirely. Missing bytes
      // must still be disclosed, including if the JSON claims to be complete.
      const deferred = {
        ...root, id: "r128-json-deferred-original", title: "Deferred original",
        checksum: "b".repeat(64), fileType: undefined,
      } as unknown as SourceDocument;
      const internal = {
        ...root, id: "r128-json-internal", fileType: "axom-private-analysis",
        checksum: "c".repeat(64),
      };
      const invalid = {
        ...root, id: "r128-json-unbound", checksum: "not-a-sha256",
      };
      const payload = {
        _app: "AXOM", _backupScope: scope,
        documents: [root, internal, invalid],
        deferredContent: { documents: [{ ...root, title: "Mirrored root" }, deferred] },
      };
      const rawText = JSON.stringify(payload);
      const portable = await readPortableBackup(new File([rawText], "historical-originals.json"));
      expect(portable.rawText).toBe(rawText);
      expect(portable.omissions).toEqual({
        missingBlobKeys: [], missingOriginalIds: [root.id, deferred.id],
      });
      // JSON includes source metadata but no original-file member or manifest.
      // Recovery must not fabricate or write missing original bytes.
      expect(await portable.restoreOriginals([root, deferred])).toEqual({ restored: 0, skipped: 0 });
      expect(await readSourceOriginal(root.id, root.checksum)).toBeUndefined();
    },
  );

  it("does not invent missing originals for JSON without checksum-bound external sources", async () => {
    const onlyMetadata = {
      _app: "AXOM", documents: [
        { id: "r128-internal", fileType: "axom-internal", checksum: "a".repeat(64) },
        { id: "r128-invalid", fileType: "text/plain", checksum: "invalid" },
        { id: "r128-unhashed", fileType: "text/plain" },
      ],
    };
    const portable = await readPortableBackup(new File([JSON.stringify(onlyMetadata)], "metadata.json"));
    expect(portable.omissions).toEqual({ missingBlobKeys: [], missingOriginalIds: [] });
  });

});
