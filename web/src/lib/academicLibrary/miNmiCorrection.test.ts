// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import { readPreparedBank } from "../privateLibrary/install";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { bank, library } from "./publicationFixture.testing";
import { MI_NMI_DECISION_FORMAT, applyMiNmiDecision, readMiNmiDecision } from "./miNmiCorrection";
import { planPublication, publicationJobs, readPublicationInventory } from "./publication";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);

async function fixture() {
  const prepared = await library();
  const catalog = prepared.catalog as PrivateLibraryCatalog;
  const miOriginal = new TextEncoder().encode("%PDF-1.4 synthetic MI question source");
  const miSha = await hex(miOriginal);
  const miBank = bank("mi-pq", "MI", 5, miSha);
  miBank.pkg.manifest.course.week = 0;
  miBank.pkg.questions[0].week = 0;
  const miBankPath = `banks/${miSha}/bank.json`;
  prepared.files.set(`sources/${miSha}.pdf`, miOriginal);
  prepared.files.set(miBankPath, encode(miBank));
  catalog.sources.push({ id: `source-${miSha}`, name: "mi-pq.pdf", sourcePath: "MI/mi-pq.pdf", checksum: miSha,
    module: "MI", status: "prepared", reason: "Synthetic test source", bankFile: miBankPath,
    originalFile: `sources/${miSha}.pdf`, ready: 1, review: 0 });
  const miSlides = new TextEncoder().encode("%PDF-1.4 synthetic MI original only");
  const slidesSha = await hex(miSlides);
  prepared.files.set(`sources/${slidesSha}.pdf`, miSlides);
  catalog.sources.push({ id: `source-${slidesSha}`, name: "mi-slides.pdf", sourcePath: "MI/mi-slides.pdf", checksum: slidesSha,
    module: "MI", status: "reference/template-only", reason: "Synthetic test source",
    originalFile: `sources/${slidesSha}.pdf`, ready: 0, review: 0 });
  prepared.files.set("catalog.json", encode(catalog));
  const catalogSha256 = await hex(prepared.files.get("catalog.json")!);
  const decision = { format: MI_NMI_DECISION_FORMAT, schemaVersion: 2, catalogSha256,
    fromModule: "MI", toModule: "NMI", term: "Term 5", ownerDecision: "MI belongs under NMI",
    decidedAtUtc: "2026-11-01T00:00:00Z", sources: [
      { sourceId: `source-${miSha}`, sourceChecksum: miSha, bankSha256: await hex(prepared.files.get(miBankPath)!) },
      { sourceId: `source-${slidesSha}`, sourceChecksum: slidesSha, bankSha256: null },
    ], plans: [] as Array<{ templateFile: string; templateSha256: string }> };
  return { prepared, decision, miBankPath, miSha };
}

