import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_EXPORT_KEY,
  base64ToBytes,
  blobToBase64,
  collectQuestionAttachmentPayloads,
  createQuestionAttachment,
  deleteQuestionAttachmentBlobs,
  extractQuestionAttachmentPayloads,
  getQuestionAttachmentBlob,
  listQuestionAttachmentBlobKeys,
  MAX_QUESTION_ATTACHMENT_BYTES,
  MAX_QUESTION_ATTACHMENTS,
  normalizeAttachmentFileName,
  normalizeQuestionAttachments,
  putQuestionAttachmentBlob,
  restoreMissingQuestionAttachment,
  restoreQuestionAttachmentPayloads,
  stageQuestionAttachmentPayloads,
  runQuestionAttachmentMaintenance,
  validateQuestionAttachmentFile,
  validateMissingQuestionAttachmentFile,
  type QuestionImageAttachment,
} from "./questionAttachments";
import { DB_NAME, DB_VERSION, STORE_NAME, BACKUP_STORE_NAME, ATTACHMENT_STORE_NAME, ensureVaultStores } from "./localVault";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function pngFile(name = "figure.png", bytes: Uint8Array = PNG_BYTES): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type: "image/png" });
}

function metadata(overrides: Partial<QuestionImageAttachment> = {}): QuestionImageAttachment {
  return {
    id: "attachment-1",
    fileName: "figure.png",
    mimeType: "image/png",
    byteSize: PNG_BYTES.byteLength,
    altText: "",
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
    blobKey: overrides.id ?? "attachment-1",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  await deleteDatabase(DB_NAME);
});

afterEach(() => vi.unstubAllGlobals());

describe("validation", () => {
  it("accepts the four supported image types and rejects everything else", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(validateQuestionAttachmentFile({ name: "a", type, size: 10 }).ok).toBe(true);
    }
    for (const type of ["image/svg+xml", "application/pdf", "text/html", "video/mp4", ""]) {
      const result = validateQuestionAttachmentFile({ name: "a", type, size: 10 });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects zero-byte and oversized files with specific messages", () => {
    const empty = validateQuestionAttachmentFile({ name: "x.png", type: "image/png", size: 0 });
    expect(empty).toMatchObject({ ok: false, message: expect.stringContaining("empty") });
    const big = validateQuestionAttachmentFile({ name: "x.png", type: "image/png", size: MAX_QUESTION_ATTACHMENT_BYTES + 1 });
    expect(big).toMatchObject({ ok: false, message: "This image is larger than the 8 MB limit." });
  });

  it("enforces the per-question count and total-byte limits", () => {
    const ten = Array.from({ length: MAX_QUESTION_ATTACHMENTS }, (_, i) => metadata({ id: `attachment-${i}` }));
    const capped = validateQuestionAttachmentFile({ name: "x.png", type: "image/png", size: 10 }, ten);
    expect(capped).toMatchObject({ ok: false, message: `This question already has ${MAX_QUESTION_ATTACHMENTS} attachments.` });
    const heavy = [metadata({ id: "a", byteSize: 8 * 1024 * 1024 }), metadata({ id: "b", byteSize: 8 * 1024 * 1024 }), metadata({ id: "c", byteSize: 8 * 1024 * 1024 })];
    const total = validateQuestionAttachmentFile({ name: "x.png", type: "image/png", size: 7 * 1024 * 1024 }, heavy);
    expect(total).toMatchObject({ ok: false, message: expect.stringContaining("30 MB") });
  });

  it("normalizes hostile filenames and keeps an extension-safe fallback", () => {
    expect(normalizeAttachmentFileName("../..\\evil:name?.png", "image/png")).not.toContain("/");
    expect(normalizeAttachmentFileName("", "image/jpeg")).toBe("image.jpg");
    expect(normalizeAttachmentFileName("\u0000\u0001", "image/webp")).toBe("image.webp");
  });
});

