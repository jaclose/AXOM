// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { FILING_DECISIONS_FORMAT, FILING_PROPOSALS_FORMAT, applyFilingDecisions, readFilingDecisions, readFilingProposals } from "./filingDecisions";
import { planPublication, readPublicationInventory } from "./publication";
import { library } from "./publicationFixture.testing";
import { accountQuestions } from "./questionLedger";

describe("every question in a prepared library is accounted for", () => {
  it("places each question row in one course or one stated reason, and the totals reconcile", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const ledger = accountQuestions(inventory, planPublication(inventory));
    expect(ledger.total).toEqual({ sources: 5, questions: 6, ready: 6, held: 0 });
    expect(ledger.courses.map(course => [course.term, course.module, course.questions, course.publishable])).toEqual([
      ["Term 1", "CPR 1", 2, false], ["Term 4", "NCRS", 1, true], ["Term 5", "GOER", 1, true],
    ]);
    expect(ledger.inCourses.questions).toBe(4);
    expect(ledger.leftOut.map(group => [group.questions, group.reason])).toEqual([
      [1, expect.stringMatching(/catalog module and its question package disagree/)],
      [1, expect.stringMatching(/no reviewed Term 1-5 and module/)],
    ]);
    expect(ledger.inCourses.questions + ledger.leftOut.reduce((sum, group) => sum + group.questions, 0)).toBe(ledger.total.questions);
    expect(ledger.unaccounted).toBe(0);
    expect(ledger.mismatched).toEqual([]);
  });

  it("moves reviewed sources into their courses without losing or doubling a question", async () => {
    const fixture = await library();
    const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json"))) as PrivateLibraryCatalog;
    const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);
    const unfiled = catalog.sources.find(source => source.name === "unfiled-pq.pdf")!;
    const catalogSha256 = await hex(fixture.files.get("catalog.json")!);
    const bankSha256 = await hex(fixture.files.get(unfiled.bankFile!)!);
    const decisions = readFilingDecisions({ format: FILING_DECISIONS_FORMAT, schemaVersion: 2, catalogSha256,
      sourceCount: 1, exportedAtUtc: "2026-10-30T17:29:40Z",
      decisions: [{ sourceId: unfiled.id, sourceChecksum: unfiled.checksum, bankSha256: await hex(fixture.files.get(unfiled.bankFile!)!),
        action: "correct", term: "Term 4", module: "NCRS", note: "Source evidence reviewed.", decidedAtUtc: "2026-10-30T17:19:00Z" }] });
    const proposals = readFilingProposals({ format: FILING_PROPOSALS_FORMAT, schemaVersion: 1, catalogSha256,
      sources: [{ sourceId: unfiled.id, sourceChecksum: unfiled.checksum, bankFile: unfiled.bankFile,
        originalFile: unfiled.originalFile, bankSha256, proposedTerm: "Term 1", proposedModule: "MSK" }] });
    const { read } = await applyFilingDecisions(fixture.read, decisions, proposals);
    const inventory = await readPublicationInventory(read);
    const ledger = accountQuestions(inventory, planPublication(inventory));
    expect(ledger.total.questions).toBe(6);
    expect(ledger.courses.find(course => course.module === "NCRS")).toMatchObject({ sources: 2, questions: 2 });
    expect(ledger.leftOut.map(group => group.questions)).toEqual([1]);
    expect(ledger.unaccounted).toBe(0);
  });

  it("counts unreadable rows, flags packages whose catalog counts disagree, and catches a source placed twice", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const goer = inventory.sources.find(source => source.name === "goer-pq.pdf")!;
    goer.rows = 4; // one question plus three rows the source could not read
    goer.review = 2;
    const plan = planPublication(inventory);
    const ledger = accountQuestions(inventory, plan);
    expect(ledger.total.questions).toBe(9);
    expect(ledger.mismatched).toEqual([{ id: goer.id, name: "goer-pq.pdf", rows: 4, ready: 1, held: 2 }]);
    expect(ledger.unaccounted).toBe(0);

    const twice = { ...plan, excluded: [...plan.excluded, { id: goer.id, name: goer.name, reason: "Placed again by mistake.", hasBank: true }] };
    expect(accountQuestions(inventory, twice).unaccounted).toBe(4);
  });

  it("holds repeated bank source IDs instead of treating last-write-wins as reconciled", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const bank = inventory.sources.find(source => source.name === "goer-pq.pdf")!;
    const basePlan = planPublication(inventory);
    expect(basePlan.courses.some(course => course.sourceIds.includes(bank.id))).toBe(true);
    const baseline = accountQuestions(inventory, basePlan);
    const originalRows = bank.rows ?? bank.ready + bank.review;
    const conflict = { ...bank, name: "altered-goer.pdf", checksum: "f".repeat(64),
      rows: originalRows + 2, ready: bank.ready + 1, review: bank.review + 1 };

    for (const [first, second] of [[bank, conflict], [conflict, bank]]) {
      const disputedInventory = { ...inventory,
        sources: [...inventory.sources.filter(source => source.id !== bank.id), first, second] };
      const ledger = accountQuestions(disputedInventory, basePlan);
      // All claimed source rows remain visible, but neither disputed record
      // can be attributed to a publishable course or reported as reconciled.
      expect(ledger.total.questions).toBe(baseline.total.questions + conflict.rows);
      expect(ledger.inCourses.questions).toBe(baseline.inCourses.questions - originalRows);
      expect(ledger.inCourses.ready).toBe(baseline.inCourses.ready - bank.ready);
      expect(ledger.unaccounted).toBe(originalRows + conflict.rows);
      const excluded = { ...basePlan, excluded: [...basePlan.excluded,
        { id: bank.id, name: conflict.name, hasBank: true, reason: "Review ambiguous identity." }] };
      const withExcluded = accountQuestions(disputedInventory, excluded);
      expect(withExcluded.unaccounted).toBe(originalRows + conflict.rows);
      expect(withExcluded.leftOut.some(group => group.reason === "Review ambiguous identity.")).toBe(false);
    }
  });

  it("holds repeated bank catalog rows even when their source bytes match", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const bank = inventory.sources.find(source => source.name === "goer-pq.pdf")!;
    const plan = planPublication(inventory);
    const rows = bank.rows ?? bank.ready + bank.review;
    const ledger = accountQuestions({ ...inventory, sources: [...inventory.sources, { ...bank }] }, plan);
    expect(ledger.unaccounted).toBe(rows * 2);
    expect(ledger.inCourses.questions).toBe(accountQuestions(inventory, plan).inCourses.questions - rows);
  });

  it("reports repeated empty bank source IDs separately from truthful zero question counts", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const bank = inventory.sources.find(source => source.name === "goer-pq.pdf")!;
    const plan = planPublication(inventory);
    const originalRows = bank.rows ?? bank.ready + bank.review;
    const zero = { ...bank, rows: 0, ready: 0, review: 0 };
    const second = { ...zero, name: "other-empty.pdf", checksum: "f".repeat(64) };
    const otherSources = inventory.sources.filter(source => source.id !== bank.id);
    const reference = accountQuestions({ ...inventory, sources: [...otherSources, zero] }, plan);
    const baseline = accountQuestions(inventory, plan);
    expect(reference.duplicateSourceIds).toEqual([]);
    expect(reference.unaccounted).toBe(0);
    expect(reference.mismatched).toEqual([]);

    for (const items of [[zero, second], [second, zero]]) {
      const ledger = accountQuestions({ ...inventory, sources: [...otherSources, ...items] }, plan);
      expect(ledger.total.questions).toBe(baseline.total.questions - originalRows);
      expect(ledger.unaccounted).toBe(0); // No question rows can be fabricated to signal a collision.
      expect(ledger.mismatched).toEqual([]);
      expect(ledger.duplicateSourceIds).toEqual([bank.id]);
      expect(ledger.inCourses.questions).toBe(reference.inCourses.questions);
    }
  });

  it("does not count a duplicate-linked catalog row as another copy of its bank", async () => {
    const { read } = await library();
    const inventory = await readPublicationInventory(read);
    const bank = inventory.sources.find(source => source.name === "ncrs-pq.pdf")!;
    inventory.sources.push({ ...bank, name: "ncrs duplicate.pdf", hasBank: false, bank: undefined,
      status: "duplicate-linked", duplicateOf: bank.id, ready: 0, review: 0, rows: undefined });
    const ledger = accountQuestions(inventory, planPublication(inventory));
    expect(ledger.total.questions).toBe(6);
    expect(ledger.leftOut.reduce((sum, group) => sum + group.questions, 0)).toBe(2);
    expect(ledger.unaccounted).toBe(0);
    expect(ledger.duplicateSourceIds).toEqual([]); // A non-bank reference does not create a collision.
  });
});
