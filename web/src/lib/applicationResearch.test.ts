import { describe, expect, it } from "vitest";
import { normalizeApplicationResearch, normalizeResearchFacts, researchFactRevision, researchValue, type SchoolResearchFact } from "./applicationResearch";
import { parseApplicationSchoolDataset, mergeApplicationSchoolDatasets } from "./applicationSchools";
import { mergeStates, parseImport, toPortableState } from "./backup";
import { makeSeed } from "./seed";
import { migratePersistedState } from "./store";
import { readFileSync } from "node:fs";
const dataset: unknown = JSON.parse(readFileSync("public/application-schools.json", "utf8"));

const fact: SchoolResearchFact = { id: "mcat", label: "MCAT", value: "Read cycle exceptions", url: "https://example.edu/requirements", capturedAt: "2026-07-19T00:00:00Z", captureStatus: "unverified-capture" };
const now = new Date("2026-09-22T12:00:00Z");

describe("application research", () => {
  it("loads all canonical school records without certifying historical captures", () => {
    const result = parseApplicationSchoolDataset(dataset, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toEqual([]);
    const schools = result.dataset.schools;
    const facts = schools.flatMap(s => s.researchFacts ?? []);
    expect(result.dataset.sourcePipelineVersion).toBe("phase1-research-adapter-v2");
    expect(schools).toHaveLength(292);
    expect(schools.filter(s => s.researchFacts?.length)).toHaveLength(60);
    expect(facts).toHaveLength(1766);
    expect(schools.flatMap(s => s.reportedStats ?? [])).toHaveLength(105);
    expect(schools.filter(s => s.riskFlag)).toHaveLength(15);
    expect(schools.some(s => s.verificationStatus === "verified")).toBe(false);
    expect(schools.some(s => ["S0235", "S0261"].includes(s.id))).toBe(false);
    expect(JSON.stringify(dataset)).not.toMatch(/est_lizzym|est_research_hours|admissions_email/);
    expect(facts.filter(f => /third[- ]party|aggregator/i.test(f.value))).toEqual([]);
    // field_provenance_raw source_type names a third party (P00151, P00160, P00165).
    const has = (id: string, factId: string) => schools.find(s => s.id === id)!.researchFacts!.some(f => f.id === factId);
    expect([has("S0193", "admissions_requirements_raw.min_gpa"), has("S0018", "cost_financial_aid_raw.tuition_in_state"), has("S0006", "cost_financial_aid_raw.tuition_flat")]).toEqual([false, false, false]);
  });
  it("never offers thresholds, ranges or repeated minimums as benchmarks and needs official provenance for official stats", () => {
    const result = parseApplicationSchoolDataset(dataset, now);
    if (!result.ok) throw Error("Invalid dataset");
    const byId = new Map(result.dataset.schools.map(s => [s.id, s]));
    const stats = result.dataset.schools.flatMap(s => s.reportedStats ?? []);
    // No Phase 1 stat has a matching OFFICIAL_VERIFIED provenance row, so none is an official-page capture.
    expect(stats.filter(stat => stat.basis === "official-capture")).toEqual([]);
    expect(stats.filter(stat => stat.floorLike)).toHaveLength(22);
    const stat = (id: string, field: string) => byId.get(id)!.reportedStats!.find(entry => entry.id === `admissions_requirements_raw.${field}`)!;
    expect([stat("S0036", "mcat_competitive").floorLike, stat("S0173", "competitive_science_gpa").floorLike, stat("S0165", "mcat_competitive").floorLike,
      stat("S0170", "competitive_gpa").floorLike, stat("S0189", "avg_gpa").floorLike, stat("S0013", "avg_gpa").basis]).toEqual([true, true, true, true, undefined, "unverified-capture"]);
    const floor = (id: string, key: "competitiveGpa" | "competitiveMcat") => byId.get(id)!.estimates![key]!.floorBased;
    expect([floor("S0166", "competitiveGpa"), floor("S0191", "competitiveGpa"), floor("S0234", "competitiveGpa"), floor("S0269", "competitiveGpa"), floor("S0239", "competitiveGpa"),
      floor("S0007", "competitiveMcat"), floor("S0259", "competitiveMcat"), floor("S0240", "competitiveMcat")]).toEqual(Array(8).fill(true));
    expect([floor("S0189", "competitiveMcat"), floor("S0013", "competitiveMcat"), floor("S0125", "competitiveGpa")]).toEqual([false, false, false]);
    // Number-free MCAT policy text in mcat_competitive is also a fact, so requirement rules can read it.
    const notes = result.dataset.schools.filter(s => (s.researchFacts ?? []).some(f => f.label === "MCAT policy note")).map(s => s.id);
    expect(notes).toEqual(["S0259", "S0279", "S0280", "S0289"]);
  });
  it("keeps research-team estimates under the estimates key, never as research facts", () => {
    const result = parseApplicationSchoolDataset(dataset, now);
    if (!result.ok) throw Error("Invalid dataset");
    const withEstimates = result.dataset.schools.filter(s => s.estimates);
    expect(withEstimates).toHaveLength(45);
    for (const school of withEstimates) {
      expect(school.estimates!.disclaimer).toMatch(/^ESTIMATE:/);
      expect(school.estimates!.estimatedAt).toBe("2026-07-22T00:00:00Z");
    }
    for (const school of result.dataset.schools) {
      const { estimates: _estimates, ...rest } = school;
      expect(JSON.stringify(rest)).not.toMatch(/ESTIMATE:|PEER_FALLBACK|tierRationale|competitiveGpa|lizzym/i);
      expect((school.researchFacts ?? []).some(f => f.id.startsWith("applicant_profile_estimate_raw"))).toBe(false);
      // Only a number-free policy note (e.g. "MCAT not required…") is published as both a stat and a fact.
      const statIds = new Set((school.reportedStats ?? []).filter(stat => stat.number !== undefined).map(stat => stat.id));
      expect((school.researchFacts ?? []).some(f => statIds.has(f.id))).toBe(false);
      expect((school.researchFacts ?? []).filter(f => (school.reportedStats ?? []).some(stat => stat.id === f.id)).every(f => / policy note$/.test(f.label))).toBe(true);
    }
  });
  it("retains save/review state through normalization, migration and backup restore", () => {
    const seed = makeSeed();
    seed.profile.applicationResearch = [{ schoolId: "S0001", shortlisted: true, reviewedFacts: { mcat: researchFactRevision(fact) } }];
    const migrated = migratePersistedState(seed, seed.schemaVersion);
    expect(migrated.profile.applicationResearch).toEqual(seed.profile.applicationResearch);
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(migrated) }));
    expect(restored.profile.applicationResearch).toEqual(seed.profile.applicationResearch);
    expect(normalizeApplicationResearch(undefined)).toEqual([]);
  });
  it("reopens a research check when a value, capture status or source changes", () => {
    const revision = researchFactRevision(fact);
    expect(researchFactRevision({ ...fact, value: "New policy" })).not.toBe(revision);
    expect(researchFactRevision({ ...fact, capturedAt: "2026-08-01T00:00:00Z" })).not.toBe(revision);
    expect(researchFactRevision({ ...fact, captureStatus: "official-capture" })).not.toBe(revision);
  });
  it("merges new saved schools without restoring deliberately unchecked facts", () => {
    const current = makeSeed(); const incoming = makeSeed();
    current.profile.applicationResearch = [{ schoolId: "one", shortlisted: false, reviewedFacts: {} }];
    incoming.profile.applicationResearch = [{ schoolId: "one", shortlisted: true, reviewedFacts: { mcat: "old" } }, { schoolId: "two", shortlisted: true, reviewedFacts: {} }];
    expect(mergeStates(current, incoming).profile.applicationResearch).toEqual([
      current.profile.applicationResearch[0], incoming.profile.applicationResearch[1],
    ]);
  });
  it("rejects unsafe links and future evidence, keeps unknowns distinct", () => {
    expect(normalizeResearchFacts([fact, { ...fact, url: "javascript:alert(1)" }, { ...fact, capturedAt: "2099-01-01" }], now)).toEqual([fact]);
    expect(researchValue("NOT_PUBLICLY_DISCLOSED")).toContain("Not publicly reported");
    expect(researchValue("None (no minimum)")).toBe("None (no minimum)");
    expect(researchValue("REQUIRES_MANUAL_VERIFICATION")).toContain("manual verification");
  });
  it("merging a phase1-research-adapter-v1 run with the published run keeps the new review-queue conflicts and drops third-party facts", () => {
    const current = parseApplicationSchoolDataset(dataset, now);
    if (!current.ok) throw Error("Invalid dataset");
    // The v1 adapter exported only the state_or_country conflicts (S0234 C0001, S0259 C0002) and kept S0127's third-party-labelled facts.
    const v1 = structuredClone(current.dataset);
    v1.sourcePipelineVersion = "phase1-research-adapter-v1";
    for (const school of v1.schools) {
      const kept = Object.entries(school.conflicts ?? {}).filter(([key]) => key.endsWith(": state_or_country"));
      school.conflicts = kept.length ? Object.fromEntries(kept) : undefined;
      if (school.id === "S0127") school.researchFacts = [...(school.researchFacts ?? []), { id: "admissions_requirements_raw.mcat_min", label: "MCAT minimum (read exceptions)",
        value: "495 (min, third-party)", url: "https://www.uccaribe.edu/medicina/admissions", capturedAt: "2026-07-21T00:00:00Z", captureStatus: "unverified-capture" }];
    }
    const merged = mergeApplicationSchoolDatasets(v1, current.dataset);
    const byId = new Map(merged.dataset.schools.map(s => [s.id, s]));
    const expected: Record<string, string[]> = {
      S0006: ["C0014: tuition_flat"], S0164: ["C0007: tuition_flat"], S0193: ["C0012: tuition"], S0234: ["C0001: state_or_country", "C0004: campus_and_pass_rate"],
      S0236: ["C0008: accreditor_primary"], S0239: ["C0009: accreditation"], S0243: ["C0015: ecfmg_eligible"], S0244: ["C0006: federal_loans"],
      S0259: ["C0002: state_or_country"],
    };
    for (const [id, keys] of Object.entries(expected)) {
      expect(Object.keys(byId.get(id)!.conflicts ?? {})).toEqual(keys);
      expect(byId.get(id)!.verificationStatus).toBe("conflicting");
    }
    expect(merged.conflicts).toBe(8);
    expect(byId.get("S0127")!.researchFacts!.find(f => f.id === "admissions_requirements_raw.mcat_min")).toBeUndefined();
    expect(merged.dataset.schools.flatMap(s => (s.researchFacts ?? []).filter(f => /third[- ]party|aggregator/i.test(f.value)))).toEqual([]);
  });
  it("preserves conflicting research during incremental dataset merges", () => {
    const wrap = (facts: SchoolResearchFact[]) => parseApplicationSchoolDataset({ schemaVersion: 2, generatedAt: now.toISOString(), schools: [{ id: "one", name: "School", verificationStatus: "incomplete", sources: [], researchFacts: facts }] }, now);
    const base = wrap([fact]); const incoming = wrap([{ ...fact, value: "Different policy" }]);
    if (!base.ok || !incoming.ok) throw Error("Invalid fixture");
    const merged = mergeApplicationSchoolDatasets(base.dataset, incoming.dataset);
    expect(merged.conflicts).toBe(1);
    expect(merged.dataset.schools[0].researchFacts).toEqual([fact]);
    expect(merged.dataset.schools[0].conflicts?.mcat).toEqual({ existing: fact.value, incoming: "Different policy" });
  });
});
