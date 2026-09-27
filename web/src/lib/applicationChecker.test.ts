import { describe, expect, it, vi } from "vitest";
import {
  checkSchool, compareActivities, competitivenessBand, estimateCompetitiveness, evaluateRequirements, evidenceCycleForFact,
  requirementTitle, type SchoolCheckResult,
} from "./applicationChecker.ts";
import type { ApplicationProfile } from "./applicationProfile.ts";
import { deriveRequirements, type RequirementEvidence, type RequirementKind, type StructuredRequirement } from "./applicationRequirements.ts";
import type { ApplicationSchool, ReportedStatistic, SchoolEstimates } from "./applicationSchools.ts";

// Tests exercise the evaluator with hand-built rules; the parser's readings are covered by its own tests.
vi.mock("./applicationRequirements.ts", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deriveRequirements: vi.fn(() => []),
}));

const NOW = new Date("2026-09-23T12:00:00Z");
const FORBIDDEN = /eligib|qualify|guarantee|chance|%/i;
const headlines: string[] = [];

const FACT_IDS: Record<RequirementKind, string> = {
  "gpa-minimum": "admissions_requirements_raw.min_gpa",
  "science-gpa-minimum": "admissions_requirements_raw.min_science_gpa",
  "mcat-minimum": "admissions_requirements_raw.mcat_min",
  "mcat-required": "admissions_requirements_raw.mcat_min",
  "mcat-recency": "admissions_requirements_raw.mcat_recency_policy",
  citizenship: "admissions_requirements_raw.citizenship_policy",
  "state-residency": "application_process_raw.state_residency_rules",
  degree: "coursework_policy_raw.degree_requirement",
  coursework: "coursework_policy_raw.biology_hours",
  "prerequisite-grades": "coursework_policy_raw.pass_fail_policy",
  "online-coursework": "coursework_policy_raw.online_coursework_accepted",
  "community-college": "coursework_policy_raw.community_college_accepted",
  "ap-credit": "coursework_policy_raw.ap_credit_policy",
  deadline: "application_process_raw.primary_deadline",
};

const evidence = (factId: string, rawValue: string, overrides: Partial<RequirementEvidence> = {}): RequirementEvidence => ({
  factId, revision: JSON.stringify([rawValue]), label: factId.split(".")[1] ?? factId, rawValue,
  url: "https://medicine.example.edu/admissions", capturedAt: "2026-07-19T00:00:00Z", captureStatus: "official-capture", ...overrides,
});

const rule = (kind: RequirementKind, rawValue: string, overrides: Partial<StructuredRequirement> = {}): StructuredRequirement => ({
  id: kind, kind, strength: "hard", evidence: [evidence(FACT_IDS[kind], rawValue)], interpretation: "Test reading.", exceptions: [],
  ...overrides,
});

const school = (overrides: Partial<ApplicationSchool> = {}): ApplicationSchool => ({
  id: "S0002", canonicalName: "Test School of Medicine", name: "Test School of Medicine", location: "Alabama",
  verificationStatus: "verified", sources: [], ...overrides,
});

const learner = (overrides: Partial<ApplicationProfile> = {}): ApplicationProfile => ({
  plannedMatriculationYear: 2027, coursework: {}, activityHours: {}, ...overrides,
});

function run(target: ApplicationSchool, requirements: StructuredRequirement[], profile: ApplicationProfile | undefined): SchoolCheckResult {
  const result = evaluateRequirements(target, requirements, profile, { now: NOW });
  headlines.push(result.eligibility.headline);
  return result;
}
const checkOf = (requirement: StructuredRequirement, profile: ApplicationProfile | undefined, target = school()) =>
  run(target, [requirement], profile).checks[0];

const gpaHard = rule("gpa-minimum", "3.0 cumulative", { threshold: 3 });

