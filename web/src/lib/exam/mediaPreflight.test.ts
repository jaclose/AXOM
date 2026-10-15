// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { QuestionImageAttachment, QuestionAttachmentBlobRecord } from "../questionAttachments";
import type { QuestionRecord } from "../questions";
import type { PackageQuestion, QuestionAsset } from "../question-content/package";
import { preflightQuestionMedia, requiredQuestionMedia } from "./mediaPreflight";

const png = new Blob(["real-image-example"], { type: "image/png" });
function attachment(id: string, role: QuestionImageAttachment["role"] = "question", patch: Partial<QuestionImageAttachment> = {}): QuestionImageAttachment {
  return {
    id: `attachment-${id}`, assetId: id, fileName: `${id}.png`, mimeType: "image/png",
    byteSize: png.size, altText: "Source figure", blobKey: `blob-${id}`,
    role, createdAt: "2026-10-14", updatedAt: "2026-10-14", ...patch,
  };
}
function asset(id: string, role: QuestionAsset["role"] = "question", patch: Partial<QuestionAsset> = {}): QuestionAsset {
  return { id, filename: `${id}.png`, role, mimeType: "image/png", questionId: "q1", ...patch };
}
function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: "q1", stem: "Recognize the microscopic pattern", source: "imported",
    options: [{ key: "A", text: "Yes" }, { key: "B", text: "No" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: "2026-10-14", updatedAt: "2026-10-14", ...patch,
  };
}
function content(assets: QuestionAsset[], stemImages: Array<{ type: "image"; assetId: string; role?: QuestionAsset["role"] }> = []): PackageQuestion {
  return { id: "source-1", stem: stemImages, choices: [], assets } as unknown as PackageQuestion;
}
function record(id = "q1", blob: Blob = png): QuestionAttachmentBlobRecord {
  return { blob, questionId: id, byteSize: blob.size, mimeType: "image/png", updatedAt: "2026-10-14" };
}

