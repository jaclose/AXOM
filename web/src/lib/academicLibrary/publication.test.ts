// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { splitAcademicPlanSections } from "./coursePlan";
import {
  courseLibraryReader, planPublication, publicationCatalogId, publicationJobs, readPublicationInventory,
} from "./publication";
import { library } from "./publicationFixture.testing";
import { prepareAcademicUpload } from "./upload";

describe("publishing a prepared library as one course per term and module", () => {
  it("plans courses in curriculum order and lists every source it leaves out", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses.map(course => [course.term, course.module, course.termBasis, course.sections.length, course.banks, course.ready, course.originals]))
      .toEqual([
        ["Term 1", "CPR 1", "proposed", 2, 1, 2, 1],
        ["Term 4", "NCRS", "questions", 0, 1, 1, 1],
        ["Term 5", "GOER", "plan", 1, 1, 1, 2],
      ]);
    expect(plan.courses[0]).toMatchObject({ catalogId: "academic-library-t1-cpr1", activities: 4,
      proposalReason: "The SGU outline lists CPR 1 in Term 1." });
    expect(plan.courses[2].optionalSourceIds).toHaveLength(1);
    expect(plan.blocked.map(entry => [entry.name, entry.reason])).toEqual([
      ["04_MSK_Broken.txt", expect.stringMatching(/could not be read/)],
      ["05_XYZ_Lectures.txt", expect.stringMatching(/does not name its term/)],
    ]);
    const reasons = Object.fromEntries(plan.excluded.map(entry => [entry.name, entry.reason]));
    expect(reasons).toMatchObject({
      "unfiled-pq.pdf": expect.stringMatching(/no reviewed Term 1-5 and module/),
      "mislabeled-pq.pdf": expect.stringMatching(/catalog module and its question package disagree/),
      "goer-deck.pptx": expect.stringMatching(/file type/),
      "loose-notes.pdf": expect.stringMatching(/No module is recorded/),
      "cpr1-imcq copy.pdf": expect.stringMatching(/published once/),
      "lost.pdf": expect.stringMatching(/missing/),
      "01_CPR1_Lectures_DLA.txt": "Its text is published as the course plan.",
      "04_MSK_Broken.txt": expect.stringMatching(/needs attention/),
    });
    const assigned = plan.courses.flatMap(course => course.sourceIds);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.length + plan.excluded.length).toBe(inventory.sources.length);
  });

  it("publishes only confirmed terms and prepares each course through the canonical uploader", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const proposed = planPublication(inventory);
    await expect(publicationJobs(read, inventory, [proposed.courses[0]]).jobs[0].prepare()).rejects.toThrow(/Confirm this course's term/);

    const plan = planPublication(inventory, { cpr1: "Term 1", xyz: "Term 2" });
    expect(plan.courses.map(course => [course.term, course.module, course.termBasis])).toEqual([
      ["Term 1", "CPR 1", "confirmed"], ["Term 2", "XYZ", "confirmed"], ["Term 4", "NCRS", "questions"], ["Term 5", "GOER", "plan"],
    ]);
    const { jobs } = publicationJobs(read, inventory, plan.courses);
    const [cpr, xyz, ncrs, goer] = await Promise.all(jobs.map(job => job.prepare()));
    expect(jobs.map(job => job.key)).toEqual(plan.courses.map(course => course.catalogId));

    expect(cpr).toMatchObject({ catalogId: "academic-library-t1-cpr1",
      metadata: expect.objectContaining({ module: "CPR 1", term: "Term 1", ready_questions: 2 }),
      provenance: expect.objectContaining({ planTermEvidence: "human-reviewed" }) });
    expect(splitAcademicPlanSections(cpr.template).map(section => section.split("\n")[0])).toEqual(["CPR 1 - Lectures + DLAs:", "CPR1 - Small groups:"]);
    expect(xyz.metadata).toMatchObject({ module: "XYZ", term: "Term 2", ready_questions: 0 });
    expect(ncrs).toMatchObject({ template: "", metadata: expect.objectContaining({ term: "Term 4", module: "NCRS" }),
      provenance: expect.objectContaining({ scopeEvidence: "source-metadata", weekAssignment: "unassigned" }) });
    expect(goer.provenance).not.toHaveProperty("planTermEvidence");
    expect(goer.files.some(file => file.path.endsWith(".pdf") && new TextDecoder().decode(file.bytes).includes("goer-slides"))).toBe(true);
    // No course catalog carries another course's sources or a local source path.
    for (const upload of [cpr, xyz, ncrs, goer]) {
      const catalog = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === "catalog.json")!.bytes)) as PrivateLibraryCatalog;
      expect(catalog.sources.every(source => source.sourcePath === source.name)).toBe(true);
      expect(upload.provenance.sourceChecksums).toHaveLength(catalog.sources.length);
    }
  });

  it("holds a module's questions when its existing plan revisions disagree", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const sections = inventory.sections.map(section => section.moduleKey === "cpr1"
      ? { ...section, text: `@academic-term: ${section.name.startsWith("01") ? "Fall 2026" : "Spring 2026"}\n${section.text}` }
      : section);
    const plan = planPublication({ ...inventory, sections }, { cpr1: "Term 1" });
    expect(plan.blocked.filter(section => section.moduleKey === "cpr1")).toHaveLength(2);
    expect(plan.courses.some(course => course.moduleKey === "cpr1")).toBe(false);
    expect(plan.excluded.find(source => source.name === "cpr1-imcq.pdf")?.reason).toMatch(/course plan needs attention/);
    expect(plan.courses.some(course => course.moduleKey === "goer")).toBe(true);
  });

  it("keeps the same collection identity and content hash for a reordered library with a new version label", async () => {
    const first = await library("forward", "v1");
    const second = await library("reverse", "v2");
    const prepare = async (input: Awaited<ReturnType<typeof library>>) => {
      const inventory = await readPublicationInventory(input.read);
      const plan = planPublication(inventory, { cpr1: "Term 1" });
      const { jobs } = publicationJobs(input.read, inventory, plan.courses.filter(course => course.module === "CPR 1"));
      return jobs[0].prepare();
    };
    const [a, b] = await Promise.all([prepare(first), prepare(second)]);
    expect(b.catalogId).toBe(a.catalogId);
    expect(b.template).toBe(a.template);
    expect(b.provenance).toEqual(a.provenance);
    expect(publicationCatalogId("native-0123456789abcdef01234567", "Term 5", "goer")).toBe("native-t5-goer");
  });

  it("serves one course's catalog over the library without exposing other courses", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const goer = planPublication(inventory).courses.find(course => course.module === "GOER")!;
    const reader = courseLibraryReader(read, inventory, goer, { include: id => !goer.optionalSourceIds.includes(id) });
    const catalog = JSON.parse(new TextDecoder().decode(await reader("catalog.json"))) as PrivateLibraryCatalog;
    expect(catalog.id).toBe("academic-library-t5-goer");
    expect(catalog.templates.map(entry => entry.name)).toEqual(["03_GOER_Lectures.txt"]);
    expect(catalog.sources.map(source => source.name)).toEqual(["goer-pq.pdf"]);
    expect(catalog.sources[0].originalFile).toMatch(/^sources\/[a-f0-9]{64}\.pdf$/);
    const withoutOriginals = courseLibraryReader(read, inventory, goer, { originals: false });
    const stripped = JSON.parse(new TextDecoder().decode(await withoutOriginals("catalog.json"))) as PrivateLibraryCatalog;
    expect(stripped.sources.map(source => source.name).sort()).toEqual(["goer-pq.pdf", "goer-slides.pdf"]);
    expect(stripped.sources.every(source => source.originalFile === undefined)).toBe(true);
    // Questions still publish without the source files.
    const upload = await prepareAcademicUpload(courseLibraryReader(read, inventory, goer, { include: id => !goer.optionalSourceIds.includes(id), originals: false }));
    expect(upload.files.some(file => file.path.endsWith(".pdf"))).toBe(false);
    expect(upload.metadata.ready_questions).toBe(1);
  });

  it("keeps an unsupported bank original local while publishing its questions", async () => {
    const fixture = await library();
    const bank = fixture.catalog.sources.find(source => source.name === "goer-pq.pdf")!;
    const original = bank.originalFile!;
    bank.originalFile = original.replace(/\.pdf$/, ".pptx");
    fixture.files.set(bank.originalFile, fixture.files.get(original)!);
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));

    const inventory = await readPublicationInventory(fixture.read);
    const goer = planPublication(inventory).courses.find(course => course.moduleKey === "goer")!;
    const { jobs, notes } = publicationJobs(fixture.read, inventory, [goer]);
    const upload = await jobs[0].prepare();
    const catalog = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === "catalog.json")!.bytes)) as PrivateLibraryCatalog;
    expect(catalog.sources.find(source => source.id === bank.id)?.originalFile).toBeUndefined();
    expect(upload.files.some(file => file.path.endsWith(".pptx"))).toBe(false);
    expect(upload.files.some(file => file.path.endsWith(".pdf"))).toBe(true);
    expect(upload.metadata.ready_questions).toBe(1);
    expect(upload.provenance.sourceChecksums).toContain(bank.checksum);
    expect(notes.keptLocal.get(goer.catalogId)).toBe(1);
  });
});
