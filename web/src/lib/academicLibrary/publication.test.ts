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

  it("adds an explicitly reviewed Unfiled source to its exact question-only course", async () => {
    const fixture = await library();
    const source = fixture.catalog.sources.find(item => item.name === "unfiled-pq.pdf")!;
    const bankFile = source.bankFile!;
    const bank = JSON.parse(new TextDecoder().decode(fixture.files.get(bankFile)!));
    bank.pkg.questions[0].course = "Unfiled";
    bank.pkg.questions[0].term = 0;
    bank.reviewedFiling = { term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned" };
    source.module = "NCRS";
    fixture.files.set(bankFile, new TextEncoder().encode(JSON.stringify(bank)));
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));

    const inventory = await readPublicationInventory(fixture.read);
    const plan = planPublication(inventory);
    const ncrs = plan.courses.find(course => course.moduleKey === "ncrs")!;
    expect(ncrs).toMatchObject({ term: "Term 4", banks: 2, ready: 2 });
    expect(ncrs.sourceIds).toContain(source.id);
    expect(plan.excluded.some(entry => entry.id === source.id)).toBe(false);
    const { jobs } = publicationJobs(fixture.read, inventory, [ncrs]);
    const upload = await jobs[0].prepare();
    expect(upload.provenance).toMatchObject({ scopeEvidence: "human-reviewed", weekAssignment: "unassigned" });
    expect(upload.metadata).toMatchObject({ ready_questions: 2, module: "NCRS", term: "Term 4" });
    const storedBank = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === bankFile)!.bytes));
    expect(storedBank.pkg.manifest.course).toEqual({ name: "Unfiled", term: 0, week: 0 });
    expect(storedBank.pkg.questions[0]).toMatchObject({ course: "Unfiled", term: 0 });
  });

  it("keeps a valid course in another term when one term's plan is blocked", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const [lectures, activities] = inventory.sections.filter(section => section.moduleKey === "cpr1");
    const sections = [...inventory.sections.filter(section => section.moduleKey !== "cpr1"),
      { ...lectures, term: "Term 1" as const, problem: "A source line needs review." },
      { ...activities, term: "Term 2" as const, text: activities.text.replace(/^CPR1 -/, "T2 - CPR1 -") }];
    const term1Bank = inventory.sources.find(source => source.name === "cpr1-imcq.pdf")!;
    const term2Bank = { ...term1Bank, id: "term2-cpr1-bank", name: "term2-cpr1.pdf", checksum: "e".repeat(64),
      bank: { term: "Term 2" as const, module: "CPR 1", moduleKey: "cpr1", reviewedFiling: false } };
    const plan = planPublication({ ...inventory, sections, sources: [...inventory.sources, term2Bank] });
    expect(plan.blocked.find(section => section.moduleKey === "cpr1")?.proposedTerm).toBe("Term 1");
    expect(plan.courses.some(course => course.term === "Term 1" && course.moduleKey === "cpr1")).toBe(false);
    expect(plan.courses.find(course => course.term === "Term 2" && course.moduleKey === "cpr1")?.sourceIds).toContain(term2Bank.id);
    expect(plan.excluded.find(source => source.id === term1Bank.id)?.reason).toMatch(/course plan needs attention/);
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

  it.each(["before", "after", "triple"] as const)("keeps a %s duplicate-linked source out of the prepared course", async placement => {
    const fixture = await library();
    const original = fixture.catalog.sources.find(source => source.name === "cpr1-imcq.pdf")!;
    const linked = (suffix: string): PrivateLibraryCatalog["sources"][number] => ({
      id: original.id, name: `invented-linked-${suffix}.pdf`, sourcePath: `Synthetic/invented-linked-${suffix}.pdf`,
      checksum: original.checksum, module: "CPR 1", status: "duplicate-linked", reason: "Identical source bytes",
      duplicateOf: original.id, ready: 0, review: 0,
    });
    const index = fixture.catalog.sources.indexOf(original);
    const copies = placement === "triple" ? [linked("one"), linked("two")] : [linked("one")];
    fixture.catalog.sources.splice(index + (placement === "before" ? 0 : 1), 0, ...copies);
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));

    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory, { cpr1: "Term 1" }).courses.find(item => item.moduleKey === "cpr1")!;
    expect(course.sourceIds).toEqual([original.id]);
    const upload = await publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare();
    const catalog = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === "catalog.json")!.bytes)) as PrivateLibraryCatalog;
    expect(catalog.sources.map(source => source.id)).toEqual([original.id]);
    expect(upload.provenance.sourceChecksums).toEqual([original.checksum]);
    expect(upload.metadata).toMatchObject({ ready_questions: 2, review_questions: 0 });
  });

  it.each(["unchanged", "added", "removed", "renamed", "retargeted", "canonical-converted", "alias-converted"] as const)(
    "revalidates reviewed linked aliases across an actual uploader size retry (%s)", async change => {
      const fixture = await library();
      const canonical = fixture.catalog.sources.find(source => source.name === "goer-pq.pdf")!;
      const optional = fixture.catalog.sources.find(source => source.name === "goer-slides.pdf")!;
      const alias = { ...canonical, name: "synthetic-linked.pdf", sourcePath: "Synthetic/linked.pdf",
        status: "duplicate-linked" as const, duplicateOf: canonical.id, ready: 0, review: 0 };
      delete alias.bankFile;
      delete alias.originalFile;
      fixture.catalog.sources.unshift(alias);
      const save = () => fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));
      save();
      const inventory = await readPublicationInventory(fixture.read);
      const course = planPublication(inventory).courses.find(item => item.moduleKey === "goer")!;
      const originalPath = optional.originalFile!;
      let sizeRefusals = 0;
      const read = async (path: string) => {
        if (path === originalPath) {
          sizeRefusals += 1;
          switch (change) {
            case "unchanged": fixture.catalog.sources.reverse(); break;
            case "added": fixture.catalog.sources.push({ ...alias }); break;
            case "removed": fixture.catalog.sources = fixture.catalog.sources.filter(source => source !== alias); break;
            case "renamed": alias.name = "changed-linked.pdf"; break;
            case "retargeted": alias.duplicateOf = optional.id; break;
            case "canonical-converted": Object.assign(canonical, { status: "duplicate-linked", duplicateOf: canonical.id }); break;
            case "alias-converted": Object.assign(alias, { status: "prepared", duplicateOf: undefined }); break;
          }
          save();
          throw new Error("exceeds the supported upload size");
        }
        return fixture.read(path);
      };
      const { jobs, notes } = publicationJobs(read, inventory, [course]);
      if (change === "unchanged") {
        const upload = await jobs[0].prepare();
        const projected = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === "catalog.json")!.bytes)) as PrivateLibraryCatalog;
        expect(projected.sources.map(source => source.id)).toEqual([canonical.id]);
        expect(upload.metadata.ready_questions).toBe(1);
        expect(notes.keptLocal.get(course.catalogId)).toBe(1);
      } else {
        await expect(jobs[0].prepare()).rejects.toThrow(/library changed while publishing|duplicate source identities/);
        expect(notes.keptLocal.has(course.catalogId)).toBe(false);
      }
      expect(sizeRefusals).toBe(1);
    },
  );

  it("rejects an unmarked duplicate source identity before preparing a course", async () => {
    const fixture = await library();
    const original = fixture.catalog.sources.find(source => source.name === "cpr1-imcq.pdf")!;
    const duplicate = fixture.catalog.sources.find(source => source.name === "cpr1-imcq copy.pdf")!;
    duplicate.id = original.id;
    duplicate.status = "prepared";
    duplicate.bankFile = original.bankFile;
    duplicate.ready = original.ready;
    duplicate.review = original.review;
    delete duplicate.duplicateOf;
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));

    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory, { cpr1: "Term 1" }).courses.find(item => item.moduleKey === "cpr1")!;
    await expect(publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare())
      .rejects.toThrow(/missing or duplicate source identities/);
  });

  it("rejects a planned pair with distinct identities but the same checksum", async () => {
    const fixture = await library();
    const inventory = await readPublicationInventory(fixture.read);
    const original = inventory.sources.find(source => source.name === "cpr1-imcq.pdf")!;
    const duplicate = { ...original, id: "same-bytes-another-id", name: "same-bytes.pdf" };
    const course = planPublication(inventory, { cpr1: "Term 1" }).courses.find(item => item.moduleKey === "cpr1")!;
    await expect(publicationJobs(fixture.read, { ...inventory, sources: [...inventory.sources, duplicate] },
      [{ ...course, sourceIds: [...course.sourceIds, duplicate.id] }]).jobs[0].prepare())
      .rejects.toThrow(/missing or duplicate source identities/);
  });

  it("rejects a course whose prepared question totals differ from its unique plan", async () => {
    const fixture = await library();
    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory, { cpr1: "Term 1" }).courses.find(item => item.moduleKey === "cpr1")!;
    await expect(publicationJobs(fixture.read, inventory, [{ ...course, ready: course.ready + 1 }]).jobs[0].prepare())
      .rejects.toThrow(/question counts differ from its unique planned sources/);
  });


  it.each(["removed", "unsupported", "supported", "added", "optional-removed"] as const)(
    "refuses post-review original coverage drift (%s) before preparing a publication receipt", async change => {
      const fixture = await library();
      const source = fixture.catalog.sources.find(item => item.name === (change === "optional-removed" ? "goer-slides.pdf" : "goer-pq.pdf"))!;
      const path = source.originalFile!;
      const bytes = fixture.files.get(path)!;
      const saveCatalog = () => fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));
      if (change === "added") {
        delete source.originalFile;
        saveCatalog();
      }
      const inventory = await readPublicationInventory(fixture.read);
      const course = planPublication(inventory).courses.find(item => item.moduleKey === "goer")!;
      expect(course.sourceIds).toContain(source.id);
      expect(course.originals).toBe(change === "added" ? 1 : 2);
      if (change === "removed" || change === "optional-removed") delete source.originalFile;
      else {
        source.originalFile = change === "added" ? path : path.replace(/\.pdf$/, change === "unsupported" ? ".pptx" : ".txt");
        fixture.files.set(source.originalFile, bytes);
      }
      saveCatalog();
      const snapshot = fixture.files.get("catalog.json")!.slice();
      const { jobs, notes } = publicationJobs(fixture.read, inventory, [course]);
      await expect(jobs[0].prepare()).rejects.toThrow(/reviewed original file coverage changed/);
      expect(notes.keptLocal.has(course.catalogId)).toBe(false);
      expect(notes.failures.get(course.catalogId)).toMatch(/reviewed original file coverage changed/);
      // Even an explicit omit-originals stage must not disguise selected-row drift.
      await expect(courseLibraryReader(fixture.read, inventory, course, { originals: false })("catalog.json"))
        .rejects.toThrow(/reviewed original file coverage changed/);
      expect(fixture.files.get("catalog.json")).toEqual(snapshot);
      expect(fixture.files.get(path)).toEqual(bytes);
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

