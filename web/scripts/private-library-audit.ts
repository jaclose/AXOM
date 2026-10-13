import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { assessBank } from "../src/lib/question-content/assessBank";
import { readManifest, readQuestionsFile } from "../src/lib/question-content/packageJson";
import type { PackageIssue } from "../src/lib/question-content/package";
import type { SourceMapping } from "../src/lib/course-engine/sourceMapping";
import type { PreparedBank, PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";

interface InventoryEntry { root: string; path: string; sha256: string; mapping: SourceMapping; }
type Integrity = "verified" | "missing" | "changed" | "lfs-pointer";
const unassigned = "Unassigned";
const cleanHash = (value: string) => value.replace(/^sha256:/, "");

/** Count evidence, never turn a quiz number or module-wide fallback into a week. */
export function auditScope(source: PrivateLibraryCatalog["sources"][number], mapping?: SourceMapping) {
  const conflicts = mapping?.conflicts.length ?? 0;
  return {
    term: !conflicts && mapping?.term ? mapping.term.value : unassigned,
    module: !conflicts ? mapping?.module?.value ?? source.module ?? unassigned : unassigned,
    week: !conflicts && mapping?.week && !mapping.weekEnd ? mapping.week.value : null,
    weekEnd: mapping?.weekEnd ?? null,
    // The inventory records literal week numbers, not their calendar basis.
    weekBasis: "unconfirmed" as const,
    sourceKind: /\bimcq/i.test(source.name) ? "IMCQ" : /\be[ -]?soft/i.test(source.name) ? "eSOFT"
      : mapping?.activity?.value === "pq" || /\bpqs?\b|practice questions?/i.test(source.name) ? "PQ" : "Course material",
    requiresMappingReview: !!conflicts || !mapping?.week || !!mapping.weekEnd || mapping.status !== "mapped",
  };
}

export async function auditPrivateLibrary(root: string, inventoryFile: string) {
  const base = await realpath(root);
  const catalog = JSON.parse(await readFile(resolve(base, "catalog.json"), "utf8")) as PrivateLibraryCatalog;
  const inventory = JSON.parse(await readFile(inventoryFile, "utf8")) as { entries: InventoryEntry[] };
  const byPath = new Map(inventory.entries.map(entry => [entry.path, entry]));
  const integrity = new Map<string, Promise<Integrity>>();
  async function localPath(relative: string) {
    const file = await realpath(resolve(base, relative));
    if (!file.startsWith(`${base}${sep}`)) throw new Error("A collection path escapes its private folder.");
    return file;
  }
  function verify(file: string, expected: string): Promise<Integrity> {
    const key = `${file}:${expected}`;
    if (!integrity.has(key)) integrity.set(key, (async () => {
      try {
        const hash = createHash("sha256"); let first = true; let pointer = false;
        for await (const chunk of createReadStream(file)) {
          if (first) { pointer = Buffer.from(chunk).subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/v1"); first = false; }
          hash.update(chunk);
        }
        return pointer ? "lfs-pointer" : hash.digest("hex") === cleanHash(expected) ? "verified" : "changed";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw error;
      }
    })());
    return integrity.get(key)!;
  }
  const rows = [];
  for (const source of catalog.sources) {
    const entry = byPath.get(source.sourcePath);
    const mapping = auditScope(source, entry?.mapping);
    const original = entry ? await verify(resolve(dirname(entry.root), entry.path), entry.sha256) : "missing";
    let portable: Integrity | "not-packaged" = "not-packaged";
    const problems: string[] = [];
    if (source.originalFile) {
      try { portable = await verify(await localPath(source.originalFile), source.checksum); }
      catch { portable = "missing"; problems.push("Portable original is missing or outside the collection."); }
    }
    let ready = 0, held = 0, assets = 0, verifiedAssets = 0;
    let assignedWeek: number | null = null;
    let assignedTerm: number | null = null;
    if (source.bankFile && source.status !== "duplicate-linked") {
      try {
        const bank = JSON.parse(await readFile(await localPath(source.bankFile), "utf8")) as PreparedBank;
        const issues: PackageIssue[] = [...bank.issues];
        const manifest = readManifest(bank.pkg.manifest, issues);
        const parsed = readQuestionsFile({ schemaVersion: 1, bankId: manifest?.bank.id, questions: bank.pkg.questions }, issues);
        if (!manifest || !parsed) throw new Error("Prepared package could not be read.");
        assignedWeek = manifest.course.week || null; assignedTerm = manifest.course.term || null;
        const files: Array<{ name: string }> = [];
        for (const asset of new Map(parsed.questions.flatMap(q => q.assets).map(a => [a.filename, a])).values()) {
          assets++;
          try {
            const file = await localPath(`${dirname(source.bankFile)}/assets/${asset.filename}`);
            if (asset.checksum && await verify(file, asset.checksum) === "verified") { files.push({ name: asset.filename }); verifiedAssets++; }
            else problems.push("An image has no valid matching checksum.");
          } catch { problems.push("An image is missing or outside the collection."); }
        }
        const assessed = assessBank({ manifest, questions: parsed.questions }, issues, files);
        ready = assessed.counts.ready;
        held = assessed.counts["needs-review"] + assessed.counts.unresolved + bank.pkg.questions.length - parsed.questions.length + (bank.unreadableQuestions ?? 0);
        if (assessed.issues.some(i => i.severity === "error" && !i.questionId)) { held += ready; ready = 0; problems.push("Package-level validation error."); }
      } catch (error) { problems.push(error instanceof Error ? error.message : "Bank audit failed."); }
    }
    rows.push({ id: source.id, sourcePath: source.sourcePath, status: source.status, mapping, assignedTerm, assignedWeek,
      weekAssignmentNeedsReview: assignedWeek !== null && assignedWeek !== mapping.week,
      original, portable, ready, held, reportedReady: source.ready, reportedHeld: source.review,
      assets, verifiedAssets, duplicateOf: source.duplicateOf, problems });
  }
  const groups = new Map<string, { term: string; module: string; week: number | null; kind: string; sources: number; ready: number; held: number }>();
  for (const row of rows) {
    const key = JSON.stringify([row.mapping.term, row.mapping.module, row.mapping.week, row.mapping.sourceKind]);
    const group = groups.get(key) ?? { term: row.mapping.term, module: row.mapping.module, week: row.mapping.week, kind: row.mapping.sourceKind, sources: 0, ready: 0, held: 0 };
    group.sources++; group.ready += row.ready; group.held += row.held; groups.set(key, group);
  }
  return { auditedAt: new Date().toISOString(), catalogVersion: catalog.version,
    summary: { sources: rows.length, inventoryEntries: inventory.entries.length, templates: catalog.templates.length,
      ready: rows.reduce((n,r) => n + r.ready, 0), held: rows.reduce((n,r) => n + r.held, 0),
      originalsVerified: rows.filter(r => r.original === "verified").length,
      missingOriginals: rows.filter(r => r.original === "missing" || r.original === "lfs-pointer").length,
      changedOriginals: rows.filter(r => r.original === "changed").length,
      duplicateLinked: rows.filter(r => r.status === "duplicate-linked").length,
      mappingReview: rows.filter(r => r.mapping.requiresMappingReview).length,
      questionableWeekAssignments: rows.filter(r => r.weekAssignmentNeedsReview).length,
      rowsWithProblems: rows.filter(r => r.problems.length).length,
      published: "Not audited. Local availability does not establish publication." },
    groups: [...groups.values()], sources: rows };
}
