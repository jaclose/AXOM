// @vitest-environment jsdom
// Synthetic only. No student question text or school images are stored in Git.
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeWorkspace, openEmptyWorkspace } from "../question-content/persistenceHarness.testing";
import { sha256 } from "../question-content/assets";
import { getQuestionAttachmentBlob, setMissingAttachmentLoader } from "../questionAttachments";
import { bankFiles } from "./install";
import type { PreparedBank } from "./types";

const imageBytes = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=",
  "base64",
));

async function bankForImage(expectedDigest?: string): Promise<PreparedBank> {
  const digest = expectedDigest ?? await sha256(imageBytes);
  const id = "synthetic-bsce-figure-question";
  return {
    pkg: {
      manifest: {
        schemaVersion: 2,
        course: { name: "BSCE", term: 4, week: 0 },
        bank: { id: "synthetic-bsce-import", title: "Synthetic BSCE image regression", discipline: "Mixed" },
        source: { filename: "synthetic.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: [{
        id,
        source: { filename: "synthetic.pdf", questionNumber: 1, page: 1 },
        stem: [
          { type: "text", text: "Identify the labelled figure." },
          { type: "image", assetId: "figure", role: "stem" },
        ],
        choices: [
          { id: "choice-a", label: "A", blocks: [{ type: "text", text: "Option A" }] },
          { id: "choice-b", label: "B", blocks: [{ type: "text", text: "Option B" }] },
        ],
        assets: [{
          id: "figure", filename: "figure.png", mimeType: "image/png", role: "stem",
          questionId: id, checksum: digest, byteSize: imageBytes.length, width: 1, height: 1,
        }],
        correctAnswer: { labels: ["A"], evidence: "explanation" },
        flags: [{ type: "answer_needs_review", message: "A proposed answer is not an official key." }],
        provenance: { method: "manual-transcription", sourceChecksum: `sha256:${"a".repeat(64)}` },
      }],
    },
    sourceText: { rawText: "Synthetic image test." },
    sourceBytes: 25,
    issues: [],
    notes: [],
  };
}

beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
});
afterEach(async () => {
  await closeWorkspace();
  vi.unstubAllGlobals();
});

describe("prepared ZIP images and existing cloud metadata conflicts", () => {
  it("uses supplied verified image bytes without consulting a failing account recovery loader", async () => {
    const bank = await bankForImage();
    const failingLoader = vi.fn(async (): Promise<undefined> => {
      throw new Error("Questions reference conflicting image originals. The workspace has not been marked protected.");
    });
    const unregister = setMissingAttachmentLoader(failingLoader);
    try {
      const read = vi.fn(async (path: string) => {
        expect(path).toBe("banks/bsce/assets/figure.png");
        return imageBytes.slice();
      });
      const files = await bankFiles(bank, read, "banks/bsce/prepared-bank.json");
      expect(files.map(file => file.name)).toEqual(["figure.png"]);
      expect(read).toHaveBeenCalledOnce();
      expect(failingLoader).not.toHaveBeenCalled();
      const original = await getQuestionAttachmentBlob(`private-library:${bank.pkg.questions[0].assets[0].checksum}`, { localOnly: true });
      expect(original?.byteSize).toBe(imageBytes.length);
      expect(await sha256(new Uint8Array(await original!.blob.arrayBuffer())))
        .toBe(bank.pkg.questions[0].assets[0].checksum);
    } finally {
      unregister();
    }
  });

  it("continues to reject a tampered ZIP image without persisting altered bytes", async () => {
    const digest = `sha256:${"0".repeat(64)}`;
    const bank = await bankForImage(digest);
    const read = async () => imageBytes.slice();
    await expect(bankFiles(bank, read, "banks/bsce/prepared-bank.json"))
      .rejects.toThrow(/checksum|integrity check/i);
    expect(await getQuestionAttachmentBlob(`private-library:${digest}`, { localOnly: true }))
      .toBeUndefined();
  });
});
