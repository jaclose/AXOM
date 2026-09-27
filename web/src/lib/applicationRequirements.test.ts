import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveRequirements, inferEvidenceCycle, type StructuredRequirement } from "./applicationRequirements";
import { researchFactRevision, type SchoolResearchFact } from "./applicationResearch";
import { parseApplicationSchoolDataset, type ApplicationSchool } from "./applicationSchools";

const capturedAt = "2026-07-22T00:00:00Z";
const fact = (id: string, value: string, captureStatus: SchoolResearchFact["captureStatus"] = "unverified-capture"): SchoolResearchFact =>
  ({ id, label: id, value, url: "https://example.edu/admissions", capturedAt, captureStatus });
const school = (facts: SchoolResearchFact[], location = "Alabama"): ApplicationSchool =>
  ({ id: "S9999", canonicalName: "Synthetic", name: "Synthetic", location, verificationStatus: "incomplete", sources: [], researchFacts: facts });
const A = (field: string) => `admissions_requirements_raw.${field}`;
const P = (field: string) => `application_process_raw.${field}`;
const C = (field: string) => `coursework_policy_raw.${field}`;

function only(facts: SchoolResearchFact[], id: string, location?: string): StructuredRequirement {
  const found = deriveRequirements(school(facts, location)).find(rule => rule.id === id);
  if (!found) throw new Error(`No ${id} rule for ${facts.map(item => item.value).join(" | ")}`);
  return found;
}

