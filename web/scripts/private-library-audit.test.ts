import { describe, expect, it } from "vitest";
import { auditScope } from "./private-library-audit";
import type { PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";
import type { SourceMapping } from "../src/lib/course-engine/sourceMapping";
const source: PrivateLibraryCatalog["sources"][number] = { id: "sample", name: "IMCQ 7.pdf", sourcePath: "sample", checksum: "a".repeat(64), status: "review-required", reason: "Test", ready: 0, review: 1, module: "GOER" };
const mapping: SourceMapping = { lectureRefs: [], duplicateMarker: false, referenceCandidate: false, conflicts: [], status: "mapped",
  term: { value: "T5", confidence: 1, evidence: "Term 5" }, module: { value: "GOER", confidence: 1, evidence: "GOER" }, number: 7 };
describe("private corpus mapping evidence", () => {
  it("does not turn an IMCQ number into a week", () => {
    expect(auditScope(source, mapping)).toMatchObject({ term: "T5", module: "GOER", week: null, sourceKind: "IMCQ", requiresMappingReview: true });
  });
  it("keeps ranged and conflicting weeks for review", () => {
    const week = { value: 2, confidence: 1, evidence: "Weeks 2-3" };
    expect(auditScope(source, { ...mapping, week, weekEnd: 3 }).week).toBeNull();
    expect(auditScope(source, { ...mapping, week, conflicts: ["Different terms"] })).toMatchObject({ term: "Unassigned", module: "Unassigned", week: null });
  });
  it("preserves an explicit number without claiming its week basis", () => {
    expect(auditScope({ ...source, name: "eSOFT week 2.pdf" }, { ...mapping, week: { value: 2, confidence: 1, evidence: "Week 2" } }))
      .toMatchObject({ week: 2, weekBasis: "unconfirmed", sourceKind: "eSOFT", requiresMappingReview: false });
  });
});
