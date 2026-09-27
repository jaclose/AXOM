import { describe, expect, it } from "vitest";
import {
  diffApplicationSchoolDatasets, mergeApplicationSchoolDatasets, parseApplicationSchoolDataset,
  type ApplicationSchool, type ApplicationSchoolDataset, type ReportedStatistic, type SchoolEstimates,
} from "./applicationSchools";
import type { SchoolResearchFact } from "./applicationResearch";

const source = { url: "https://example.edu/admissions", retrievedAt: "2026-08-08T12:00:00Z" };
const valid = {
  schemaVersion: 1,
  generatedAt: "2026-08-09T12:00:00Z",
  schools: [{ id: "example-med", name: "Example School of Medicine", degree: "MD", verificationStatus: "verified", sources: [source] }],
};

describe("application school ingestion contract", () => {
  it("accepts v1 input and upgrades it to the auditable v2 envelope", () => {
    const result = parseApplicationSchoolDataset(valid, new Date("2026-08-09T12:00:00Z"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dataset).toMatchObject({ schemaVersion: 2, recordCount: 1, successfulRecords: 1, rejectedRecords: 0 });
  });

  it("rejects a verified record without provenance", () => {
    const result = parseApplicationSchoolDataset({ ...valid, schools: [{ ...valid.schools[0], sources: [] }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.schools).toHaveLength(0);
      expect(result.dataset.rejectedRecords).toBe(1);
      expect(result.issues.some((issue) => /require a valid source/i.test(issue.message))).toBe(true);
    }
  });

  it("keeps partial data while diagnosing duplicate IDs, duplicate names, bad URLs, and stale sources", () => {
    const result = parseApplicationSchoolDataset({
      schemaVersion: 2, generatedAt: "2026-08-09T12:00:00Z", recordCount: 4,
      schools: [
        { id: "one", canonicalName: "Same School", verificationStatus: "verified", sources: [source] },
        { id: "two", canonicalName: "Same School", verificationStatus: "incomplete", sources: [{ url: "not-a-url", retrievedAt: "2026-08-08T12:00:00Z" }] },
        { id: "two", canonicalName: "Another School", verificationStatus: "unknown", sources: [] },
        { id: "three", canonicalName: "Old School", verificationStatus: "verified", sources: [{ url: "https://old.example.edu", retrievedAt: "2020-01-01T12:00:00Z" }] },
      ],
    }, new Date("2026-08-09T12:00:00Z"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.schools.map((school) => school.id)).toEqual(["one", "two", "three"]);
      expect(result.dataset.schools.find((school) => school.id === "three")?.verificationStatus).toBe("needs-refresh");
      expect(result.issues.some((issue) => /duplicate canonical/i.test(issue.message))).toBe(true);
      expect(result.issues.some((issue) => /duplicate school id/i.test(issue.message))).toBe(true);
      expect(result.issues.some((issue) => /source url/i.test(issue.message))).toBe(true);
    }
  });

  it("preserves old fields and surfaces incoming conflicts during incremental merge", () => {
    const base = parseApplicationSchoolDataset(valid, new Date("2026-08-09T12:00:00Z"));
    const incoming = parseApplicationSchoolDataset({
      schemaVersion: 2, generatedAt: "2026-08-10T12:00:00Z", sourcePipelineVersion: "scraper-2",
      schools: [{ id: "example-med", canonicalName: "Example School of Medicine", name: "Example School of Medicine", degree: "DO", tuition: "$50k", verificationStatus: "verified", sources: [{ url: "https://example.edu/fees", retrievedAt: "2026-08-10T12:00:00Z" }] }],
    }, new Date("2026-08-10T12:00:00Z"));
    expect(base.ok && incoming.ok).toBe(true);
    if (!base.ok || !incoming.ok) return;
    const merged = mergeApplicationSchoolDatasets(base.dataset, incoming.dataset);
    expect(merged.dataset.schools).toHaveLength(1);
    expect(merged.dataset.schools[0].tuition).toBe("$50k");
    expect(merged.dataset.schools[0].conflicts?.degree).toBeDefined();
    expect(merged.dataset.schools[0].verificationStatus).toBe("conflicting");
    expect(merged.dataset.schools[0].sources).toHaveLength(2);
  });

  it.each([271, 500, 1000])("handles a %i-school partial run without quadratic work", (count) => {
    const schools = Array.from({ length: count }, (_, index) => ({
      id: `school-${index}`, canonicalName: `Synthetic Medical School ${index}`, programType: index % 2 ? "md" : "do",
      verificationStatus: index % 9 === 0 ? "unknown" : "incomplete", sources: [],
    }));
    const started = performance.now();
    const result = parseApplicationSchoolDataset({ schemaVersion: 2, generatedAt: "2026-08-09T12:00:00Z", schools }, new Date("2026-08-09T12:00:00Z"));
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.schools).toHaveLength(count);
      expect(result.dataset.recordCount).toBe(count);
    }
    expect(elapsed).toBeLessThan(1000);
  });

  it("round-trips a 271-school incremental patch without changing untouched records", () => {
    const source = (index: number) => ({ url: `https://school-${index}.example.edu/admissions`, retrievedAt: "2026-08-10T12:00:00Z" });
    const baseInput = {
      schemaVersion: 2, generatedAt: "2026-08-10T12:00:00Z", recordCount: 271,
      schools: Array.from({ length: 271 }, (_, index) => ({
        id: `school-${index}`, canonicalName: `Synthetic Medical School ${index}`, tuition: "Unknown",
        verificationStatus: "incomplete", sources: [source(index)],
      })),
    };
    const patchInput = {
      schemaVersion: 2, generatedAt: "2026-08-11T12:00:00Z", recordCount: 33,
      schools: [
        ...Array.from({ length: 30 }, (_, index) => ({
          id: `school-${index}`, canonicalName: `Synthetic Medical School ${index}`, tuition: `$${index + 1}0k`,
          verificationStatus: "verified", sources: [source(index)],
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `new-${index}`, canonicalName: `New Medical School ${index}`, verificationStatus: "unknown", sources: [],
        })),
      ],
    };
    const base = parseApplicationSchoolDataset(baseInput, new Date("2026-08-11T00:00:00Z"));
    const patch = parseApplicationSchoolDataset(patchInput, new Date("2026-08-11T00:00:00Z"));
    expect(base.ok && patch.ok).toBe(true);
    if (!base.ok || !patch.ok) return;
    const merged = mergeApplicationSchoolDatasets(base.dataset, patch.dataset);
    expect(merged.dataset.schools).toHaveLength(274);
    expect(merged.dataset.schools.find((school) => school.id === "school-40")?.tuition).toBe("Unknown");
    expect(merged.dataset.schools.find((school) => school.id === "school-4")?.tuition).toBe("$50k");
    expect(merged.dataset.schools.find((school) => school.id === "new-2")?.canonicalName).toBe("New Medical School 2");
  });
});

