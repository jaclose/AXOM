// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { deflateSync } from "node:zlib";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal, deleteSourceOriginal, SOURCE_ORIGINALS_DB } from "./decode/sources";
import type { SourceDocument } from "./library";
import { closeWorkspace, openEmptyWorkspace } from "./question-content/persistenceHarness.testing";
import { MAX_ZIP_BACKUP_ENTRIES, assertRestorableZipBudget, assertRestorableZipEntryCounts, collectVerifiedMediaBackupPayloads, createMediaBackupArchive, mediaBackupBytes, readPortableBackup } from "./backupArchive";
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
});
