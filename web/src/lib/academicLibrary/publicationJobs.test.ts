// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAcademicUpload } from "./upload";
import { publicationJobs, type PlannedCourse, type PublicationInventory } from "./publication";

vi.mock("./upload", () => ({ prepareAcademicUpload: vi.fn() }));

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
    module: "NCRS", status: source.status, reason: "", ready: source.ready, review: 0 })),
};
const read = vi.fn(async (path: string) => path === "catalog.json" ? new TextEncoder().encode(JSON.stringify(catalog)) : new Uint8Array());

describe("publication jobs", () => {
  beforeEach(() => vi.mocked(prepareAcademicUpload).mockReset());

  it("keeps optional originals on this device only when the course exceeds its size limit", async () => {
    const upload = { catalogId: course.catalogId } as Awaited<ReturnType<typeof prepareAcademicUpload>>;
    vi.mocked(prepareAcademicUpload)
      .mockRejectedValueOnce(new Error("This collection exceeds the supported upload size."))
      .mockResolvedValueOnce(upload);
    const { jobs, notes } = publicationJobs(read, inventory, [course]);
    await expect(jobs[0].prepare()).resolves.toBe(upload);
    expect(notes.keptLocal.get(course.catalogId)).toBe(1);
    expect(prepareAcademicUpload).toHaveBeenNthCalledWith(1, expect.any(Function),
      { term: "Term 4", module: "NCRS", evidence: "source-metadata" }, {});
    const sourcesIn = async (call: number) => (JSON.parse(new TextDecoder().decode(
      await vi.mocked(prepareAcademicUpload).mock.calls[call][0]("catalog.json"))) as typeof catalog).sources.map(source => source.id);
    expect(await sourcesIn(0)).toEqual(["bank", "slides"]);
    expect(await sourcesIn(1)).toEqual(["bank"]);
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
