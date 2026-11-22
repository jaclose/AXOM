// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { sha256 } from "../question-content/assets";
import { installPrivateLibrary } from "../privateLibrary/install";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_LIBRARY_FORMAT, type PreparedBank, type PrivateLibraryCatalog } from "../privateLibrary/types";
import * as originals from "../decode/sources";
import * as attachments from "../questionAttachments";
import * as localBackup from "../localBackup";
import { downloadAcademicCourse, type AcademicCourse, type AcademicFile } from "./client";
import { ACADEMIC_REFERENCE_TYPE, downloadCourseQuestions, isAcademicCourseDownloaded } from "./downloadReference";

const mocks = vi.hoisted(() => ({ account: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn() }));
vi.mock("../account/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("../account/supabase")>(), accountOperationClient: mocks.account,
}));
vi.mock("./accountScope", () => ({ academicAccountScope: (key: string) => ({ key, assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
vi.mock("../../pages/QuestionWorkspacePage", () => ({ default: () => null }));

const ownerId = "22222222-2222-4222-8222-222222222222";
const revisionId = "11111111-1111-4111-8111-111111111111";
const course: AcademicCourse = {
  id: "33333333-3333-4333-8333-333333333333", current_revision_id: revisionId,
  title: "Synthetic hosted bank", module: "GOER", term: "Term 5", visibility: "shared",
  review_status: "approved", owned: false, ready_questions: 1, review_questions: 0,
};
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const originalImportCommit = useStore.getState().commitReviewedImport;

async function hostedFixture() {
  const files = new Map<string, Uint8Array>();
  const sources: PrivateLibraryCatalog["sources"] = [];
  for (let index = 1; index <= 5; index += 1) {
    const bytes = encode(`%PDF-1.4 synthetic original ${index}`);
    const checksum = (await sha256(bytes)).slice(7);
    const originalFile = `sources/original-${index}.pdf`;
    files.set(originalFile, bytes);
    sources.push({ id: `source-${index}`, name: `Original ${index}.pdf`, sourcePath: `Original ${index}.pdf`,
      checksum, originalFile, module: "GOER", status: index === 1 ? "prepared" : "reference/template-only",
      reason: "Synthetic source", ready: index === 1 ? 1 : 0, review: 0,
      ...(index === 1 ? { bankFile: "banks/source/bank.json" } : {}),
    });
  }
  // Decoder integrity has its own tests. This fixture keeps its bytes and
  // successful decoder deterministic while exercising real persistence.
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
  const imageHash = await sha256(png);
  files.set("banks/source/assets/figure.png", png);
  const bank: PreparedBank = {
    pkg: {
      manifest: {
        schemaVersion: 1, course: { name: "GOER", term: 5, week: 3 },
        bank: { id: "source", title: "Synthetic source bank", discipline: "Example" },
        source: { filename: "Original 1.pdf", sourceWeekDeclared: true },
        questionsFile: "questions.json", assetsDirectory: "assets",
      },
      questions: [{ id: "source-q1", source: { filename: "Original 1.pdf", questionNumber: 1 },
        stem: [{ type: "text", text: "Which label appears first?" }, { type: "image", assetId: "figure", role: "question" }],
        choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
          { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
        correctAnswer: { labels: ["A"], evidence: "printed-key" },
        assets: [{ id: "figure", questionId: "source-q1", filename: "figure.png", mimeType: "image/png", role: "question", checksum: imageHash }],
        provenance: { method: "authored", sourceChecksum: `sha256:${sources[0].checksum}` },
      }],
    },
    issues: [], sourceText: { rawText: "Synthetic source and original figure." }, sourceBytes: files.get(sources[0].originalFile!)!.length,
    notes: [], reviewedFiling: { term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned" },
  };
  const catalog: PrivateLibraryCatalog = {
    format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "synthetic-hosted", version: "one", templates: [], sources,
  };
  files.set("catalog.json", encode(catalog));
  files.set("banks/source/bank.json", encode(bank));
  const manifest: AcademicFile[] = await Promise.all([...files].map(async ([path, bytes]) => {
    const hash = (await sha256(bytes)).slice(7);
    return { path, object_path: `${ownerId}/${hash}`, sha256: hash, byte_size: bytes.length,
      mime_type: path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".png") ? "image/png" : "application/json" };
  }));
  const download = vi.fn(async (objectPath: string) => {
    const entry = manifest.find(file => file.object_path === objectPath);
    const bytes = entry && files.get(entry.path);
    return { data: bytes ? new Blob([bytes as BlobPart]) : null, error: null };
  });
  const client = {
    from: (table: string) => {
      expect(table).toBe("academic_files");
      const query = { select: () => query, eq: (key: string, value: string) => {
        expect([key, value]).toEqual(["revision_id", revisionId]); return query;
      }, order: () => query, range: async (start: number, end: number) => ({ data: manifest.slice(start, end + 1), error: null }) };
      return query;
    },
    storage: { from: (bucket: string) => { expect(bucket).toBe("academic-content"); return { download }; } },
  } as unknown as SupabaseClient;
  mocks.account.mockResolvedValue({ userId: ownerId, client });
  const read = vi.fn(async (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error("Missing fixture file: " + path);
    return bytes;
  });
  return { files, catalog, manifest, download, read };
}

beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
  vi.spyOn(originals, "readSourceOriginal").mockResolvedValue(undefined);
  vi.spyOn(originals, "saveSourceOriginal");
});
afterEach(async () => {
  vi.restoreAllMocks();
  useStore.setState({ commitReviewedImport: originalImportCommit });
  await closeWorkspace();
  vi.clearAllMocks();
});

it("downloads questions and required images without reading or caching originals, preserving all five hosted PDF identities", async () => {
  const fixture = await hostedFixture();
  const receipt = await downloadCourseQuestions(course, ownerId);
  expect(receipt.status).toBe("complete");
  expect(receipt.questionIds).toHaveLength(1);
  expect(originals.readSourceOriginal).not.toHaveBeenCalled();
  expect(originals.saveSourceOriginal).not.toHaveBeenCalled();
  const downloadedPaths = fixture.download.mock.calls.map(([path]) => fixture.manifest.find(file => file.object_path === path)!.path);
  expect(downloadedPaths.sort()).toEqual(["banks/source/assets/figure.png", "banks/source/bank.json", "catalog.json"]);
  const state = await reloadWorkspace();
  expect(isAcademicCourseDownloaded(course, ownerId, useStore.getState())).toBe(true);
  expect(state.questions[0]).toMatchObject({ module: "GOER", week: 3 });
  const storedCatalog = JSON.parse(state.documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT)!.rawText) as PrivateLibraryCatalog;
  expect(storedCatalog.sources.map(source => ({ id: source.id, originalFile: source.originalFile, checksum: source.checksum })))
    .toEqual(fixture.catalog.sources.map(source => ({ id: source.id, originalFile: source.originalFile, checksum: source.checksum })));
  expect(state.documents.every(document => document.originalFile === undefined)).toBe(true);
  expect(receipt.bindings?.originals).toEqual([expect.objectContaining({ asset: expect.objectContaining({
    revisionId, path: fixture.catalog.sources[0].originalFile, sha256: fixture.catalog.sources[0].checksum,
  }) })]);
  expect(receipt.bindings?.assets).toEqual([expect.objectContaining({ path: "banks/source/assets/figure.png" })]);
  expect((await attachments.listQuestionAttachmentBlobKeys()).length).toBeGreaterThan(0);
});

it("retains the full original-download default for review copies and local private imports", async () => {
  const fixture = await hostedFixture();
  const reviewed = await downloadAcademicCourse(revisionId, () => {}, { key: ownerId, assertCurrent: () => {} });
  expect(reviewed.status).toBe("complete");
  expect(originals.readSourceOriginal).toHaveBeenCalledTimes(5);
  expect(originals.saveSourceOriginal).toHaveBeenCalledTimes(5);
  expect(reviewed.bindings.originals).toHaveLength(5);
  const originalPaths = fixture.download.mock.calls.map(([path]) => fixture.manifest.find(file => file.object_path === path)!.path)
    .filter(path => path.endsWith(".pdf"));
  expect(originalPaths).toHaveLength(5);
  vi.mocked(originals.readSourceOriginal).mockClear();
  vi.mocked(originals.saveSourceOriginal).mockClear();
  await installPrivateLibrary(fixture.read);
  expect(originals.readSourceOriginal).toHaveBeenCalledTimes(5);
  expect(originals.saveSourceOriginal).toHaveBeenCalledTimes(5);
});

it("keeps a default private import incomplete when an original cannot be cached", async () => {
  const fixture = await hostedFixture();
  vi.mocked(originals.saveSourceOriginal).mockRejectedValue(new Error("Synthetic original cache failure"));
  const result = await installPrivateLibrary(fixture.read);
  expect(result.status).toBe("partial");
  expect(result.questionIds).toEqual([]);
  expect(result.warnings.join(" ")).toContain("Synthetic original cache failure");
});

it("retains the safety-backup gate before a questions-only download", async () => {
  await hostedFixture();
  vi.spyOn(localBackup, "createLocalBackup").mockRejectedValue(new Error("Synthetic safety backup quota failure"));
  await expect(downloadCourseQuestions(course, ownerId)).rejects.toThrow("Synthetic safety backup quota failure");
  expect(useStore.getState().questions).toHaveLength(0);
  expect(isAcademicCourseDownloaded(course, ownerId, useStore.getState())).toBe(false);
});

it.each(["missing image", "changed image", "image persistence", "question persistence", "receipt persistence"])(
  "refuses a complete questions-only receipt on %s failure", async failure => {
    const fixture = await hostedFixture();
    if (failure === "missing image") fixture.files.delete("banks/source/assets/figure.png");
    if (failure === "changed image") fixture.files.set("banks/source/assets/figure.png", encode("changed bytes"));
    if (failure === "image persistence") vi.spyOn(attachments, "putQuestionAttachmentBlob").mockRejectedValue(new Error("Synthetic image persistence failure"));
    if (failure === "question persistence") vi.spyOn(useStore.getState(), "commitReviewedImport").mockResolvedValue({
      ok: false, message: "Synthetic question persistence failure", rollbackFailures: [],
    });
    if (failure === "receipt persistence") {
      const hasReceipt = () => useStore.getState().documents.some(document => document.fileType === ACADEMIC_REFERENCE_TYPE);
      const open = indexedDB.open.bind(indexedDB);
      vi.spyOn(indexedDB, "open").mockImplementation((name, version) => {
        if (hasReceipt()) throw new DOMException("Synthetic receipt IndexedDB quota failure", "QuotaExceededError");
        return open(name, version);
      });
      const storage = window.localStorage;
      const setItem = storage.setItem.bind(storage);
      vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
        if (hasReceipt()) throw new DOMException("Synthetic receipt fallback quota failure", "QuotaExceededError");
        return setItem(name, value);
      });
    }
    await expect(downloadCourseQuestions(course, ownerId)).rejects.toThrow();
    expect(isAcademicCourseDownloaded(course, ownerId, useStore.getState())).toBe(false);
    expect(originals.readSourceOriginal).not.toHaveBeenCalled();
    expect(originals.saveSourceOriginal).not.toHaveBeenCalled();
    expect(useStore.getState().questions).toHaveLength(failure === "receipt persistence" ? 1 : 0);
  },
);