describe("publication raw UTF-8 admission", () => {
  // A malformed byte and the genuine replacement character decode identically
  // under the old nonfatal decoder. The latter must remain legitimate data.
  function corruptReplacement(bytes: Uint8Array): Uint8Array {
    const index = bytes.findIndex((byte, position) => byte === 0xef
      && bytes[position + 1] === 0xbf && bytes[position + 2] === 0xbd);
    if (index < 0) throw new Error("Missing synthetic replacement marker.");
    return Uint8Array.from([...bytes.slice(0, index), 0xff, ...bytes.slice(index + 3)]);
  }

  it.each([
    ["goer-pq.pdf", "name"],
    ["goer-pq.pdf", "reason"],
    ["goer-pq.pdf", "sourcePath"],
    ["ncrs-pq.pdf", "name"],
    ["ncrs-pq.pdf", "reason"],
  ] as const)("rejects malformed raw catalog metadata in %s (%s), before inventory and after review", async (name, field) => {
    const fixture = await library();
    const source = fixture.catalog.sources.find(item => item.name === name)!;
    source[field] += "\uFFFD";
    const valid = new TextEncoder().encode(JSON.stringify(fixture.catalog));
    fixture.files.set("catalog.json", valid);
    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory).courses.find(item => item.moduleKey === "goer")!;
    expect(course).toBeDefined();
    expect(course.sourceIds.includes(source.id)).toBe(name === "goer-pq.pdf");

    const malformed = corruptReplacement(valid);
    const snapshot = malformed.slice();
    fixture.files.set("catalog.json", malformed);
    await expect(readPublicationInventory(fixture.read)).rejects.toThrow(/Invalid UTF-8/);
    await expect(courseLibraryReader(fixture.read, inventory, course)("catalog.json")).rejects.toThrow(/Invalid UTF-8/);
    const { jobs, notes } = publicationJobs(fixture.read, inventory, [course]);
    await expect(jobs[0].prepare()).rejects.toThrow(/Invalid UTF-8/);
    expect(notes.failures.get(course.catalogId)).toMatch(/Invalid UTF-8/);
    expect(notes.keptLocal.size).toBe(0);
    expect(fixture.files.get("catalog.json")).toEqual(snapshot);
  });

  it("preserves valid Unicode and a leading BOM through scoping and actual preparation", async () => {
    const fixture = await library();
    const source = fixture.catalog.sources.find(item => item.name === "goer-pq.pdf")!;
    source.reason = "Synthetic Ω \uFFFD";
    const raw = new TextEncoder().encode("\uFEFF" + JSON.stringify(fixture.catalog));
    const snapshot = raw.slice();
    fixture.files.set("catalog.json", raw);
    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory).courses.find(item => item.moduleKey === "goer")!;
    const scoped = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await courseLibraryReader(fixture.read, inventory, course)("catalog.json"))) as PrivateLibraryCatalog;
    expect(scoped.sources.find(item => item.id === source.id)?.reason).toBe(source.reason);
    const upload = await publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare();
    expect(upload.metadata.ready_questions).toBe(1);
    expect(upload.catalogId).toBe(course.catalogId);
    expect(fixture.files.get("catalog.json")).toEqual(snapshot);
  });

  it("refuses a malformed plan before deriving module or activity metadata", async () => {
    const fixture = await library();
    const file = fixture.catalog.templates[0].file;
    const original = fixture.files.get(file)!;
    const malformed = Uint8Array.from([...original, 0xff]);
    const snapshot = malformed.slice();
    fixture.files.set(file, malformed);
    await expect(readPublicationInventory(fixture.read)).rejects.toThrow(/Invalid UTF-8/);
    expect(fixture.files.get(file)).toEqual(snapshot);
  });

  it("holds an unreadable question package rather than deriving its filing from substituted text", async () => {
    const fixture = await library();
    const source = fixture.catalog.sources.find(item => item.name === "goer-pq.pdf")!;
    const file = source.bankFile!;
    const original = JSON.parse(new TextDecoder().decode(fixture.files.get(file)!));
    original.sourceText.rawText += "\uFFFD";
    const malformed = corruptReplacement(new TextEncoder().encode(JSON.stringify(original)));
    const snapshot = malformed.slice();
    fixture.files.set(file, malformed);
    const inventory = await readPublicationInventory(fixture.read);
    expect(inventory.sources.find(item => item.id === source.id)?.bank).toEqual({
      problem: "Its question package could not be read.",
    });
    const plan = planPublication(inventory);
    expect(plan.excluded.find(item => item.id === source.id)?.reason).toMatch(/could not be read/);
    expect(plan.courses.every(course => !course.sourceIds.includes(source.id))).toBe(true);
    expect(fixture.files.get(file)).toEqual(snapshot);
  });
});