describe("essential pre-answer medical media selection", () => {
  it("only requires displayed clinical figures and choices, never answer/source pages, explanation or note images", () => {
    const q = question({
      content: content([
        asset("stem"), asset("choice", "choice"), asset("answer", "answer_reveal"),
        asset("source", "source_page"), asset("explain", "explanation"),
      ], [
        { type: "image", assetId: "stem" }, { type: "image", assetId: "answer" },
        { type: "image", assetId: "source" },
      ]),
      attachments: [
        attachment("stem"), attachment("choice", "choice"), attachment("answer", "answer_reveal"),
        attachment("source", "source_page"), attachment("explain", "explanation"),
        attachment("notes", "question", { role: undefined }),
      ],
    });
    expect(requiredQuestionMedia(q).map((value) => value.assetId)).toEqual(["stem", "choice"]);
  });

  it("a source's restricted answer asset overrides a wrongly classified exhibit attachment", () => {
    const mixed = question({
      content: content([asset("answer-slide", "answer_reveal")]),
      attachments: [attachment("answer-slide", "exhibit")],
    });
    expect(requiredQuestionMedia(mixed)).toEqual([]);
  });

  it("requires legacy exhibit images but not unclassified personal note attachments", () => {
    expect(requiredQuestionMedia(question({
      attachments: [attachment("ecg", "exhibit"), attachment("note", "question", { role: undefined }), attachment("source", "source_page")],
    })).map((reference) => reference.assetId)).toEqual(["ecg"]);
  });

  it("holds a source image referenced by its stem when blob metadata is missing", async () => {
    const load = vi.fn();
    const check = await preflightQuestionMedia([question({ content: content([asset("absent")], [{ type: "image", assetId: "absent" }]) })], { load });
    expect(check.issues).toEqual([{ questionId: "q1", assetId: "absent", code: "missing-metadata" }]);
    expect(check.blockedQuestionIds).toEqual(["q1"]);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("bounded figure-byte trust", () => {
  const clinical = () => question({
    content: content([asset("ecg")], [{ type: "image", assetId: "ecg" }]),
    attachments: [attachment("ecg")],
  });

  it("passes a locally present image only when question identity, type and length match", async () => {
    const onProgress = vi.fn();
    const verified = await preflightQuestionMedia([clinical()], {
      load: async () => record(), decode: async () => true, onProgress,
    });
    expect(verified).toMatchObject({ total: 1, available: 1, decoded: 1, issues: [], blockedQuestionIds: [], cancelled: false });
    expect(onProgress).toHaveBeenCalledWith({ total: 1, checked: 1, available: 1, blocked: 0 });
  });

  it.each([
    ["missing-bytes", undefined],
    ["wrong-question", record("another-person")],
    ["size-mismatch", { ...record(), byteSize: 17 }],
    ["type-mismatch", { ...record(), mimeType: "image/jpeg" as const }],
  ])("fails closed on %s", async (expected, incoming) => {
    const verified = await preflightQuestionMedia([clinical()], { load: async () => incoming, decode: async () => true });
    expect(verified).toMatchObject({ available: 0, blockedQuestionIds: ["q1"] });
    expect(verified.issues).toEqual([{ questionId: "q1", assetId: "ecg", code: expected }]);
  });

  it("compares sha256 assets when a source checksum is provided", async () => {
    const digest = createHash("sha256").update(new Uint8Array(await png.arrayBuffer())).digest("hex");
    const source = question({
      content: content([asset("ecg", "question", { checksum: `sha256:${digest}` })], [{ type: "image", assetId: "ecg" }]),
      attachments: [attachment("ecg")],
    });
    const options = { load: async () => record(), decode: async () => true, hash: async () => digest };
    const good = await preflightQuestionMedia([source], options);
    expect(good).toMatchObject({ available: 1, hashesVerified: 1, blockedQuestionIds: [] });
    const changed = await preflightQuestionMedia([source], { ...options, hash: async () => "0".repeat(64) });
    expect(changed.issues.map((value) => value.code)).toEqual(["checksum-mismatch"]);
  });

  it("allows two questions to share one exact checksum-addressed private-library object", async () => {
    const digest = createHash("sha256").update(new Uint8Array(await png.arrayBuffer())).digest("hex");
    const blobKey = `private-library:sha256:${digest}`;
    const sharedQuestion = (id: string, assetId: string) => question({
      id,
      content: content([
        asset(assetId, "question", { questionId: id, checksum: `sha256:${digest}` }),
      ], [{ type: "image", assetId }]),
      attachments: [attachment(assetId, "question", { blobKey })],
    });
    const sharedRecord = record("q2");
    const verified = await preflightQuestionMedia([
      sharedQuestion("q1", "figure-one"),
      sharedQuestion("q2", "figure-two"),
    ], {
      load: async () => sharedRecord,
      decode: async () => true,
      hash: async () => digest,
    });

    expect(verified).toMatchObject({
      total: 2, available: 2, hashesVerified: 2, decoded: 2,
      issues: [], blockedQuestionIds: [],
    });

    const unbound = sharedQuestion("q1", "figure-one");
    unbound.attachments![0].blobKey = "private-library:not-the-checksum";
    const refused = await preflightQuestionMedia([unbound], {
      load: async () => sharedRecord,
      decode: async () => true,
      hash: async () => digest,
    });
    expect(refused.issues).toEqual([{ questionId: "q1", assetId: "figure-one", code: "wrong-question" }]);
  });

  it("rejects invalid decodes even when the stored byte count matches", async () => {
    const result = await preflightQuestionMedia([clinical()], { load: async () => record(), decode: async () => false });
    expect(result.issues[0].code).toBe("decode-failed");
    expect(result.available).toBe(0);
  });

  it("bounds slow media loaders and does not continue scheduling after cancellation", async () => {
    const waiting = [1, 2, 3, 4].map((i) => question({
      id: `q${i}`, attachments: [attachment(`ecg-${i}`)],
    }));
    const timeout = await preflightQuestionMedia([waiting[0]], {
      load: () => new Promise(() => {}), timeoutMs: 100,
    });
    expect(timeout.issues[0].code).toBe("timeout");
    const abort = new AbortController();
    let called = 0;
    const pending = preflightQuestionMedia(waiting, {
      signal: abort.signal, concurrency: 2, decode: async () => true,
      load: async () => { called++; abort.abort(); return record("q1"); },
    });
    const ended = await pending;
    expect(ended.cancelled).toBe(true);
    expect(called).toBeLessThan(4);
  });
});

describe("image decoder fallback and fail-closed behavior", () => {
  it("does not mark an image ready if no browser decoder is available", async () => {
    const originalImage = globalThis.Image;
    const originalBitmap = globalThis.createImageBitmap;
    try {
      vi.stubGlobal("createImageBitmap", undefined);
      vi.stubGlobal("Image", class NoImageDecoder {});
      const q = question({
        content: content([asset("ecg")], [{ type: "image", assetId: "ecg" }]),
        attachments: [attachment("ecg")],
      });
      const result = await preflightQuestionMedia([q], { load: async () => record() });
      expect(result.issues).toEqual([{ questionId: "q1", assetId: "ecg", code: "decode-failed" }]);
      expect(result.decoded).toBe(0);
    } finally {
      vi.stubGlobal("Image", originalImage);
      vi.stubGlobal("createImageBitmap", originalBitmap);
      vi.unstubAllGlobals();
    }
  });
});

describe("GIF media contract and protected answer/source roles", () => {
  const gifBytes = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const gifBlob = new Blob([gifBytes], { type: "image/gif" });
  const gifSha = createHash("sha256").update(gifBytes).digest("hex");
  const gifAttachment = (id: string, role: QuestionImageAttachment["role"]): QuestionImageAttachment =>
    attachment(id, role, {
      fileName: `${id}.gif`, mimeType: "image/gif", byteSize: gifBytes.byteLength,
      blobKey: `blob-${id}`,
    });
  const gifAsset = (id: string, role: QuestionAsset["role"]) =>
    asset(id, role, { filename: `${id}.gif`, mimeType: "image/gif", checksum: `sha256:${gifSha}` });
  const mediaQuestion = () => question({
    content: content([
      gifAsset("stem-animation", "question"),
      gifAsset("marked-answer", "answer_reveal"),
      gifAsset("source-scan", "source_page"),
    ], [
      { type: "image", assetId: "stem-animation", role: "question" },
      // Even an incorrectly labeled stem placement cannot reveal these roles.
      { type: "image", assetId: "marked-answer", role: "question" },
      { type: "image", assetId: "source-scan", role: "question" },
    ]),
    attachments: [
      gifAttachment("stem-animation", "question"),
      gifAttachment("marked-answer", "exhibit"),
      gifAttachment("source-scan", "exhibit"),
    ],
  });

  it("reads only the essential GIF, verifies exact SHA-256/size/MIME/owner, and never fetches answer or source slides", async () => {
    const required = requiredQuestionMedia(mediaQuestion());
    expect(required.map((entry) => entry.assetId)).toEqual(["stem-animation"]);
    const load = vi.fn(async (_key: string) => ({
      blob: gifBlob, mimeType: "image/gif" as const, byteSize: gifBytes.byteLength,
      questionId: "q1", updatedAt: "2026-10-14",
    }));
    const checked = await preflightQuestionMedia([mediaQuestion()], {
      load, decode: async (blob) => blob.size === gifBytes.byteLength && blob.type === "image/gif",
      hash: async (blob) => createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex"),
    });
    expect(checked).toMatchObject({ total: 1, available: 1, hashesVerified: 1, decoded: 1,
      issues: [], blockedQuestionIds: [], cancelled: false });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("blob-stem-animation");
  });

  it("blocks an altered GIF with unchanged byte length before scoring", async () => {
    const tampered = new Uint8Array(gifBytes);
    tampered[tampered.length - 2] ^= 1;
    const result = await preflightQuestionMedia([mediaQuestion()], {
      load: async () => ({
        blob: new Blob([tampered], { type: "image/gif" }),
        mimeType: "image/gif", byteSize: tampered.byteLength,
        questionId: "q1", updatedAt: "2026-10-14",
      }),
      hash: async (blob) => createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex"),
      decode: async () => true,
    });
    expect(result).toMatchObject({
      total: 1, available: 0, blockedQuestionIds: ["q1"],
      issues: [{ questionId: "q1", assetId: "stem-animation", code: "checksum-mismatch" }],
    });
  });
});