describe("numeric minimums from real captured text", () => {
  it.each([
    ["3.0", "hard", 3],
    ["2.8 cumulative", "hard", 2.8],
    ["3.00 (general GPA minimum)", "hard", 3],
    ["2.75 total (min)", "hard", 2.75],
    ["3.0 undergraduate (min)", "hard", 3],
    ["3.0 total (preferred)", "recommended", 3],
    ["2.8 cumulative (recommended minimum)", "recommended", 2.8],
  ])("GPA %s → %s %s", (value, strength, threshold) => {
    const rule = only([fact(A("min_gpa"), value)], "gpa-minimum");
    expect(rule).toMatchObject({ strength, threshold, gpaScope: "cumulative" });
    expect(rule.variants).toBeUndefined();
  });

  it("reads cumulative & science scope", () => {
    expect(only([fact(A("min_gpa"), "3.60 cumulative & science (min)")], "gpa-minimum"))
      .toMatchObject({ strength: "hard", threshold: 3.6, gpaScope: "both" });
  });

  it.each([
    "No minimum (holistic)", "None stated", "None (no stated minimum)", "None (no minimum)", "No published minimum",
    "No rigid minimum", "None (no minimum; holistic)",
  ])("GPA %s → none-stated", value => {
    expect(only([fact(A("min_gpa"), value)], "gpa-minimum")).toMatchObject({ strength: "none-stated" });
  });

  it("never reads an admitted average as a minimum", () => {
    const rule = only([fact(A("min_gpa"), "None (avg admitted 3.27)")], "gpa-minimum");
    expect(rule).toMatchObject({ strength: "none-stated" });
    expect(rule.threshold).toBeUndefined();
  });

  it("never reads a scholarship threshold as an admission minimum", () => {
    const rule = only([fact(A("min_gpa"), "3.6+ earns 20% tuition scholarship (indirect signal)")], "gpa-minimum");
    expect(rule.strength).toBe("unknown");
    expect(rule.threshold).toBeUndefined();
    expect(rule.variants).toBeUndefined();
  });

  it("reads Early Decision, screening, North American and program-track conditions as variants", () => {
    expect(only([fact(A("min_gpa"), "3.50 (Early Decision Program minimum only)")], "gpa-minimum"))
      .toMatchObject({ strength: "conditional", variants: [{ condition: "early-decision", threshold: 3.5 }] });
    expect(only([fact(A("min_gpa"), "3.0 overall (secondary-screen min)")], "gpa-minimum"))
      .toMatchObject({ strength: "conditional", variants: [{ condition: "screening", threshold: 3 }] });
    expect(only([fact(A("min_gpa"), "3.0 (North American applicants)")], "gpa-minimum"))
      .toMatchObject({ strength: "conditional", variants: [{ condition: "north-american", threshold: 3 }] });
    const credits = only([fact(A("min_gpa"), "3.4 cumulative (min, for 90-120 cr applicants)")], "gpa-minimum");
    expect(credits).toMatchObject({ strength: "conditional", variants: [{ condition: "other", threshold: 3.4 }] });
    expect(credits.exceptions).toContain("for 90-120 cr applicants");
    expect(credits.threshold).toBeUndefined();
  });

  it("splits in-state and out-of-state figures", () => {
    const rule = only([fact(A("min_science_gpa"), "3.0 (AL residents) / 3.3 (out-of-state), BCPM, for secondary invite")], "science-gpa-minimum");
    expect(rule.strength).toBe("conditional");
    expect(rule.variants?.map(variant => [variant.condition, variant.threshold])).toEqual([["in-state", 3], ["out-of-state", 3.3]]);
    expect(rule.exceptions).toContain("for secondary invite");
    const mcat = only([fact(A("mcat_min"), "500 (AR residents) / 505 (non-residents)")], "mcat-minimum");
    expect(mcat.variants?.map(variant => [variant.condition, variant.threshold])).toEqual([["in-state", 500], ["out-of-state", 505]]);
  });

  it.each([
    ["504", "hard", 504],
    ["506 composite (min)", "hard", 506],
    ["495 (scores below 495 not considered)", "hard", 495],
    ["500 (to apply)", "hard", 500],
  ])("MCAT %s → %s %s", (value, strength, threshold) => {
    expect(only([fact(A("mcat_min"), value)], "mcat-minimum")).toMatchObject({ strength, threshold });
  });

  it("reads approximate MCAT figures as recommended, with the qualifier kept", () => {
    const rule = only([fact(A("mcat_min"), "~495 (may still be considered)")], "mcat-minimum");
    expect(rule).toMatchObject({ strength: "recommended", threshold: 495 });
    expect(rule.exceptions.join(" ")).toMatch(/may still be considered/);
  });

  it("reads screening thresholds, attempt limits and Early Decision MCAT minimums", () => {
    expect(only([fact(A("mcat_min"), "495 total (secondary-invite threshold)")], "mcat-minimum"))
      .toMatchObject({ strength: "conditional", variants: [{ condition: "screening", threshold: 495 }] });
    expect(only([fact(A("mcat_min"), "494 (interview minimum; max 3 attempts)")], "mcat-minimum"))
      .toMatchObject({ strength: "conditional", maxAttempts: 3, variants: [{ condition: "screening", threshold: 494 }] });
    const early = only([fact(A("mcat_min"), "503 (EDP minimum composite); regular-pool floor not published")], "mcat-minimum");
    expect(early).toMatchObject({ strength: "conditional", variants: [{ condition: "early-decision", threshold: 503 }] });
    expect(early.exceptions).toContain("regular-pool floor not published");
  });

  it("reads section floors", () => {
    expect(only([fact(A("mcat_min"), "502 (threshold; no section below 124; <=3 attempts)")], "mcat-minimum"))
      .toMatchObject({ sectionFloor: 124, maxAttempts: 3 });
  });

  it("uses the matching requirement_type clause to spot screening and recommended figures", () => {
    const screening = only([fact(A("mcat_min"), "502"), fact(A("requirement_type"), "COMPETITIVE_THRESHOLD (MCAT 502 threshold for secondary invite; 90 semester hours min)", "official-capture")], "mcat-minimum");
    expect(screening).toMatchObject({ strength: "conditional", variants: [{ condition: "screening", threshold: 502 }] });
    expect(screening.evidence.map(item => item.factId)).toEqual([A("mcat_min"), A("requirement_type")]);
    const recommended = only([fact(A("mcat_min"), "496"), fact(A("requirement_type"), "RECOMMENDED minimums (min recommended MCAT 496, science GPA 3.0); no set hard minimum")], "mcat-minimum");
    expect(recommended).toMatchObject({ strength: "recommended", threshold: 496 });
    const hard = only([fact(A("mcat_min"), "504"), fact(A("requirement_type"), "HARD requirement (GPA/MCAT/citizenship/degree); coursework recommended only")], "mcat-minimum");
    expect(hard).toMatchObject({ strength: "hard", threshold: 504 });
    expect(hard.evidence).toHaveLength(1);
  });

  it.each([
    ["MCAT not required (optional; given high regard if attempted)", "not-required"],
    ["Not required (no entrance exam)", "not-required"],
    ["MCAT collected for U.S. citizens/PR (DoE requirement) but NOT scored in admit decision", "not-required"],
    ["MCAT not required (optional; 495+ earns full-tuition scholarship for 10 students)", "not-required"],
    ["None stated in official requirements", "none-stated"],
    ["Competitive score required (no numeric floor published)", "none-stated"],
    ["MCAT required for North American applicants (within 3 years); holistic, no fixed cutoff", "none-stated"],
    ["No minimum; MCAT required for U.S. applicants prior to interview", "none-stated"],
    ["Not specified", "none-stated"],
  ])("MCAT %s → %s without a threshold", (value, strength) => {
    const rule = only([fact(A("mcat_min"), value)], "mcat-minimum");
    expect(rule.strength).toBe(strength);
    expect(rule.threshold).toBeUndefined();
  });

  it("keeps sentinel evidence as an unknown rule and emits nothing when the fact is absent", () => {
    expect(only([fact(A("min_gpa"), "NOT_PUBLICLY_DISCLOSED")], "gpa-minimum").strength).toBe("unknown");
    expect(deriveRequirements(school([fact(A("mcat_min"), "500")])).some(rule => rule.kind === "gpa-minimum")).toBe(false);
  });
});

