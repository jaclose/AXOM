// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAcademicUpload, preflightAcademicUpload } from "./upload";
import { publicationJobs, type PlannedCourse, type PublicationInventory } from "./publication";

vi.mock("./upload", () => ({ prepareAcademicUpload: vi.fn(), preflightAcademicUpload: vi.fn() }));

const inventory: PublicationInventory = {
  library: { format: "axom-private-library", schemaVersion: 1, id: "academic-library", version: "v1" },
  sections: [],
  sources: [
    { id: "bank", name: "bank.pdf", checksum: "a".repeat(64), status: "prepared", reason: "", ready: 3, review: 0, hasBank: true },
    { id: "slides", name: "slides.pdf", checksum: "b".repeat(64), status: "reference/template-only", reason: "", ready: 0, review: 0, hasBank: false },
  ],
};
const course: PlannedCourse = {
  catalogId: "academic-library-t4-ncrs", term: "Term 4", module: "NCRS", moduleKey: "ncrs", termBasis: "questions",
  sections: [], activities: 0, sourceIds: ["bank", "slides"], optionalSourceIds: ["slides"], banks: 1, ready: 3, review: 0, originals: 2,
};
const catalog = {
  format: "axom-private-library", schemaVersion: 1, id: "academic-library", version: "v1", templates: [],
  sources: inventory.sources.map(source => ({ id: source.id, name: source.name, sourcePath: source.name, checksum: source.checksum,
    module: "NCRS", status: source.status, reason: "", ready: source.ready, review: 0,
    ...(source.hasBank ? { bankFile: `banks/${source.checksum}/bank.json` } : {}) })),
};
const read = vi.fn(async (path: string) => path === "catalog.json" ? new TextEncoder().encode(JSON.stringify(catalog)) : new Uint8Array());
const prepared = (): Awaited<ReturnType<typeof prepareAcademicUpload>> => ({
  catalogId: course.catalogId,
  metadata: { ready_questions: course.ready, review_questions: course.review },
  template: "",
  provenance: { sourceChecksums: [] },
  files: [],
  hash: "",
  localOnlyOriginals: [],
});

