// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { FILING_DECISIONS_FORMAT, applyFilingDecisions, readFilingDecisions } from "./filingDecisions";
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
    const decisions = readFilingDecisions({ format: FILING_DECISIONS_FORMAT, schemaVersion: 2, catalogSha256: await hex(fixture.files.get("catalog.json")!),
      decisions: [{ sourceId: unfiled.id, sourceChecksum: unfiled.checksum, bankSha256: await hex(fixture.files.get(unfiled.bankFile!)!),
        action: "correct", term: "Term 4", module: "NCRS" }] });
    const { read } = await applyFilingDecisions(fixture.read, decisions);
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

    const twice = { ...plan, excluded: [...plan.excluded, { id: goer.id, name: goer.name, reason: "Placed again by mistake." }] };
    expect(accountQuestions(inventory, twice).unaccounted).toBe(4);
  });
});