describe("MCAT requirement and test dates", () => {
  it("reads who must submit an MCAT", () => {
    expect(only([fact(A("mcat_min"), "MCAT required for US-based applicants (no numeric floor published)")], "mcat-required"))
      .toMatchObject({ strength: "hard", requiredFor: ["us-citizen", "us-permanent-resident"] });
    const northAmerican = only([
      fact(A("mcat_min"), "MCAT required for North American applicants (within 3 years); holistic, no fixed cutoff"),
      fact(P("international_policy"), "Applicants outside North America not required to submit MCAT"),
    ], "mcat-required");
    expect(northAmerican.requiredFor).toEqual(["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen"]);
    expect(northAmerican.optionalFor).toEqual(["international"]);
    const alternatives = only([fact(P("international_policy"), "Open to international applicants; MCAT required for U.S. applicants (Canadian/Intl may submit UCAT/NEET/GAMSAT)")], "mcat-required");
    expect(alternatives).toMatchObject({ requiredFor: ["us-citizen", "us-permanent-resident"], optionalFor: ["canadian-citizen", "international"] });
    expect(only([fact(A("mcat_recency_policy"), "Prerequisites within 5 years of application; MCAT required")], "mcat-required"))
      .toMatchObject({ strength: "hard" });
    expect(only([fact(A("mcat_min"), "MCAT not required (optional; given high regard if attempted)")], "mcat-required").strength).toBe("not-required");
  });

  it("does not emit an MCAT requirement from a bare numeric minimum", () => {
    expect(deriveRequirements(school([fact(A("mcat_min"), "504")])).some(rule => rule.kind === "mcat-required")).toBe(false);
  });

  it.each([
    ["MCAT within three years of matriculation", { years: 3, anchor: "matriculation" }],
    ["MCAT within 4 years of desired matriculation date", { years: 4, anchor: "matriculation" }],
    ["MCAT taken within three years of application", { years: 3, anchor: "application" }],
    ["Scores within one year of application", { years: 1, anchor: "application" }],
    ["MCAT scores must be no more than 3 years old", { years: 3, anchor: "unspecified" }],
    ["MCAT scores taken no more than 3 years prior to the planned enrollment year", { years: 3, anchor: "matriculation" }],
    ["Highest total MCAT within the last three years considered", { years: 3, anchor: "unspecified" }],
    ["MCAT within past four calendar years; no subsection below 25th percentile", { years: 4, anchor: "unspecified" }],
  ])("recency: %s", (value, recency) => {
    expect(only([fact(A("mcat_recency_policy"), value)], "mcat-recency")).toMatchObject({ strength: "hard", recency });
  });

  it("reads explicit windows and the entering class they name", () => {
    expect(only([fact(A("mcat_recency_policy"), "Taken no earlier than Jan 1, 2023 and no later than Sept 30, 2025 (2026 entering class)")], "mcat-recency"))
      .toMatchObject({ testWindow: { earliest: "2023-01-01", latest: "2025-09-30", matriculationYear: 2026 }, cycleYear: 2026 });
    expect(only([fact(A("mcat_recency_policy"), "Within 4 years of matriculation (Jan 2023-Sept 2026 for 2027 entry)")], "mcat-recency"))
      .toMatchObject({ recency: { years: 4, anchor: "matriculation" }, testWindow: { earliest: "2023-01-01", latest: "2026-09-30", matriculationYear: 2027 } });
    expect(only([fact(A("mcat_recency_policy"), "At least 1 MCAT from an exam taken after Jan 2023 and before Aug 22, 2026 for the 2027 cycle")], "mcat-recency"))
      .toMatchObject({ testWindow: { earliest: "2023-01-01", latest: "2026-08-21", matriculationYear: 2027 } });
    expect(only([fact(A("mcat_recency_policy"), "2024 earliest for 2027 entering class; Sept 2026 latest considered; most recent total score used")], "mcat-recency"))
      .toMatchObject({ testWindow: { earliest: "2024-01-01", latest: "2026-09-30", matriculationYear: 2027 } });
    expect(only([fact(A("mcat_recency_policy"), "MCAT earned no earlier than calendar year 2024 and no later than Sep 12 2026 for 2027 entry")], "mcat-recency"))
      .toMatchObject({ testWindow: { earliest: "2024-01-01", latest: "2026-09-12", matriculationYear: 2027 } });
    expect(only([fact(A("mcat_recency_policy"), "MCAT must have been taken between January 2024 and January 2027 (for Summer 2027 start)")], "mcat-recency"))
      .toMatchObject({ testWindow: { earliest: "2024-01-01", latest: "2027-01-31", matriculationYear: 2027 } });
    const released = only([fact(A("mcat_recency_policy"), "For applications by Oct 15 2026, scores released Jan 1 2024 through Sep 12 2026 accepted (~3 yr); committee reviews most recent scores")], "mcat-recency");
    expect(released.testWindow).toEqual({ earliest: "2024-01-01", latest: "2026-09-12" });
    expect(released.recency).toBeUndefined();
    expect(released.exceptions.join(" ")).toMatch(/score release/);
  });

  it("reads latest-month rules relative to matriculation", () => {
    expect(only([fact(A("mcat_recency_policy"), "MCAT taken no later than September of the year preceding admission")], "mcat-recency").latestTestMonthBeforeMatriculation).toBe(9);
    expect(only([fact(A("mcat_recency_policy"), "August of the year prior to admission is the latest acceptable test date")], "mcat-recency").latestTestMonthBeforeMatriculation).toBe(8);
    expect(only([fact(A("mcat_recency_policy"), "MCAT must be taken prior to January of the entering year; scores submitted to AACOMAS")], "mcat-recency").latestTestMonthBeforeMatriculation).toBe(12);
    const combined = only([fact(A("mcat_recency_policy"), "MCAT within 4 years of the matriculation year and no later than October of the year prior; most recent score used for prescreening")], "mcat-recency");
    expect(combined).toMatchObject({ recency: { years: 4, anchor: "matriculation" }, latestTestMonthBeforeMatriculation: 10 });
  });

  it("keeps soft, pending and track-specific rules from blocking", () => {
    expect(only([fact(A("mcat_recency_policy"), "Not considered expired; advised within 3 years; no subsection below 15th percentile")], "mcat-recency").strength).toBe("recommended");
    expect(only([fact(A("mcat_recency_policy"), "MCAT required; recency not stated in COM Bulletin (3-yr per school future-students page, pending fetch)")], "mcat-recency").strength).toBe("conditional");
    expect(only([fact(A("mcat_recency_policy"), "MCAT & bachelor's should be achieved within the last 3 years (Accelerated track)")], "mcat-recency").strength).toBe("conditional");
    expect(only([fact(A("mcat_recency_policy"), "N/A (MCAT optional)")], "mcat-recency").strength).toBe("not-required");
  });

  it("does not read prerequisite windows or waivers as MCAT recency", () => {
    const rules = deriveRequirements(school([fact(A("mcat_recency_policy"), "Prerequisites within 5 years of application; MCAT required")]));
    expect(rules.some(rule => rule.kind === "mcat-recency")).toBe(false);
    expect(deriveRequirements(school([fact(A("mcat_recency_policy"), "MCAT may be waived for Henderson-NYITCOM Pre-Med Pathway completers")]))
      .some(rule => rule.kind === "mcat-recency")).toBe(false);
  });
});

