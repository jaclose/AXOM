// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { ImportPackage } from "../../lib/question-content/package";
import type { BankSave } from "../../lib/question-content/bankImport";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "../../lib/privateLibrary/types";
import { persistPreparedLibraryReview, practiceReadyQuestionCount, PreparedLibrary } from "./PreparedLibrary";

const mocks = vi.hoisted(() => ({
  documents: [] as SourceDocument[],
  questions: [] as QuestionRecord[],
  readOriginal: vi.fn(),
  folderReader: vi.fn(),
  installLibrary: vi.fn(),
  setState: vi.fn(),
  checkpoint: vi.fn(),
  flushVault: vi.fn(),
  assertVaultWrite: vi.fn(),
  assertVaultWritesSince: vi.fn(),
}));

vi.mock("../../lib/store", () => ({
  useStore: Object.assign((selector: (state: { documents: SourceDocument[]; questions: QuestionRecord[] }) => unknown) => selector(mocks), {
    getState: () => mocks,
    setState: (update: ((state: typeof mocks) => Partial<typeof mocks>) | Partial<typeof mocks>) => {
      mocks.setState(update);
      Object.assign(mocks, typeof update === "function" ? update(mocks) : update);
    },
  }),
}));
vi.mock("../../lib/localVault", () => ({
  getVaultWriteCheckpoint: () => mocks.checkpoint(),
  flushLocalVaultWrites: () => mocks.flushVault(),
  assertVaultWrite: (...args: unknown[]) => mocks.assertVaultWrite(...args),
  assertVaultWritesSince: (...args: unknown[]) => mocks.assertVaultWritesSince(...args),
}));
vi.mock("../../lib/decode/sources", () => ({
  readSourceOriginal: (...args: unknown[]) => mocks.readOriginal(...args),
}));
vi.mock("../../lib/privateLibrary/install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/privateLibrary/install")>();
  return {
    ...actual,
    folderLibraryReader: (...args: unknown[]) => mocks.folderReader(...args),
    installPrivateLibrary: (...args: unknown[]) => mocks.installLibrary(...args),
  };
});

const checksum = "a".repeat(64);
const stamp = "2026-10-15T00:00:00.000Z";

function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id, source: "imported", stem: `Question ${id}`,
    options: [{ key: "A", text: "Yes" }, { key: "B", text: "No" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: stamp, updatedAt: stamp,
    content: {
      id: `source-${id}`, bankId: "bank",
      stem: [{ type: "text", text: `Question ${id}` }],
      choices: [
        { id: `${id}-a`, label: "A", blocks: [{ type: "text", text: "Yes" }] },
        { id: `${id}-b`, label: "B", blocks: [{ type: "text", text: "No" }] },
      ],
      correctAnswer: { labels: ["A"] }, assets: [],
      source: { filename: "source.pdf" },
      provenance: { method: "axom-export", sourceChecksum: `sha256:${checksum}` },
    },
    ...patch,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readOriginal.mockResolvedValue(undefined);
  mocks.folderReader.mockReturnValue(async () => new Uint8Array());
  mocks.installLibrary.mockResolvedValue({
    status: "complete", warnings: [], templateIds: [], documentIds: [], questionIds: [], setIds: [],
  });
  mocks.checkpoint.mockReturnValue(20);
  mocks.flushVault.mockResolvedValue(undefined);
  const catalog = {
    format: "axom-private-library", schemaVersion: 1, id: "prepared", version: "test", templates: [],
    sources: [{
      id: "source", name: "Source.pdf", sourcePath: "Source.pdf", checksum, module: "FTCM",
      status: "prepared", reason: "Prepared for review", bankFile: "banks/source.json", originalFile: "sources/source.pdf",
      ready: 99, review: 4,
    }],
  };
  mocks.documents = [
    {
      id: "private-library-prepared", title: "Prepared academic library", fileName: "catalog.json",
      fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: JSON.stringify(catalog), sizeBytes: 1,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    },
    {
      id: `private-source-${checksum}`, title: "Source", fileName: "Source.pdf", fileType: "pdf",
      uploadedAt: stamp, rawText: "", sizeBytes: 1, checksum: `sha256:${checksum}`,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    },
    {
      id: `private-review-${checksum}`, title: "Source review", fileName: "Source.pdf",
      fileType: PRIVATE_REVIEW_DOCUMENT, uploadedAt: stamp, rawText: "{}", sizeBytes: 2,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    },
  ];
  mocks.questions = [question("ready"), question("review", { needsReview: true })];
});

afterEach(cleanup);

