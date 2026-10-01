import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
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
  restoreQuestionAttachmentPayloads,
  runQuestionAttachmentMaintenance,
  validateQuestionAttachmentFile,
  type QuestionImageAttachment,
} from "./questionAttachments";
import { DB_NAME, DB_VERSION, STORE_NAME, BACKUP_STORE_NAME, ATTACHMENT_STORE_NAME } from "./localVault";

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
  it("deletes unreferenced blobs, reports missing blobs, never touches referenced ones", async () => {
    await putQuestionAttachmentBlob("referenced", { blob: new Blob(["a"]), mimeType: "image/png", byteSize: 1, questionId: "q1", updatedAt: "t" });
    await putQuestionAttachmentBlob("orphan", { blob: new Blob(["b"]), mimeType: "image/png", byteSize: 1, questionId: "gone", updatedAt: "t" });
    const questions = [
      { attachments: [metadata({ id: "referenced" }), metadata({ id: "missing-blob" })] },
    ];
    const report = await runQuestionAttachmentMaintenance(questions);
    expect(report.deletedOrphanBlobKeys).toEqual(["orphan"]);
    expect(report.missingBlobKeys).toEqual(["missing-blob"]);
    expect(await listQuestionAttachmentBlobKeys()).toEqual(["referenced"]);
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
