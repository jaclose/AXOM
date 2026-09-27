import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseApplicationSchoolDataset } from "./applicationSchools";

type Rows = Record<string, string>[];

function writeCsv(folder: string, name: string, rows: Rows) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  writeFileSync(join(folder, name + ".csv"), [keys, ...rows.map(row => keys.map(key => row[key] ?? ""))].map(row => row.map(cell).join(",")).join("\n"));
}

/** Runs the adapter on synthetic tables; tables left out are simply absent from the folder. */
function adapt(tables: Record<string, Rows>) {
  const folder = mkdtempSync(join(tmpdir(), "axom-research-adapter-"));
  try {
    for (const [name, rows] of Object.entries(tables)) writeCsv(folder, name, rows);
    const output = join(folder, "out.json");
    const result = spawnSync("python3", ["scripts/build-application-research.py", folder, output], { encoding: "utf8" });
    if (result.status !== 0) throw Error(result.stderr);
    const text = readFileSync(output, "utf8");
    const parsed = parseApplicationSchoolDataset(JSON.parse(text), new Date("2026-09-23T12:00:00Z"));
    if (!parsed.ok) throw Error("Adapter produced invalid data");
    return { report: JSON.parse(result.stdout), text, issues: parsed.issues, schools: new Map(parsed.dataset.schools.map(school => [school.id, school])) };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

const roster = (school_id: string, segment: string, program_type: string) => ({
  school_id, institution_name: `Synthetic ${school_id}`, segment, program_type, is_canonical: "True", state_or_country: "Test",
  admissions_website_phase0: "https://example.edu", date_seeded: "2026-07-19",
});
const url = "https://example.edu/requirements";

describe("Phase 1 research adapter", () => {
  it("preserves quoted source text, suppresses duplicates and never promotes field estimates", () => {
    const folder = mkdtempSync(join(tmpdir(), "axom-research-adapter-"));
    const csv = (name: string, rows: Rows) => writeCsv(folder, name, rows);
    try {
      const school = { school_id: "one", institution_name: "Synthetic School", is_canonical: "True", program_type: "MD", state_or_country: "Test", admissions_website_phase0: "https://example.edu", date_seeded: "2026-07-19" };
      csv("schools_raw", [school, { ...school, school_id: "duplicate", is_canonical: "False" }]);
      csv("admissions_requirements_raw", [{ school_id: "one", min_gpa: "3.0 (conditional, not universal)", mcat_min: "An estimate", mcat_recency_policy: "New policy\nRead exceptions", policy_url: "https://example.edu/requirements", date_captured: "2026-07-22", verification_status: "OFFICIAL_VERIFIED" }]);
      csv("coursework_policy_raw", []); csv("application_process_raw", []); csv("conflicts_and_review_queue", []);
      csv("field_provenance_raw", [
        { school_id: "one", table_name: "admissions_requirements_raw", field_name: "mcat_min", captured_value: "An estimate", verification_status: "THIRD_PARTY_UNVERIFIED", source_url: "https://example.edu/requirements", date_captured: "2026-07-19" },
        { school_id: "one", table_name: "admissions_requirements_raw", field_name: "mcat_recency_policy", captured_value: "Old policy", verification_status: "OFFICIAL_VERIFIED", source_url: "https://example.edu/old", date_captured: "2026-07-19" },
      ]);
      const output = join(folder, "out.json");
      const result = spawnSync("python3", ["scripts/build-application-research.py", folder, output], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ rosterRows: 2, publishedSchools: 1, excludedNoncanonicalIds: ["duplicate"], researchFacts: 2 });
      const parsed = parseApplicationSchoolDataset(JSON.parse(readFileSync(output, "utf8")), new Date("2026-09-22T00:00:00Z"));
      if (!parsed.ok) throw Error("Adapter produced invalid data");
      expect(parsed.issues).toEqual([]);
      expect(parsed.dataset.schools[0].researchFacts).toEqual([
        expect.objectContaining({ value: "3.0 (conditional, not universal)", captureStatus: "official-capture" }),
        expect.objectContaining({ value: "New policy\nRead exceptions", captureStatus: "unverified-capture", url: "https://example.edu/requirements" }),
      ]);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it("accepts a sparse appended export: optional tables, no is_canonical column, latest row wins", () => {
    const admissions = (school_id: string, min_gpa: string, date_captured: string, verification_status = "OFFICIAL_VERIFIED") =>
      ({ school_id, min_gpa, policy_url: url, date_captured, verification_status, column_added_later: "ignored" });
    const { report, schools, issues } = adapt({
      schools_raw: [roster("ca1", "CANADA_MD", "MD-equivalent (Canada)"), roster("ca2", "US_MD", "MD")].map(({ is_canonical: _drop, ...row }) => row),
      admissions_requirements_raw: [
        admissions("ca1", "3.3", "2026-07-19"), admissions("ca1", "3.5", "2026-07-25", "LEGACY_IMPORT"), admissions("ca1", "2.9", "2026-07-10"),
        admissions("ca2", "3.0", "2026-07-20"), admissions("ca2", "3.1", "2026-07-20"),
      ],
    });
    expect(issues).toEqual([]);
    expect(report).toMatchObject({
      rosterRows: 2, publishedSchools: 2, excludedNoncanonicalIds: [], researchFacts: 2,
      supersededRows: { admissions_requirements_raw: 3, schools_raw: 0 }, segments: { CANADA_MD: 1, US_MD: 1 },
    });
    expect(report.missingTables).toEqual(expect.arrayContaining(["coursework_policy_raw", "conflicts_and_review_queue", "field_provenance_raw", "applicant_profile_estimate_raw"]));
    expect(report.missingTables).not.toContain("admissions_requirements_raw");
    expect(schools.get("ca1")).toMatchObject({ segment: "CANADA_MD", programType: "md", updatedAt: "2026-07-25T00:00:00Z", verificationStatus: "incomplete" });
    expect(schools.get("ca1")!.researchFacts).toEqual([expect.objectContaining({ value: "3.5", captureStatus: "unverified-capture", capturedAt: "2026-07-25T00:00:00Z" })]);
    expect(schools.get("ca2")!.researchFacts).toEqual([expect.objectContaining({ value: "3.1", captureStatus: "official-capture" })]);
    expect(schools.get("ca1")!.estimates).toBeUndefined();
  });

  it("exports cost, accreditation, class statistics, estimates and risk flags without promoting estimates", () => {
    const tables: Record<string, Rows> = {
      schools_raw: [roster("one", "US_MD", "MD"), roster("two", "CARIBBEAN_INTL", "Caribbean / MD-equivalent"), roster("three", "CANADA_MD", "MD (Canada)"), roster("four", "INTL_OTHER", "DO")],
      admissions_requirements_raw: [
        { school_id: "one", min_gpa: "3.0", min_science_gpa: "3.2 (third-party aggregator)", avg_gpa: "3.85 median (third-party)", competitive_gpa: ">3.5",
          avg_science_gpa: "NOT_PUBLICLY_DISCLOSED", competitive_science_gpa: "3.6", mcat_avg: "510", mcat_competitive: "50th percentile or higher",
          policy_url: url, date_captured: "2026-07-22", verification_status: "OFFICIAL_VERIFIED" },
        { school_id: "two", avg_gpa: "3.61 (2024-25 entering)", mcat_avg: "~493 avg", policy_url: url, date_captured: "2026-07-21", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" },
      ],
      coursework_policy_raw: [
        { school_id: "two", biology_hours: "8", prereq_policy_url: url, date_captured: "2026-07-21", verification_status: "LEGACY_IMPORT" },
        { school_id: "four", biology_hours: "8", prereq_policy_url: url, date_captured: "2026-07-21", verification_status: "ESTIMATE" },
      ],
      application_process_raw: [{ school_id: "one", secondary_fee: "$100", process_policy_url: url, date_captured: "2026-07-22", verification_status: "OFFICIAL_VERIFIED" }],
      cost_financial_aid_raw: [
        { school_id: "one", academic_year: "2025-2026", tuition_in_state: "", tuition_flat: "$68,620", total_cost_of_attendance: "NF", title_iv_federal_loan_eligible: "Yes (LCME U.S. school)",
          cost_policy_url: "https://example.edu/cost", date_captured: "2026-07-22", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" },
        { school_id: "four", tuition_flat: "59000", cost_policy_url: "https://example.edu/cost", date_captured: "2026-07-22", verification_status: "SEARCH_DERIVED_THIRD_PARTY" },
      ],
      accreditation_regulatory_raw: [{ school_id: "two", accreditor_primary: "CAAM-HP", wfme_recognized: "REQUIRES_MANUAL_VERIFICATION", ecfmg_eligible: "Yes",
        accreditation_policy_url: "https://example.edu/accreditation", date_captured: "2026-07-21", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" }],
      caribbean_risk_eligibility_raw: [
        { school_id: "two", risk_tier: "MODERATE (CAAM-HP)", state_approvals_ny_ca_fl: "REQUIRES_MANUAL_VERIFICATION", federal_loan_eligibility: "Eligible", ecfmg_eligible: "Yes",
          notes: "Verify approvals.", source_url: "https://example.edu/risk", date_captured: "2026-07-21", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" },
        { school_id: "three", risk_tier: "NOT_FOUND_AFTER_OFFICIAL_SEARCH", source_url: "https://example.edu/risk", date_captured: "2026-07-21", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" },
      ],
      applicant_profile_estimate_raw: [
        { school_id: "one", tier_classification: "A", tier_rationale: "Research-heavy.", est_competitive_gpa: "3.91", gpa_basis: "TIER_PEER_FALLBACK_ESTIMATE (avg of 4 peers)",
          est_competitive_mcat: "503", mcat_basis: "SCHOOL_DATA_IN_FILE (floor/minimum value, not confirmed matriculant avg)", est_lizzym_composite_index: "61.2",
          lizzym_benchmark_interpretation: "59-64.9 : many DO programs", est_research_hours_range: "800-2000+ (often 1-2 dedicated research years)",
          est_clinical_volunteer_hours_range: "1,000-2,500", est_shadowing_hours_range: "Varies by applicant", est_paid_clinical_work_hours_range: "500-100",
          confidence_level: "MODERATE", disclaimer: "ESTIMATE: directional planning context only.", sources_referenced: "AAMC MSQ", date_estimated: "2026-07-22" },
        { school_id: "two", tier_classification: "D", est_competitive_gpa: "3.0", gpa_basis: "SCHOOL_DATA_IN_FILE", date_estimated: "2026-07-22" },
        { school_id: "three", est_competitive_gpa: "5.2", gpa_basis: "SCHOOL_DATA_IN_FILE", est_competitive_mcat: "508", confidence_level: "unclear",
          disclaimer: "ESTIMATE: no verified data.", date_estimated: "2026-07-22" },
        { school_id: "four", tier_classification: "C", disclaimer: "ESTIMATE: undated.", date_estimated: "" },
      ],
      field_provenance_raw: [{ school_id: "one", table_name: "admissions_requirements_raw", field_name: "competitive_science_gpa", captured_value: "3.6",
        verification_status: "THIRD_PARTY_UNVERIFIED", source_url: "https://aggregator.example.com/one", date_captured: "2026-07-20" }],
      conflicts_and_review_queue: [
        { conflict_id: "C1", school_id: "one", field_name: "tuition_flat", value_a: "$68,620", value_b: "$70,000", status: "OPEN_CONFLICT" },
        { conflict_id: "C2", school_id: "one", field_name: "mcat_avg", value_a: "510", value_b: "515", status: "OPEN_NOT_RECORDED" },
        { conflict_id: "C3", school_id: "one", field_name: "avg_gpa", value_a: "3.85", value_b: "3.80", status: "OPEN_VERIFY" },
        { conflict_id: "C4", school_id: "two", field_name: "accreditor_primary", value_a: "CAAM-HP", value_b: "ACCM", status: "RESOLVED_REFINEMENT" },
        { conflict_id: "C5", school_id: "two", field_name: "website_typo", value_a: "a", value_b: "b", status: "OPEN_VERIFY" },
        { conflict_id: "C6", school_id: "two", field_name: "federal_loans", value_a: "Grad PLUS available", value_b: "Grad PLUS eliminated", status: "OPEN_POLICY_WATCH" },
      ],
    };
    const first = adapt(tables);
    const { report, schools, issues } = first;
    expect(adapt(tables).text).toBe(first.text);
    expect(issues).toEqual([]);
    expect(report).toMatchObject({
      rosterRows: 4, publishedSchools: 4, researchFacts: 13, schoolsWithEstimates: 2, reportedStats: 7, riskFlags: 1,
      excludedThirdPartyFacts: 3, excludedConflicts: 3, missingTables: [],
      thirdPartyBySourceType: { facts: 0, stats: 0 }, droppedNoUrlOrDate: { facts: 0, stats: 0, riskFlags: 0 },
      statPolicyNoteFacts: 0, floorLikeStats: 1, floorBasedEstimates: 1,
      factsByCaptureStatus: { "official-capture": 2, "unverified-capture": 11 },
      factsByTable: { admissions_requirements_raw: 1, coursework_policy_raw: 1, application_process_raw: 1, cost_financial_aid_raw: 4, accreditation_regulatory_raw: 3, caribbean_risk_eligibility_raw: 3 },
      segments: { CANADA_MD: 1, CARIBBEAN_INTL: 1, OTHER: 1, US_MD: 1 },
    });
    expect(JSON.parse(first.text).sourcePipelineVersion).toBe("phase1-research-adapter-v2");

    const one = schools.get("one")!;
    expect(one.researchFacts!.map(fact => [fact.id, fact.label, fact.value, fact.captureStatus])).toEqual([
      ["admissions_requirements_raw.min_gpa", "GPA minimum (read exceptions)", "3.0", "official-capture"],
      ["application_process_raw.secondary_fee", "Secondary application fee", "$100", "official-capture"],
      ["cost_financial_aid_raw.academic_year", "Cost figures academic year", "2025-2026", "unverified-capture"],
      ["cost_financial_aid_raw.tuition_flat", "Tuition (all students)", "$68,620", "unverified-capture"],
      ["cost_financial_aid_raw.total_cost_of_attendance", "Total cost of attendance", "NF", "unverified-capture"],
      ["cost_financial_aid_raw.title_iv_federal_loan_eligible", "U.S. federal (Title IV) loan eligibility", "Yes (LCME U.S. school)", "unverified-capture"],
    ]);
    expect(one.researchFacts!.find(fact => fact.id.startsWith("cost_"))!.url).toBe("https://example.edu/cost");
    expect(one.reportedStats).toEqual([
      { id: "admissions_requirements_raw.avg_gpa", label: "Reported class GPA", metric: "gpa", kind: "average", value: "3.85 median (third-party)", number: 3.85, approximate: true, url, capturedAt: "2026-07-22T00:00:00Z", basis: "third-party" },
      // An OFFICIAL_VERIFIED row without a matching official provenance row is not an official-page capture.
      { id: "admissions_requirements_raw.competitive_gpa", label: "Reported competitive GPA", metric: "gpa", kind: "competitive", value: ">3.5", number: 3.5, approximate: true, floorLike: true, url, capturedAt: "2026-07-22T00:00:00Z", basis: "unverified-capture" },
      { id: "admissions_requirements_raw.competitive_science_gpa", label: "Reported competitive science GPA", metric: "science-gpa", kind: "competitive", value: "3.6", number: 3.6, url: "https://aggregator.example.com/one", capturedAt: "2026-07-20T00:00:00Z", basis: "third-party" },
      { id: "admissions_requirements_raw.mcat_avg", label: "Reported class MCAT", metric: "mcat", kind: "average", value: "510", number: 510, url, capturedAt: "2026-07-22T00:00:00Z", basis: "unverified-capture" },
      { id: "admissions_requirements_raw.mcat_competitive", label: "Reported competitive MCAT", metric: "mcat", kind: "competitive", value: "50th percentile or higher", url, capturedAt: "2026-07-22T00:00:00Z", basis: "unverified-capture" },
    ]);
    expect(schools.get("two")!.reportedStats!.map(stat => [stat.number, stat.approximate, stat.basis])).toEqual([[3.61, undefined, "unverified-capture"], [493, true, "unverified-capture"]]);

    expect(one.estimates).toEqual({
      tier: "A", tierRationale: "Research-heavy.",
      competitiveGpa: { value: 3.91, basis: "TIER_PEER_FALLBACK_ESTIMATE (avg of 4 peers)", floorBased: false, peerFallback: true },
      competitiveMcat: { value: 503, basis: "SCHOOL_DATA_IN_FILE (floor/minimum value, not confirmed matriculant avg)", floorBased: true, peerFallback: false },
      indexScore: { value: 61.2, interpretation: "59-64.9 : many DO programs" },
      hours: {
        research: { text: "800-2000+ (often 1-2 dedicated research years)", min: 800, max: 2000, openEnded: true },
        clinicalVolunteer: { text: "1,000-2,500", min: 1000, max: 2500 },
        shadowing: { text: "Varies by applicant" },
        paidClinical: { text: "500-100" },
      },
      confidence: "moderate", disclaimer: "ESTIMATE: directional planning context only.", sourcesReferenced: "AAMC MSQ", estimatedAt: "2026-07-22T00:00:00Z",
    });
    expect(schools.get("two")!.estimates).toBeUndefined();
    expect(schools.get("three")!.estimates).toEqual({ hours: {}, confidence: "unknown", disclaimer: "ESTIMATE: no verified data.", estimatedAt: "2026-07-22T00:00:00Z" });
    expect(schools.get("four")!.estimates).toBeUndefined();
    for (const school of schools.values()) expect(school.researchFacts!.some(fact => /ESTIMATE|applicant_profile/.test(fact.id + fact.value))).toBe(false);

    const two = schools.get("two")!;
    expect(two.riskFlag).toEqual({ tier: "MODERATE (CAAM-HP)", notes: "Verify approvals.", url: "https://example.edu/risk", capturedAt: "2026-07-21T00:00:00Z", captureStatus: "unverified-capture" });
    expect(schools.get("three")!.riskFlag).toBeUndefined();
    expect(two.researchFacts!.map(fact => [fact.id, fact.value, fact.captureStatus])).toEqual([
      ["coursework_policy_raw.biology_hours", "8", "unverified-capture"],
      ["accreditation_regulatory_raw.accreditor_primary", "CAAM-HP", "unverified-capture"],
      ["accreditation_regulatory_raw.wfme_recognized", "REQUIRES_MANUAL_VERIFICATION", "unverified-capture"],
      ["accreditation_regulatory_raw.ecfmg_eligible", "Yes", "unverified-capture"],
      ["caribbean_risk_eligibility_raw.state_approvals_ny_ca_fl", "REQUIRES_MANUAL_VERIFICATION", "unverified-capture"],
      ["caribbean_risk_eligibility_raw.federal_loan_eligibility", "Eligible", "unverified-capture"],
      ["caribbean_risk_eligibility_raw.ecfmg_eligible", "Yes", "unverified-capture"],
    ]);

    expect(one.conflicts).toEqual({ "C1: tuition_flat": { existing: "$68,620", incoming: "$70,000" } });
    expect(two.conflicts).toEqual({ "C6: federal_loans": { existing: "Grad PLUS available", incoming: "Grad PLUS eliminated" } });
    expect([one.verificationStatus, two.verificationStatus, schools.get("three")!.verificationStatus]).toEqual(["conflicting", "conflicting", "unknown"]);
    expect([...schools.values()].map(school => [school.segment, school.programType])).toEqual([["US_MD", "md"], ["CARIBBEAN_INTL", "other"], ["CANADA_MD", "md"], ["OTHER", "do"]]);
    expect(schools.get("four")!.researchFacts).toEqual([]);
  });

  const admissionsRow = (school_id: string, fields: Record<string, string>, verification_status = "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH") =>
    ({ school_id, ...fields, policy_url: url, date_captured: "2026-07-22", verification_status });
  const estimateRow = (school_id: string, fields: Record<string, string>) =>
    ({ school_id, ...fields, confidence_level: "LOW", disclaimer: "ESTIMATE: directional only.", date_estimated: "2026-07-22" });
  const provenanceRow = (school_id: string, table_name: string, field_name: string, captured_value: string, source_type: string, verification_status: string) =>
    ({ school_id, table_name, field_name, captured_value, source_type, verification_status, source_url: url, date_captured: "2026-07-22" });

  it("marks estimates that repeat a school minimum, scholarship, threshold or track figure as floor-based (real Phase 1 text)", () => {
    const ids = ["S0166", "S0269", "S0239", "S0007", "S0259", "S0240", "S0125", "S0013", "S0189"];
    const { schools } = adapt({
      schools_raw: ids.map(id => roster(id, "US_MD", "MD")),
      admissions_requirements_raw: [
        admissionsRow("S0166", { min_gpa: "2.8 cumulative", mcat_min: "None stated in official requirements" }),
        admissionsRow("S0269", { min_gpa: "3.0 (North American applicants)" }),
        admissionsRow("S0239", { min_gpa: "3.6+ earns 20% tuition scholarship (indirect signal)" }),
        admissionsRow("S0007", { min_gpa: "NOT_PUBLICLY_DISCLOSED", mcat_min: "500 (AR residents) / 505 (non-residents)" }),
        admissionsRow("S0259", { mcat_min: "491 (Accelerated 5-sem track)" }),
        admissionsRow("S0240", { mcat_min: "MCAT not required (optional; 495+ earns full-tuition scholarship)" }),
        admissionsRow("S0125", { min_gpa: "2.7 overall", min_science_gpa: "2.5 (science)", mcat_min: "494 (interview minimum; max 3 attempts)" }),
        admissionsRow("S0013", { min_gpa: "None stated", mcat_min: "506 (secondary-invite threshold)" }),
        admissionsRow("S0189", { min_gpa: "3.0", mcat_min: "495" }),
      ],
      applicant_profile_estimate_raw: [
        estimateRow("S0166", { est_competitive_gpa: "2.8", gpa_basis: "SCHOOL_DATA_IN_FILE", est_competitive_mcat: "504", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0269", { est_competitive_gpa: "3.0", gpa_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0239", { est_competitive_gpa: "3.6", gpa_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0007", { est_competitive_gpa: "3.85", gpa_basis: "SCHOOL_DATA_IN_FILE", est_competitive_mcat: "500", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0259", { est_competitive_mcat: "491", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0240", { est_competitive_mcat: "495", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0125", { est_competitive_gpa: "3.7", gpa_basis: "SCHOOL_DATA_IN_FILE", est_competitive_mcat: "499", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0013", { est_competitive_mcat: "517", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
        estimateRow("S0189", { est_competitive_gpa: "3.61", gpa_basis: "SCHOOL_DATA_IN_FILE", est_competitive_mcat: "500", mcat_basis: "SCHOOL_DATA_IN_FILE" }),
      ],
    });
    const floors = (id: string) => [schools.get(id)!.estimates!.competitiveGpa?.floorBased, schools.get(id)!.estimates!.competitiveMcat?.floorBased];
    expect(Object.fromEntries(ids.map(id => [id, floors(id)]))).toEqual({
      S0166: [true, false], S0269: [true, undefined], S0239: [true, undefined], S0007: [false, true], S0259: [undefined, true],
      S0240: [undefined, true], S0125: [false, false], S0013: [undefined, false], S0189: [false, false],
    });
    expect(schools.get("S0240")!.estimates!.competitiveMcat).toEqual({ value: 495, basis: "SCHOOL_DATA_IN_FILE", floorBased: true, peerFallback: false });
  });

  it("flags thresholds, recommended figures, open-ended values and ranges as floor-like, never class statistics", () => {
    const { schools, report } = adapt({
      schools_raw: [roster("S0036", "US_MD", "MD"), roster("S0173", "US_DO", "DO"), roster("S0170", "US_DO", "DO"), roster("S0189", "US_DO", "DO")],
      admissions_requirements_raw: [
        admissionsRow("S0036", { mcat_competitive: "502 (threshold; no section below 124; <=3 attempts)", mcat_avg: "510" }),
        admissionsRow("S0173", { competitive_gpa: "3.0 (recommended overall)", competitive_science_gpa: "3.0 (recommended science)", mcat_competitive: "500 (recommended)" }),
        admissionsRow("S0170", { competitive_gpa: "3.5-3.8", mcat_competitive: "500-506 (accepted range)", avg_gpa: "3.00+ (competitive)" }),
        admissionsRow("S0189", { avg_gpa: "3.61 (2024-25 entering; third-party)", mcat_avg: "500.1 (2024-25 median; third-party)" }),
      ],
    });
    const flags = (id: string) => schools.get(id)!.reportedStats!.map(stat => [stat.id.split(".")[1], stat.number, stat.floorLike ?? false]);
    expect(flags("S0036")).toEqual([["mcat_avg", 510, false], ["mcat_competitive", 502, true]]);
    expect(flags("S0173")).toEqual([["competitive_gpa", 3, true], ["competitive_science_gpa", 3, true], ["mcat_competitive", 500, true]]);
    expect(flags("S0170")).toEqual([["avg_gpa", 3, true], ["competitive_gpa", 3.5, true], ["mcat_competitive", 500, true]]);
    expect(flags("S0189")).toEqual([["avg_gpa", 3.61, false], ["mcat_avg", 500.1, false]]);
    expect(report.floorLikeStats).toBe(7);
  });

  it("requires a matching OFFICIAL_VERIFIED provenance row for an official stat and downgrades search digests", () => {
    const table = "admissions_requirements_raw";
    const { schools } = adapt({
      schools_raw: [roster("S0013", "US_MD", "MD"), roster("S0009", "US_MD", "MD")],
      admissions_requirements_raw: [
        admissionsRow("S0013", { avg_gpa: "3.83 (Class of 2029, per search digest of official facts)", mcat_avg: "517 median (Class of 2029, per digest)" }, "OFFICIAL_VERIFIED"),
        admissionsRow("S0009", { mcat_avg: "510 (most recent incoming class, official)", avg_gpa: "3.69", competitive_gpa: "3.7" }, "OFFICIAL_VERIFIED"),
      ],
      field_provenance_raw: [
        provenanceRow("S0013", table, "avg_gpa", "3.83 (Class of 2029, per search digest of official facts)", "OFFICIAL_PAGE_FETCHED", "OFFICIAL_VERIFIED"),
        provenanceRow("S0013", table, "mcat_avg", "517 median (Class of 2029, per digest)", "OFFICIAL_PAGE_FETCHED", "OFFICIAL_VERIFIED"),
        provenanceRow("S0009", table, "avg_gpa", "3.69", "OFFICIAL_PAGE_FETCHED", "OFFICIAL_VERIFIED"),
        provenanceRow("S0009", table, "competitive_gpa", "3.65", "OFFICIAL_PAGE_FETCHED", "OFFICIAL_VERIFIED"),
      ],
    });
    const bases = (id: string) => Object.fromEntries(schools.get(id)!.reportedStats!.map(stat => [stat.id.split(".")[1], stat.basis]));
    expect(bases("S0013")).toEqual({ avg_gpa: "unverified-capture", mcat_avg: "unverified-capture" });
    // Row status alone (mcat_avg) and a provenance value mismatch (competitive_gpa) are unverified; only avg_gpa is official.
    expect(bases("S0009")).toEqual({ competitive_gpa: "unverified-capture", avg_gpa: "official-capture", mcat_avg: "unverified-capture" });
  });

  it("treats a third-party provenance source_type as third-party even when its captured value differs", () => {
    const { schools, report } = adapt({
      schools_raw: [roster("S0018", "US_MD", "MD"), roster("S0193", "US_DO", "DO")],
      admissions_requirements_raw: [admissionsRow("S0193", { min_gpa: "2.7", min_science_gpa: "2.7", avg_gpa: "3.65 (median)" })],
      cost_financial_aid_raw: [{ school_id: "S0018", tuition_in_state: "47637", tuition_out_of_state: "59883", cost_policy_url: "https://example.edu/cost",
        date_captured: "2026-07-22", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" }],
      field_provenance_raw: [
        provenanceRow("S0018", "cost_financial_aid_raw", "tuition_in_state", "47637", "thirdparty_of_official", "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH"),
        provenanceRow("S0193", "admissions_requirements_raw", "min_gpa", "2.7 cumulative & science (supplemental)", "THIRD_PARTY", "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH"),
        provenanceRow("S0193", "admissions_requirements_raw", "avg_gpa", "3.65", "THIRD_PARTY_AGGREGATOR", "THIRD_PARTY_UNVERIFIED"),
      ],
    });
    expect(schools.get("S0018")!.researchFacts!.map(fact => fact.id)).toEqual(["cost_financial_aid_raw.tuition_out_of_state"]);
    expect(schools.get("S0193")!.researchFacts!.map(fact => [fact.id, fact.value])).toEqual([["admissions_requirements_raw.min_science_gpa", "2.7"]]);
    expect(schools.get("S0193")!.reportedStats!.map(stat => stat.basis)).toEqual(["third-party"]);
    expect(report).toMatchObject({ excludedThirdPartyFacts: 2, thirdPartyBySourceType: { facts: 2, stats: 1 } });
  });

  it("also publishes a number-free MCAT policy stat as a fact so requirement rules can read it", () => {
    const { schools, report } = adapt({
      schools_raw: [roster("S0259", "CARIBBEAN_INTL", "MD"), roster("S0279", "CARIBBEAN_INTL", "MD"), roster("S0191", "US_DO", "DO"), roster("S0020", "US_MD", "MD")],
      admissions_requirements_raw: [
        admissionsRow("S0259", { mcat_competitive: "MCAT not required but strongly recommended" }),
        admissionsRow("S0279", { mcat_competitive: "MCAT required for U.S. citizens/nationals/PR; optional but recommended for others", mcat_avg: "500 required" }),
        admissionsRow("S0191", { mcat_competitive: "50th percentile or higher (highly competitive)" }, "OFFICIAL_VERIFIED"),
        admissionsRow("S0020", { mcat_competitive: "MCAT required; scores below 513 rarely competitive (third-party)" }, "OFFICIAL_VERIFIED"),
      ],
    });
    expect(schools.get("S0259")!.researchFacts).toEqual([{ id: "admissions_requirements_raw.mcat_competitive", label: "MCAT policy note",
      value: "MCAT not required but strongly recommended", url, capturedAt: "2026-07-22T00:00:00Z", captureStatus: "unverified-capture" }]);
    expect(schools.get("S0259")!.reportedStats!.map(stat => [stat.id, stat.number, stat.floorLike])).toEqual([["admissions_requirements_raw.mcat_competitive", undefined, true]]);
    // A stat with a plausible number stays a stat only.
    expect(schools.get("S0279")!.researchFacts!.map(fact => fact.id)).toEqual(["admissions_requirements_raw.mcat_competitive"]);
    expect(schools.get("S0191")!.researchFacts).toEqual([]);
    expect(schools.get("S0020")!.researchFacts).toEqual([]);
    expect(report).toMatchObject({ statPolicyNoteFacts: 2, researchFacts: 2, factsByTable: { admissions_requirements_raw: 2 } });
  });

  it("counts facts, statistics and risk flags dropped for a missing link or capture date", () => {
    const { schools, report } = adapt({
      schools_raw: [roster("one", "US_MD", "MD"), roster("two", "CARIBBEAN_INTL", "MD")],
      admissions_requirements_raw: [
        { school_id: "one", min_gpa: "3.0", avg_gpa: "3.7", policy_url: "", date_captured: "2026-07-22", verification_status: "OFFICIAL_VERIFIED" },
        { school_id: "two", min_gpa: "3.0", mcat_avg: "500", policy_url: url, date_captured: "", verification_status: "OFFICIAL_VERIFIED" },
      ],
      caribbean_risk_eligibility_raw: [{ school_id: "two", risk_tier: "HIGH", source_url: "mailto:risk@example.edu", date_captured: "2026-07-21", verification_status: "SEARCH_DERIVED_OFFICIAL_PENDING_FETCH" }],
    });
    expect(report.droppedNoUrlOrDate).toEqual({ facts: 2, stats: 2, riskFlags: 1 });
    expect([...schools.values()].map(school => [school.researchFacts, school.reportedStats, school.riskFlag])).toEqual([[[], undefined, undefined], [[], undefined, undefined]]);
  });
});
