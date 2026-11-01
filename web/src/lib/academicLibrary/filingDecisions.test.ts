// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import { readPreparedBank } from "../privateLibrary/install";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import {
  FILING_DECISIONS_FORMAT, FILING_PROPOSALS_FORMAT, applyFilingDecisions, readFilingDecisions, readFilingProposals,
} from "./filingDecisions";
import { planPublication, publicationJobs, readPublicationInventory } from "./publication";
import { library } from "./publicationFixture.testing";

const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);
type Fixture = Awaited<ReturnType<typeof library>>;
type Choice = { name: string; action: "accept" | "correct" | "keep-unfiled"; term: string | null; module: string | null;
  proposedTerm?: string | null; proposedModule?: string | null; note?: string };

async function review(fixture: Fixture, choices: Choice[]) {
  const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json"))) as PrivateLibraryCatalog;
  const catalogSha256 = await hex(fixture.files.get("catalog.json")!);
  const sources = await Promise.all(choices.map(async choice => {
    const source = catalog.sources.find(entry => entry.name === choice.name)!;
    return { sourceId: source.id, sourceChecksum: source.checksum, bankFile: source.bankFile!, originalFile: source.originalFile!,
      bankSha256: await hex(fixture.files.get(source.bankFile!)!),
      proposedTerm: choice.proposedTerm ?? (choice.action === "accept" ? choice.term : "Term 1"),
      proposedModule: choice.proposedModule ?? (choice.action === "accept" ? choice.module : "MSK") };
  }));
  const worksheet = { format: FILING_PROPOSALS_FORMAT, schemaVersion: 1, catalogSha256, sources };
  const decisions = { format: FILING_DECISIONS_FORMAT, schemaVersion: 2, catalogSha256, sourceCount: sources.length,
    exportedAtUtc: "2026-10-30T17:29:40Z", decisions: sources.map((source, index) => ({
      sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, bankSha256: source.bankSha256,
      action: choices[index].action, term: choices[index].term, module: choices[index].module,
      note: choices[index].note ?? (choices[index].action === "correct" ? "Source evidence reviewed." : ""),
      decidedAtUtc: "2026-10-30T17:19:00Z",
    })) };
  const apply = () => applyFilingDecisions(fixture.read, readFilingDecisions(decisions), readFilingProposals(worksheet));
  return { worksheet, decisions, apply };
}

