// @vitest-environment node
import { describe, expect, it } from "vitest";
import { previewPreparedLibrary } from "./importPreview";
const catalog = {
  format: "axom-private-library", schemaVersion: 1, id: "sample", version: "native-1",
  templates: [],
  sources: [
    { id: "one", name: "MICR 06.pdf", sourcePath: "MICR 06.pdf", checksum: "a".repeat(64),
      status: "prepared", reason: "Ready from source", module: "DERS", ready: 7, review: 0, bankFile: "a/prepared-bank.json" },
    { id: "two", name: "PATH 01, 03, 05.pdf", sourcePath: "PATH.pdf", checksum: "b".repeat(64),
      status: "review-required", reason: "Answer check pending", module: "DERS", ready: 22, review: 2, bankFile: "b/prepared-bank.json" },
  ],
};
describe("read-only prepared ZIP preflight", () => {
  it("counts ready and review-held questions without installing or reading images", async () => {
    const visited: string[] = [];
    const reader = async (path: string) => { visited.push(path); return new TextEncoder().encode(JSON.stringify(catalog)); };
    const result = await previewPreparedLibrary(reader);
    expect(visited).toEqual(["catalog.json"]);
    expect(result).toMatchObject({ sources: 2, templates: 0, potentialReady: 29, heldForReview: 2, bankSources: 2 });
    expect(result.items.map(s => s.name)).toEqual(["MICR 06.pdf", "PATH 01, 03, 05.pdf"]);
  });
  it("reports references without pretending they are scored questions", async () => {
    const reader = async () => new TextEncoder().encode(JSON.stringify({ ...catalog,
      sources: [{ ...catalog.sources[0], ready: 0, review: 0, bankFile: undefined, status: "reference/template-only" }] }));
    const result = await previewPreparedLibrary(reader);
    expect(result.bankSources).toBe(0);
    expect(result.potentialReady).toBe(0);
  });
  it("rejects a bogus catalog before asking the learner to confirm", async () => {
    await expect(previewPreparedLibrary(async () => new TextEncoder().encode(JSON.stringify({ format: "reports" })))).rejects.toThrow(/supported/i);
  });
});