describe("numeric minimums", () => {
  it("meets a hard GPA minimum at exactly the threshold", () => {
    const check = checkOf(gpaHard, learner({ cumulativeGpa: 3 }));
    expect(check).toMatchObject({ title: "Cumulative GPA minimum", outcome: "meets", blocking: false, yourValue: "3.00", schoolValue: "3.00 minimum" });
    expect(check.explanation).toContain("3.00");
  });

  it("blocks below a hard minimum and names both numbers", () => {
    const check = checkOf(gpaHard, learner({ cumulativeGpa: 2.9 }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(check.explanation).toMatch(/2\.90.*3\.00/);
  });

  it("reports missing-profile, never meets, when the learner has no value", () => {
    expect(checkOf(gpaHard, learner())).toMatchObject({ outcome: "missing-profile", blocking: false });
    expect(checkOf(rule("mcat-minimum", "500", { threshold: 500 }), learner())).toMatchObject({ outcome: "missing-profile", title: "MCAT minimum" });
  });

  it("treats a recommended minimum as below-recommended, not a blocker", () => {
    const recommended = rule("science-gpa-minimum", "2.8 (recommended)", { strength: "recommended", threshold: 2.8 });
    const check = checkOf(recommended, learner({ scienceGpa: 2.7 }));
    expect(check).toMatchObject({ title: "Science GPA minimum", outcome: "below-recommended", blocking: false });
    expect(check.explanation).toMatch(/2\.70.*2\.80/);
    expect(checkOf(recommended, learner({ scienceGpa: 2.8 })).outcome).toBe("meets");
  });

  it("does not treat none-stated or not-required evidence as a waiver", () => {
    const none = checkOf(rule("gpa-minimum", "None (no minimum; holistic)", { strength: "none-stated" }), learner({ cumulativeGpa: 2.1 }));
    expect(none.outcome).toBe("not-applicable");
    expect(none.explanation).toBe("No published minimum in the captured evidence — not a waiver of holistic review.");
    expect(checkOf(rule("mcat-minimum", "Not required (no entrance exam)", { strength: "not-required" }), learner()).outcome).toBe("not-applicable");
  });

  it("separates sentinel evidence (missing-evidence) from unreadable text (needs-review)", () => {
    expect(checkOf(rule("gpa-minimum", "NOT_PUBLICLY_DISCLOSED", { strength: "unknown" }), learner({ cumulativeGpa: 3.9 })).outcome).toBe("missing-evidence");
    expect(checkOf(rule("gpa-minimum", "", { strength: "unknown" }), learner({ cumulativeGpa: 3.9 })).outcome).toBe("missing-evidence");
    const unread = checkOf(rule("gpa-minimum", "Varies by track", { strength: "unknown" }), learner({ cumulativeGpa: 3.9 }));
    expect(unread.outcome).toBe("needs-review");
    expect(unread.explanation).toContain("could not read a rule");
  });
});

describe("conditional variants", () => {
  const uab = rule("science-gpa-minimum", "3.0 (AL residents) / 3.3 (out-of-state), BCPM, for secondary invite", {
    strength: "conditional",
    variants: [
      { condition: "in-state", threshold: 3, text: "3.0 (AL residents)" },
      { condition: "out-of-state", threshold: 3.3, text: "3.3 (out-of-state)" },
    ],
  });

  it("applies the in-state figure to an Alabama resident at an Alabama school", () => {
    const check = checkOf(uab, learner({ scienceGpa: 3.1, stateOfResidence: "Alabama" }));
    expect(check).toMatchObject({ outcome: "meets", schoolValue: "3.00 in-state minimum" });
  });

  it("applies the out-of-state figure and blocks below it", () => {
    const check = checkOf(uab, learner({ scienceGpa: 3.1, stateOfResidence: "Georgia" }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true, schoolValue: "3.30 out-of-state minimum" });
    expect(check.explanation).toMatch(/Georgia.*3\.30.*3\.10/);
  });

  it("asks for residency when the figure depends on it, but not when every figure is cleared", () => {
    const missing = checkOf(uab, learner({ scienceGpa: 3.1 }));
    expect(missing.outcome).toBe("missing-profile");
    expect(missing.explanation).toContain("state of residence");
    expect(checkOf(uab, learner({ scienceGpa: 3.5 })).outcome).toBe("meets");
  });

  it("resolves Arkansas-style MCAT variants for residents and non-residents", () => {
    const uams = rule("mcat-minimum", "500 (AR residents) / 505 (non-residents)", {
      strength: "conditional",
      variants: [{ condition: "in-state", threshold: 500, text: "500 (AR residents)" }, { condition: "out-of-state", threshold: 505, text: "505 (non-residents)" }],
    });
    const arkansas = school({ location: "Arkansas" });
    expect(checkOf(uams, learner({ mcatTotal: 503, stateOfResidence: "Arkansas" }), arkansas).outcome).toBe("meets");
    const texan = checkOf(uams, learner({ mcatTotal: 503, stateOfResidence: "TX" }), arkansas);
    expect(texan).toMatchObject({ outcome: "does-not-meet", blocking: true, yourValue: "503", schoolValue: "505 out-of-state minimum" });
  });

  it("needs review when only the in-state figure was captured and the learner is out of state", () => {
    const inStateOnly = rule("gpa-minimum", "3.0 (AL residents)", { strength: "conditional", variants: [{ condition: "in-state", threshold: 3, text: "3.0 (AL residents)" }] });
    expect(checkOf(inStateOnly, learner({ cumulativeGpa: 2.5, stateOfResidence: "Florida" })).outcome).toBe("needs-review");
  });

  it("needs review when the school's own state cannot be resolved", () => {
    const check = checkOf(uab, learner({ scienceGpa: 3.1, stateOfResidence: "Alabama" }), school({ location: "Jamaica / Bahamas" }));
    expect(check.outcome).toBe("needs-review");
  });

  it("treats Early Decision figures as below-recommended with the ED qualifier", () => {
    const edp = rule("gpa-minimum", "3.50 (Early Decision Program minimum only)", {
      strength: "conditional", variants: [{ condition: "early-decision", threshold: 3.5, text: "3.50 (Early Decision Program minimum only)" }],
    });
    const below = checkOf(edp, learner({ cumulativeGpa: 3.4 }));
    expect(below).toMatchObject({ outcome: "below-recommended", blocking: false });
    expect(below.explanation).toContain("applies only if you apply Early Decision");
    const above = checkOf(edp, learner({ cumulativeGpa: 3.6 }));
    expect(above.outcome).toBe("meets");
    expect(above.explanation).toContain("applies only if you apply Early Decision");
  });

  it("treats a screening threshold like a hard minimum", () => {
    const screen = rule("mcat-minimum", "495 total (secondary-invite threshold)", {
      strength: "conditional", variants: [{ condition: "screening", threshold: 495, text: "495 total (secondary-invite threshold)" }],
    });
    const check = checkOf(screen, learner({ mcatTotal: 494 }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true, schoolValue: "495 screening threshold" });
    expect(check.explanation).toContain("screening threshold");
    expect(checkOf(screen, learner({ mcatTotal: 495 })).outcome).toBe("meets");
  });

  it("applies North American figures only to North American applicants", () => {
    const na = rule("gpa-minimum", "3.0 (North American applicants)", {
      strength: "conditional", variants: [{ condition: "north-american", threshold: 3, text: "3.0 (North American applicants)" }],
    });
    expect(checkOf(na, learner({ cumulativeGpa: 2.5, citizenship: "international" })).outcome).toBe("not-applicable");
    expect(checkOf(na, learner({ cumulativeGpa: 2.5, citizenship: "canadian-citizen" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(na, learner({ cumulativeGpa: 2.5, citizenship: "daca" })).blocking).toBe(true);
    const missing = checkOf(na, learner({ cumulativeGpa: 2.5 }));
    expect(missing.outcome).toBe("missing-profile");
    expect(missing.explanation).toContain("citizenship");
  });

  it("needs review below a figure whose condition AXOM cannot check, and shows the qualifier", () => {
    const credits = rule("science-gpa-minimum", "3.4 (min, for 90-120 cr applicants)", {
      strength: "conditional", threshold: 3.4, exceptions: ["for 90-120 cr applicants"],
    });
    const below = checkOf(credits, learner({ scienceGpa: 3.2 }));
    expect(below.outcome).toBe("needs-review");
    expect(below.explanation).toContain("\"for 90-120 cr applicants\"");
    expect(checkOf(credits, learner({ scienceGpa: 3.5 })).outcome).toBe("meets");
  });
});

describe("MCAT section floor and attempts", () => {
  it("blocks on a hard section floor even when the total meets", () => {
    const floor = rule("mcat-minimum", "500; no section below 124", { threshold: 500, sectionFloor: 124 });
    const check = checkOf(floor, learner({ mcatTotal: 510, mcatLowestSection: 123 }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true, yourValue: "Lowest section 123", schoolValue: "No section below 124" });
    expect(check.explanation).toMatch(/123.*124/);
    const noSection = checkOf(floor, learner({ mcatTotal: 510 }));
    expect(noSection.outcome).toBe("meets");
    expect(noSection.explanation).toContain("add your lowest section score");
  });

  it("blocks when attempts exceed a screening rule's maximum", () => {
    const interview = rule("mcat-minimum", "494 (interview minimum; max 3 attempts)", {
      strength: "conditional", maxAttempts: 3, variants: [{ condition: "screening", threshold: 494, text: "494 (interview minimum)" }],
    });
    const check = checkOf(interview, learner({ mcatTotal: 500, mcatAttempts: 4 }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(check.explanation).toMatch(/4 MCAT attempts.*at most 3/);
    expect(checkOf(interview, learner({ mcatTotal: 500, mcatAttempts: 3 })).outcome).toBe("meets");
  });
});

describe("MCAT requirement", () => {
  const required = rule("mcat-required", "MCAT required");

  it("asks for a score or planned test date when required", () => {
    const check = checkOf(required, learner());
    expect(check).toMatchObject({ title: "MCAT requirement", outcome: "missing-profile" });
    expect(check.explanation).toContain("add your score or planned test date");
    expect(checkOf(required, learner({ mcatTestDate: "2026-04" })).outcome).toBe("missing-profile");
  });

  it("is on track with a planned future test and meets with a score", () => {
    expect(checkOf(required, learner({ mcatTestDate: "2027-01" }))).toMatchObject({ outcome: "on-track", yourValue: "Planned January 2027" });
    expect(checkOf(required, learner({ mcatTotal: 510 })).outcome).toBe("meets");
  });

  it("follows the applicant groups the evidence names", () => {
    const byGroup = rule("mcat-required", "MCAT required for North American applicants (within 3 years)", {
      strength: "conditional",
      requiredFor: ["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen"], optionalFor: ["international"],
    });
    expect(checkOf(byGroup, learner({ citizenship: "international" })).outcome).toBe("not-applicable");
    expect(checkOf(byGroup, learner({ citizenship: "us-citizen" })).outcome).toBe("missing-profile");
    expect(checkOf(byGroup, learner({ citizenship: "us-citizen", mcatTotal: 505 })).outcome).toBe("meets");
    expect(checkOf(byGroup, learner()).explanation).toContain("citizenship");
    expect(checkOf(rule("mcat-required", "MCAT not required", { strength: "not-required" }), learner()).outcome).toBe("not-applicable");
  });
});

describe("MCAT test date window", () => {
  const threeYears = rule("mcat-recency", "MCAT within three years of matriculation", { recency: { years: 3, anchor: "matriculation" } });

  it("meets six months or more inside a recency window (earliest Aug 2024 for 2027)", () => {
    expect(checkOf(threeYears, learner({ mcatTestDate: "2025-02" })).outcome).toBe("meets");
  });

  it("needs review within six months of the cutoff on either side", () => {
    const late = checkOf(threeYears, learner({ mcatTestDate: "2025-01" }));
    expect(late.outcome).toBe("needs-review");
    expect(late.explanation).toContain("close to the 3-year cutoff");
    expect(late.explanation).toContain("schools count this differently");
    expect(checkOf(threeYears, learner({ mcatTestDate: "2024-02" })).outcome).toBe("needs-review");
  });

  it("blocks a test more than six months before the cutoff", () => {
    const check = checkOf(threeYears, learner({ mcatTestDate: "2024-01" }));
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: true, yourValue: "January 2024" });
  });

  it("anchors application-based windows on June of the year before matriculation", () => {
    const application = rule("mcat-recency", "MCAT taken within three years of application", { recency: { years: 3, anchor: "application" } });
    expect(checkOf(application, learner({ mcatTestDate: "2023-12" })).outcome).toBe("meets");
    expect(checkOf(application, learner({ mcatTestDate: "2023-11" })).outcome).toBe("needs-review");
    expect(checkOf(application, learner({ mcatTestDate: "2022-12" })).outcome).toBe("needs-review");
    expect(checkOf(application, learner({ mcatTestDate: "2022-11" })).outcome).toBe("does-not-meet");
  });

  it("is on track for a planned test inside the window", () => {
    const check = checkOf(threeYears, learner({ mcatTestDate: "2027-01" }));
    expect(check).toMatchObject({ outcome: "on-track", yourValue: "Planned January 2027" });
  });

  it("compares an explicit window for the learner's cycle exactly", () => {
    const window = rule("mcat-recency", "2024 earliest for 2027 entering class; Sept 2026 latest considered; most recent total score used", {
      testWindow: { earliest: "2024-01-01", latest: "2026-09-30", matriculationYear: 2027 }, cycleYear: 2027,
    });
    expect(checkOf(window, learner({ mcatTestDate: "2025-06" })).outcome).toBe("meets");
    expect(checkOf(window, learner({ mcatTestDate: "2026-09" })).outcome).toBe("meets");
    expect(checkOf(window, learner({ mcatTestDate: "2023-11" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    const planned = checkOf(window, learner({ mcatTestDate: "2026-10" }));
    expect(planned).toMatchObject({ outcome: "does-not-meet", yourValue: "Planned October 2026" });
    expect(planned.explanation).toContain("September 30, 2026");
  });

  it("needs review when the test falls in the same month as a mid-month cutoff", () => {
    const window = rule("mcat-recency", "At least 1 MCAT from an exam taken after Jan 2023 and before Aug 22, 2026 for the 2027 cycle", {
      testWindow: { earliest: "2023-02-01", latest: "2026-08-22", matriculationYear: 2027 },
    });
    const check = checkOf(window, learner({ mcatTestDate: "2026-08" }));
    expect(check.outcome).toBe("needs-review");
    expect(check.explanation).toContain("August 22, 2026");
  });

  it("needs review with a cycle note when the window was published for another cycle", () => {
    const old = rule("mcat-recency", "Taken no earlier than Jan 1, 2023 and no later than Sept 30, 2025 (2026 entering class)", {
      testWindow: { earliest: "2023-01-01", latest: "2025-09-30", matriculationYear: 2026 }, cycleYear: 2026,
    });
    const check = checkOf(old, learner({ mcatTestDate: "2025-06" }));
    expect(check.outcome).toBe("needs-review");
    expect(check.explanation).toContain("2026 entering class");
    expect(check.cycleNote).toContain("2026 entering class");
  });

  it("falls back to a stated recency rule when the window names another cycle", () => {
    const both = rule("mcat-recency", "Within 4 years of matriculation (Jan 2023-Sept 2026 for 2027 entry)", {
      recency: { years: 4, anchor: "matriculation" }, testWindow: { earliest: "2023-01-01", latest: "2026-09-30", matriculationYear: 2027 },
    });
    const check = checkOf(both, learner({ plannedMatriculationYear: 2028, mcatTestDate: "2025-03" }));
    expect(check.outcome).toBe("meets");
    expect(check.explanation).toContain("2027 entering class");
    expect(check.cycleNote).toContain("2027");
  });

  it("reads 'latest test month before matriculation' as that month of M−1", () => {
    const august = rule("mcat-recency", "August of the year prior to admission is the latest acceptable test date", { latestTestMonthBeforeMatriculation: 8 });
    expect(checkOf(august, learner({ mcatTestDate: "2026-08" })).outcome).toBe("meets");
    expect(checkOf(august, learner({ mcatTestDate: "2026-09" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(august, learner({ plannedMatriculationYear: 2028, mcatTestDate: "2027-04" })).outcome).toBe("on-track");
  });

  it("asks for the test date and cycle before comparing", () => {
    expect(checkOf(threeYears, learner()).outcome).toBe("missing-profile");
    const noYear = checkOf(threeYears, { coursework: {}, activityHours: {}, mcatTestDate: "2025-02" });
    expect(noYear.outcome).toBe("missing-profile");
    expect(noYear.explanation).toContain("planned matriculation year");
  });
});

describe("citizenship", () => {
  const onlyUs = rule("citizenship", "U.S. citizens and permanent residents only", {
    citizenship: { accepted: ["us-citizen", "us-permanent-resident"], excluded: ["international", "canadian-citizen", "undocumented"] },
  });

  it("blocks excluded statuses, meets accepted ones and reviews the rest", () => {
    expect(checkOf(onlyUs, learner({ citizenship: "international" }))).toMatchObject({
      title: "Citizenship and visa status", outcome: "does-not-meet", blocking: true, yourValue: "Other international applicant",
    });
    expect(checkOf(onlyUs, learner({ citizenship: "us-permanent-resident" })).outcome).toBe("meets");
    expect(checkOf(onlyUs, learner({ citizenship: "daca" })).outcome).toBe("needs-review");
    expect(checkOf(onlyUs, learner()).outcome).toBe("missing-profile");
  });

  it("still meets under a conditional policy but surfaces the qualifier", () => {
    const conditional = rule("citizenship", "Accepted students must obtain permanent residency prior to matriculation", {
      strength: "conditional", exceptions: ["must obtain permanent residency prior to matriculation"],
      citizenship: { accepted: ["us-citizen", "us-permanent-resident", "international"], excluded: [] },
    });
    const check = checkOf(conditional, learner({ citizenship: "international" }));
    expect(check.outcome).toBe("meets");
    expect(check.explanation).toContain("\"must obtain permanent residency prior to matriculation\"");
  });
});

describe("state residency", () => {
  const preference = rule("state-residency", "Strong preference for legal residents of Alabama", {
    residency: { mode: "preference", preferredRegions: ["Alabama"] },
  });

  it("covers none, preference in and out of state, missing and restricted modes", () => {
    const none = checkOf(rule("state-residency", "Private; no state residency preference", { strength: "none-stated", residency: { mode: "none", preferredRegions: [] } }), learner());
    expect(none.outcome).toBe("not-applicable");
    expect(none.explanation).toContain("No state preference stated");
    const inState = checkOf(preference, learner({ stateOfResidence: "Alabama" }));
    expect(inState.outcome).toBe("meets");
    expect(inState.explanation).toContain("In-state preference applies to you");
    const outOfState = checkOf(preference, learner({ stateOfResidence: "Ohio" }));
    expect(outOfState).toMatchObject({ outcome: "below-recommended", blocking: false });
    expect(outOfState.explanation).toContain("prefers residents of Alabama; out-of-state applicants may need ties");
    expect(checkOf(preference, learner()).outcome).toBe("missing-profile");
    const restricted = rule("state-residency", "Limited to residents of Alabama", { residency: { mode: "restricted", preferredRegions: ["AL"] } });
    expect(checkOf(restricted, learner({ stateOfResidence: "Ohio" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(restricted, learner({ stateOfResidence: "Alabama" })).outcome).toBe("meets");
  });
});

describe("degree", () => {
  const byMatriculation = rule("degree", "Baccalaureate from accredited U.S. college/university prior to matriculation", {
    degree: { bachelorsRequired: true, completedBy: "matriculation" },
  });
  const byApplication = rule("degree", "Bachelor's required prior to application", { degree: { bachelorsRequired: true, completedBy: "application" } });

  it("compares expected graduation with July of M or June of M−1", () => {
    expect(checkOf(byMatriculation, learner({ degreeStatus: "completed" })).outcome).toBe("meets");
    expect(checkOf(byMatriculation, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2027-05" })).outcome).toBe("on-track");
    expect(checkOf(byMatriculation, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2027-07" })).outcome).toBe("on-track");
    expect(checkOf(byMatriculation, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2027-08" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(byApplication, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2026-06" })).outcome).toBe("on-track");
    expect(checkOf(byApplication, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2026-12" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
  });

  it("handles missing dates, not-started timing and missing status", () => {
    expect(checkOf(byMatriculation, learner({ degreeStatus: "in-progress" })).outcome).toBe("needs-review");
    expect(checkOf(byMatriculation, learner({ degreeStatus: "not-started", plannedMatriculationYear: 2028 }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(byMatriculation, learner({ degreeStatus: "not-started", plannedMatriculationYear: 2029 })).outcome).toBe("on-track");
    expect(checkOf(byMatriculation, learner()).outcome).toBe("missing-profile");
  });

  it("reads a semester-hour minimum without a bachelor's requirement", () => {
    const hours = rule("degree", "90 sem hrs required; Baccalaureate preferred", { degree: { bachelorsRequired: false, minimumSemesterHours: 90 } });
    expect(checkOf(hours, learner({ degreeStatus: "in-progress", semesterHoursCompleted: 60 })).outcome).toBe("on-track");
    expect(checkOf(hours, learner({ degreeStatus: "not-started", semesterHoursCompleted: 60 })).outcome).toBe("below-recommended");
    const enough = checkOf(hours, learner({ semesterHoursCompleted: 96 }));
    expect(enough.outcome).toBe("meets");
    expect(enough.explanation).toMatch(/96.*90/);
    expect(checkOf(hours, learner({ degreeStatus: "in-progress" })).outcome).toBe("missing-profile");
  });
});

describe("coursework", () => {
  const biology = rule("coursework", "8 (Gen Bio w/lab)", { id: "coursework:biology", coursework: { category: "biology", semesterHours: 8, lab: true } });

  it("covers every course status against a hard hour requirement", () => {
    expect(checkOf(biology, learner())).toMatchObject({ title: "Biology coursework", outcome: "missing-profile" });
    expect(checkOf(biology, learner({ coursework: { biology: { status: "not-planned" } } }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(biology, learner({ coursework: { biology: { status: "planned" } } })).outcome).toBe("on-track");
    expect(checkOf(biology, learner({ coursework: { biology: { status: "in-progress", semesterHours: 4 } } })).outcome).toBe("on-track");
    expect(checkOf(biology, learner({ coursework: { biology: { status: "completed", semesterHours: 8 } } })).outcome).toBe("meets");
    const short = checkOf(biology, learner({ coursework: { biology: { status: "completed", semesterHours: 6 } } }));
    expect(short).toMatchObject({ outcome: "needs-review", blocking: false, schoolValue: "8 semester hours with lab" });
    expect(short.explanation).toMatch(/entered 6 semester hours.*lists 8/);
  });

  it("handles recommended, none-stated and sentinel coursework evidence", () => {
    const chem = { id: "coursework:generalChemistry", coursework: { category: "generalChemistry" as const } };
    const recommended = rule("coursework", "Recommended", { ...chem, strength: "recommended" });
    expect(requirementTitle(recommended)).toBe("General chemistry coursework");
    expect(checkOf(recommended, learner({ coursework: { generalChemistry: { status: "not-planned" } } })).outcome).toBe("below-recommended");
    expect(checkOf(recommended, learner({ coursework: { generalChemistry: { status: "completed" } } })).outcome).toBe("meets");
    expect(checkOf(rule("coursework", "No specific requirement", { ...chem, strength: "none-stated" }), learner()).outcome).toBe("not-applicable");
    expect(checkOf(rule("coursework", "NOT_PUBLICLY_DISCLOSED", { ...chem, strength: "unknown" }), learner()).outcome).toBe("missing-evidence");
    const required = rule("coursework", "Required prereq (holistic)", { ...chem });
    expect(checkOf(required, learner({ coursework: { generalChemistry: { status: "completed" } } })).outcome).toBe("meets");
  });
});

describe("coursework policies", () => {
  const passFail = rule("prerequisite-grades", "Letter grades required, no grade lower than C (Spring 2020 P/S grades acceptable)", {
    passFail: "not-accepted", minimumGrade: "C", exceptions: ["Spring 2020 P/S grades acceptable"],
  });
  const flagged = learner({ coursework: { physics: { status: "completed", passFail: true, online: true, communityCollege: true, apCredit: true } } });

  it("only applies when the learner flagged the attribute", () => {
    const check = checkOf(passFail, learner({ coursework: { physics: { status: "completed" } } }));
    expect(check).toMatchObject({ title: "Prerequisite grades", outcome: "not-applicable", schoolValue: "Minimum grade C; pass/fail not accepted" });
  });

  it("flags not-accepted pass/fail as does-not-meet without blocking", () => {
    const check = checkOf(passFail, flagged);
    expect(check).toMatchObject({ outcome: "does-not-meet", blocking: false, yourValue: "Pass/fail: physics" });
    expect(check.explanation).toContain("retaken");
  });

  it("maps limited, accepted and unknown stances for online, community college and AP credit", () => {
    const online = rule("online-coursework", "Lecture: accepted if comparable to in-person; lab: must be in person", { acceptance: "limited" });
    expect(checkOf(online, flagged)).toMatchObject({ title: "Online coursework", outcome: "needs-review" });
    const cc = rule("community-college", "Accepted", { acceptance: "accepted" });
    expect(checkOf(cc, flagged)).toMatchObject({ title: "Community college coursework", outcome: "meets" });
    const ap = rule("ap-credit", "AP credits are NOT counted toward requirements", { acceptance: "not-accepted" });
    expect(checkOf(ap, flagged)).toMatchObject({ title: "AP/IB credit", outcome: "does-not-meet", blocking: false });
    const unknown = rule("online-coursework", "NOT_FOUND_AFTER_OFFICIAL_SEARCH", { strength: "unknown", acceptance: "unknown" });
    expect(checkOf(unknown, flagged).outcome).toBe("missing-evidence");
  });

  it.each([
    ["prerequisite-grades", "passFail", "Pass/fail"],
    ["online-coursework", "online", "Online"],
    ["community-college", "communityCollege", "Community college"],
    ["ap-credit", "apCredit", "AP/IB credit"],
  ] as const)("covers every %s outcome for the %s flag", (kind, flag, label) => {
    const stanceField = kind === "prerequisite-grades" ? "passFail" : "acceptance";
    const policy = (stance: "accepted" | "not-accepted" | "limited" | "unknown", strength: StructuredRequirement["strength"] = "hard") =>
      rule(kind, `Policy text (${stance})`, { strength, [stanceField]: stance });
    const marked = learner({ coursework: { biology: { status: "completed", [flag]: true }, physics: { status: "in-progress", [flag]: true } } });
    expect(checkOf(policy("not-accepted"), learner({ coursework: { biology: { status: "completed" } } })).outcome).toBe("not-applicable");
    const refused = checkOf(policy("not-accepted"), marked);
    expect(refused).toMatchObject({ outcome: "does-not-meet", blocking: false, yourValue: `${label}: biology, physics` });
    expect(refused.explanation).toContain("a course can be retaken or replaced");
    expect(checkOf(policy("limited"), marked)).toMatchObject({ outcome: "needs-review", blocking: false });
    expect(checkOf(policy("accepted"), marked)).toMatchObject({ outcome: "meets", blocking: false });
    expect(checkOf(policy("unknown", "unknown"), marked).outcome).toBe("missing-evidence");
    expect(checkOf(policy("unknown"), marked).outcome).toBe("missing-evidence");
  });
});

describe("primary application deadline (now = 2026-09-23)", () => {
  const deadline = (rawValue: string, value: NonNullable<StructuredRequirement["deadline"]>) => rule("deadline", rawValue, { deadline: value });

  it("places Jun–Dec deadlines in M−1 and Jan–May deadlines in M", () => {
    const november = checkOf(deadline("November 1 (AMCAS)", { month: 11, day: 1, rolling: false }), learner());
    expect(november).toMatchObject({ title: "Primary application deadline", outcome: "not-applicable", blocking: false, schoolValue: "November 1, 2026" });
    expect(november.explanation).toBe("Due November 1, 2026 (confirm).");
    expect(checkOf(deadline("January 15", { month: 1, day: 15, rolling: false }), learner()).schoolValue).toBe("January 15, 2027");
  });

  it("flags a passed deadline for review, never as a blocker", () => {
    const passed = checkOf(deadline("September 15", { month: 9, day: 15, rolling: false }), learner());
    expect(passed).toMatchObject({ outcome: "needs-review", blocking: false });
    expect(passed.explanation).toContain("appears to have passed for your cycle; confirm");
    expect(checkOf(deadline("November 1", { month: 11, day: 1, rolling: false }), learner({ plannedMatriculationYear: 2026 })).outcome).toBe("needs-review");
    expect(checkOf(deadline("September 23", { month: 9, day: 23, rolling: false }), learner()).outcome).toBe("not-applicable");
  });

  it("lets an explicit year win and treats rolling admissions as not-applicable", () => {
    const explicit = checkOf(deadline("2025-12-15 (fall 2026 entry, third-party)", { month: 12, day: 15, rolling: false, explicitYear: 2025 }), learner());
    expect(explicit).toMatchObject({ outcome: "needs-review", schoolValue: "December 15, 2025" });
    const rolling = checkOf(deadline("Rolling (until seats filled)", { month: 0, day: 0, rolling: true }), learner());
    expect(rolling.outcome).toBe("not-applicable");
    expect(rolling.explanation).toContain("Rolling admissions");
    expect(checkOf(deadline("November 1", { month: 11, day: 1, rolling: false }), { coursework: {}, activityHours: {}, cumulativeGpa: 3.5 }).outcome).toBe("missing-profile");
  });
});

describe("evidence status and cycle notes", () => {
  it("marks all-unverified evidence and says so in the explanation", () => {
    const unverified = rule("gpa-minimum", "3.0", { threshold: 3, evidence: [evidence(FACT_IDS["gpa-minimum"], "3.0", { captureStatus: "unverified-capture" })] });
    const check = checkOf(unverified, learner({ cumulativeGpa: 3.2 }));
    expect(check.unverifiedEvidence).toBe(true);
    expect(check.explanation).toContain("from an unverified capture");
    const mixed = rule("gpa-minimum", "3.0", {
      threshold: 3,
      evidence: [evidence(FACT_IDS["gpa-minimum"], "3.0", { captureStatus: "unverified-capture" }), evidence("admissions_requirements_raw.requirement_type", "HARD_REQUIREMENT")],
    });
    // An official requirement_type label does not verify the rule's own unverified fact.
    const mixedCheck = checkOf(mixed, learner({ cumulativeGpa: 3.2 }));
    expect(mixedCheck.unverifiedEvidence).toBe(true);
    const official = rule("gpa-minimum", "3.0", {
      threshold: 3,
      evidence: [evidence(FACT_IDS["gpa-minimum"], "3.0"), evidence("admissions_requirements_raw.requirement_type", "HARD_REQUIREMENT", { captureStatus: "unverified-capture" })],
    });
    const officialCheck = checkOf(official, learner({ cumulativeGpa: 3.2 }));
    expect(officialCheck.unverifiedEvidence).toBe(false);
    expect(officialCheck.explanation).not.toContain("unverified");
  });

  it("adds a cycle note only when the rule's evidence predates the learner's cycle", () => {
    const early = rule("gpa-minimum", "3.0", { threshold: 3, evidence: [evidence(FACT_IDS["gpa-minimum"], "3.0", { capturedAt: "2026-01-10T00:00:00Z" })] });
    expect(checkOf(early, learner({ cumulativeGpa: 3.2 })).cycleNote).toBe("Evidence describes the 2026 entering class; confirm this rule for your 2027 cycle.");
    expect(checkOf(gpaHard, learner({ cumulativeGpa: 3.2 })).cycleNote).toBeUndefined();
  });
});

describe("evidenceCycleForFact", () => {
  const at = (value: string, capturedAt = "2026-07-19T00:00:00Z") => evidenceCycleForFact({ value, capturedAt });

  it("reads explicit entering classes, entry years and cycles", () => {
    expect(at("2024 earliest for 2027 entering class; Sept 2026 latest considered")).toBe(2027);
    expect(at("Taken no earlier than Jan 1, 2023 and no later than Sept 30, 2025 (2026 entering class)")).toBe(2026);
    expect(at("Within 4 years of matriculation (Jan 2023-Sept 2026 for 2027 entry)")).toBe(2027);
    expect(at("2025-12-15 (fall 2026 entry, third-party)")).toBe(2026);
    expect(at("Class of 2030 profile")).toBe(2026);
    expect(at("Entering class of 2027 averages")).toBe(2027);
    expect(at("before Aug 22, 2026 for the 2027 cycle")).toBe(2027);
    expect(at("2026-2027 cycle")).toBe(2027);
    expect(at("2026–27 cycle")).toBe(2027);
  });

  it("otherwise infers the cycle from the capture month", () => {
    expect(at("3.0")).toBe(2027);
    expect(at("3.0", "2026-04-30T00:00:00Z")).toBe(2026);
    expect(at("3.0", "2026-05-01T00:00:00Z")).toBe(2027);
    expect(at("3.0", "not a date")).toBeUndefined();
  });
});

describe("eligibility summary", () => {
  const passedDeadline = rule("deadline", "September 15", { deadline: { month: 9, day: 15, rolling: false } });
  const biology = rule("coursework", "8", { id: "coursework:biology", coursework: { category: "biology", semesterHours: 8 } });
  const done = { coursework: { biology: { status: "completed" as const, semesterHours: 8 } } };

  it("asks for a profile when none (or an empty one) is entered", () => {
    for (const profile of [undefined, { coursework: {}, activityHours: {} }, { coursework: {}, activityHours: {}, updatedAt: "2026-09-01T00:00:00Z" }]) {
      const result = run(school(), [gpaHard, biology], profile);
      expect(result.eligibility).toMatchObject({ status: "not-enough-information", headline: "Add your application profile to run the checks.", total: 2, unknown: 2 });
      expect(result.checks.map(check => check.outcome)).toEqual(["missing-profile", "missing-profile"]);
    }
  });

  it("says so when a school has no requirement evidence", () => {
    const result = run(school(), [], learner({ cumulativeGpa: 3.5 }));
    expect(result.eligibility).toMatchObject({ status: "not-enough-information", headline: "No requirement evidence has been collected for this school yet.", total: 0 });
  });

  it("ranks blockers over reviews over no-blockers", () => {
    const profile = learner({ cumulativeGpa: 2.9, ...done });
    const blocked = run(school(), [gpaHard, passedDeadline, biology], profile);
    expect(blocked.eligibility).toMatchObject({ status: "possible-blocker", blockers: 1, reviews: 1, meets: 1, decided: 2, total: 3 });
    expect(blocked.eligibility.headline).toBe("Possible blocker — Cumulative GPA minimum: you entered 2.90 vs. 3.00 minimum.");
    const reviewed = run(school(), [passedDeadline, biology], profile);
    expect(reviewed.eligibility).toMatchObject({
      status: "needs-review", headline: "Primary application deadline needs a closer look — review before relying on these checks.",
    });
    const clear = run(school(), [biology, gpaHard], learner({ cumulativeGpa: 3.4, ...done }));
    expect(clear.eligibility).toMatchObject({
      status: "no-blockers-found", headline: "No blockers found in 2 of 2 captured requirement areas — confirm with the school.",
    });
  });

  it("appends the unverified suffix and counts further blockers in the headline", () => {
    const unverified = rule("mcat-minimum", "506 (secondary-invite threshold)", {
      strength: "conditional", variants: [{ condition: "screening", threshold: 506, text: "506 (secondary-invite threshold)" }],
      evidence: [evidence(FACT_IDS["mcat-minimum"], "506 (secondary-invite threshold)", { captureStatus: "unverified-capture" })],
    });
    const result = run(school(), [unverified, gpaHard], learner({ mcatTotal: 500, cumulativeGpa: 2.5 }));
    expect(result.eligibility.headline).toBe(
      "Possible blocker — MCAT minimum: you entered 500 vs. 506 screening threshold (from an unverified capture), plus 1 more possible blocker.");
  });

  it("downgrades a clean result to needs-review when evidence predates the learner's cycle", () => {
    const result = run(school(), [gpaHard], learner({ plannedMatriculationYear: 2028, cumulativeGpa: 3.5 }));
    expect(result.cycle).toMatchObject({ status: "earlier-cycle", evidenceYear: 2027, plannedMatriculationYear: 2028 });
    expect(result.cycle.note).toBe("Evidence describes the 2027 entering class; confirm requirements for your 2028 cycle.");
    expect(result.eligibility.status).toBe("needs-review");
    expect(result.eligibility.headline).toContain("2027 entering class");
    const unread = [
      rule("state-residency", "Mission emphasis on improving health outcomes for Arizona", { strength: "unknown" }),
      rule("citizenship", "Addressed on separate Citizenship page (not fetched)", { strength: "unknown" }),
    ];
    expect(run(school(), unread, learner({ plannedMatriculationYear: 2028, citizenship: "us-citizen" })).eligibility.headline).toBe(
      "2 requirement areas, starting with State residency, need a closer look, and the captured evidence describes the 2027 entering class rather than your 2028 cycle — review before relying on these checks.");
  });

  it("reports not-enough-information when nothing could be decided", () => {
    const sentinel = rule("gpa-minimum", "NOT_PUBLICLY_DISCLOSED", { strength: "unknown" });
    const result = run(school(), [sentinel, biology], learner({ cumulativeGpa: 3.5 }));
    expect(result.eligibility).toMatchObject({ status: "not-enough-information", decided: 0, unknown: 2 });
  });

  it("assesses the cycle as current, later or unknown", () => {
    expect(run(school(), [gpaHard], learner({ cumulativeGpa: 3.5 })).cycle).toMatchObject({ status: "current", evidenceYear: 2027 });
    expect(run(school(), [gpaHard], learner({ plannedMatriculationYear: 2026, cumulativeGpa: 3.5 })).cycle.status).toBe("later-cycle");
    const noYear = run(school(), [gpaHard], { coursework: {}, activityHours: {}, cumulativeGpa: 3.5 });
    expect(noYear.cycle).toMatchObject({ status: "unknown", evidenceYear: 2027 });
    const facts = school({ researchFacts: [{ id: "x.y", label: "Y", value: "for the 2028 cycle", url: "https://a.example", capturedAt: "2026-07-01T00:00:00Z", captureStatus: "official-capture" }] });
    expect(run(facts, [gpaHard], learner({ cumulativeGpa: 3.5 })).cycle).toMatchObject({ status: "later-cycle", evidenceYear: 2028 });
  });

  it("never throws on malformed rules", () => {
    const broken = [{ id: "odd", kind: "mystery", strength: "hard" } as unknown as StructuredRequirement, null as unknown as StructuredRequirement];
    expect(() => run(school(), broken, learner({ cumulativeGpa: 3.5 }))).not.toThrow();
    expect(run(school(), broken, learner({ cumulativeGpa: 3.5 })).checks).toHaveLength(1);
  });

  it("checkSchool evaluates the derived requirements", () => {
    vi.mocked(deriveRequirements).mockReturnValueOnce([gpaHard]);
    const target = school();
    const result = checkSchool(target, learner({ cumulativeGpa: 3.1 }), { now: NOW });
    headlines.push(result.eligibility.headline);
    expect(deriveRequirements).toHaveBeenCalledWith(target);
    expect(result.checks.map(check => [check.requirementId, check.outcome])).toEqual([["gpa-minimum", "meets"]]);
  });
});

const stat = (metric: ReportedStatistic["metric"], kind: ReportedStatistic["kind"], basis: ReportedStatistic["basis"], number: number, value = String(number)): ReportedStatistic => ({
  id: `admissions_requirements_raw.${metric}_${kind}_${basis}`, label: `${metric} ${kind}`, metric, kind, value, number,
  url: "https://medicine.example.edu/profile", capturedAt: "2026-07-21T00:00:00Z", basis,
});
const estimates = (overrides: Partial<SchoolEstimates> = {}): SchoolEstimates => ({
  tier: "B", hours: {}, confidence: "moderate", disclaimer: "ESTIMATE: directional planning context only.", estimatedAt: "2026-07-21T00:00:00Z",
  ...overrides,
});
const score = (value: number, floorBased = false, peerFallback = false) => ({ value, basis: "test basis", floorBased, peerFallback });

describe("estimateCompetitiveness", () => {
  const gpaBenchmark = (target: ApplicationSchool) => estimateCompetitiveness(target, learner({ cumulativeGpa: 3.7 }))?.comparisons.find(entry => entry.metric === "gpa");

  it("returns undefined without estimates or reported statistics", () => {
    expect(estimateCompetitiveness(school(), learner({ cumulativeGpa: 3.7 }))).toBeUndefined();
    expect(estimateCompetitiveness(school({ reportedStats: [] }), learner())).toBeUndefined();
  });

  it("walks the benchmark priority: official average, estimate, other reports, peer estimate", () => {
    const all = [
      stat("gpa", "average", "official-capture", 3.8, "3.80 median (matriculants)"), stat("gpa", "competitive", "official-capture", 3.78),
      stat("gpa", "average", "unverified-capture", 3.75), stat("gpa", "competitive", "unverified-capture", 3.74),
      stat("gpa", "average", "third-party", 3.85), stat("gpa", "competitive", "third-party", 3.86),
    ];
    const withEstimate = { estimates: estimates({ competitiveGpa: score(3.7) }) };
    expect(gpaBenchmark(school({ reportedStats: all, ...withEstimate }))).toMatchObject({
      benchmark: 3.8, benchmarkBasis: "official-capture", benchmarkLabel: "Reported median (official page capture, Jul 2026)",
    });
    const noOfficialAverage = all.slice(1);
    expect(gpaBenchmark(school({ reportedStats: noOfficialAverage, ...withEstimate }))).toMatchObject({
      benchmark: 3.7, benchmarkBasis: "estimate", benchmarkLabel: "Research estimate (moderate confidence)",
    });
    // Spec order: an unverified class average outranks an official "competitive" figure.
    expect(gpaBenchmark(school({ reportedStats: noOfficialAverage }))).toMatchObject({ benchmark: 3.75, benchmarkBasis: "unverified-capture" });
    expect(gpaBenchmark(school({ reportedStats: [all[1], all[3]] }))).toMatchObject({ benchmark: 3.78, benchmarkBasis: "official-capture" });
    expect(gpaBenchmark(school({ reportedStats: all.slice(2) }))).toMatchObject({ benchmark: 3.75, benchmarkBasis: "unverified-capture" });
    expect(gpaBenchmark(school({ reportedStats: all.slice(3) }))).toMatchObject({ benchmark: 3.74, benchmarkBasis: "unverified-capture" });
    expect(gpaBenchmark(school({ reportedStats: all.slice(4), estimates: estimates({ competitiveGpa: score(3.6, false, true) }) })))
      .toMatchObject({ benchmark: 3.85, benchmarkBasis: "third-party", benchmarkLabel: "Reported average (third-party source, Jul 2026)" });
    expect(gpaBenchmark(school({ estimates: estimates({ competitiveGpa: score(3.6, false, true) }) })))
      .toMatchObject({ benchmark: 3.6, benchmarkBasis: "peer-estimate", benchmarkLabel: "Peer-school estimate (moderate confidence)" });
  });

  it("never uses floor-based estimates as benchmarks", () => {
    const floorOnly = school({ estimates: estimates({ competitiveGpa: score(3.5, true), competitiveMcat: score(503, true, true) }) });
    const result = estimateCompetitiveness(floorOnly, learner({ cumulativeGpa: 3.2, mcatTotal: 500 }));
    expect(result).toMatchObject({ comparisons: [], tier: "B", confidence: "moderate" });
    expect(result?.band).toBeUndefined();
    expect(gpaBenchmark(school({ reportedStats: [stat("gpa", "average", "third-party", 3.9)], estimates: estimates({ competitiveGpa: score(3.5, true) }) })))
      .toMatchObject({ benchmark: 3.9, benchmarkBasis: "third-party" });
  });

  it("uses reported statistics only for science GPA", () => {
    const target = school({ reportedStats: [stat("science-gpa", "average", "unverified-capture", 3.6)], estimates: estimates({ competitiveGpa: score(3.7) }) });
    const result = estimateCompetitiveness(target, learner({ scienceGpa: 3.5, cumulativeGpa: 3.7 }));
    expect(result?.comparisons.map(entry => [entry.metric, entry.benchmarkBasis, entry.band])).toEqual([["gpa", "estimate", "at-or-above"], ["science-gpa", "unverified-capture", "near"]]);
    expect(estimateCompetitiveness(school({ estimates: estimates({ competitiveGpa: score(3.7) }) }), learner())?.comparisons.map(entry => entry.metric)).toEqual(["gpa"]);
  });

  it("bands GPA at −0.15 and MCAT at −3 exactly", () => {
    expect(competitivenessBand("gpa", 0)).toBe("at-or-above");
    expect(competitivenessBand("gpa", -0.15)).toBe("near");
    expect(competitivenessBand("gpa", -0.16)).toBe("below");
    expect(competitivenessBand("mcat", -3)).toBe("near");
    expect(competitivenessBand("mcat", -3.1)).toBe("below");
    const target = school({ reportedStats: [stat("gpa", "average", "official-capture", 3.6), stat("mcat", "average", "official-capture", 510)] });
    const at = (cumulativeGpa: number, mcatTotal: number) => estimateCompetitiveness(target, learner({ cumulativeGpa, mcatTotal }))!;
    expect(at(3.45, 507).comparisons.map(entry => [entry.delta, entry.band])).toEqual([[-0.15, "near"], [-3, "near"]]);
    expect(at(3.44, 506).comparisons.map(entry => entry.band)).toEqual(["below", "below"]);
    expect(at(3.6, 510).comparisons.map(entry => entry.band)).toEqual(["at-or-above", "at-or-above"]);
  });

  it("derives the overall band from the compared metrics", () => {
    const target = school({ reportedStats: [stat("gpa", "average", "official-capture", 3.6), stat("mcat", "average", "official-capture", 510)] });
    const band = (cumulativeGpa: number, mcatTotal: number) => estimateCompetitiveness(target, learner({ cumulativeGpa, mcatTotal }))?.band;
    expect(band(3.7, 512)).toBe("at-or-above");
    expect(band(3.5, 508)).toBe("near");
    expect(band(3.2, 500)).toBe("below");
    expect(band(3.7, 500)).toBe("mixed");
    expect(band(3.7, 508)).toBe("near");
    expect(estimateCompetitiveness(target, learner({ cumulativeGpa: 3.2 }))?.band).toBe("below");
  });

  it("still returns benchmarks without profile values and always carries the disclaimer", () => {
    const target = school({ reportedStats: [stat("mcat", "average", "third-party", 508)], estimates: estimates({ tier: "C", confidence: "low" }) });
    const empty = estimateCompetitiveness(target, undefined)!;
    expect(empty.comparisons).toEqual([{ metric: "mcat", benchmark: 508, benchmarkBasis: "third-party", benchmarkLabel: "Reported average (third-party source, Jul 2026)" }]);
    expect(empty).toMatchObject({ tier: "C", confidence: "low" });
    expect(empty.band).toBeUndefined();
    const withValue = estimateCompetitiveness(target, learner({ mcatTotal: 504 }))!;
    for (const result of [empty, withValue]) {
      expect(result.explanation).toContain("Estimate from captured class statistics and research-team estimates — not an admissions probability or requirement.");
    }
    expect(withValue.explanation).toContain("MCAT 504 vs. 508 (below)");
  });
});

describe("compareActivities", () => {
  const target = school({
    estimates: estimates({
      hours: {
        leadership: { text: "100-300", min: 100, max: 300 },
        research: { text: "200-600", min: 200, max: 600 },
        clinicalVolunteer: { text: "500-3000+ (EMT/paramedic, scribe)", min: 500, max: 3000, openEnded: true },
        nonclinicalVolunteer: { text: "100-300", min: 100, max: 300 },
        shadowing: { text: "Varies" },
      },
    }),
  });

  it("returns one comparison per estimated activity in the fixed order with positions", () => {
    const result = compareActivities(target, learner({ activityHours: { research: 150, clinicalVolunteer: 5000, shadowing: 50, leadership: 400, paidClinical: 900 } }));
    expect(result.map(entry => [entry.activity, entry.label, entry.yours, entry.position])).toEqual([
      ["research", "Research", 150, "below-range"],
      ["clinicalVolunteer", "Clinical volunteering", 5000, "within-range"],
      ["nonclinicalVolunteer", "Non-clinical volunteering", undefined, undefined],
      ["shadowing", "Shadowing", 50, undefined],
      ["leadership", "Leadership", 400, "above-range"],
    ]);
  });

  it("treats range endpoints as within range and handles missing estimates", () => {
    const bounds = compareActivities(target, learner({ activityHours: { research: 200, leadership: 300, clinicalVolunteer: 499 } }));
    expect(Object.fromEntries(bounds.map(entry => [entry.activity, entry.position]))).toMatchObject({
      research: "within-range", leadership: "within-range", clinicalVolunteer: "below-range",
    });
    expect(compareActivities(school(), learner({ activityHours: { research: 100 } }))).toEqual([]);
    expect(compareActivities(target, undefined).every(entry => entry.yours === undefined && entry.position === undefined)).toBe(true);
  });

  it("feeds the school result alongside the checks", () => {
    const result = run(target, [gpaHard], learner({ cumulativeGpa: 3.5, activityHours: { research: 300 } }));
    expect(result.activities[0]).toMatchObject({ activity: "research", position: "within-range" });
    expect(result.competitiveness).toMatchObject({ tier: "B", comparisons: [] });
  });
});

describe("outcome coverage by kind", () => {
  const complete = learner({
    cumulativeGpa: 3.5, scienceGpa: 3.5, mcatTotal: 510, mcatTestDate: "2025-06", citizenship: "us-citizen", stateOfResidence: "Alabama",
    degreeStatus: "completed", coursework: { biology: { status: "completed", semesterHours: 8, passFail: true, online: true, communityCollege: true, apCredit: true } },
  });

  it("reports sentinel evidence as missing-evidence for every kind, even with a complete profile", () => {
    for (const kind of Object.keys(FACT_IDS) as RequirementKind[]) {
      const id = kind === "coursework" ? "coursework:biology" : kind;
      const check = checkOf(rule(kind, "NOT_FOUND_AFTER_OFFICIAL_SEARCH", { id, strength: "unknown" }), complete);
      expect([kind, check.outcome, check.blocking]).toEqual([kind, "missing-evidence", false]);
    }
  });

  it("never passes a check for a profile that only names the cycle (unknown is not a pass)", () => {
    const rules: StructuredRequirement[] = [
      gpaHard,
      rule("science-gpa-minimum", "3.0 (AL residents) / 3.3 (out-of-state)", { strength: "conditional",
        variants: [{ condition: "in-state", threshold: 3, text: "3.0 (AL residents)" }, { condition: "out-of-state", threshold: 3.3, text: "3.3 (out-of-state)" }] }),
      rule("mcat-minimum", "500", { threshold: 500 }),
      rule("mcat-required", "MCAT required"),
      rule("mcat-recency", "Within 3 years of matriculation", { recency: { years: 3, anchor: "matriculation" } }),
      rule("citizenship", "U.S. citizens and permanent residents only", { citizenship: { accepted: ["us-citizen", "us-permanent-resident"], excluded: ["international"] } }),
      rule("state-residency", "Strong preference for Alabama residents", { residency: { mode: "preference", preferredRegions: ["Alabama"] } }),
      rule("degree", "Bachelor's required", { degree: { bachelorsRequired: true, completedBy: "matriculation" } }),
      rule("coursework", "8 (w/lab)", { id: "coursework:physics", coursework: { category: "physics", semesterHours: 8, lab: true } }),
      rule("prerequisite-grades", "Pass/fail not accepted", { passFail: "not-accepted" }),
      rule("deadline", "November 1", { deadline: { month: 11, day: 1, rolling: false } }),
    ];
    const result = run(school(), rules, learner());
    expect(result.checks.filter(check => check.outcome === "meets" || check.outcome === "on-track")).toEqual([]);
    expect(result.eligibility).toMatchObject({ status: "not-enough-information", meets: 0, blockers: 0, unknown: 10, decided: 0, total: 11 });
    expect(result.eligibility.headline).not.toMatch(/no blockers/i);
  });

  it("reads unparsed coursework and policy text as missing evidence, and other unparsed text as needs-review", () => {
    const course = checkOf(rule("coursework", "incl. in biochem seq", {
      id: "coursework:biochemistry", coursework: { category: "biochemistry" }, strength: "unknown", exceptions: ["incl. in biochem seq"],
    }), complete);
    expect(course.outcome).toBe("missing-evidence");
    expect(course.explanation).toContain("could not read the course requirement");
    expect(course.explanation).toContain("\"incl. in biochem seq\"");
    const grade = checkOf(rule("prerequisite-grades", "Course satisfied with grade C (2.00) or better, min 2 credit hours", {
      strength: "unknown", minimumGrade: "C", passFail: "unknown",
    }), complete);
    expect(grade).toMatchObject({ outcome: "missing-evidence", schoolValue: "Minimum grade C; pass/fail not stated" });
    expect(grade.explanation).toContain("minimum grade of C but does not say whether pass/fail coursework counts");
    const online = checkOf(rule("online-coursework", "Per registrar review", { strength: "unknown", acceptance: "unknown" }), complete);
    expect(online.outcome).toBe("missing-evidence");
    expect(online.explanation).toContain("online coursework policy");
    const residency = checkOf(rule("state-residency", "Mission emphasis on improving health outcomes for Arizona", { strength: "unknown" }), complete);
    expect(residency.outcome).toBe("needs-review");
    const faith = checkOf(rule("state-residency", "REQUIRES_MANUAL_VERIFICATION (faith-based, Seventh-day Adventist affiliation)", {
      strength: "unknown", exceptions: ["faith-based, Seventh-day Adventist affiliation"],
    }), complete);
    expect(faith.outcome).toBe("missing-evidence");
    expect(faith.explanation).toContain("\"faith-based, Seventh-day Adventist affiliation\"");
    expect(checkOf(rule("deadline", "AACOMAS closing date", { strength: "unknown" }), complete).outcome).toBe("needs-review");
  });

  it("covers the remaining MCAT requirement outcomes", () => {
    const usOnly = rule("mcat-required", "MCAT required for U.S. citizens/PR", { strength: "conditional", requiredFor: ["us-citizen", "us-permanent-resident"] });
    const international = checkOf(usOnly, learner({ citizenship: "international" }));
    expect(international).toMatchObject({ outcome: "needs-review", blocking: false });
    expect(international.explanation).toContain("how Other international applicants are treated");
    const recommended = checkOf(rule("mcat-required", "MCAT recommended", { strength: "recommended" }), learner());
    expect(recommended).toMatchObject({ outcome: "missing-profile", blocking: false });
    const pastNoScore = checkOf(rule("mcat-required", "MCAT required"), learner({ mcatTestDate: "2026-05" }));
    expect(pastNoScore).toMatchObject({ outcome: "missing-profile", yourValue: "Tested May 2026" });
    expect(pastNoScore.explanation).toContain("add your score");
    expect(checkOf(rule("mcat-required", "Depends on program track", { strength: "conditional" }), learner({ mcatTotal: 505 })).outcome).toBe("needs-review");
  });

  it("covers the remaining numeric-minimum outcomes", () => {
    const none = checkOf(rule("science-gpa-minimum", "None stated", { strength: "none-stated" }), learner({ scienceGpa: 2.2 }));
    expect(none).toMatchObject({ outcome: "not-applicable", blocking: false, schoolValue: "No published minimum" });
    const noNumber = checkOf(rule("mcat-minimum", "Competitive scores expected"), learner({ mcatTotal: 500 }));
    expect(noNumber).toMatchObject({ outcome: "needs-review", blocking: false });
    const residentsOnly = rule("mcat-minimum", "500 (AR residents)", {
      strength: "conditional", variants: [{ condition: "in-state", threshold: 500, text: "500 (AR residents)" }],
    });
    const texan = checkOf(residentsOnly, learner({ mcatTotal: 498, stateOfResidence: "Texas" }), school({ location: "Arkansas" }));
    expect(texan).toMatchObject({ outcome: "needs-review", blocking: false, yourValue: "498", schoolValue: "500 in-state minimum" });
    expect(texan.explanation).toMatch(/500 in-state minimum.*498/);
    expect(checkOf(residentsOnly, learner({ mcatTotal: 498, stateOfResidence: "Arkansas" }), school({ location: "Arkansas" })))
      .toMatchObject({ outcome: "does-not-meet", blocking: true });
  });

  it("covers the remaining MCAT minimum and test-window outcomes", () => {
    const recommended = checkOf(rule("mcat-minimum", "~495 (competitive)", { strength: "recommended", threshold: 495, exceptions: ["~"] }), learner({ mcatTotal: 492 }));
    expect(recommended).toMatchObject({ outcome: "below-recommended", blocking: false, schoolValue: "495 recommended minimum" });
    expect(recommended.explanation).toMatch(/492.*495/);
    expect(checkOf(rule("mcat-minimum", "None stated", { strength: "none-stated" }), learner({ mcatTotal: 490 })).outcome).toBe("not-applicable");
    expect(checkOf(rule("mcat-recency", "N/A (MCAT optional)", { strength: "not-required" }), learner()).outcome).toBe("not-applicable");
    const soft = rule("mcat-recency", "MCAT within three years preferred", { strength: "recommended", recency: { years: 3, anchor: "unspecified" } });
    expect(checkOf(soft, learner({ mcatTestDate: "2023-06" }))).toMatchObject({ outcome: "below-recommended", blocking: false });
    expect(checkOf(rule("mcat-recency", "Recent scores preferred"), learner({ mcatTestDate: "2025-06" })).outcome).toBe("needs-review");
  });

  it("covers the remaining citizenship outcomes", () => {
    const daca = rule("citizenship", "U.S. citizens, permanent residents and DACA recipients eligible", {
      citizenship: { accepted: ["us-citizen", "us-permanent-resident", "daca"], excluded: [] },
    });
    expect(checkOf(daca, learner({ citizenship: "daca" })).outcome).toBe("meets");
    const notListed = checkOf(daca, learner({ citizenship: "international" }));
    expect(notListed).toMatchObject({ outcome: "needs-review", blocking: false });
    expect(notListed.explanation).not.toContain("applicant applicants");
    expect(checkOf(rule("citizenship", "No stated citizenship restriction", { strength: "none-stated" }), learner({ citizenship: "international" })).outcome).toBe("not-applicable");
    expect(checkOf(rule("citizenship", "Addressed on separate Citizenship page (not fetched)", { strength: "unknown" }), learner({ citizenship: "us-citizen" })).outcome).toBe("needs-review");
  });

  it("covers residency qualifiers and the school's own state as the preferred region", () => {
    const edp = rule("state-residency", "EDP limited to residents of Alabama, FL panhandle, MS Gulf Coast counties", {
      residency: { mode: "preference", preferredRegions: ["Alabama"] }, exceptions: ["EDP limited to residents of Alabama, FL panhandle, MS Gulf Coast counties"],
    });
    const texan = checkOf(edp, learner({ stateOfResidence: "Texas" }));
    expect(texan).toMatchObject({ outcome: "below-recommended", blocking: false, yourValue: "Texas", schoolValue: "Prefers residents of Alabama" });
    expect(texan.explanation).toContain("Qualifier to read: \"EDP limited to residents");
    const unnamed = rule("state-residency", "In-state preference", { residency: { mode: "preference", preferredRegions: [] } });
    expect(checkOf(unnamed, learner({ stateOfResidence: "Arkansas" }), school({ location: "Arkansas" })).outcome).toBe("meets");
  });

  it("covers the remaining degree and coursework outcomes", () => {
    expect(checkOf(rule("degree", "No degree requirement stated", { strength: "none-stated" }), learner()).outcome).toBe("not-applicable");
    const preferred = rule("degree", "Baccalaureate preferred", { strength: "recommended", degree: { bachelorsRequired: false } });
    expect(checkOf(preferred, learner({ degreeStatus: "in-progress", degreeExpectedDate: "2027-12" }))).toMatchObject({ outcome: "below-recommended", blocking: false });
    const required = rule("degree", "Bachelor's required", { degree: { bachelorsRequired: true } });
    const noYear = checkOf(required, { coursework: {}, activityHours: {}, degreeStatus: "in-progress", degreeExpectedDate: "2027-05" });
    expect(noYear.outcome).toBe("missing-profile");
    const physics = rule("coursework", "1 yr (w/lab)", { id: "coursework:physics", coursework: { category: "physics", semesterHours: 8, lab: true } });
    const noHours = checkOf(physics, learner({ coursework: { physics: { status: "completed" } } }));
    expect(noHours).toMatchObject({ outcome: "missing-profile", title: "Physics coursework" });
    expect(noHours.explanation).toContain("8");
    expect(checkOf(rule("coursework", "Not required", { id: "coursework:english", strength: "not-required" }), learner()).outcome).toBe("not-applicable");
    const conditional = rule("coursework", "Required unless AP credit on transcript", { id: "coursework:english", strength: "conditional", coursework: { category: "english" } });
    expect(checkOf(conditional, learner({ coursework: { english: { status: "not-planned" } } }))).toMatchObject({ outcome: "needs-review", blocking: false });
    expect(requirementTitle({ id: "coursework:mathStatistics", kind: "coursework" })).toBe("Math and statistics coursework");
    expect(requirementTitle({ id: "coursework:behavioralScience", kind: "coursework", coursework: { category: "behavioralScience" } })).toBe("Behavioral science coursework");
  });

  it("reads the broader entering-class phrasings", () => {
    expect(evidenceCycleForFact({ value: "Averages for students entering in fall 2026", capturedAt: "2026-07-19T00:00:00Z" })).toBe(2026);
    expect(evidenceCycleForFact({ value: "Within 3 years of 2027 matriculation", capturedAt: "2026-01-19T00:00:00Z" })).toBe(2027);
    expect(evidenceCycleForFact({ value: "Profile for the 2025 class", capturedAt: "2026-07-19T00:00:00Z" })).toBe(2025);
  });
});

describe("review fixes", () => {
  const recency = rule("mcat-recency", "MCAT within three years of matriculation", { recency: { years: 3, anchor: "matriculation" } });

  it("rejects tests after January of the matriculation year, planned or not", () => {
    expect(checkOf(recency, learner({ mcatTestDate: "2027-10" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(recency, learner({ mcatTestDate: "2030-01" }))).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(checkOf(recency, learner({ mcatTestDate: "2027-01" }))).toMatchObject({ outcome: "on-track" });
    const late = checkOf(rule("mcat-required", "MCAT required"), learner({ mcatTestDate: "2028-03" }));
    expect(late).toMatchObject({ outcome: "needs-review", yourValue: "Planned March 2028" });
    expect(late.explanation).toContain("January 2027");
  });

  it("treats a window with no readable date as absent", () => {
    const broken = rule("mcat-recency", "2024", { testWindow: { earliest: "2024", matriculationYear: 2027 } });
    expect(checkOf(broken, learner({ mcatTestDate: "2019-01" }))).toMatchObject({ outcome: "needs-review" });
  });

  it("asks for coursework before judging grade, online, community-college and AP policies", () => {
    const passFail = rule("prerequisite-grades", "Pass/fail not accepted", { passFail: "not-accepted" });
    expect(checkOf(passFail, learner())).toMatchObject({ outcome: "missing-profile" });
    expect(checkOf(passFail, learner({ coursework: { biology: { status: "completed" } } }))).toMatchObject({ outcome: "not-applicable" });
  });

  it("sends a non-blocking shortfall to needs-review instead of 'no blockers found'", () => {
    const passFail = rule("prerequisite-grades", "Pass/fail not accepted", { passFail: "not-accepted" });
    const result = run(school(), [gpaHard, passFail], learner({ cumulativeGpa: 3.5, coursework: { biology: { status: "completed", passFail: true } } }));
    expect(result.checks[1]).toMatchObject({ outcome: "does-not-meet", blocking: false });
    expect(result.eligibility).toMatchObject({ status: "needs-review", reviews: 1 });
    expect(result.eligibility.headline).not.toMatch(/no blockers/i);
  });

  it("does not say 'no blockers' for earlier-cycle evidence when nothing was decided", () => {
    const result = run(school(), [gpaHard], learner({ plannedMatriculationYear: 2028 }));
    expect(result.eligibility.status).toBe("not-enough-information");
    expect(result.eligibility.headline).toMatch(/2027 entering class.*2028/);
    expect(result.eligibility.headline).not.toMatch(/no blockers/i);
  });

  it("flags a deadline published for another cycle", () => {
    const deadline = rule("deadline", "2025-12-15 (fall 2026 entry)", { deadline: { month: 12, day: 15, rolling: false, explicitYear: 2025 } });
    const check = checkOf(deadline, learner({ plannedMatriculationYear: 2027 }));
    expect(check).toMatchObject({ outcome: "needs-review", schoolValue: "December 15, 2025" });
    expect(check.explanation).toContain("another cycle");
    const same = rule("deadline", "February 1, 2027", { deadline: { month: 2, day: 1, rolling: false, explicitYear: 2027 } });
    expect(checkOf(same, learner({ plannedMatriculationYear: 2027 })).outcome).toBe("not-applicable");
  });

  it("keeps a deadline open until the end of the day across U.S. time zones", () => {
    const deadline = rule("deadline", "November 1", { deadline: { month: 11, day: 1, rolling: false } });
    const at = (iso: string) => evaluateRequirements(school(), [deadline], learner(), { now: new Date(iso) }).checks[0].outcome;
    expect(at("2026-11-02T02:00:00Z")).toBe("not-applicable");
    expect(at("2026-11-02T10:00:00Z")).toBe("needs-review");
  });

  it("never benchmarks against floor-like figures or a stated minimum", () => {
    const threshold = stat("mcat", "competitive", "unverified-capture", 502, "502 (threshold; no section below 124; <=3 attempts)");
    expect(estimateCompetitiveness(school({ reportedStats: [{ ...threshold, floorLike: true }] }), learner({ mcatTotal: 502 }))?.comparisons).toEqual([]);
    vi.mocked(deriveRequirements).mockReturnValueOnce([rule("gpa-minimum", "2.8 cumulative", { threshold: 2.8 })]).mockReturnValueOnce([]).mockReturnValueOnce([]);
    const result = estimateCompetitiveness(school({ estimates: estimates({ competitiveGpa: score(2.8) }) }), learner({ cumulativeGpa: 2.8 }));
    expect(result?.comparisons.find(entry => entry.metric === "gpa")).toBeUndefined();
  });
});

describe("headline wording", () => {
  it("never says eligible, qualify, guarantee, chance or % in any headline produced above", () => {
    expect(headlines.length).toBeGreaterThan(40);
    for (const headline of headlines) expect(headline).not.toMatch(FORBIDDEN);
  });
});