describe("filing decisions from the unfiled source review", () => {
  it("files a reviewed source through an envelope and keeps original bank and question scopes", async () => {
    const fixture = await library();
    const before = new Map([...fixture.files].map(([path, bytes]) => [path, bytes.slice()]));
    const { apply } = await review(fixture, [{ name: "unfiled-pq.pdf", action: "correct", term: "Term 4", module: "NCRS" }]);
    const { read, summary } = await apply();
    expect(summary).toEqual({ filed: 1, keptUnfiled: 0, courses: [{ term: "Term 4", module: "NCRS", sources: 1 }] });
    const catalog = JSON.parse(new TextDecoder().decode(await read("catalog.json"))) as PrivateLibraryCatalog;
    const source = catalog.sources.find(entry => entry.name === "unfiled-pq.pdf")!;
    expect(source.bankFile).toMatch(/\.owner-reviewed-[a-f0-9]{12}\.json$/);
    const filed = readPreparedBank(JSON.parse(new TextDecoder().decode(await read(source.bankFile!))));
    expect(filed.reviewedFiling).toEqual({ term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned" });
    expect(filed.pkg.manifest.course).toMatchObject({ name: "Unfiled", term: 0, week: 0 });
    expect(filed.pkg.questions[0]).toMatchObject({ course: "Unfiled", term: 0, week: 0 });
    const originalPath = fixture.catalog.sources.find(entry => entry.name === "unfiled-pq.pdf")!.bankFile!;
    expect(await read(originalPath)).toEqual(before.get(originalPath));
    for (const [path, bytes] of before) expect(fixture.files.get(path)).toEqual(bytes);

    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses.find(course => course.module === "NCRS")).toMatchObject({ banks: 2, ready: 2 });
    const ncrs = plan.courses.filter(course => course.module === "NCRS");
    const upload = await publicationJobs(read, inventory, ncrs).jobs[0].prepare();
    expect(upload.metadata).toMatchObject({ term: "Term 4", module: "NCRS", ready_questions: 2 });
  });

  it("accepts only the matching proposal and leaves a kept source unfiled", async () => {
    const fixture = await library();
    const accepted = await review(fixture, [{ name: "unfiled-pq.pdf", action: "accept", term: "Term 4", module: "NCRS" }]);
    expect((await accepted.apply()).summary.filed).toBe(1);
    accepted.worksheet.sources[0].proposedModule = "MSK";
    await expect(accepted.apply()).rejects.toThrow(/Accept must match/);

    const kept = await review(fixture, [{ name: "unfiled-pq.pdf", action: "keep-unfiled", term: null, module: null }]);
    const { read, summary } = await kept.apply();
    expect(summary).toEqual({ filed: 0, keptUnfiled: 1, courses: [] });
    expect(planPublication(await readPublicationInventory(read)).excluded.find(entry => entry.name === "unfiled-pq.pdf")?.reason)
      .toMatch(/no reviewed Term 1-5 and module/);
  });

  it("refuses altered catalog, bank and original bytes and mixed original scope", async () => {
    const fixture = await library();
    const reviewFile = await review(fixture, [{ name: "unfiled-pq.pdf", action: "correct", term: "Term 4", module: "NCRS" }]);
    const validDecisions = readFilingDecisions(reviewFile.decisions);
    const validProposals = readFilingProposals(reviewFile.worksheet);
    await expect(applyFilingDecisions(fixture.read, { ...validDecisions, catalogSha256: "0".repeat(64) }, validProposals))
      .rejects.toThrow(/different version/);
    await expect(applyFilingDecisions(fixture.read, { ...validDecisions, decisions: [
      { ...validDecisions.decisions[0], bankSha256: "0".repeat(64) },
    ] }, validProposals)).rejects.toThrow(/does not match/);
    const bankPath = reviewFile.worksheet.sources[0].bankFile;
    const originalPath = reviewFile.worksheet.sources[0].originalFile;
    const changedBank = async (path: string) => path === bankPath ? new TextEncoder().encode("{}") : fixture.read(path);
    await expect(applyFilingDecisions(changedBank, validDecisions, validProposals)).rejects.toThrow(/changed after it was reviewed/);
    const changedOriginal = async (path: string) => path === originalPath ? new TextEncoder().encode("changed") : fixture.read(path);
    await expect(applyFilingDecisions(changedOriginal, validDecisions, validProposals)).rejects.toThrow(/original source file changed/);
    const rawBank = JSON.parse(new TextDecoder().decode(fixture.files.get(bankPath))) as Record<string, unknown>;
    const mixed = structuredClone(rawBank) as { pkg: { questions: Array<{ term: number }> } };
    mixed.pkg.questions[0].term = 2;
    const mixedBytes = new TextEncoder().encode(JSON.stringify(mixed));
    const mixedSha = await hex(mixedBytes);
    const mixedReader = async (path: string) => path === bankPath ? mixedBytes : fixture.read(path);
    await expect(applyFilingDecisions(mixedReader,
      { ...validDecisions, decisions: [{ ...validDecisions.decisions[0], bankSha256: mixedSha }] },
      { ...validProposals, sources: [{ ...validProposals.sources[0], bankSha256: mixedSha }] }))
      .rejects.toThrow(/mixes original scopes/);
  });

  it("rejects a non-Unfiled bank, wrong curriculum pair and unsupported correction", async () => {
    const fixture = await library();
    const mislabeled = await review(fixture, [{ name: "mislabeled-pq.pdf", action: "correct", term: "Term 2", module: "DM" }]);
    await expect(mislabeled.apply()).rejects.toThrow(/mixes original scopes/);
    const unfiled = await review(fixture, [{ name: "unfiled-pq.pdf", action: "correct", term: "Term 2", module: "NCRS" }]);
    expect(() => readFilingDecisions(unfiled.decisions)).toThrow(/exact module and Term 1 to 5 pair/);
    unfiled.decisions.decisions[0].term = "Term 4";
    unfiled.decisions.decisions[0].note = " ";
    expect(() => readFilingDecisions(unfiled.decisions)).toThrow(/source-evidence note/);
  });
});