describe("the exact owner-confirmed MI to NMI correction", () => {
  it("places all MI sources under one NMI course while preserving source bytes, question IDs and original scopes", async () => {
    const { prepared, decision, miBankPath, miSha } = await fixture();
    const originalBank = prepared.files.get(miBankPath)!.slice();
    const { read, summary } = await applyMiNmiDecision(prepared.read, prepared.read, readMiNmiDecision(decision));
    expect(summary).toEqual({ sources: 2, banks: 1, questionRows: 1, planSections: 0, activities: 0 });
    const virtual = JSON.parse(decode(await read("catalog.json"))) as PrivateLibraryCatalog;
    const corrected = virtual.sources.find(source => source.id === `source-${miSha}`)!;
    expect(corrected).toMatchObject({ module: "NMI", checksum: miSha });
    expect(corrected.bankFile).toMatch(/\.owner-reviewed-nmi-[a-f0-9]{12}\.json$/);
    const filed = readPreparedBank(JSON.parse(decode(await read(corrected.bankFile!))));
    expect(filed.reviewedFiling).toEqual({ term: "Term 5", module: "NMI", evidence: "human-reviewed", weekAssignment: "unassigned" });
    expect(filed.pkg.manifest.course).toEqual({ name: "MI", term: 5, week: 0 });
    expect(filed.pkg.questions[0]).toMatchObject({ id: "mi-pq-q1", week: 0 });
    expect(await read(miBankPath)).toEqual(originalBank);
    expect(prepared.files.get(miBankPath)).toEqual(originalBank);
    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses.filter(course => course.moduleKey === "mi")).toHaveLength(0);
    const nmi = plan.courses.find(course => course.term === "Term 5" && course.moduleKey === "nmi")!;
    expect(nmi).toMatchObject({ banks: 1, ready: 1, originals: 2 });
    const upload = await publicationJobs(read, inventory, [nmi]).jobs[0].prepare();
    expect(upload.metadata).toMatchObject({ term: "Term 5", module: "NMI", ready_questions: 1 });
    expect(upload.provenance).toMatchObject({ scopeEvidence: "human-reviewed", weekAssignment: "unassigned" });
  });

  it("reclassifies a reviewed MI plan heading without changing its source, activities or stated week", async () => {
    const { prepared, decision } = await fixture();
    const originalText = "T5 - MI - Lectures:\nWeek 2:\nLecture 01 Synthetic conduction [Lecture]\n";
    const originalBytes = new TextEncoder().encode(originalText);
    const checksum = await hex(originalBytes);
    const templateFile = `templates/${checksum}.txt`;
    const sourceFile = `sources/${checksum}.txt`;
    prepared.files.set(templateFile, originalBytes);
    prepared.files.set(sourceFile, originalBytes);
    prepared.catalog.templates.push({ file: templateFile, name: "MI synthetic plan.txt", checksum });
    prepared.catalog.sources.push({ id: `source-${checksum}`, name: "MI synthetic plan.txt",
      sourcePath: "MI/synthetic plan.txt", checksum, module: "MI", status: "reference/template-only",
      reason: "Synthetic test plan", originalFile: sourceFile, ready: 0, review: 0 });
    prepared.files.set("catalog.json", encode(prepared.catalog));
    decision.catalogSha256 = await hex(prepared.files.get("catalog.json")!);
    decision.sources.push({ sourceId: `source-${checksum}`, sourceChecksum: checksum, bankSha256: null });
    decision.plans.push({ templateFile, templateSha256: checksum });

    const { read, summary } = await applyMiNmiDecision(prepared.read, prepared.read, readMiNmiDecision(decision));
    expect(summary).toEqual({ sources: 3, banks: 1, questionRows: 1, planSections: 1, activities: 1 });
    const virtual = JSON.parse(decode(await read("catalog.json"))) as PrivateLibraryCatalog;
    const reviewed = virtual.templates.find(row => row.name === "MI synthetic plan.txt")!;
    const reviewedText = decode(await read(reviewed.file));
    expect(reviewedText).toBe("T5 - NMI - Lectures:\nWeek 2:\nLecture 01 Synthetic conduction [Lecture]\n");
    expect(await read(templateFile)).toEqual(originalBytes);
    expect(prepared.files.get(templateFile)).toEqual(originalBytes);
    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses.some(course => course.moduleKey === "mi")).toBe(false);
    const nmi = plan.courses.find(course => course.moduleKey === "nmi")!;
    expect(nmi).toMatchObject({ term: "Term 5", activities: 1, banks: 1 });
    const upload = await publicationJobs(read, inventory, [nmi]).jobs[0].prepare();
    expect(upload.metadata).toMatchObject({ term: "Term 5", module: "NMI", ready_questions: 1 });
    expect(upload.template).toBe(reviewedText);
    expect(upload.files.find(file => file.path === sourceFile)?.bytes).toEqual(originalBytes);

    await expect(applyMiNmiDecision(prepared.read, prepared.read,
      readMiNmiDecision({ ...decision, plans: [] }))).rejects.toThrow(/exact owner-reviewed inventory/);
  });

  it("rejects incomplete, altered and ambiguous source decisions", async () => {
    const { prepared, decision, miBankPath } = await fixture();
    await expect(applyMiNmiDecision(prepared.read, prepared.read,
      readMiNmiDecision({ ...decision, sources: decision.sources.slice(0, 1) }))).rejects.toThrow(/every MI source/);
    await expect(applyMiNmiDecision(prepared.read, prepared.read,
      readMiNmiDecision({ ...decision, catalogSha256: "0".repeat(64) }))).rejects.toThrow(/different version/);
    await expect(applyMiNmiDecision(prepared.read, prepared.read,
      readMiNmiDecision({ ...decision, sources: decision.sources.map((source, index) => index === 0
        ? { ...source, bankSha256: "0".repeat(64) } : source) }))).rejects.toThrow(/question package changed/);
    const changed = JSON.parse(decode(prepared.files.get(miBankPath)!));
    changed.pkg.questions[0].week = 2;
    prepared.files.set(miBankPath, encode(changed));
    const changedSha = await hex(prepared.files.get(miBankPath)!);
    const withChangedBank = { ...decision, sources: decision.sources.map((source, index) => index === 0
      ? { ...source, bankSha256: changedSha } : source) };
    await expect(applyMiNmiDecision(prepared.read, prepared.read, readMiNmiDecision(withChangedBank)))
      .rejects.toThrow(/mixes module, term, week/);
  });

  it("accepts only the owner's exact destination and unique source identities", async () => {
    const { decision } = await fixture();
    expect(() => readMiNmiDecision({ ...decision, toModule: "MI" })).toThrow(/exact MI to NMI/);
    expect(() => readMiNmiDecision({ ...decision, sources: [decision.sources[0], decision.sources[0]] }))
      .toThrow(/repeated source identity/);
  });
});
