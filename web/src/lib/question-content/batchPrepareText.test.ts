import { describe, expect, it } from "vitest";
import { prepareRawTextBank } from "./batchPrepareText";
import { packageToReviewedImport } from "./toReviewedImport";

const utf8 = (text: string) => new TextEncoder().encode(text);
const sample = [
  "1. In a patient with hyperaldosteronism, which electrolyte is lowered?",
  "A. Calcium", "B. Potassium", "C. Sodium", "Answer: B",
  "",
  "2. Which layer is innervated by the vagus nerve?",
  "A. Medulla", "B. Adrenal cortex", "C. Stomach", "Answer: C",
].join("\n");

describe("offline canonical preparation for raw tagged academic text", () => {
  it("builds a valid stable-sha AXOM bank and canonical reviewed-save handoff", async () => {
    const first = await prepareRawTextBank({ sourceBytes: utf8(sample), filename: "T4 sampled IMCQ.txt" });
    const second = await prepareRawTextBank({ sourceBytes: utf8(sample), filename: "T4 sampled IMCQ.txt", expectedSha256: first.sourceSha256 });
    expect(first.pkg).toEqual(second.pkg);
    expect(first.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.pkg.questions.map(question => question.provenance.sourceChecksum)).toEqual([`sha256:${first.sourceSha256}`, `sha256:${first.sourceSha256}`]);
    expect(first.pkg.manifest.course).toEqual({ name: "UNMAPPED", term: 0, week: 0 });
    expect(first.pkg.manifest.source.sourceWeekDeclared).toBe(false);
    expect(first.detected).toBe(2);
    expect(first.verifiedReadyIds.length + first.reviewRequiredIds.length + first.unresolvedIds.length).toBe(2);
    const review = packageToReviewedImport(first.pkg, first.issues);
    expect(review.imports.reduce((num, item) => num + item.questionIds.length, 0) + review.held.length).toBe(2);
  });
  it("never confuses repeated source question numbers with unique IDs", async () => {
    const raw = `${sample}\n\n${sample}`;
    const result = await prepareRawTextBank({ sourceBytes: utf8(raw), filename: "aggregate.txt" });
    expect(result.detected).toBeGreaterThanOrEqual(2);
    expect(new Set(result.pkg.questions.map(question => question.id)).size).toBe(result.detected);
  });
  it("requires inventory SHA identity and does not emit partial text records on mismatch", async () => {
    await expect(prepareRawTextBank({ sourceBytes: utf8(sample), filename: "wrong.txt", expectedSha256: "a".repeat(64) }))
      .rejects.toThrow(/differs from the inventory/);
  });
  it("preserves real questions past the 400k source-document preview cap", async () => {
    const huge = `${"Unrelated introductory text ".repeat(16_000)}\n${sample}`;
    expect(huge.length).toBeGreaterThan(400_000);
    const result = await prepareRawTextBank({ sourceBytes: utf8(huge), filename: "long-source.txt" });
    expect(result.detected).toBeGreaterThan(0);
    expect(result.pkg.questions.at(-1)?.stem.length).toBeGreaterThan(0);
  });
});