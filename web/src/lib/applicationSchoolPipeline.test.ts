import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "application-school-pipeline.mjs");
const now = "2026-08-11T00:00:00Z";

function run(args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });
}

function dataset(schools: unknown[], generatedAt = "2026-08-10T12:00:00Z") {
  return { schemaVersion: 2, generatedAt, recordCount: schools.length, schools };
}

describe("application school pipeline CLI", () => {
  it("reports a safe partial dataset and writes normalized JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const input = join(directory, "export.json");
      const output = join(directory, "normalized.json");
      writeFileSync(input, JSON.stringify(dataset([
        {
          id: "one", canonicalName: "One Medical School", verificationStatus: "verified",
          sources: [{ url: "https://one.example.edu/admissions", retrievedAt: "2026-08-10T10:00:00Z" }],
        },
        { id: "two", canonicalName: "Two Medical School", verificationStatus: "unknown", sources: [] },
      ])));
      const result = run(["validate", input, "--now", now, "--output", output]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PASS: School dataset validation");
      expect(result.stdout).toContain("valid: 2");
      expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ schemaVersion: 2, recordCount: 2 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses unsafe input and reports the reason without writing output", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const input = join(directory, "unsafe.json");
      const output = join(directory, "should-not-exist.json");
      writeFileSync(input, JSON.stringify(dataset([
        { id: "bad", canonicalName: "Bad School", verificationStatus: "verified", sources: [{ url: "not-a-url", retrievedAt: "2026-08-10T10:00:00Z" }] },
        { id: "bad", canonicalName: "Duplicate School", verificationStatus: "unknown", sources: [] },
      ])));
      const result = run(["validate", input, "--now", now, "--output", output]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rejected: 2");
      expect(result.stdout).toMatch(/ERROR:.*Source URL/);
      expect(result.stdout).toMatch(/ERROR:.*Duplicate school ID/);
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("merges an incremental export while preserving conflicts and provenance", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const base = join(directory, "base.json");
      const incoming = join(directory, "incoming.json");
      const output = join(directory, "merged.json");
      writeFileSync(base, JSON.stringify(dataset([{
        id: "one", canonicalName: "One Medical School", degree: "MD", verificationStatus: "verified",
        sources: [{ url: "https://one.example.edu/admissions", retrievedAt: "2026-08-09T10:00:00Z" }],
      }])));
      writeFileSync(incoming, JSON.stringify(dataset([{
        id: "one", canonicalName: "One Medical School", degree: "DO", tuition: "$50k", verificationStatus: "verified",
        sources: [{ url: "https://one.example.edu/fees", retrievedAt: "2026-08-10T10:00:00Z" }],
      }], "2026-08-10T13:00:00Z")));
      const result = run(["merge", base, incoming, "--now", now, "--output", output]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("preserved 1 field conflict");
      const merged = JSON.parse(readFileSync(output, "utf8"));
      expect(merged.schools[0]).toMatchObject({ degree: "MD", tuition: "$50k", verificationStatus: "conflicting" });
      expect(merged.schools[0].sources).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps stdout machine-readable when merge output is redirected", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const base = join(directory, "base.json");
      const incoming = join(directory, "incoming.json");
      const school = { id: "one", canonicalName: "One Medical School", verificationStatus: "unknown", sources: [] };
      writeFileSync(base, JSON.stringify(dataset([school])));
      writeFileSync(incoming, JSON.stringify(dataset([])));
      const result = run(["merge", base, incoming, "--now", now]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 2, recordCount: 1 });
      expect(result.stderr).toContain("PASS: Base dataset validation");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("diffs two runs, names changed facts and counts reopened review checks", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const base = join(directory, "base.json");
      const incoming = join(directory, "incoming.json");
      const fact = (id: string, value: string) => ({ id, label: id, value, url: "https://one.example.edu/requirements", capturedAt: "2026-08-01T00:00:00Z", captureStatus: "unverified-capture" });
      const school = (id: string, researchFacts: unknown[], extra = {}) => ({ id, canonicalName: `School ${id}`, verificationStatus: "incomplete", sources: [], researchFacts, ...extra });
      writeFileSync(base, JSON.stringify(dataset([school("one", [fact("admissions_requirements_raw.min_gpa", "3.0")]), school("gone", [])])));
      writeFileSync(incoming, JSON.stringify(dataset([
        school("one", [fact("admissions_requirements_raw.min_gpa", "3.2"), fact("cost_financial_aid_raw.tuition_flat", "$60,000")], {
          estimates: { hours: {}, confidence: "low", disclaimer: "ESTIMATE: directional only.", estimatedAt: "2026-08-01T00:00:00Z" },
        }),
        school("new", []),
      ])));
      const result = run(["diff", base, incoming, "--now", now]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("schools: +1 added, -1 removed");
      expect(result.stdout).toContain("facts: +1 added, -0 removed, 1 changed");
      expect(result.stdout).toContain("review checks reopened: 1");
      expect(result.stdout).toContain("estimate changes: 1 school(s)");
      expect(result.stdout).toContain('one admissions_requirements_raw.min_gpa [value]: "3.0" -> "3.2"');
      expect(result.stdout).toContain("cost_financial_aid_raw.tuition_flat: 1 school(s)");
      const json = run(["diff", base, incoming, "--now", now, "--json"]);
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({
        addedSchools: ["new"], removedSchools: ["gone"], reviewChecksReopened: 1, estimateChanges: ["one"], statChanges: [],
        changedFacts: [{ schoolId: "one", factId: "admissions_requirements_raw.min_gpa", fields: ["value"] }],
        addedFacts: [{ schoolId: "one", factId: "cost_financial_aid_raw.tuition_flat" }],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("counts implausible numbers as impossible numeric fields and only future-dated evidence as future", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const input = join(directory, "export.json");
      const stat = (overrides: Record<string, unknown>) => ({ id: "admissions_requirements_raw.mcat_avg", label: "Reported class MCAT", metric: "mcat", kind: "average",
        value: "510", number: 510, url: "https://one.example.edu/facts", capturedAt: "2026-08-01T00:00:00Z", basis: "unverified-capture", ...overrides });
      writeFileSync(input, JSON.stringify(dataset([{
        id: "one", canonicalName: "One Medical School", verificationStatus: "incomplete", sources: [],
        reportedStats: [stat({ number: 600 }), stat({ capturedAt: "not-a-date" }), stat({ capturedAt: "2026-07-01" })],
        estimates: { competitiveMcat: { value: 700, basis: "SCHOOL_DATA_IN_FILE" }, hours: {}, confidence: "low", disclaimer: "ESTIMATE: directional only.", estimatedAt: "2026-08-01T00:00:00Z" },
      }])));
      const result = run(["validate", input, "--now", now]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("impossible numeric fields: 2");
      expect(result.stdout).toContain("future timestamps: 0");
      expect(result.stdout).toContain("2 reported statistic(s) with an unsafe link, invalid date or unknown basis were rejected.");

      writeFileSync(input, JSON.stringify(dataset([{
        id: "one", canonicalName: "One Medical School", verificationStatus: "incomplete", sources: [], reportedStats: [stat({ capturedAt: "2026-09-01T00:00:00Z" })],
      }])));
      const future = run(["validate", input, "--now", now]);
      expect(future.stdout).toContain("future timestamps: 1");
      expect(future.stdout).toContain("impossible numeric fields: 0");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lists reported statistic changes in the diff", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const base = join(directory, "base.json");
      const incoming = join(directory, "incoming.json");
      const stat = (basis: string) => ({ id: "admissions_requirements_raw.avg_gpa", label: "Reported class GPA", metric: "gpa", kind: "average",
        value: "3.83 (Class of 2029, per search digest of official facts)", number: 3.83, url: "https://one.example.edu/facts", capturedAt: "2026-08-01T00:00:00Z", basis });
      const school = (reportedStats: unknown[]) => ({ id: "one", canonicalName: "One Medical School", verificationStatus: "incomplete", sources: [], reportedStats });
      writeFileSync(base, JSON.stringify(dataset([school([stat("official-capture")])])));
      writeFileSync(incoming, JSON.stringify(dataset([school([stat("unverified-capture")])])));
      const result = run(["diff", base, incoming, "--now", now]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("reported statistics: 1 -> 1 (1 added, removed or changed)");
      expect(result.stdout).toContain("one admissions_requirements_raw.avg_gpa changed [basis]");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to diff an unsafe dataset", () => {
    const directory = mkdtempSync(join(tmpdir(), "axom-schools-"));
    try {
      const base = join(directory, "base.json");
      const unsafe = join(directory, "unsafe.json");
      writeFileSync(base, JSON.stringify(dataset([])));
      writeFileSync(unsafe, JSON.stringify(dataset([{ id: "bad", canonicalName: "Bad School", verificationStatus: "verified", sources: [{ url: "not-a-url", retrievedAt: "2026-08-10T10:00:00Z" }] }])));
      const result = run(["diff", base, unsafe, "--now", now, "--json"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("diff refused");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the documented command runnable from the repository root", () => {
    const output = execFileSync("npm", ["run", "schools:validate", "--", "--help"], { encoding: "utf8", cwd: join(process.cwd(), "..") });
    expect(output).toContain("npm run schools:validate");
    expect(execFileSync("npm", ["run", "schools:diff", "--", "--help"], { encoding: "utf8", cwd: join(process.cwd(), "..") })).toContain("npm run schools:diff");
  });
});
