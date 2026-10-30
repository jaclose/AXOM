// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { FILING_DECISIONS_FORMAT, applyFilingDecisions, readFilingDecisions } from "./filingDecisions";
import { planPublication, publicationJobs, readPublicationInventory } from "./publication";
import { library } from "./publicationFixture.testing";

const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);

/** A decisions file as the review page exports it, for the synthetic library. */
async function reviewed(fixture: Awaited<ReturnType<typeof library>>, choices: Record<string, { action: string; term: string | null; module: string | null }>) {
  const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json"))) as PrivateLibraryCatalog;
  const decisions = await Promise.all(Object.entries(choices).map(async ([name, choice]) => {
    const source = catalog.sources.find(entry => entry.name === name)!;
    return { sourceId: source.id, sourceChecksum: source.checksum, bankSha256: await hex(fixture.files.get(source.bankFile!)!),
      ...choice, note: "", decidedAtUtc: "2026-10-30T17:19:00Z" };
  }));
  return { format: FILING_DECISIONS_FORMAT, schemaVersion: 2, catalogSha256: await hex(fixture.files.get("catalog.json")!),
    sourceCount: catalog.sources.length, exportedAtUtc: "2026-10-30T17:29:40Z", decisions };
}

describe("filing decisions from the unfiled source review", () => {
  it("files each decided source where the reviewer put it, without changing the library", async () => {
    const fixture = await library();
    const before = new Map([...fixture.files].map(([path, bytes]) => [path, bytes.slice()]));
    const file = await reviewed(fixture, {
      "unfiled-pq.pdf": { action: "correct", term: "Term 4", module: "NCRS" },
      "mislabeled-pq.pdf": { action: "accept", term: "Term 2", module: "DM" },
    });
    const { read, summary } = await applyFilingDecisions(fixture.read, readFilingDecisions(file));
    expect(summary).toEqual({ filed: 2, keptUnfiled: 0, courses: [
      { term: "Term 4", module: "NCRS", sources: 1 }, { term: "Term 2", module: "DM", sources: 1 },
    ] });

    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses.map(course => [course.term, course.module, course.banks, course.ready])).toEqual([
      ["Term 1", "CPR 1", 1, 2], ["Term 2", "DM", 1, 1], ["Term 4", "NCRS", 2, 2], ["Term 5", "GOER", 1, 1],
    ]);
    expect(plan.excluded.map(entry => entry.name)).not.toEqual(expect.arrayContaining(["unfiled-pq.pdf"]));
    expect(plan.excluded.map(entry => entry.name)).not.toEqual(expect.arrayContaining(["mislabeled-pq.pdf"]));

    // The canonical uploader accepts both filed courses as they stand.
    const filedCourses = plan.courses.filter(course => course.module === "NCRS" || course.module === "DM");
    const uploads = await Promise.all(publicationJobs(read, inventory, filedCourses).jobs.map(job => job.prepare()));
    expect(uploads.map(upload => [upload.metadata.term, upload.metadata.module, upload.metadata.ready_questions]))
      .toEqual([["Term 2", "DM", 1], ["Term 4", "NCRS", 2]]);

    for (const [path, bytes] of before) expect(fixture.files.get(path)).toEqual(bytes);
  });

  it("leaves a source kept unfiled exactly as it was", async () => {
    const fixture = await library();
    const file = await reviewed(fixture, { "unfiled-pq.pdf": { action: "keep-unfiled", term: null, module: null } });
    const { read, summary } = await applyFilingDecisions(fixture.read, readFilingDecisions(file));
    expect(summary).toEqual({ filed: 0, keptUnfiled: 1, courses: [] });
    const plan = planPublication(await readPublicationInventory(read));
    expect(plan.excluded.find(entry => entry.name === "unfiled-pq.pdf")?.reason).toMatch(/no reviewed Term 1-5 and module/);
  });

  it("refuses decisions made for another library version or for a package that changed since review", async () => {
    const fixture = await library();
    const file = await reviewed(fixture, { "unfiled-pq.pdf": { action: "correct", term: "Term 4", module: "NCRS" } });
    await expect(applyFilingDecisions(fixture.read, readFilingDecisions({ ...file, catalogSha256: "0".repeat(64) })))
      .rejects.toThrow(/different version of this library/);
    const changed = { ...file, decisions: [{ ...file.decisions[0], bankSha256: "0".repeat(64) }] };
    await expect(applyFilingDecisions(fixture.read, readFilingDecisions(changed))).rejects.toThrow(/changed after it was reviewed/);
    const elsewhere = { ...file, decisions: [{ ...file.decisions[0], sourceId: "source-unknown" }] };
    await expect(applyFilingDecisions(fixture.read, readFilingDecisions(elsewhere))).rejects.toThrow(/does not hold/);
  });

  it("reads only what the review page writes", async () => {
    const fixture = await library();
    const file = await reviewed(fixture, { "unfiled-pq.pdf": { action: "correct", term: "Term 4", module: "NCRS" } });
    const decision = file.decisions[0];
    expect(() => readFilingDecisions({ ...file, format: "axom-private-library" })).toThrow(/not a filing decisions file/);
    expect(() => readFilingDecisions({ ...file, decisions: [{ ...decision, term: "Term 6" }] })).toThrow(/Term 1 to 5 and a module/);
    expect(() => readFilingDecisions({ ...file, decisions: [{ ...decision, module: "" }] })).toThrow(/Term 1 to 5 and a module/);
    expect(() => readFilingDecisions({ ...file, decisions: [{ ...decision, action: "keep-unfiled" }] })).toThrow(/cannot also name/);
    expect(() => readFilingDecisions({ ...file, decisions: [decision, decision] })).toThrow(/repeats a source/);
    expect(() => readFilingDecisions({ ...file, decisions: [{ ...decision, action: "publish" }] })).toThrow(/incomplete/);
  });
});