describe("research context fields: statistics, estimates and risk flags", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const stat = (overrides: Partial<ReportedStatistic> = {}): ReportedStatistic => ({
    id: "admissions_requirements_raw.avg_gpa", label: "Reported class GPA", metric: "gpa", kind: "average", value: "3.85 median",
    number: 3.85, approximate: true, url: "https://example.edu/facts", capturedAt: "2026-07-22T00:00:00Z", basis: "unverified-capture", ...overrides,
  });
  const estimates = (overrides: Partial<SchoolEstimates> = {}): SchoolEstimates => ({
    tier: "B", hours: { shadowing: { text: "40-100", min: 40, max: 100 } }, confidence: "low",
    disclaimer: "ESTIMATE: directional only.", estimatedAt: "2026-07-22T00:00:00Z", ...overrides,
  });
  const fact = (id: string, overrides: Partial<SchoolResearchFact> = {}): SchoolResearchFact => ({
    id, label: id, value: "3.0", url: "https://example.edu/requirements", capturedAt: "2026-07-19T00:00:00Z", captureStatus: "unverified-capture", ...overrides,
  });
  const school = (id: string, overrides: Partial<ApplicationSchool> = {}): ApplicationSchool => ({
    id, canonicalName: `School ${id}`, name: `School ${id}`, verificationStatus: "incomplete", sources: [], ...overrides,
  });

  it("normalizes segments and keeps only safe, plausible research context", () => {
    const result = parseApplicationSchoolDataset({
      schemaVersion: 2, generatedAt: "2026-07-22T00:00:00Z",
      schools: [
        {
          ...school("one"), segment: "canada_md",
          reportedStats: [
            stat(), stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat", number: 600, value: "600?" }),
            stat({ url: "javascript:alert(1)" }), stat({ capturedAt: "2099-01-01T00:00:00Z" }), { ...stat(), basis: "rumor" },
          ],
          estimates: {
            ...estimates(), confidence: "certain",
            competitiveGpa: { value: 3.9, basis: "SCHOOL_DATA_IN_FILE (floor/minimum value)", floorBased: false, peerFallback: false },
            competitiveMcat: { value: 600, basis: "SCHOOL_DATA_IN_FILE", floorBased: false, peerFallback: false },
            indexScore: { value: 61.2, interpretation: "59-64.9" },
            hours: {
              research: { text: "800-200", min: 800, max: 200 }, shadowing: { text: "40-100+", min: 40, max: 100, openEnded: "yes" },
              sleep: { text: "56" }, leadership: { text: "150-400", min: 150, max: 400, openEnded: true },
            },
          },
          riskFlag: { tier: "MODERATE", url: "https://example.edu/risk", capturedAt: "2026-07-21T00:00:00Z", captureStatus: "official-capture" },
        },
        { ...school("two"), segment: "MARS", estimates: { ...estimates(), disclaimer: " " }, riskFlag: { tier: "HIGH", url: "ftp://example.edu", capturedAt: "2026-07-21T00:00:00Z" } },
        { ...school("three"), estimates: { ...estimates(), estimatedAt: "2026-07-22" } },
      ],
    }, now);
    if (!result.ok) throw Error("Invalid fixture");
    const [one, two, three] = result.dataset.schools;
    expect(result.dataset.rejectedRecords).toBe(0);
    expect(result.issues.every(item => item.severity === "warning")).toBe(true);
    expect(result.issues.map(item => item.path)).toEqual([
      "schools[0].reportedStats", "schools[0].reportedStats", "schools[0].reportedStats", "schools[0].estimates", "schools[1].estimates", "schools[1].riskFlag", "schools[2].estimates",
    ]);
    // A future capture is reported apart from unsafe links and unknown bases.
    expect(result.issues.filter(item => item.path === "schools[0].reportedStats").map(item => item.message)).toEqual([
      "2 reported statistic(s) with an unsafe link, invalid date or unknown basis were rejected.",
      "1 reported statistic(s) dated in the future were rejected.",
      "1 implausible reported number(s) were dropped; the source text is kept.",
    ]);
    expect([one.segment, two.segment, three.segment]).toEqual(["CANADA_MD", "OTHER", undefined]);
    expect(one.reportedStats).toEqual([stat(), { ...stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat", value: "600?" }), number: undefined }]);
    expect(one.reportedStats![1]).not.toHaveProperty("number");
    expect(one.estimates).toEqual({
      tier: "B", confidence: "unknown", disclaimer: "ESTIMATE: directional only.", estimatedAt: "2026-07-22T00:00:00Z",
      competitiveGpa: { value: 3.9, basis: "SCHOOL_DATA_IN_FILE (floor/minimum value)", floorBased: true, peerFallback: false },
      indexScore: { value: 61.2, interpretation: "59-64.9" },
      hours: { research: { text: "800-200" }, shadowing: { text: "40-100+", min: 40, max: 100 }, leadership: { text: "150-400", min: 150, max: 400, openEnded: true } },
    });
    expect(one.riskFlag).toEqual({ tier: "MODERATE", url: "https://example.edu/risk", capturedAt: "2026-07-21T00:00:00Z", captureStatus: "official-capture" });
    expect([two.estimates, two.riskFlag, three.estimates]).toEqual([undefined, undefined, undefined]);
  });

  it("refreshes statistics, estimates and risk flags by recency without flipping verification status", () => {
    const base = testDataset([
      school("one", {
        reportedStats: [stat(), stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat", value: "510", number: 510 })],
        estimates: estimates(), riskFlag: { tier: "MODERATE", url: "https://example.edu/risk", capturedAt: "2026-07-21T00:00:00Z", captureStatus: "unverified-capture" },
      }),
      school("two"),
    ]);
    const incoming = testDataset([
      school("one", {
        segment: "US_MD",
        reportedStats: [
          stat({ value: "3.9", number: 3.9, capturedAt: "2026-07-25T00:00:00Z", basis: "official-capture" }),
          stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat", value: "505", number: 505, capturedAt: "2026-07-10T00:00:00Z" }),
          stat({ id: "admissions_requirements_raw.competitive_gpa", kind: "competitive" }),
        ],
        estimates: estimates({ tier: "C", estimatedAt: "2026-07-01T00:00:00Z" }),
        riskFlag: { tier: "HIGHER", url: "https://example.edu/risk", capturedAt: "2026-07-30T00:00:00Z", captureStatus: "unverified-capture" },
      }),
      school("two", { estimates: estimates({ tier: "D" }) }),
    ]);
    const merged = mergeApplicationSchoolDatasets(base, incoming);
    const [one, two] = merged.dataset.schools;
    expect(merged.conflicts).toBe(0);
    expect([one.verificationStatus, two.verificationStatus]).toEqual(["incomplete", "incomplete"]);
    expect(one.segment).toBe("US_MD");
    expect(one.reportedStats!.map(item => [item.id.split(".")[1], item.value])).toEqual([["avg_gpa", "3.9"], ["mcat_avg", "510"], ["competitive_gpa", "3.85 median"]]);
    expect(one.estimates!.tier).toBe("B");
    expect(one.riskFlag!.tier).toBe("HIGHER");
    expect(two.estimates!.tier).toBe("D");
  });

  it("diffs two runs and counts only the review checks a changed fact reopens", () => {
    const base = testDataset([
      school("A", { researchFacts: [fact("f1"), fact("f2"), fact("f3")], estimates: estimates() }),
      school("B", { researchFacts: [fact("f1")] }),
      school("C", { researchFacts: [fact("f1")] }),
    ]);
    const incoming = testDataset([
      school("A", { researchFacts: [fact("f1"), fact("f2", { value: "3.2" }), fact("f3", { label: "Renamed label" }), fact("f4")], estimates: estimates({ confidence: "moderate" }) }),
      { ...school("C-2"), canonicalName: "School C", researchFacts: [] },
      school("D", { researchFacts: [fact("f1")] }),
    ]);
    const diff = diffApplicationSchoolDatasets(base, incoming);
    expect(diff).toEqual({
      addedSchools: ["D"], removedSchools: ["B"],
      changedFacts: [
        { schoolId: "A", factId: "f2", fields: ["value"], before: fact("f2"), after: fact("f2", { value: "3.2" }) },
        { schoolId: "A", factId: "f3", fields: ["label"], before: fact("f3"), after: fact("f3", { label: "Renamed label" }) },
      ],
      addedFacts: [{ schoolId: "A", factId: "f4" }], removedFacts: [{ schoolId: "C", factId: "f1" }],
      estimateChanges: ["A"], statChanges: [], reviewChecksReopened: 1,
    });
    expect(diffApplicationSchoolDatasets(base, base)).toEqual({
      addedSchools: [], removedSchools: [], changedFacts: [], addedFacts: [], removedFacts: [], estimateChanges: [], statChanges: [], reviewChecksReopened: 0,
    });
  });

  it("keeps floorLike boolean-only, derives it from threshold/range wording and carries it through merge and diff", () => {
    const result = parseApplicationSchoolDataset({
      schemaVersion: 2, generatedAt: "2026-07-22T00:00:00Z",
      schools: [school("one", { reportedStats: [
        stat({ id: "admissions_requirements_raw.competitive_gpa", kind: "competitive", value: "3.0 (recommended overall)", number: 3 }),
        { ...stat({ id: "admissions_requirements_raw.mcat_competitive", metric: "mcat", kind: "competitive", value: "509", number: 509 }), floorLike: "yes" as unknown as boolean },
        stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat", value: "510", number: 510, floorLike: false }),
        stat({ id: "admissions_requirements_raw.avg_science_gpa", metric: "science-gpa", value: "3.61 (2024-25 entering)", number: 3.61, approximate: undefined }),
        stat({ id: "admissions_requirements_raw.competitive_science_gpa", metric: "science-gpa", kind: "competitive", value: "3.5-3.8", number: 3.5 }),
        stat({ id: "admissions_requirements_raw.avg_gpa", value: "3.7", number: 3.7, approximate: undefined, floorLike: true }),
      ] })],
    }, now);
    if (!result.ok) throw Error("Invalid fixture");
    const stats = result.dataset.schools[0].reportedStats!;
    expect(stats.map(item => [item.id.split(".")[1], item.floorLike])).toEqual([
      ["competitive_gpa", true], ["mcat_competitive", true], ["mcat_avg", undefined], ["avg_science_gpa", undefined], ["competitive_science_gpa", true], ["avg_gpa", true],
    ]);
    expect(stats.every(item => item.floorLike === undefined || item.floorLike === true)).toBe(true);
    expect(result.issues.map(item => item.message)).toEqual(["1 reported statistic(s) had a non-boolean floorLike flag; they are treated as floor-like."]);

    const refreshed = testDataset([school("one", { reportedStats: [stat({ value: "3.9+", number: 3.9, floorLike: true, capturedAt: "2026-07-25T00:00:00Z", basis: "official-capture" })] })]);
    const merged = mergeApplicationSchoolDatasets(testDataset([school("one", { reportedStats: [stat()] })]), refreshed);
    expect(merged.dataset.schools[0].reportedStats).toEqual(refreshed.schools[0].reportedStats);
    const diff = diffApplicationSchoolDatasets(testDataset([school("one", { reportedStats: [stat(), stat({ id: "admissions_requirements_raw.mcat_avg", metric: "mcat" })] })]),
      testDataset([school("one", { reportedStats: [stat({ floorLike: true, basis: "third-party" }), stat({ id: "admissions_requirements_raw.competitive_gpa", kind: "competitive" })] })]));
    expect(diff.statChanges).toEqual([
      { schoolId: "one", statId: "admissions_requirements_raw.avg_gpa", change: "changed", fields: ["floorLike", "basis"] },
      { schoolId: "one", statId: "admissions_requirements_raw.competitive_gpa", change: "added", fields: [] },
      { schoolId: "one", statId: "admissions_requirements_raw.mcat_avg", change: "removed", fields: [] },
    ]);
  });

  it("keeps review-queue conflicts from both runs, counts only new ones and drops third-party facts from older runs", () => {
    const base = testDataset([
      school("A", { conflicts: { "C0001: state_or_country": { existing: "Anguilla & St. Vincent", incoming: "Anguilla / Saint Vincent" } },
        researchFacts: [fact("admissions_requirements_raw.mcat_min", { value: "495 (min, third-party)" }), fact("admissions_requirements_raw.min_gpa")] }),
      school("B", { researchFacts: [fact("application_process_raw.primary_deadline", { value: "2025-12-15 (fall 2026 entry, third-party)" })] }),
    ]);
    const incoming = testDataset([
      school("A", { conflicts: {
        "C0001: state_or_country": { existing: "Anguilla & St. Vincent", incoming: "Anguilla / Saint Vincent" },
        "C0004: campus_and_pass_rate": { existing: "Anguilla & St. Vincent", incoming: "Anguilla campus closed 2024" },
      }, researchFacts: [fact("admissions_requirements_raw.min_gpa")] }),
      school("B", { conflicts: { "C0014: tuition_flat": { existing: "Tuition-free", incoming: "$72,010" } },
        researchFacts: [fact("application_process_raw.primary_deadline", { value: "November 1" })] }),
      school("C", { conflicts: { "C0015: ecfmg_eligible": { existing: "Candidacy withdrawn", incoming: "School advertises ECFMG support" } },
        researchFacts: [fact("application_process_raw.secondary_deadline", { value: "January 15 (per aggregator)" })] }),
    ]);
    const merged = mergeApplicationSchoolDatasets(base, incoming);
    const [a, b, c] = merged.dataset.schools;
    expect(Object.keys(a.conflicts!)).toEqual(["C0001: state_or_country", "C0004: campus_and_pass_rate"]);
    expect(a.researchFacts!.map(item => item.value)).toEqual(["3.0"]);
    // The base's third-party deadline is dropped, so the incoming value is not a fact conflict.
    expect(b.conflicts).toEqual({ "C0014: tuition_flat": { existing: "Tuition-free", incoming: "$72,010" } });
    expect(b.researchFacts!.map(item => item.value)).toEqual(["November 1"]);
    expect(c.researchFacts).toEqual([]);
    expect([a.verificationStatus, b.verificationStatus]).toEqual(["conflicting", "conflicting"]);
    expect(merged.conflicts).toBe(3);
    expect(merged.warnings).toEqual([
      "School A: C0004: campus_and_pass_rate needs review.", "School B: C0014: tuition_flat needs review.", "School C: C0015: ecfmg_eligible needs review.",
    ]);
    expect(mergeApplicationSchoolDatasets(merged.dataset, incoming).conflicts).toBe(0);
  });
});

export function testDataset(schools: ApplicationSchoolDataset["schools"]): ApplicationSchoolDataset {
  return { schemaVersion: 2, generatedAt: "2026-08-09T12:00:00Z", recordCount: schools.length, successfulRecords: schools.length, incompleteRecords: 0, rejectedRecords: 0, schools };
}
