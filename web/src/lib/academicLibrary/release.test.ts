import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicLibraryReader } from "./client";
import { downloadAcademicAsset } from "./contentReferences";
import { prepareAcademicReleaseProjection } from "./release";
import { prepareAcademicUpload } from "./upload";

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=",
  "base64",
));

async function sourceFixture(answered = true) {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
  const sourceBytes = encode("Private extraction text that must stay in the source revision.");
  const sourceDigest = await sha256(sourceBytes);
  const imageDigest = await sha256(png);
  const question = {
    id: "core-q1",
    source: { filename: "source-material.txt", questionNumber: 1 },
    stem: [
      { type: "text", text: "Which option is supported?" },
      { type: "image", assetId: "core-q1-clean", role: "stem", alt: "One-pixel test figure" },
    ],
    choices: [
      { id: "a", label: "A", blocks: [{ type: "text", text: "Supported option" }] },
      { id: "b", label: "B", blocks: [{ type: "text", text: "Distractor option" }] },
    ],
    ...(answered ? { correctAnswer: { labels: ["A"], evidence: "printed-key" } } : {}),
    explanation: [{ type: "text", text: "The supplied key identifies option A." }],
    assets: [
      { id: "core-q1-clean", filename: "clean.png", mimeType: "image/png", role: "stem",
        questionId: "core-q1", checksum: imageDigest },
      { id: "core-q1-reveal", filename: "reveal.png", mimeType: "image/png", role: "answer_reveal",
        questionId: "core-q1", checksum: imageDigest, revealOf: "core-q1-clean" },
    ],
    provenance: { method: "manual-transcription", sourceChecksum: sourceDigest,
      notes: "private reviewer note" },
  };
  const bank = {
    pkg: {
      manifest: {
        schemaVersion: 1,
        course: { name: "CORE", term: 1, week: 1 },
        bank: { id: "core-bank", title: "Core bank", discipline: "Medicine" },
        source: { filename: "source-material.txt", sourceWeekDeclared: false, axomAssignedWeek: 1 },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: [question],
    },
    issues: [],
    sourceText: { rawText: "Private extraction text that must stay in the source revision.",
      pageTexts: ["Private page text."] },
    sourceBytes: sourceBytes.length,
    notes: [],
  };
  const bankBytes = encode(JSON.stringify(bank));
  const ready = answered ? 1 : 0;
  const review = answered ? 0 : 1;
  const catalog = {
    format: "axom-private-library",
    schemaVersion: 1,
    id: answered ? "release-ready" : "release-held",
    version: "1",
    templates: [],
    sources: [{
      id: "core-source",
      name: "source-material.txt",
      sourcePath: "source-material.txt",
      checksum: sourceDigest.slice(7),
      module: "CORE",
      status: answered ? "prepared" : "review-required",
      reason: answered ? "Reviewed" : "Answer key missing",
      bankFile: "banks/core/bank.json",
      originalFile: "sources/source-material.txt",
      ready,
      review,
    }],
  };
  const files = new Map<string, Uint8Array>([
    ["catalog.json", encode(JSON.stringify(catalog))],
    ["banks/core/bank.json", bankBytes],
    ["banks/core/assets/clean.png", png],
    ["banks/core/assets/reveal.png", png],
    ["sources/source-material.txt", sourceBytes],
  ]);
  const read = async (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing fixture file ${path}`);
    return bytes;
  };
  return prepareAcademicUpload(read, {
    term: "Term 1",
    module: "CORE",
    evidence: "human-reviewed",
  });
}

afterEach(() => vi.unstubAllGlobals());

it("derives a deterministic ready-only projection while preserving answers and answer-reveal media", async () => {
  const upload = await sourceFixture();
  const privateBytes = new Map(upload.files.map(file => [file.path, new Uint8Array(file.bytes)]));
  const first = await prepareAcademicReleaseProjection(upload);
  const second = await prepareAcademicReleaseProjection(upload);

  expect(first.projectionHash).toBe(second.projectionHash);
  expect(first.readyQuestions).toBe(1);
  expect(first.heldQuestions).toBe(0);
  expect(first.files.map(file => file.path)).toEqual(second.files.map(file => file.path));
  expect(first.files.every(file => file.sha256 === second.files.find(other => other.path === file.path)?.sha256)).toBe(true);
  expect(first.files.some(file => /(^|\/)(audit|original|private|recovery|reference|source)(\/|$)/i.test(file.path))).toBe(false);

  const catalog = JSON.parse(decode(first.files.find(file => file.path === "catalog.json")!.bytes));
  expect(catalog.sources).toHaveLength(1);
  expect(catalog.sources[0]).not.toHaveProperty("originalFile");
  expect(catalog.sources[0]).toMatchObject({ ready: 1, review: 0, status: "prepared" });
  const bankFile = first.files.find(file => file.path === catalog.sources[0].bankFile)!;
  const bank = JSON.parse(decode(bankFile.bytes));
  expect(bank.sourceText).toEqual({ rawText: "" });
  expect(bank.sourceBytes).toBe(0);
  expect(bank.notes).toEqual([]);
  expect(bank.issues).toEqual([]);
  expect(bank.pkg.questions[0].correctAnswer).toEqual({ labels: ["A"], evidence: "printed-key" });
  expect(bank.pkg.questions[0].explanation[0].text).toMatch(/supplied key/i);
  expect(bank.pkg.questions[0].provenance).not.toHaveProperty("notes");
  const reveal = bank.pkg.questions[0].assets.find((asset: { role: string }) => asset.role === "answer_reveal");
  expect(reveal).toMatchObject({ filename: "reveal.png", revealOf: "core-q1-clean" });
  const revealFile = first.files.find(file => file.path.endsWith("/assets/reveal.png"));
  expect(revealFile?.bytes).toEqual(png);
  expect(decode(bankFile.bytes)).not.toContain("Private extraction text");
  expect(decode(bankFile.bytes)).not.toContain("private reviewer note");

  for (const file of upload.files) {
    expect(file.bytes).toEqual(privateBytes.get(file.path));
  }
  expect(upload.files.some(file => file.path === "sources/source-material.txt")).toBe(true);
});

it("refuses a source revision that still has a held question", async () => {
  const upload = await sourceFixture(false);
  expect(upload.metadata).toMatchObject({ ready_questions: 0, review_questions: 1 });
  await expect(prepareAcademicReleaseProjection(upload)).rejects.toThrow(/zero-review/i);
  expect(upload.files.some(file => file.path === "sources/source-material.txt")).toBe(true);
});

it("reads release objects only from their dedicated immutable namespace", async () => {
  const bytes = encode("{}");
  const digest = (await sha256(bytes)).slice(7);
  const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const file = {
    path: "catalog.json",
    object_path: `${collection}/release/${digest}`,
    sha256: digest,
    byte_size: bytes.length,
    mime_type: "application/json",
  };
  const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }));
  const client = {
    rpc: vi.fn(async () => ({ data: [file], error: null })),
    from: vi.fn(),
    storage: { from: vi.fn(() => ({ download })) },
  } as unknown as SupabaseClient;
  const read = await academicLibraryReader(client, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await expect(read("catalog.json")).resolves.toEqual(bytes);
  expect(download).toHaveBeenCalledWith(file.object_path);

  vi.mocked(client.rpc).mockResolvedValueOnce({
    data: [{ ...file, object_path: `${collection}/${digest}` }],
    error: null,
  } as never);
  await expect(academicLibraryReader(client, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
    .rejects.toThrow(/Invalid course file manifest/);
});

it("resolves deferred media against the release manifest without reading private source rows", async () => {
  const digest = (await sha256(png)).slice(7);
  const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const reference = {
    revisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    path: "banks/core/assets/reveal.png",
    sha256: digest,
  };
  const from = vi.fn();
  const client = {
    rpc: vi.fn(async () => ({ data: [{
      path: reference.path,
      object_path: `${collection}/release/${digest}`,
      sha256: digest,
      byte_size: png.length,
      mime_type: "image/png",
    }], error: null })),
    from,
    storage: { from: vi.fn(() => ({ download: vi.fn(async () => ({ data: new Blob([png]), error: null })) })) },
  } as unknown as SupabaseClient;
  const blob = await downloadAcademicAsset(client, reference);
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
  expect(from).not.toHaveBeenCalled();
});
