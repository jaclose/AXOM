// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { ImportPackage } from "../../lib/question-content/package";
import type { BankSave } from "../../lib/question-content/bankImport";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "../../lib/privateLibrary/types";
import { persistPreparedLibraryReview, practiceReadyQuestionCount, PreparedLibrary } from "./PreparedLibrary";

const mocks = vi.hoisted(() => ({
  documents: [] as SourceDocument[],
  questions: [] as QuestionRecord[],
  readOriginal: vi.fn(),
  probeOriginal: vi.fn(),
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
  hasStoredSourceOriginal: (...args: unknown[]) => mocks.probeOriginal(...args),
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
  mocks.probeOriginal.mockResolvedValue(false);
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
  it("combines installed catalogs, de-duplicates sources, and totals local readiness and held review", () => {
    const secondChecksum = "b".repeat(64);
    const thirdChecksum = "e".repeat(64);
    const olderCatalog = JSON.parse(mocks.documents[0].rawText);
    olderCatalog.templates = [{ file: "templates/shared.txt", name: "Shared", checksum: "c".repeat(64) }];
    olderCatalog.sources[0].review = 496;
    mocks.documents[0] = { ...mocks.documents[0], rawText: JSON.stringify(olderCatalog) };
    const esoftCatalog = {
      ...olderCatalog,
      id: "esoft", version: "esoft-test",
      sources: [{
        ...olderCatalog.sources[0], id: "esoft-source", name: "ESoft source.pdf", sourcePath: "ESoft source.pdf",
        checksum: secondChecksum, bankFile: "banks/esoft-source.json", originalFile: undefined, ready: 0, review: 3018,
      }],
    };
    const cumulativeCatalog = {
      ...olderCatalog,
      id: "cumulative", version: "cumulative-test",
      templates: [olderCatalog.templates[0], { file: "templates/new.txt", name: "New", checksum: "d".repeat(64) }],
      sources: [{
        ...olderCatalog.sources[0], id: "cumulative-source", name: "Cumulative source.pdf", sourcePath: "Cumulative source.pdf",
        checksum: thirdChecksum, bankFile: "banks/cumulative-source.json", originalFile: undefined, ready: 0, review: 6,
      }, {
        ...olderCatalog.sources[0], name: "Newest RHPS Source.pdf", sourcePath: "Newest RHPS Source.pdf", originalFile: undefined,
      }],
    };
    mocks.documents.unshift(
      {
        id: "private-library-cumulative", title: "Prepared academic library", fileName: "catalog.json",
        fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: JSON.stringify(cumulativeCatalog), sizeBytes: 1,
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      },
      {
        id: "private-library-esoft", title: "Prepared academic library", fileName: "catalog.json",
        fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: JSON.stringify(esoftCatalog), sizeBytes: 1,
        tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      },
    );
    mocks.questions.push(...Array.from({ length: 18 }, (_, index) => question(`rhps-ready-${index}`)));

    render(<PreparedLibrary />);

    expect(screen.getByText("2 templates · 19 locally answer-ready questions")).toBeTruthy();
    expect(screen.getByText(/Source coverage & review \(3520 held\)/)).toBeTruthy();
    expect(screen.getByText(/3 installed collections · Content versions cumulative-test, esoft-test, test/)).toBeTruthy();
    expect(screen.getByText("Newest RHPS Source.pdf")).toBeTruthy();
    expect(screen.getByText("ESoft source.pdf")).toBeTruthy();
    expect(screen.getByText("Cumulative source.pdf")).toBeTruthy();
    expect(screen.queryByText("Source.pdf")).toBeNull();
  });

  it("keeps a bank-bearing catalog as review owner when a newer reference-only catalog repeats its checksum", () => {
    const bankCatalog = JSON.parse(mocks.documents[0].rawText) as PrivateLibraryCatalog;
    bankCatalog.sources[0].review = 496;
    mocks.documents[0] = { ...mocks.documents[0], rawText: JSON.stringify(bankCatalog) };
    const referenceCatalog: PrivateLibraryCatalog = {
      ...bankCatalog,
      id: "reference-only",
      version: "reference-only-test",
      sources: [{
        ...bankCatalog.sources[0],
        id: "reference-copy",
        status: "reference/template-only",
        reason: "Reference PDF only",
        bankFile: undefined,
        originalFile: "sources/reference.pdf",
        ready: 0,
        review: 0,
      }],
    };
    mocks.documents.unshift({
      id: "private-library-reference", title: "Reference library", fileName: "catalog.json",
      fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: JSON.stringify(referenceCatalog), sizeBytes: 1,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    });

    render(<PreparedLibrary />);

    expect(screen.getByText(/1 locally answer-ready · 1 stored for review · 496 held in source/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review source" })).toBeTruthy();
  });

  it("keeps valid installed collections visible when another catalog is damaged", () => {
    mocks.documents.unshift({
      id: "private-library-damaged", title: "Damaged academic library", fileName: "catalog.json",
      fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: "{not json", sizeBytes: 1,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    });

    render(<PreparedLibrary />);

    expect(screen.getByText("0 templates · 1 locally answer-ready questions")).toBeTruthy();
    expect(screen.getByText("Source.pdf")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/1 installed library catalog could not be read.*Other prepared collections remain available/i);
  });

  it.each([true, false])("makes only the checksum-matched stored original available in source review (available: %s)", async (available) => {
    const original = new Blob(["synthetic original PDF"], { type: "application/pdf" });
    mocks.probeOriginal.mockResolvedValue(available);
    mocks.readOriginal.mockImplementation(async (id: string) => available && id === `private-source-${checksum}` ? original : undefined);
    mocks.documents.unshift({ ...mocks.documents[1], id: "unrelated-same-name", checksum: `sha256:${"b".repeat(64)}` });
    const prepared: PreparedBank = {
      pkg: {
        manifest: { schemaVersion: 1, course: { name: "FTCM", term: 1, week: 1 },
          bank: { id: "bank", title: "Stored source review", discipline: "Medicine" },
          source: { filename: "Source.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets" },
        questions: [{ id: "source-question", source: { filename: "Source.pdf", page: 2 },
          stem: [{ type: "text", text: "Which synthetic option is marked?" }],
          choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
          assets: [], provenance: { method: "pdf-import", sourceChecksum: `sha256:${checksum}` } }],
      }, issues: [], sourceText: { rawText: "Synthetic source" }, sourceBytes: original.size, notes: [],
    };
    mocks.documents.find(document => document.id === `private-review-${checksum}`)!.rawText = JSON.stringify(prepared);
    render(<PreparedLibrary />);
    fireEvent.click(screen.getByRole("button", { name: "Review source" }));
    await screen.findByRole("region", { name: "Source question bank preview" });
    fireEvent.change(screen.getByLabelText("Preview mode"), { target: { value: "review" } });
    expect(Boolean(screen.queryByRole("button", { name: "View original PDF page" }))).toBe(available);
    expect(mocks.probeOriginal).toHaveBeenCalledWith(`private-source-${checksum}`, `sha256:${checksum}`);
    expect(mocks.readOriginal).toHaveBeenCalledWith(`private-source-${checksum}`, `sha256:${checksum}`);
    expect(mocks.readOriginal).not.toHaveBeenCalledWith("unrelated-same-name", expect.anything());
  });

  it("counts only practice-ready local records and checks original availability", async () => {
    render(<PreparedLibrary />);

    expect(screen.getByText("0 templates · 1 locally answer-ready questions")).toBeTruthy();
    screen.getByText(/1 locally answer-ready · 1 stored for review · 4 held in source · Prepared package/);
    await waitFor(() => expect(screen.getByText(/Original listed but missing on this device/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Open original" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.probeOriginal).toHaveBeenCalledWith(`private-source-${checksum}`, `sha256:${checksum}`);
    expect(mocks.readOriginal).not.toHaveBeenCalled();
    expect(screen.queryByText(/99 ready/)).toBeNull();
    expect(practiceReadyQuestionCount(mocks.questions, checksum)).toBe(1);
  });

  it("checks original storage sequentially without reconstructing the visible files", async () => {
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
    mocks.probeOriginal.mockImplementationOnce(() => first).mockResolvedValue(false);

    render(<PreparedLibrary />);

    await waitFor(() => expect(mocks.probeOriginal).toHaveBeenCalledTimes(1));
    expect(mocks.readOriginal).not.toHaveBeenCalled();
    releaseFirst();
    await waitFor(() => expect(mocks.probeOriginal).toHaveBeenCalledTimes(2));
    expect(mocks.readOriginal).not.toHaveBeenCalled();
  });

  it("reuses the storage presence probe across search changes without reading original bytes", async () => {
    mocks.probeOriginal.mockResolvedValue(true);
    render(<PreparedLibrary />);

    await waitFor(() => expect(screen.getByText(/Original stored on this device; verified when opened/)).toBeTruthy());
    expect(mocks.probeOriginal).toHaveBeenCalledTimes(1);
    expect(mocks.readOriginal).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Find a source"), { target: { value: "no match" } });
    expect(screen.getByText("No prepared sources match this search.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a source"), { target: { value: "Source" } });

    await waitFor(() => expect(screen.getByText(/Original stored on this device; verified when opened/)).toBeTruthy());
    expect(mocks.probeOriginal).toHaveBeenCalledTimes(1);
    expect(mocks.readOriginal).not.toHaveBeenCalled();
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

  it("turns an installation quota failure into concise recovery guidance", async () => {
    mocks.installLibrary.mockImplementation(async (_read: unknown, progress: (message: string) => void) => {
      progress("Protecting your current workspace…");
      progress("Preparing your library · 2 of 3 sources · saving reviewed questions");
      throw new DOMException("QuotaExceededError: write failed", "QuotaExceededError");
    });
    render(<PreparedLibrary />);

    fireEvent.change(screen.getByLabelText("Prepared library folder"), {
      target: { files: [new File(["catalog"], "catalog.json")] },
    });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(
      "Browser storage on this device is full. AXOM stopped while preparing your library · 2 of 3 sources · saving reviewed questions. Content confirmed before this step remains saved; this step was not confirmed. Free disk space, then retry the same bundle.",
    ));
    expect(screen.getByRole("alert").textContent).not.toMatch(/QuotaExceededError|write failed/i);
  });

  it("normalizes a synchronous folder-reader quota error but preserves other precise import errors", async () => {
    const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    mocks.folderReader.mockImplementationOnce(() => { throw new Error("Folder access failed", { cause: quota }); });
    render(<PreparedLibrary />);

    fireEvent.change(screen.getByLabelText("Prepared library folder"), {
      target: { files: [new File(["catalog"], "catalog.json")] },
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Browser storage on this device is full. No new content was confirmed. Free disk space, then retry the same bundle.",
    );

    mocks.folderReader.mockImplementationOnce(() => { throw new Error("Catalog checksum does not match this bundle."); });
    fireEvent.change(screen.getByLabelText("Prepared library folder"), {
      target: { files: [new File(["catalog"], "catalog.json")] },
    });
    expect(screen.getByRole("alert").textContent).toBe("Catalog checksum does not match this bundle.");
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

  it("updates the catalog that contains the reviewed source when several are installed", async () => {
    const targetCatalog = mocks.documents[0];
    const unrelatedChecksum = "b".repeat(64);
    const unrelatedCatalog = {
      format: "axom-private-library", schemaVersion: 1, id: "unrelated", version: "unrelated-test", templates: [],
      sources: [{
        id: "unrelated", name: "Unrelated.pdf", sourcePath: "Unrelated.pdf", checksum: unrelatedChecksum,
        module: "FTCM", status: "review-required", reason: "Unrelated review", bankFile: "banks/unrelated.json",
        ready: 0, review: 12,
      }],
    };
    const unrelatedDocument: SourceDocument = {
      id: "private-library-unrelated", title: "Prepared academic library", fileName: "catalog.json",
      fileType: PRIVATE_LIBRARY_DOCUMENT, uploadedAt: stamp, rawText: JSON.stringify(unrelatedCatalog), sizeBytes: 1,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    mocks.documents.unshift(unrelatedDocument);
    const pkg: ImportPackage = {
      manifest: {
        schemaVersion: 1, course: { name: "FTCM", term: 1, week: 1 },
        bank: { id: "bank", title: "Reviewed source", discipline: "Medicine" },
        source: { filename: "Source.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json", assetsDirectory: "assets",
      },
      questions: [],
    };
    const bank: PreparedBank = { pkg, issues: [], sourceText: { rawText: "Reviewed" }, sourceBytes: 8, notes: [] };
    const result: BankSave = {
      status: "saved",
      sections: [{
        setTitle: "Reviewed source", questionIds: ["source-ready"], savedIds: ["ready"], reused: false,
        images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [], held: [], withheldAssets: [],
      filing: { module: "FTCM", term: 1, agrees: true }, errors: [],
    };

    await persistPreparedLibraryReview(`private-review-${checksum}`, bank, pkg, result, targetCatalog.id);

    expect(JSON.parse(mocks.documents.find(document => document.id === unrelatedDocument.id)!.rawText))
      .toEqual(unrelatedCatalog);
    const savedTarget = JSON.parse(mocks.documents.find(document => document.id === targetCatalog.id)!.rawText);
    expect(savedTarget.sources[0]).toMatchObject({ checksum, ready: 1, review: 0, status: "prepared" });
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