describe("citizenship and residency", () => {
  it.each([
    ["U.S. citizens and permanent residents only", ["us-citizen", "us-permanent-resident"], ["undocumented", "canadian-citizen", "international"]],
    ["U.S. citizen or permanent resident", ["us-citizen", "us-permanent-resident"], []],
    ["US citizen or permanent resident; DACA may apply; does not admit international students", ["us-citizen", "us-permanent-resident", "daca"], ["undocumented", "canadian-citizen", "international"]],
    ["U.S. citizens, U.S. permanent residents, and applicants with DACA only", ["us-citizen", "us-permanent-resident", "daca"], ["undocumented", "canadian-citizen", "international"]],
  ])("%s", (value, accepted, excluded) => {
    expect(only([fact(A("citizenship_policy"), value)], "citizenship").citizenship).toEqual({ accepted, excluded });
  });

  it("does not read 'not open to international students' as open", () => {
    const rule = only([
      fact(A("citizenship_policy"), "U.S. citizens or U.S. permanent residents (green card) only; Florida residents given preference"),
      fact(P("international_policy"), "U.S. citizens or permanent residents only (not open to international students)"),
    ], "citizenship");
    expect(rule.citizenship?.excluded).toContain("international");
    expect(rule.citizenship?.accepted).not.toContain("international");
  });

  it("reads open policies and their conditions", () => {
    const open = only([fact(A("citizenship_policy"), "U.S. citizens, permanent residents, DACA, undocumented (legal status by matriculation), and visa-eligible international")], "citizenship");
    expect(open.citizenship?.accepted).toEqual(["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen", "international"]);
    expect(open.exceptions.join(" ")).toMatch(/legal status by matriculation/);
    const conditional = only([fact(A("citizenship_policy"), "Accepted students must obtain permanent residency prior to matriculation; international applicants must complete prereqs at US/Canada institutions")], "citizenship");
    expect(conditional).toMatchObject({ strength: "conditional", citizenship: { accepted: ["us-citizen", "us-permanent-resident"], excluded: [] } });
  });

  it("ignores MCAT-only clauses and non-citizenship text", () => {
    expect(only([fact(P("international_policy"), "U.S. DoE requires MCAT collection for U.S. citizens/PR"), fact(P("daca_policy"), "REQUIRES_MANUAL_VERIFICATION")], "citizenship").strength).toBe("unknown");
    expect(deriveRequirements(school([fact(A("citizenship_policy"), "Bachelor's from regionally accredited college/university (or foreign equivalent)")]))
      .some(rule => rule.kind === "citizenship")).toBe(false);
  });

  it.each([
    ["Strong preference for legal residents of Alabama", "Alabama"],
    ["Strong California-resident preference", "California"],
    ["Public AZ school; Arizona-resident preference (see residency page)", "Arizona"],
    ["Florida residents given preference (~135 matriculate via Regular Admissions)", "Florida"],
    ["Strong preference for PR residents; non-residents must show >=2 of 4 ties", "Puerto Rico"],
    ["80% of class must be Michigan residents; open to out-of-state", "Michigan"],
  ])("residency preference: %s", (value, region) => {
    const rule = only([fact(P("state_residency_rules"), value)], "state-residency");
    expect(rule.residency).toEqual({ preferredRegions: [region], mode: "preference" });
  });

  it.each([
    "No state residency preference", "Private; no state residency preference", "Private HBCU; open to all states",
    "No Maine/New England quotas; applicants from all regions encouraged", "N/A (international)", "International (Aruba)",
  ])("no residency preference: %s", value => {
    expect(only([fact(P("state_residency_rules"), value)], "state-residency")).toMatchObject({ strength: "none-stated", residency: { mode: "none" } });
  });

  it("does not invent a preference from mission statements", () => {
    expect(only([fact(P("state_residency_rules"), "Mission emphasis on improving health outcomes for Arizona")], "state-residency").strength).toBe("unknown");
    expect(only([fact(P("state_residency_rules"), "California public; holistic review")], "state-residency").strength).toBe("unknown");
  });

  it("adds residency preference stated only in the citizenship text", () => {
    const rule = only([fact(P("state_residency_rules"), "Arkansas residents favored"), fact(A("citizenship_policy"), "Strong preference for Arkansas residents; out-of-state must have close AR ties")], "state-residency");
    expect(rule.residency?.preferredRegions).toEqual(["Arkansas"]);
    expect(rule.exceptions.join(" ")).toMatch(/ties/);
  });
});