describe("publication reviewed bank identity", () => {
  async function reviewedFixture() {
    const fixture = await library();
    const source = fixture.catalog.sources.find(item => item.name === "goer-pq.pdf")!;
    const path = source.bankFile!;
    const original = fixture.files.get(path)!;
    const bank = JSON.parse(new TextDecoder().decode(original));
    bank.pkg.questions[0].stem[0].text = bank.pkg.questions[0].stem[0].text.replace("stem 1", "stem X");
    const edited = new TextEncoder().encode(JSON.stringify(bank));
    expect(edited).not.toEqual(original);
    expect(edited.length).toBe(original.length);
    const inventory = await readPublicationInventory(fixture.read);
    const course = planPublication(inventory).courses.find(item => item.moduleKey === "goer")!;
    return { fixture, source, path, original, edited, inventory, course };
  }

  it("rejects a same-size, same-count valid bank edit until the library is explicitly reviewed again", async () => {
    const { fixture, path, original, edited, inventory, course } = await reviewedFixture();
    const unchanged = await publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare();
    expect(unchanged.metadata.ready_questions).toBe(1);
    fixture.files.set(path, edited);
    const snapshot = edited.slice();
    const { jobs, notes } = publicationJobs(fixture.read, inventory, [course]);
    await expect(jobs[0].prepare()).rejects.toThrow(/reviewed question package changed/);
    expect(notes.failures.get(course.catalogId)).toMatch(/reviewed question package changed/);
    expect(notes.keptLocal.size).toBe(0);

    const fresh = await readPublicationInventory(fixture.read);
    const replanned = planPublication(fresh).courses.find(item => item.moduleKey === "goer")!;
    const upload = await publicationJobs(fixture.read, fresh, [replanned]).jobs[0].prepare();
    expect(upload.metadata.ready_questions).toBe(unchanged.metadata.ready_questions);
    expect(upload.metadata.review_questions).toBe(unchanged.metadata.review_questions);
    const stored = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === path)!.bytes));
    expect(stored.pkg.questions[0].stem[0].text).toContain("stem X");
    expect(fixture.files.get(path)).toEqual(snapshot);
    expect(new TextDecoder().decode(original)).toContain("stem 1");
  });

  it("rejects a changed bank path even when the replacement contains identical bytes", async () => {
    const { fixture, source, path, original, inventory, course } = await reviewedFixture();
    const moved = path.replace("/bank.json", "/moved.json");
    expect(moved).not.toBe(path);
    fixture.files.set(moved, original.slice());
    source.bankFile = moved;
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));
    await expect(publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare())
      .rejects.toThrow(/library changed while publishing/);
    expect(fixture.files.get(moved)).toEqual(original);
  });

  it("checks the bytes actually consumed after the scoped catalog has been read", async () => {
    const { fixture, path, original, edited, inventory, course } = await reviewedFixture();
    const reader = courseLibraryReader(fixture.read, inventory, course);
    await reader("catalog.json");
    const checked = await reader(path);
    expect(checked).toEqual(original);
    expect(checked).not.toBe(original);
    fixture.files.set(path, edited);
    await expect(reader(path)).rejects.toThrow(/reviewed question package changed/);
    expect(fixture.files.get(path)).toEqual(edited);
  });

  it.each([false, true])("rechecks the bank on an optional-original retry (bank changed: %s)", async changed => {
    const { fixture, path, edited, inventory, course } = await reviewedFixture();
    const optional = fixture.catalog.sources.find(item => course.optionalSourceIds.includes(item.id))!;
    expect(optional.originalFile).toBeDefined();
    let refusedOriginals = 0;
    const read = async (file: string) => {
      if (file === optional.originalFile) {
        refusedOriginals += 1;
        if (changed) fixture.files.set(path, edited);
        // Inject the uploader's supported size failure without allocating a huge fixture.
        throw new Error("exceeds the supported upload size");
      }
      return fixture.read(file);
    };
    const { jobs, notes } = publicationJobs(read, inventory, [course]);
    if (changed) {
      await expect(jobs[0].prepare()).rejects.toThrow(/reviewed question package changed/);
      expect(notes.keptLocal.size).toBe(0);
      expect(notes.failures.get(course.catalogId)).toMatch(/reviewed question package changed/);
    } else {
      const upload = await jobs[0].prepare();
      expect(upload.metadata.ready_questions).toBe(1);
      expect(notes.keptLocal.get(course.catalogId)).toBe(1);
      expect(notes.failures.size).toBe(0);
    }
    expect(refusedOriginals).toBe(1);
  });

  it.each(["row", "pointer", "extension", "checksum", "duplicate"] as const)(
    "rejects omitted optional-source %s drift in the actual uploader size retry", async change => {
      const { fixture, inventory, course } = await reviewedFixture();
      const optional = fixture.catalog.sources.find(item => course.optionalSourceIds.includes(item.id))!;
      const originalPath = optional.originalFile!;
      const original = fixture.files.get(originalPath)!.slice();
      let originalReads = 0;
      const read = async (file: string) => {
        if (file === originalPath) {
          originalReads += 1;
          switch (change) {
            case "row": fixture.catalog.sources = fixture.catalog.sources.filter(item => item.id !== optional.id); break;
            case "pointer": delete optional.originalFile; break;
            case "extension": optional.originalFile = originalPath.replace(/\.pdf$/, ".txt"); break;
            case "checksum": optional.checksum = "d".repeat(64); break;
            case "duplicate": fixture.catalog.sources.push({ ...optional }); break;
          }
          fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));
          throw new Error("exceeds the supported upload size");
        }
        return fixture.read(file);
      };
      const { jobs, notes } = publicationJobs(read, inventory, [course]);
      await expect(jobs[0].prepare()).rejects.toThrow(/library changed while publishing|reviewed original file coverage changed|duplicate source identities/);
      expect(originalReads).toBe(1);
      expect(notes.keptLocal.has(course.catalogId)).toBe(false);
      expect(fixture.files.get(originalPath)).toEqual(original);
    },
  );

  it("reports intentional omission without rereading unavailable optional bytes", async () => {
    const { fixture, inventory, course } = await reviewedFixture();
    const optional = fixture.catalog.sources.find(item => course.optionalSourceIds.includes(item.id))!;
    const originalPath = optional.originalFile!;
    let originalReads = 0;
    const read = async (file: string) => {
      if (file === originalPath) {
        originalReads += 1;
        // Simulate an external disappearance during the first size refusal.
        fixture.files.delete(originalPath);
        throw new Error("exceeds the supported upload size");
      }
      return fixture.read(file);
    };
    const { jobs, notes } = publicationJobs(read, inventory, [course]);
    const upload = await jobs[0].prepare();
    expect(originalReads).toBe(1);
    expect(upload.files.some(file => file.path === originalPath)).toBe(false);
    expect(upload.metadata.ready_questions).toBe(course.ready);
    // This count denotes omission, not proof that the original is still local.
    expect(notes.keptLocal.get(course.catalogId)).toBe(1);
    expect(fixture.files.has(originalPath)).toBe(false);
  });

  it("fails closed when the reviewed inventory has no bank digest", async () => {
    const { fixture, source, inventory, course } = await reviewedFixture();
    delete inventory.sources.find(item => item.id === source.id)!.bankIdentity;
    await expect(publicationJobs(fixture.read, inventory, [course]).jobs[0].prepare())
      .rejects.toThrow(/missing or conflicting reviewed bank identities/);
  });
});