describe("PreparedLibrary truthfulness", () => {
  it("counts only practice-ready local records and checks original availability", async () => {
    render(<PreparedLibrary />);

    expect(screen.getByText("0 templates · 1 locally answer-ready questions")).toBeTruthy();
    screen.getByText(/1 locally answer-ready · 1 stored for review · 4 held in source · Prepared package/);
    await waitFor(() => expect(screen.getByText(/Original listed but missing on this device/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Open original" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/99 ready/)).toBeNull();
    expect(practiceReadyQuestionCount(mocks.questions, checksum)).toBe(1);
  });

  it("checks large original files sequentially instead of loading the visible list together", async () => {
    const secondChecksum = "b".repeat(64);
    const catalog = JSON.parse(mocks.documents[0].rawText) as {
      sources: Array<Record<string, unknown>>;
    };
    catalog.sources.push({
      ...catalog.sources[0],
      id: "source-two",
      name: "Source two.pdf",
      sourcePath: "Source two.pdf",
      checksum: secondChecksum,
      originalFile: "sources/source-two.pdf",
    });
    mocks.documents[0] = { ...mocks.documents[0], rawText: JSON.stringify(catalog) };
    mocks.documents.push({
      id: `private-source-${secondChecksum}`, title: "Source two", fileName: "Source two.pdf", fileType: "pdf",
      uploadedAt: stamp, rawText: "", sizeBytes: 1, checksum: `sha256:${secondChecksum}`,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    });
    let releaseFirst!: () => void;
    const first = new Promise<undefined>((resolve) => { releaseFirst = () => resolve(undefined); });
    mocks.readOriginal.mockImplementationOnce(() => first).mockResolvedValue(undefined);

    render(<PreparedLibrary />);

    await waitFor(() => expect(mocks.readOriginal).toHaveBeenCalledTimes(1));
    releaseFirst();
    await waitFor(() => expect(mocks.readOriginal).toHaveBeenCalledTimes(2));
  });

  it("keeps a partial installation visible as a warning with its durable count", async () => {
    mocks.installLibrary.mockResolvedValue({
      status: "partial",
      warnings: ["Source.pdf: reviewed filing needs another try."],
      templateIds: [],
      documentIds: ["source-document"],
      questionIds: ["question-1", "question-2"],
      setIds: ["set-1"],
    });
    render(<PreparedLibrary />);

    fireEvent.change(screen.getByLabelText("Prepared library folder"), {
      target: { files: [new File(["catalog"], "catalog.json")] },
    });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(
      /2 answer-ready questions remain saved on this device.*reviewed filing needs another try/i,
    ));
    expect(mocks.installLibrary).toHaveBeenCalledTimes(1);
  });

  it("persists the reviewed source and catalog in one checked vault snapshot", async () => {
    const pkg: ImportPackage = {
      manifest: {
        schemaVersion: 1,
        course: { name: "FTCM", term: 1, week: 1 },
        bank: { id: "bank", title: "Reviewed source", discipline: "Medicine" },
        source: { filename: "Source.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: [],
    };
    const bank: PreparedBank = {
      pkg,
      issues: [],
      sourceText: { rawText: "Reviewed source text" },
      sourceBytes: 20,
      notes: [],
    };
    const result: BankSave = {
      status: "saved",
      sections: [{
        setTitle: "Reviewed source", questionIds: ["source-ready"], savedIds: ["ready"],
        reused: false, images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [], held: [], withheldAssets: [],
      filing: { module: "FTCM", term: 1, agrees: true }, errors: [],
    };

    await persistPreparedLibraryReview(`private-review-${checksum}`, bank, pkg, result);

    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.flushVault).toHaveBeenCalledTimes(1);
    expect(mocks.assertVaultWrite).toHaveBeenCalledWith(21);
    expect(mocks.assertVaultWritesSince).toHaveBeenCalledWith(20);
    const savedReview = mocks.documents.find(document => document.id === `private-review-${checksum}`)!;
    expect(JSON.parse(savedReview.rawText).pkg.manifest.bank.title).toBe("Reviewed source");
    const savedCatalog = JSON.parse(mocks.documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT)!.rawText);
    expect(savedCatalog.sources[0]).toMatchObject({ ready: 1, review: 0, status: "prepared" });
  });

  it("reports a truthful partial result when the reviewed catalog snapshot is not durable", async () => {
    mocks.assertVaultWrite.mockImplementationOnce(() => { throw new Error("Synthetic vault refusal"); });
    const pkg = {
      manifest: {
        schemaVersion: 1 as const,
        course: { name: "FTCM", term: 1, week: 1 },
        bank: { id: "bank", title: "Reviewed source", discipline: "Medicine" },
        source: { filename: "Source.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: [],
    };
    const bank = {
      pkg, issues: [], sourceText: { rawText: "Reviewed" }, sourceBytes: 8, notes: [],
    } satisfies PreparedBank;
    const result = {
      status: "partial" as const,
      sections: [{
        setTitle: "Reviewed source", questionIds: ["source-ready"], savedIds: ["ready"],
        reused: false, images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [{
        setTitle: "Reviewed source remainder", questionIds: ["source-review"], savedIds: ["review"],
        reused: true, reason: "Reviewed filing still needs attention.",
      }],
      held: [], withheldAssets: [],
      filing: { module: "FTCM", term: 1, agrees: true }, errors: ["Reviewed filing still needs attention."],
    } satisfies BankSave;

    await expect(persistPreparedLibraryReview(`private-review-${checksum}`, bank, pkg, result))
      .rejects.toThrow(/2 imported questions remain saved.*could not confirm.*catalog.*Synthetic vault refusal.*prior review metadata was restored/i);
    expect(mocks.setState).toHaveBeenCalledTimes(2);
    expect(mocks.flushVault).toHaveBeenCalledTimes(2);
    expect(mocks.assertVaultWrite).toHaveBeenCalledTimes(2);
    expect(mocks.assertVaultWritesSince).toHaveBeenCalledTimes(1);
    expect(mocks.documents.find(document => document.id === `private-review-${checksum}`)?.rawText).toBe("{}");
    const restoredCatalog = JSON.parse(mocks.documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT)!.rawText);
    expect(restoredCatalog.sources[0]).toMatchObject({ ready: 99, review: 4, status: "prepared" });
  });
});