describe("degree and coursework", () => {
  it.each([
    ["Bachelor's required", { bachelorsRequired: true, completedBy: "unspecified" }],
    ["Baccalaureate from accredited U.S. college/university prior to matriculation", { bachelorsRequired: true, completedBy: "matriculation" }],
    ["90 undergrad credit hours; degree by July 1 before matriculation", { bachelorsRequired: true, minimumSemesterHours: 90, completedBy: "matriculation" }],
    ["90 sem hrs required; Baccalaureate preferred", { bachelorsRequired: false, minimumSemesterHours: 90 }],
    ["Bachelor's or >=90 credits (>=3 years study)", { bachelorsRequired: false, minimumSemesterHours: 90 }],
    ["90 semester hours min from a regionally accredited institution", { bachelorsRequired: false, minimumSemesterHours: 90 }],
    ["71 semester hours min in accredited US/Canadian college; baccalaureate expected", { bachelorsRequired: true, minimumSemesterHours: 71 }],
  ])("degree: %s", (value, degree) => {
    expect(only([fact(C("degree_requirement"), value)], "degree")).toMatchObject({ strength: "hard", degree });
  });

  it("keeps a preferred bachelor's soft and accreditation qualifiers as exceptions", () => {
    expect(only([fact(C("degree_requirement"), "Bachelor's from regionally accredited US 4-yr preferred")], "degree").strength).toBe("recommended");
    expect(only([fact(C("degree_requirement"), "U.S. bachelor's or intl equivalent; online-only degrees not accepted")], "degree").exceptions)
      .toContain("online-only degrees not accepted");
  });

  it.each([
    ["8 (w/lab)", 8, true],
    ["8 sem hrs inorganic (w/ lab)", 8, true],
    ["8 sem / 12 qtr credits (labs required)", 8, true],
    ["4 sem / 6 qtr credits (lab required)", 4, true],
    ["6 (English Comp or Lit)", 6, false],
    ["12 (Behavioral Sciences)", 12, false],
    ["2 sem w/ labs (8 sem hrs)", 8, true],
    ["1 sem upper-division survey (3-4 sem hrs)", 3, false],
  ])("coursework hours: %s", (value, semesterHours, lab) => {
    const rule = only([fact(C("biology_hours"), value)], "coursework:biology");
    expect(rule).toMatchObject({ strength: "hard", coursework: { category: "biology", semesterHours } });
    expect(Boolean(rule.coursework?.lab)).toBe(lab);
  });

  it("states how years, semesters and courses were converted", () => {
    const year = only([fact(C("physics_hours"), "1 yr (w/lab)")], "coursework:physics");
    expect(year.coursework?.semesterHours).toBe(8);
    expect(year.interpretation).toMatch(/one year read as about 8 semester hours/);
    expect(only([fact(C("english_hours"), "1 yr (English)")], "coursework:english").coursework?.semesterHours).toBe(6);
    expect(only([fact(C("biochem_hours"), "1 course (required)")], "coursework:biochemistry").interpretation).toMatch(/1 course read as about 3/);
    expect(only([fact(C("biochem_hours"), "1 sem coursework (lab recommended, not required)")], "coursework:biochemistry").coursework?.lab).toBeUndefined();
  });

  it.each([
    ["Recommended", "recommended"], ["Recommended (for MCAT)", "recommended"], ["Psychology & Sociology recommended", "recommended"],
    ["No specific requirement", "none-stated"], ["N/A (any seq incl. biochem)", "none-stated"], ["Not required", "not-required"],
    ["Required (hours NPD)", "hard"], ["Required (organic chemistry OR biochemistry)", "hard"], ["per institution", "unknown"],
    ["Biostatistics 1 sem recommended 2026-27; REQUIRED beginning 2027-28", "conditional"], ["NOT_PUBLICLY_DISCLOSED", "unknown"],
  ])("coursework: %s → %s", (value, strength) => {
    expect(only([fact(C("math_stats_hours"), value)], "coursework:mathStatistics").strength).toBe(strength);
  });

  it("flags the 'typical DO' fills as not quoted from the school", () => {
    expect(only([fact(C("orgo_hours"), "1 yr (w/ lab; typical DO)")], "coursework:organicChemistry").exceptions.join(" ")).toMatch(/typical DO/);
  });
});