describe("publication jobs", () => {
  // A function returned from beforeEach runs as teardown, so return nothing.
  beforeEach(() => {
    vi.mocked(prepareAcademicUpload).mockReset();
    vi.mocked(preflightAcademicUpload).mockReset().mockResolvedValue([]);
  });

  it("refuses duplicate bank source IDs before preparing uploads, even when both banks have zero question rows", async () => {
    const original = { ...inventory.sources[0], ready: 0, review: 0, rows: 0 };
    const conflict = { ...original, name: "empty-duplicate-bank.pdf", checksum: "c".repeat(64) };
    const emptyCourse = { ...course, ready: 0, review: 0 };
    for (const copies of [[original, conflict], [conflict, original]]) {
      const input: PublicationInventory = { ...inventory, sources: [...copies, inventory.sources[1]] };
      const { jobs, notes } = publicationJobs(read, input, [emptyCourse]);
      await expect(jobs[0].prepare()).rejects.toThrow(/Two question banks share one original source ID/);
      expect(notes.failures.get(emptyCourse.catalogId)).toMatch(/catalog collision/);
    }
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
    expect(preflightAcademicUpload).not.toHaveBeenCalled();
  });

  it("refuses repeated selected source IDs before preparing even when their question counts are zero", async () => {
    const zero: PublicationInventory = { ...inventory, sources: inventory.sources.map(source => source.id === "bank"
      ? { ...source, ready: 0, review: 0, rows: 0 } : source) };
    const withRepeatedSelection = { ...course, sourceIds: ["bank", "bank", "slides"], ready: 0, review: 0 };
    const { jobs, notes } = publicationJobs(read, zero, [withRepeatedSelection]);
    await expect(jobs[0].prepare()).rejects.toThrow(/course repeats a source ID/);
    expect(notes.failures.get(course.catalogId)).toMatch(/prepared course filing/);
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
  });

  it("allows a nonbank duplicate-linked reference without mistaking it for an original bank", async () => {
    const linked = { ...inventory.sources[0], status: "duplicate-linked" as const, hasBank: false,
      duplicateOf: "bank", name: "duplicate-linked.pdf", ready: 0, review: 0 };
    const input: PublicationInventory = { ...inventory, sources: [...inventory.sources, linked] };
    const upload = prepared();
    vi.mocked(prepareAcademicUpload).mockResolvedValue(upload);
    const { jobs, notes } = publicationJobs(read, input, [course]);
    await expect(jobs[0].prepare()).resolves.toBe(upload);
    expect(notes.failures.size).toBe(0);
    expect(prepareAcademicUpload).toHaveBeenCalledOnce();
  });

  it("keeps optional originals on this device only when the course exceeds its size limit", async () => {
    const upload = prepared();
    vi.mocked(prepareAcademicUpload)
      .mockRejectedValueOnce(new Error("This collection exceeds the supported upload size."))
      .mockResolvedValueOnce(upload);
    const { jobs, notes } = publicationJobs(read, inventory, [course]);
    await expect(jobs[0].prepare()).resolves.toBe(upload);
    expect(preflightAcademicUpload).toHaveBeenCalledOnce();
    expect(notes.keptLocal.get(course.catalogId)).toBe(1);
    expect(prepareAcademicUpload).toHaveBeenNthCalledWith(1, expect.any(Function),
      { term: "Term 4", module: "NCRS", evidence: "source-metadata" }, {});
    const sourcesIn = async (call: number) => (JSON.parse(new TextDecoder().decode(
      await vi.mocked(prepareAcademicUpload).mock.calls[call][0]("catalog.json"))) as typeof catalog).sources.map(source => source.id);
    expect(await sourcesIn(0)).toEqual(["bank", "slides"]);
    expect(await sourcesIn(1)).toEqual(["bank"]);
  });

  it("retries a preflight size rejection without dropping ready or held questions", async () => {
    const heldInventory: PublicationInventory = { ...inventory, sources: inventory.sources.map(source => source.id === "bank"
      ? { ...source, review: 2 } : source) };
    const heldCourse: PlannedCourse = { ...course, review: 2 };
    const heldCatalog = { ...catalog, sources: catalog.sources.map(source => source.id === "bank"
      ? { ...source, review: 2 } : source) };
    const heldRead = async (path: string) => path === "catalog.json"
      ? new TextEncoder().encode(JSON.stringify(heldCatalog)) : new Uint8Array();
    vi.mocked(prepareAcademicUpload).mockImplementation(async reader => {
      const bytes = await reader("catalog.json");
      const selected = JSON.parse(new TextDecoder().decode(bytes)) as typeof catalog;
      return {
        ...prepared(),
        metadata: {
          ready_questions: selected.sources.reduce((total, source) => total + source.ready, 0),
          review_questions: selected.sources.reduce((total, source) => total + source.review, 0),
        },
        provenance: { sourceChecksums: selected.sources.map(source => source.checksum) },
        files: [{ path: "catalog.json", bytes, sha256: "synthetic", byte_size: bytes.byteLength, mime_type: "application/json" }],
      };
    });
    vi.mocked(preflightAcademicUpload).mockRejectedValueOnce(new Error("This collection exceeds the supported upload size."));

    const { jobs, notes } = publicationJobs(heldRead, heldInventory, [heldCourse]);
    const finalUpload = await jobs[0].prepare();
    expect(prepareAcademicUpload).toHaveBeenCalledTimes(2);
    expect(preflightAcademicUpload).toHaveBeenCalledTimes(2);
    const selectedIds = (call: number) => (JSON.parse(new TextDecoder().decode(
      vi.mocked(preflightAcademicUpload).mock.calls[call][0].files[0].bytes)) as typeof catalog).sources.map(source => source.id);
    expect(selectedIds(0)).toEqual(["bank", "slides"]);
    expect(selectedIds(1)).toEqual(["bank"]);
    expect(finalUpload).toBe(vi.mocked(preflightAcademicUpload).mock.calls[1][0]);
    expect(finalUpload.metadata).toMatchObject({ ready_questions: 3, review_questions: 2 });
    expect(finalUpload.provenance.sourceChecksums).toEqual(["a".repeat(64)]);
    expect(notes.keptLocal.get(course.catalogId)).toBe(1);
  });

  it("counts an unsupported bank original once when size fallback also keeps an optional file", async () => {
    const mixed: PublicationInventory = { ...inventory, sources: inventory.sources.map(source => ({ ...source,
      original: { extension: source.id === "bank" ? "pptx" : "pdf" } })) };
    const upload = prepared();
    vi.mocked(prepareAcademicUpload)
      .mockRejectedValueOnce(new Error("This collection exceeds the supported upload size."))
      .mockResolvedValueOnce(upload);
    const { jobs, notes } = publicationJobs(read, mixed, [course]);
    await expect(jobs[0].prepare()).resolves.toBe(upload);
    expect(prepareAcademicUpload).toHaveBeenCalledTimes(2);
    expect(notes.keptLocal.get(course.catalogId)).toBe(2);
  });

  it("publishes questions without any source files when the course is still too large, and explains when nothing fits", async () => {
    const bankWithOriginal: PublicationInventory = { ...inventory, sources: inventory.sources.map(source => source.id === "bank"
      ? { ...source, original: { extension: "pdf" } } : source) };
    const upload = prepared();
    vi.mocked(prepareAcademicUpload)
      .mockRejectedValueOnce(new Error("This collection exceeds the supported upload size."))
      .mockRejectedValueOnce(new Error("A private academic upload must contain 1–1500 verified files."))
      .mockResolvedValueOnce(upload);
    const first = publicationJobs(read, bankWithOriginal, [course]);
    await expect(first.jobs[0].prepare()).resolves.toBe(upload);
    expect(first.notes.keptLocal.get(course.catalogId)).toBe(2);
    const third = JSON.parse(new TextDecoder().decode(await vi.mocked(prepareAcademicUpload).mock.calls[2][0]("catalog.json"))) as typeof catalog;
    expect(third.sources.map(source => source.id)).toEqual(["bank"]);

    vi.mocked(prepareAcademicUpload).mockReset().mockRejectedValue(new Error("This collection exceeds the supported upload size."));
    const second = publicationJobs(read, bankWithOriginal, [course]);
    await expect(second.jobs[0].prepare()).rejects.toThrow(/larger than 512 MB or 1,500 files even without its source files/);
    expect(prepareAcademicUpload).toHaveBeenCalledTimes(3);
    expect(second.notes.failures.get(course.catalogId)).toMatch(/smaller groups/);
  });

  it("does not hide other preparation failures behind the size fallback", async () => {
    vi.mocked(prepareAcademicUpload).mockRejectedValueOnce(new Error("A reviewed question is missing its source checksum."));
    const { jobs, notes } = publicationJobs(read, inventory, [course]);
    await expect(jobs[0].prepare()).rejects.toThrow(/source checksum/);
    expect(prepareAcademicUpload).toHaveBeenCalledTimes(1);
    expect(notes.keptLocal.size).toBe(0);
  });

  it("stops before preparing when publishing is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { jobs } = publicationJobs(read, inventory, [course]);
    await expect(jobs[0].prepare(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
  });
});