describe("missing direct-image repair", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1536, height: 946, close: vi.fn() })));
  });

  it("requires the recorded name, format, size, and decoded dimensions", async () => {
    const original = pngFile("original.png");
    const attachment = metadata({ fileName: "original.png", width: 1536, height: 946 });
    expect(await validateMissingQuestionAttachmentFile(original, attachment)).toEqual({ ok: true });
    expect(await validateMissingQuestionAttachmentFile(pngFile("other.png"), attachment))
      .toMatchObject({ ok: false, message: expect.stringContaining("original file named") });
    expect(await validateMissingQuestionAttachmentFile(original, { ...attachment, byteSize: 1 }))
      .toMatchObject({ ok: false, message: expect.stringContaining("different file size") });
    expect(await validateMissingQuestionAttachmentFile(original, { ...attachment, width: 100 }))
      .toMatchObject({ ok: false, message: expect.stringContaining("different image dimensions") });
    expect(await validateMissingQuestionAttachmentFile(original, { ...attachment, mimeType: "image/jpeg" }))
      .toMatchObject({ ok: false });
    expect(await validateMissingQuestionAttachmentFile(original, { ...attachment, blobKey: "private-library:shared" }))
      .toMatchObject({ ok: false, message: expect.stringContaining("source library") });
  });

  it("restores under the existing key, reads exact bytes back, and does not overwrite a second attempt", async () => {
    const attachment = metadata({ width: 1536, height: 946 });
    const file = pngFile();
    expect(await restoreMissingQuestionAttachment({ attachment, file, questionId: "q1" }))
      .toEqual({ status: "restored" });
    const stored = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true });
    expect(stored).toMatchObject({ questionId: "q1", mimeType: "image/png", byteSize: file.size });
    expect([...new Uint8Array(await stored!.blob.arrayBuffer())]).toEqual([...PNG_BYTES]);
    const changedBytes = new Uint8Array(PNG_BYTES);
    changedBytes[changedBytes.length - 1] ^= 1;
    const second = await restoreMissingQuestionAttachment({ attachment, file: pngFile("figure.png", changedBytes), questionId: "q1" });
    expect(second).toMatchObject({ status: "exists" });
    expect([...new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true }))!.blob.arrayBuffer())])
      .toEqual([...PNG_BYTES]);
  });

  it("does not write a mismatched candidate", async () => {
    const attachment = metadata({ byteSize: PNG_BYTES.byteLength + 1 });
    expect(await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" }))
      .toMatchObject({ status: "rejected" });
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it.each([
    ["QuotaExceededError", /browser reported a storage-space limit/i],
    ["AbortError", /interrupted the image-storage transaction \(AbortError\)/i],
    ["TransactionInactiveError", /interrupted the image-storage transaction \(TransactionInactiveError\)/i],
    ["DataCloneError", /could not store the selected file/i],
    ["NotFoundError", /image store is unavailable/i],
  ])("explains a plain %s without claiming a restore or exposing raw error text", async (name, expected) => {
    const originalAdd = FakeIDBObjectStore.prototype.add;
    const add = vi.spyOn(FakeIDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === ATTACHMENT_STORE_NAME) throw Object.assign(new Error("private browser implementation details"), { name });
      return originalAdd.call(this, value, key);
    });
    try {
      const result = await restoreMissingQuestionAttachment({ attachment: metadata(), file: pngFile(), questionId: "q1" });
      expect(result).toMatchObject({ status: "failed", message: expect.stringMatching(expected) });
      expect(JSON.stringify(result)).not.toContain("private browser implementation details");
    } finally { add.mockRestore(); }
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it("reports a newer database version without guessing that storage is full", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const result = await restoreMissingQuestionAttachment({ attachment: metadata(), file: pngFile(), questionId: "q1" });
    expect(result).toMatchObject({ status: "failed", message: expect.stringContaining("older image-store version") });
  });

  it("explains an upgrade blocked by an older tab and can retry after it closes", async () => {
    const older = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION - 1);
      request.onupgradeneeded = () => ensureVaultStores(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    older.onversionchange = () => {};
    try {
      expect(await restoreMissingQuestionAttachment({ attachment: metadata(), file: pngFile(), questionId: "q1" }))
        .toMatchObject({ status: "failed", message: expect.stringContaining("Close older AXOM tabs") });
    } finally { older.close(); }
    expect(await restoreMissingQuestionAttachment({ attachment: metadata(), file: pngFile(), questionId: "q1" }))
      .toEqual({ status: "restored" });
  });

  it("keeps a concurrent winner intact when add returns a non-DOM ConstraintError", async () => {
    const attachment = metadata();
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: pngFile(), questionId: "q1", mimeType: "image/png", byteSize: PNG_BYTES.length, updatedAt: attachment.updatedAt,
    });
    const originalGet = FakeIDBObjectStore.prototype.get;
    const originalAdd = FakeIDBObjectStore.prototype.add;
    let firstRead = true;
    const get = vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === ATTACHMENT_STORE_NAME && firstRead) { firstRead = false; return originalGet.call(this, "simulate-pre-race-miss"); }
      return originalGet.call(this, key);
    });
    const add = vi.spyOn(FakeIDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === ATTACHMENT_STORE_NAME) throw Object.assign(new Error("Concurrent key reservation"), { name: "ConstraintError" });
      return originalAdd.call(this, value, key);
    });
    try {
      expect(await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" }))
        .toMatchObject({ status: "exists", message: expect.stringContaining("did not replace") });
    } finally { get.mockRestore(); add.mockRestore(); }
    expect([...new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())]).toEqual([...PNG_BYTES]);
  });

  it("retains a malformed reserved row and reports unavailable bytes instead of an available image", async () => {
    const attachment = metadata();
    const damaged = { questionId: "q1", mimeType: "image/png" as const, byteSize: PNG_BYTES.length, updatedAt: attachment.updatedAt };
    await putQuestionAttachmentBlob(attachment.blobKey, damaged as Parameters<typeof putQuestionAttachmentBlob>[1]);
    const result = await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" });
    expect(result).toMatchObject({ status: "failed", message: expect.stringContaining("reserves this key") });
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toEqual(damaged);
  });

  it("does not replace a dangling null row when its reserved key causes a real IndexedDB constraint failure", async () => {
    const attachment = metadata();
    await putQuestionAttachmentBlob(attachment.blobKey, null as unknown as Parameters<typeof putQuestionAttachmentBlob>[1]);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
    expect(await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" }))
      .toMatchObject({ status: "failed", message: expect.stringContaining("reserves this key") });
    expect(await listQuestionAttachmentBlobKeys()).toEqual([attachment.blobKey]);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true })).toBeUndefined();
  });

  it("does not call a Blob descriptor available when its backing bytes cannot be read", async () => {
    const attachment = metadata();
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([PNG_BYTES]), questionId: "q1", mimeType: "image/png", byteSize: PNG_BYTES.length, updatedAt: attachment.updatedAt,
    });
    const read = vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValue(Object.assign(new Error("Backing bytes unavailable"), { name: "NotReadableError" }));
    try {
      expect(await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" }))
        .toMatchObject({ status: "failed", message: expect.stringContaining("could not read the image bytes") });
    } finally { read.mockRestore(); }
    expect([...new Uint8Array(await (await getQuestionAttachmentBlob(attachment.blobKey))!.blob.arrayBuffer())]).toEqual([...PNG_BYTES]);
  });

  it("does not claim success when the just-written blob cannot be read back", async () => {
    const attachment = metadata({ width: 1536, height: 946 });
    const originalGet = FakeIDBObjectStore.prototype.get;
    const getSpy = vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
      // Only the image read is unavailable; the ownership receipt must remain
      // readable so this exercises verification rather than a different fault.
      return originalGet.call(this, this.name === ATTACHMENT_STORE_NAME ? "another-key" : key);
    });
    try {
      const result = await restoreMissingQuestionAttachment({ attachment, file: pngFile(), questionId: "q1" });
      expect(result).toMatchObject({ status: "failed", message: expect.stringContaining("could not be verified") });
    } finally {
      getSpy.mockRestore();
    }
    expect(await listQuestionAttachmentBlobKeys()).toEqual([attachment.blobKey]);
  });
});