describe("grade, delivery and credit policies, deadlines", () => {
  it.each([
    ["Pass/no pass accepted", "accepted", undefined],
    ["C- or better required", "unknown", "C-"],
    ["Course satisfied with grade C (2.00) or better, min 2 credit hours", "unknown", "C"],
    ["Pass/Fail accepted for prerequisites taken Spring 2020 only; otherwise letter grade C or better", "limited", "C"],
    ["Letter grades required, no grade lower than C (Spring 2020 P/S grades acceptable)", "limited", "C"],
    ["Courses should be letter grade beyond Pass/Fail unless extenuating circumstances", "limited", undefined],
  ])("grades: %s", (value, passFail, minimumGrade) => {
    const rule = only([fact(C("pass_fail_policy"), value)], "prerequisite-grades");
    expect(rule.passFail).toBe(passFail);
    expect(rule.minimumGrade).toBe(minimumGrade);
  });

  it.each([
    ["online_coursework_accepted", "online-coursework", "Accepted (online coursework and pass/no pass accepted)", "accepted"],
    ["online_coursework_accepted", "online-coursework", "Accepted (no preference as to delivery format: in person, distance learning, or hybrid)", "accepted"],
    ["online_coursework_accepted", "online-coursework", "Lecture: accepted if comparable to in-person; lab: must be in person (at-home kits NOT accepted)", "limited"],
    ["community_college_accepted", "community-college", "Accepted (max 105 quarter units from community college)", "limited"],
    ["community_college_accepted", "community-college", "Accepted", "accepted"],
    ["ap_credit_policy", "ap-credit", "AP credits are NOT counted toward requirements", "not-accepted"],
    ["ap_credit_policy", "ap-credit", "AP accepted if it appears on an official college transcript", "limited"],
    ["ap_credit_policy", "ap-credit", "AP credits accepted", "accepted"],
  ])("%s: %s", (field, id, value, acceptance) => {
    expect(only([fact(C(field), value)], id).acceptance).toBe(acceptance);
  });

  it.each([
    ["November 1", { month: 11, day: 1, rolling: false }],
    ["AMCAS October 15", { month: 10, day: 15, rolling: false }],
    ["AMCAS by October 15", { month: 10, day: 15, rolling: false }],
    ["AMCAS December 1 (11:59 EDT)", { month: 12, day: 1, rolling: false }],
    ["April 1 (all materials incl AACOMAS, MCAT, 2 letters)", { month: 4, day: 1, rolling: false }],
    ["AACOMAS verified status by February 1, 2027 (Summer 2027 start)", { month: 2, day: 1, rolling: false, explicitYear: 2027 }],
    ["2025-12-15 (fall 2026 entry)", { month: 12, day: 15, rolling: false, explicitYear: 2025 }],
    ["Rolling (Jan/May/Sep intakes)", { rolling: true }],
  ])("deadline: %s", (value, deadline) => {
    expect(only([fact(P("primary_deadline"), value)], "deadline").deadline).toMatchObject(deadline);
  });

  it("leaves unreadable deadlines unknown", () => {
    expect(only([fact(P("primary_deadline"), "AACOMAS closing date")], "deadline").strength).toBe("unknown");
    expect(only([fact(P("primary_deadline"), "Three intakes: January, May, September")], "deadline").strength).toBe("unknown");
  });
});

