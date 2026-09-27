import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSchool, type SchoolCheckResult } from "./applicationChecker";
import type { ApplicationProfile } from "./applicationProfile";
import { parseApplicationSchoolDataset, type ApplicationSchool } from "./applicationSchools";

// End-to-end over the published research: parser + checker on real captured text.
const NOW = new Date("2026-09-24T12:00:00Z");
const parsed = parseApplicationSchoolDataset(JSON.parse(readFileSync("public/application-schools.json", "utf8")), NOW);
if (!parsed.ok) throw new Error("published dataset is invalid");
const schools = parsed.dataset.schools;
const byId = (id: string) => {
  const found = schools.find(entry => entry.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const FORBIDDEN = /eligib|qualify|guarantee|chance|%/i;

const strong: ApplicationProfile = {
  plannedMatriculationYear: 2027, cumulativeGpa: 3.8, scienceGpa: 3.75, mcatTotal: 512, mcatTestDate: "2026-04", mcatAttempts: 1,
  citizenship: "us-citizen", stateOfResidence: "Alabama", degreeStatus: "in-progress", degreeExpectedDate: "2027-05",
  coursework: Object.fromEntries(["biology", "generalChemistry", "organicChemistry", "biochemistry", "physics", "mathStatistics", "english", "behavioralScience"]
    .map(category => [category, { status: "completed", semesterHours: 8 }])),
  activityHours: {},
};
const international: ApplicationProfile = { plannedMatriculationYear: 2027, cumulativeGpa: 2.6, citizenship: "international", coursework: {}, activityHours: {} };
const check = (target: ApplicationSchool, profile: ApplicationProfile | undefined) => checkSchool(target, profile, { now: NOW });
const find = (result: SchoolCheckResult, id: string) => result.checks.find(entry => entry.requirementId === id);

describe("checker over the published dataset", () => {
  it.each([
    ["no profile", undefined],
    ["an empty profile", { coursework: {}, activityHours: {} } as ApplicationProfile],
    ["a strong U.S. applicant", strong],
    ["an international applicant without an MCAT", international],
  ])("runs for every school with %s and keeps its wording honest", (_label, profile) => {
    for (const entry of schools) {
      const result = check(entry, profile);
      expect(result.eligibility.headline).not.toMatch(FORBIDDEN);
      for (const item of result.checks) {
        expect(item.evidence.length).toBeGreaterThan(0);
        expect(item.evidence.every(evidence => /^https?:\/\//.test(evidence.url))).toBe(true);
        if (item.blocking) expect(item.outcome).toBe("does-not-meet");
      }
      if (!entry.researchFacts?.length) expect(result.eligibility.status).toBe("not-enough-information");
      if (!profile || (!profile.plannedMatriculationYear && !profile.cumulativeGpa)) {
        expect(result.checks.some(item => item.outcome === "meets" || item.outcome === "on-track")).toBe(false);
      }
    }
  });

  it("blocks a GPA below a hard captured minimum and names both numbers", () => {
    const result = check(byId("S0164"), { ...international, citizenship: "us-citizen", stateOfResidence: "Alabama" });
    expect(find(result, "gpa-minimum")).toMatchObject({ outcome: "does-not-meet", blocking: true, yourValue: "2.60", schoolValue: "3.00 minimum" });
    expect(result.eligibility.status).toBe("possible-blocker");
    expect(result.eligibility.headline).toMatch(/2\.60.*3\.00/);
  });

  it("applies the in-state or out-of-state MCAT figure by residence", () => {
    const uams = byId("S0007");
    const arkansan = check(uams, { ...strong, mcatTotal: 502, stateOfResidence: "Arkansas" });
    expect(find(arkansan, "mcat-minimum")).toMatchObject({ outcome: "meets" });
    const alabaman = check(uams, { ...strong, mcatTotal: 502, stateOfResidence: "Alabama" });
    expect(find(alabaman, "mcat-minimum")).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(find(alabaman, "state-residency")).toMatchObject({ outcome: "below-recommended", blocking: false });
  });

  it("reads residency preference and ties for a Puerto Rico school without blocking", () => {
    const result = check(byId("S0128"), strong);
    const residency = find(result, "state-residency");
    expect(residency).toMatchObject({ outcome: "below-recommended", blocking: false, schoolValue: "Prefers residents of Puerto Rico" });
    expect(residency?.explanation).toMatch(/ties/);
  });

  it("exempts international applicants where the evidence says so, and blocks where it excludes them", () => {
    expect(find(check(byId("S0244"), international), "mcat-required")).toMatchObject({ outcome: "not-applicable" });
    expect(find(check(byId("S0269"), international), "mcat-required")).toMatchObject({ outcome: "not-applicable" });
    const excluded = check(byId("S0002"), international);
    expect(find(excluded, "citizenship")).toMatchObject({ outcome: "does-not-meet", blocking: true });
    expect(excluded.eligibility.status).toBe("possible-blocker");
  });

  it("treats an MCAT window for an earlier entering class as a review item, not a pass", () => {
    const result = check(byId("S0013"), strong);
    const recency = find(result, "mcat-recency");
    expect(recency?.outcome).toBe("needs-review");
    expect(recency?.explanation).toMatch(/2026 entering class/);
  });

  it("flags unverified evidence on a blocker headline", () => {
    const result = check(byId("S0164"), { ...international, citizenship: "us-citizen" });
    const gpa = find(result, "gpa-minimum");
    if (gpa?.unverifiedEvidence) expect(result.eligibility.headline).toContain("unverified");
  });

  it("gives a strong applicant at least one school with no blockers, and never a false blocker on estimates", () => {
    const results = schools.map(entry => check(entry, strong));
    expect(results.some(result => result.eligibility.status === "no-blockers-found" || result.eligibility.status === "needs-review")).toBe(true);
    for (const result of results) {
      for (const item of result.checks.filter(entry => entry.blocking)) {
        expect(["gpa-minimum", "science-gpa-minimum", "mcat-minimum", "mcat-recency", "citizenship", "state-residency", "degree", "coursework"]).toContain(item.kind);
      }
    }
  });
});