describe("metadata normalization", () => {
  it("drops invalid entries, dedupes by id keeping later updatedAt, [] → undefined", () => {
    expect(normalizeQuestionAttachments([])).toBeUndefined();
    expect(normalizeQuestionAttachments("junk")).toBeUndefined();
    const normalized = normalizeQuestionAttachments([
      metadata({ id: "dup", altText: "old", updatedAt: "2026-07-17T10:00:00.000Z" }),
      metadata({ id: "dup", altText: "new", updatedAt: "2026-07-17T11:00:00.000Z" }),
      { id: "bad", mimeType: "image/svg+xml", byteSize: 5, createdAt: "x", updatedAt: "x" },
      { nonsense: true },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toMatchObject({ id: "dup", altText: "new" });
  });

  it("keeps an exhibit an exhibit through a save and reload, and ignores any other role", () => {
    const [exhibit, note, odd] = normalizeQuestionAttachments([
      metadata({ id: "a", role: "exhibit" }),
      metadata({ id: "b" }),
      { ...metadata({ id: "c" }), role: "banner" },
    ])!;
    expect(exhibit.role).toBe("exhibit");
    expect("role" in note).toBe(false);
    expect("role" in odd).toBe(false);
  });
});

describe("blob store", () => {
  it("round-trips exact bytes and MIME through the dedicated store", async () => {
    const result = await createQuestionAttachment({ file: pngFile(), questionId: "q1", existing: [] });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    const record = await getQuestionAttachmentBlob(result.attachment.blobKey);
    expect(record?.mimeType).toBe("image/png");
    expect(record?.questionId).toBe("q1");
    const bytes = new Uint8Array(await record!.blob.arrayBuffer());
    expect([...bytes]).toEqual([...PNG_BYTES]);
  });

  it("creates the attachment store alongside existing vault stores (v32 workspace data untouched)", async () => {
    await putQuestionAttachmentBlob("k", { blob: new Blob([PNG_BYTES.buffer as ArrayBuffer]), mimeType: "image/png", byteSize: 4, questionId: "q", updatedAt: "t" } as never);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect([...db.objectStoreNames].sort()).toEqual([BACKUP_STORE_NAME, ATTACHMENT_STORE_NAME, STORE_NAME].sort());
    db.close();
  });

  it("deletes only the targeted blob", async () => {
    await putQuestionAttachmentBlob("keep", { blob: new Blob(["a"]), mimeType: "image/png", byteSize: 1, questionId: "q", updatedAt: "t" });
    await putQuestionAttachmentBlob("drop", { blob: new Blob(["b"]), mimeType: "image/png", byteSize: 1, questionId: "q", updatedAt: "t" });
    await deleteQuestionAttachmentBlobs(["drop"]);
    expect(await listQuestionAttachmentBlobKeys()).toEqual(["keep"]);
  });
});

describe("orphan maintenance", () => {
  const record = (bytes: string, questionId: string) => ({
    blob: new Blob([bytes]), mimeType: "image/png" as const,
    byteSize: bytes.length, questionId, updatedAt: "t",
  });

  it("preserves unowned device bytes and reports missing references without deleting them", async () => {
    await putQuestionAttachmentBlob("referenced", record("a", "q1"));
    await putQuestionAttachmentBlob("orphan", record("b", "gone"));
    const questions = [
      { attachments: [metadata({ id: "referenced" }), metadata({ id: "missing-blob" })] },
    ];
    const report = await runQuestionAttachmentMaintenance(questions);
    expect(report.deletedOrphanBlobKeys).toEqual([]);
    expect(report.preservedUnscopedBlobCount).toBe(1);
    expect(report.missingBlobKeys).toEqual(["missing-blob"]);
    expect(await listQuestionAttachmentBlobKeys()).toEqual(["orphan", "referenced"]);

    // Targeted user-initiated deletion still works, unlike an unscoped sweep.
    await deleteQuestionAttachmentBlobs(["orphan"]);
    expect(await listQuestionAttachmentBlobKeys()).toEqual(["referenced"]);
  });

  it("does not erase A's non-private attachment across simulated disjoint and empty B hydration", async () => {
    await putQuestionAttachmentBlob("account-A-attachment", record("account-A-original", "A-question"));
    await putQuestionAttachmentBlob("account-B-attachment", record("account-B-original", "B-question"));
    const bWorkspace = [{ attachments: [metadata({
      id: "account-B-attachment", blobKey: "account-B-attachment",
    })] }];
    const bReport = await runQuestionAttachmentMaintenance(bWorkspace);
    expect(bReport.deletedOrphanBlobKeys).toEqual([]);
    expect(bReport.preservedUnscopedBlobCount).toBe(1);

    // A completely empty workspace is not proof this origin's Blob store
    // belongs to that account, including during a fresh B rehydration.
    const emptyReport = await runQuestionAttachmentMaintenance([]);
    expect(emptyReport.deletedOrphanBlobKeys).toEqual([]);
    expect(emptyReport.preservedUnscopedBlobCount).toBe(2);

    const a = await getQuestionAttachmentBlob("account-A-attachment", { localOnly: true });
    const b = await getQuestionAttachmentBlob("account-B-attachment", { localOnly: true });
    expect(a).toMatchObject({ questionId: "A-question", byteSize: 18 });
    expect(b).toMatchObject({ questionId: "B-question", byteSize: 18 });
    expect(await a!.blob.text()).toBe("account-A-original");
    expect(await b!.blob.text()).toBe("account-B-original");
  });
});

describe("portable backup payloads", () => {
  it("collects exact base64 bytes for export and reports unavailable blobs", async () => {
    const created = await createQuestionAttachment({ file: pngFile(), questionId: "q1", existing: [] });
    if (created.status !== "created") throw new Error("setup failed");
    const questions = [
      { id: "q1", attachments: [created.attachment] },
      { id: "q2", attachments: [metadata({ id: "lost" })] },
    ];
    const { payloads, missingBlobKeys } = await collectQuestionAttachmentPayloads(questions);
    expect(missingBlobKeys).toEqual(["lost"]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].questionId).toBe("q1");
    expect([...base64ToBytes(payloads[0].base64)!]).toEqual([...PNG_BYTES]);
  });

  it("extract rejects malformed, oversized, and unowned payloads", () => {
    const good = { ...metadata({ id: "ok" }), questionId: "q1", base64: "aGVsbG8=" };
    const extracted = extractQuestionAttachmentPayloads({
      [ATTACHMENT_EXPORT_KEY]: [
        good,
        { ...metadata({ id: "no-owner" }), base64: "aGVsbG8=" },
        { ...metadata({ id: "no-bytes" }), questionId: "q1" },
        { ...metadata({ id: "huge" }), questionId: "q1", base64: "A".repeat(12 * 1024 * 1024) },
        "garbage",
      ],
    });
    expect(extracted.map((p) => p.id)).toEqual(["ok"]);
    expect(extractQuestionAttachmentPayloads(null)).toEqual([]);
    expect(extractQuestionAttachmentPayloads({})).toEqual([]);
  });

  it("restores exact bytes for surviving metadata and round-trips export → import", async () => {
    const base64 = await blobToBase64(new Blob([PNG_BYTES.buffer as ArrayBuffer]));
    const meta = metadata({ id: "attachment-rt" });
    const restoredCount = await restoreQuestionAttachmentPayloads(
      [{ ...meta, questionId: "q1", base64 }],
      [{ id: "q1", attachments: [meta] }],
    );
    expect(restoredCount.restored).toBe(1);
    const record = await getQuestionAttachmentBlob(meta.blobKey);
    expect([...new Uint8Array(await record!.blob.arrayBuffer())]).toEqual([...PNG_BYTES]);
  });

  it("same id, different bytes: the payload wins only when at least as new (deterministic)", async () => {
    const older = "2026-07-17T09:00:00.000Z";
    const newer = "2026-07-17T12:00:00.000Z";
    await putQuestionAttachmentBlob("attachment-c", { blob: new Blob(["current"]), mimeType: "image/png", byteSize: 7, questionId: "q1", updatedAt: newer });
    const meta = metadata({ id: "attachment-c", updatedAt: older });
    const skipped = await restoreQuestionAttachmentPayloads(
      [{ ...meta, questionId: "q1", base64: await blobToBase64(new Blob(["imported"])) }],
      [{ id: "q1", attachments: [meta] }],
    );
    expect(skipped).toEqual({ restored: 0, skipped: 1 });

    const winningMeta = metadata({ id: "attachment-c", updatedAt: "2026-07-17T13:00:00.000Z", byteSize: 8 });
    const won = await restoreQuestionAttachmentPayloads(
      [{ ...winningMeta, questionId: "q1", base64: await blobToBase64(new Blob(["imported"])) }],
      [{ id: "q1", attachments: [winningMeta] }],
    );
    expect(won.restored).toBe(1);
    const record = await getQuestionAttachmentBlob("attachment-c");
    expect(await record!.blob.text()).toBe("imported");
  });

  it("payloads for questions the merge dropped are skipped (never attach to the wrong question)", async () => {
    const meta = metadata({ id: "attachment-x" });
    const result = await restoreQuestionAttachmentPayloads(
      [{ ...meta, questionId: "gone", base64: "aGVsbG8=" }],
      [{ id: "q1", attachments: [] }],
    );
    expect(result).toEqual({ restored: 0, skipped: 1 });
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it("stages only absent immutable blob keys and rolls back only its own bytes", async () => {
    const existing = metadata({ id: "existing" });
    const added = metadata({ id: "added" });
    await putQuestionAttachmentBlob(existing.blobKey, {
      blob: new Blob([PNG_BYTES.buffer as ArrayBuffer]), mimeType: "image/png",
      byteSize: PNG_BYTES.byteLength, questionId: "q1", updatedAt: existing.updatedAt,
    });
    const stage = await stageQuestionAttachmentPayloads([
      { ...existing, questionId: "q1", base64: await blobToBase64(new Blob([PNG_BYTES.buffer as ArrayBuffer])) },
      { ...added, questionId: "q1", base64: await blobToBase64(new Blob([PNG_BYTES.buffer as ArrayBuffer])) },
    ], [{ id: "q1", attachments: [existing, added] }]);
    expect(stage).toMatchObject({ restored: 1, skipped: 1 });
    await stage.rollback();
    expect(await getQuestionAttachmentBlob(existing.blobKey)).toBeTruthy();
    expect(await getQuestionAttachmentBlob(added.blobKey)).toBeUndefined();
  });

  it("rejects a colliding immutable blob key without changing its bytes", async () => {
    const meta = metadata({ id: "collision", byteSize: 8 });
    await putQuestionAttachmentBlob(meta.blobKey, {
      blob: new Blob(["original"]), mimeType: "image/png", byteSize: 8,
      questionId: "q1", updatedAt: meta.updatedAt,
    });
    await expect(stageQuestionAttachmentPayloads(
      [{ ...meta, questionId: "q1", base64: await blobToBase64(new Blob(["imported"])) }],
      [{ id: "q1", attachments: [meta] }],
    )).rejects.toThrow("existing storage key with different bytes");
    expect(await (await getQuestionAttachmentBlob(meta.blobKey))!.blob.text()).toBe("original");
  });
});

describe("creation flow", () => {
  it("rejects unsupported/oversized before any blob write; failures leave no orphan", async () => {
    const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    const rejected = await createQuestionAttachment({ file: svg, questionId: "q1", existing: [] });
    expect(rejected.status).toBe("rejected");
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it("no localStorage is touched by attachment storage", async () => {
    const calls: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => { calls.push(`get:${k}`); return null; },
      setItem: (k: string) => { calls.push(`set:${k}`); },
      removeItem: () => {},
      clear: () => {}, key: () => null, length: 0,
    });
    const created = await createQuestionAttachment({ file: pngFile(), questionId: "q1", existing: [] });
    expect(created.status).toBe("created");
    expect(calls.filter((c) => c.startsWith("set:"))).toEqual([]);
  });
});