describe("evidence cycle", () => {
  const at = (value: string, when = capturedAt) => inferEvidenceCycle({ value, capturedAt: when });
  it("prefers explicit entering classes and cycles", () => {
    expect(at("2024 earliest for 2027 entering class")).toBe(2027);
    expect(at("Taken no earlier than Jan 1, 2023 (2026 entering class)")).toBe(2026);
    expect(at("before Aug 22, 2026 for the 2027 cycle")).toBe(2027);
    expect(at("3.83 (Class of 2029, per search digest)")).toBe(2025);
    expect(at("~$389,987 total tuition (2026 entrants, incl. admin fees)")).toBe(2026);
    expect(at("verified by February 1, 2027 (Summer 2027 start)")).toBe(2027);
  });
  it("falls back to the capture date", () => {
    expect(at("November 1")).toBe(2027);
    expect(at("November 1", "2026-03-01T00:00:00Z")).toBe(2026);
    expect(at("November 1", "not a date")).toBeUndefined();
  });
});

describe("derived rules carry their evidence", () => {
  it("records the revision of every fact so changed evidence reopens review", () => {
    const source = fact(A("min_gpa"), "3.0", "official-capture");
    const rule = only([source], "gpa-minimum");
    expect(rule.evidence).toEqual([{ factId: source.id, revision: researchFactRevision(source), label: source.label, rawValue: "3.0", url: source.url, capturedAt, captureStatus: "official-capture" }]);
  });

  it("never throws on malformed schools", () => {
    expect(deriveRequirements({} as ApplicationSchool)).toEqual([]);
    expect(deriveRequirements(school([{ ...fact(A("min_gpa"), "3.0"), value: undefined as unknown as string }]))).toEqual([]);
  });

  it("derives sound rules for every school in the published dataset", () => {
    const parsed = parseApplicationSchoolDataset(JSON.parse(readFileSync("public/application-schools.json", "utf8")), new Date("2026-09-24T12:00:00Z"));
    if (!parsed.ok) throw new Error("dataset invalid");
    let total = 0;
    for (const entry of parsed.dataset.schools) {
      const rules = deriveRequirements(entry);
      total += rules.length;
      expect(new Set(rules.map(rule => rule.id)).size).toBe(rules.length);
      for (const rule of rules) {
        expect(rule.evidence.length).toBeGreaterThan(0);
        expect(rule.evidence.every(item => item.revision && /^https?:\/\//.test(item.url))).toBe(true);
        expect(rule.interpretation.trim()).not.toBe("");
        if (rule.threshold !== undefined) {
          const gpa = rule.kind !== "mcat-minimum";
          expect(gpa ? rule.threshold >= 2 && rule.threshold <= 4 : rule.threshold >= 472 && rule.threshold <= 528).toBe(true);
        }
        if (rule.strength === "conditional" && rule.kind.endsWith("minimum")) expect(rule.variants?.length).toBeGreaterThan(0);
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(parsed.dataset.schools.filter(entry => !entry.researchFacts?.length).every(entry => deriveRequirements(entry).length === 0)).toBe(true);
  });
});
