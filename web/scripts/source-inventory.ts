// ===========================================================================
// Inventory local source folders without copying or changing anything in them.
// For every file: identity (path, size, SHA-256), what its name says it is
// (term, module, week, activity, answer variant) and how sure that reading is.
// The manifest goes under artifacts/, which git ignores: it lists private
// course material by name and must stay on this machine.
//
//   npm run sources:inventory -- --roots ../artifacts/source-inventory/roots.json \
//     --templates "/path/to/templates" [--deep-sample 12] [--workspace backup.json]
//
// roots.json is a JSON array of folder paths.
// ===========================================================================
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { inferSourceMapping, termKey, type SourceMapping } from "../src/lib/course-engine/sourceMapping.ts";
import { parseCourseTemplate, planCourseTemplate, templateModules, type CourseTemplateSection } from "../src/lib/course-engine/templateParse.ts";
import { buildVocabulary, moduleKey, type ModuleVocabulary } from "../src/lib/course-engine/vocabulary.ts";

interface DeepRead {
  pages: number;
  textCharacters: number;
  questionCountEstimate: number;
  optionLines: number;
  imagePages: number;
  note?: string;
}

interface ManifestEntry {
  root: string;
  path: string;
  fileName: string;
  extension: string;
  size: number;
  sha256: string;
  mapping: SourceMapping;
  /** Another file with the same bytes; the first one found is the original. */
  duplicateOf?: string;
  /** The same quiz in its other form (with answers, or questions only). */
  pairedWith?: string;
  importStatus: "imported" | "not-imported" | "unknown";
  deep?: DeepRead;
}

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const outDir = resolve(option("out") ?? "../artifacts/source-inventory");
const rootsFile = option("roots");
const roots: string[] = rootsFile
  ? JSON.parse(readFileSync(resolve(rootsFile), "utf8"))
  : args.filter((value) => value.startsWith("/"));
if (!roots.length) {
  console.error("Give the folders to inventory: --roots <roots.json>, or list absolute paths.");
  process.exit(1);
}

// --- vocabulary: module codes come from the learner's own templates --------
const templateDir = option("templates");
const sections: CourseTemplateSection[] = templateDir && existsSync(templateDir)
  ? readdirSync(templateDir).filter((name) => name.endsWith(".txt")).sort()
      .map((name) => parseCourseTemplate(readFileSync(join(templateDir, name), "utf8"), name))
  : [];
const extraModules: ModuleVocabulary[] = (option("modules") ?? "")
  .split(",").map((code) => code.trim()).filter(Boolean).map((code) => ({ code }));

// --- walk and hash ------------------------------------------------------------
function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function sha256(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done(hash.digest("hex")))
      .on("error", fail);
  });
}

const missingRoots = roots.filter((root) => !existsSync(root));
const files = roots.flatMap((root) => (existsSync(root) ? walk(root).map((file) => ({ root, file })) : []));
// The root's own name is evidence too ("RHPS Wk1-2"), so paths start at its parent.
const pathOf = (root: string, file: string) => relative(dirname(root), file);

// A module's term is learned from the corpus: a path that names both a term
// and a module ties them together. No course map is built into this script.
function learnTerms(modules: ModuleVocabulary[]): ModuleVocabulary[] {
  const bare = buildVocabulary(modules);
  const votes = new Map<string, Map<string, number>>();
  for (const { root, file } of files) {
    const mapping = inferSourceMapping(pathOf(root, file), bare);
    // A folder that holds a module's files is evidence. A file name that lists
    // several terms ("Cumulative T1, T2, T3 ...") is not.
    if (!mapping.module || !mapping.term || mapping.module.confidence < 0.8) continue;
    if (!mapping.term.evidence.startsWith("folder")) continue;
    const key = moduleKey(mapping.module.value);
    const tally = votes.get(key) ?? new Map<string, number>();
    tally.set(mapping.term.value, (tally.get(mapping.term.value) ?? 0) + 1);
    votes.set(key, tally);
  }
  return modules.map((module) => {
    const [winner, runnerUp] = [...(votes.get(moduleKey(module.code)) ?? [])].sort((a, b) => b[1] - a[1]);
    // Only a clear majority counts; a split is left unknown.
    const clear = winner && winner[1] >= 3 && (!runnerUp || winner[1] >= runnerUp[1] * 3);
    return clear ? { ...module, term: module.term ?? winner[0] } : module;
  });
}

const vocabulary = buildVocabulary(learnTerms([...templateModules(sections), ...extraModules]));

// --- optional: which files a workspace backup already holds -----------------
const workspaceFile = option("workspace");
const importedChecksums = new Set<string>();
if (workspaceFile && existsSync(workspaceFile)) {
  const backup = JSON.parse(readFileSync(workspaceFile, "utf8")) as { documents?: Array<{ checksum?: string }> };
  for (const document of backup.documents ?? []) {
    if (document.checksum) importedChecksums.add(document.checksum.toLowerCase());
  }
}

const entries: ManifestEntry[] = [];
const firstByHash = new Map<string, string>();
for (const { root, file } of files) {
  const hash = await sha256(file);
  const path = pathOf(root, file);
  const entry: ManifestEntry = {
    root,
    path,
    fileName: basename(file),
    extension: extname(file).slice(1).toLowerCase(),
    size: statSync(file).size,
    sha256: hash,
    mapping: inferSourceMapping(path, vocabulary),
    importStatus: workspaceFile ? (importedChecksums.has(hash) ? "imported" : "not-imported") : "unknown",
  };
  const original = firstByHash.get(hash);
  if (original) entry.duplicateOf = original;
  else firstByHash.set(hash, path);
  entries.push(entry);
}

// --- pair the two forms of one quiz -----------------------------------------
function quizKey(entry: ManifestEntry): string | undefined {
  const { module, activity, number, week } = entry.mapping;
  if (!module || !activity || (number === undefined && !week)) return undefined;
  return [moduleKey(module.value), activity.value, number ?? `w${week!.value}`].join("|");
}
const answered = new Map<string, ManifestEntry>();
for (const entry of entries) {
  const key = quizKey(entry);
  if (key && !entry.duplicateOf && entry.mapping.variant === "with-answers" && !answered.has(key)) answered.set(key, entry);
}
for (const entry of entries) {
  const key = quizKey(entry);
  const partner = key ? answered.get(key) : undefined;
  if (partner && entry.mapping.variant === "questions-only" && !entry.duplicateOf) {
    entry.pairedWith = partner.path;
    partner.pairedWith ??= entry.path;
  }
}

// --- optional: look inside a spread of PDFs ---------------------------------
const deepSample = Number(option("deep-sample") ?? 0);
if (deepSample > 0) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const candidates = entries.filter((entry) => entry.extension === "pdf" && !entry.duplicateOf && entry.size < 25 * 1024 * 1024);
  // Spread the sample across activities and modules instead of taking the first N.
  const buckets = new Map<string, ManifestEntry[]>();
  for (const entry of candidates) {
    const bucket = `${entry.mapping.activity?.value ?? "none"}|${entry.mapping.module?.value ?? "none"}`;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
  }
  // Question sources first: they are what the import engine has to read.
  const questionFirst = [...buckets.entries()]
    .sort(([left], [right]) => Number(/^(?:pq|imcq|esoft)\|/.test(right)) - Number(/^(?:pq|imcq|esoft)\|/.test(left)))
    .map(([, bucket]) => bucket);
  const picked: ManifestEntry[] = [];
  for (let round = 0; picked.length < deepSample && round < 50; round += 1) {
    for (const bucket of questionFirst) {
      if (bucket[round] && picked.length < deepSample) picked.push(bucket[round]);
    }
  }
  for (const entry of picked) {
    try {
      const data = new Uint8Array(readFileSync(join(dirname(entry.root), entry.path)));
      const loading = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
      const document = await loading.promise;
      let text = "";
      let imagePages = 0;
      const pages = Math.min(document.numPages, 60);
      for (let number = 1; number <= pages; number += 1) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        let line = "";
        let lastY: number | undefined;
        for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
          const y = item.transform?.[5];
          if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2) { text += `${line}\n`; line = ""; }
          line += item.str ?? "";
          lastY = y;
        }
        text += `${line}\n`;
        const operators = await page.getOperatorList();
        if (operators.fnArray.some((fn: number) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject)) imagePages += 1;
      }
      const lines = text.split("\n").map((value) => value.trim());
      const optionLines = lines.filter((value) => /^\(?[A-H][.)]\s+\S/.test(value)).length;
      const numbered = lines.filter((value) => /^(?:question\s*)?\d{1,3}[.)]\s+\S{3,}/i.test(value)).length;
      entry.deep = {
        pages: document.numPages,
        textCharacters: text.replace(/\s+/g, "").length,
        // Numbered stems when the file numbers them, else one question per run of options.
        questionCountEstimate: numbered >= 2 ? numbered : Math.round(optionLines / 4.5),
        optionLines,
        imagePages,
        note: document.numPages > pages ? `Only the first ${pages} pages were read.` : undefined,
      };
      await loading.destroy();
    } catch (error) {
      entry.deep = {
        pages: 0, textCharacters: 0, questionCountEstimate: 0, optionLines: 0, imagePages: 0,
        note: `Could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }
}

// --- write + summarize ------------------------------------------------------
function tally<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

const unique = entries.filter((entry) => !entry.duplicateOf);
const moduleGroups = new Map<string, CourseTemplateSection[]>();
for (const section of sections) {
  moduleGroups.set(moduleKey(section.module), [...(moduleGroups.get(moduleKey(section.module)) ?? []), section]);
}
const templates = [...moduleGroups.values()].map((group) => {
  const term = termKey(vocabulary.modules.find((module) => moduleKey(module.code) === moduleKey(group[0].module))?.term);
  const plan = planCourseTemplate(group, { term });
  return {
    module: plan.module,
    term: plan.term ?? null,
    items: plan.items.length,
    weeks: plan.weekCount ?? null,
    groups: group.map((section) => section.groupCount),
    byActivity: tally(plan.items, (item) => item.activity),
    weekBasis: tally(plan.items, (item) => item.weekBasis),
    problems: plan.problems,
  };
});

// The weeks each module's own files name, which is how a template's "week 1"
// is tied to the week of the term it falls in.
const statedWeeks: Record<string, number[]> = {};
for (const entry of unique) {
  if (!entry.mapping.module || !entry.mapping.week || entry.mapping.module.confidence < 0.8) continue;
  const weeks = statedWeeks[entry.mapping.module.value] ?? [];
  const last = entry.mapping.weekEnd ?? entry.mapping.week.value;
  for (let week = entry.mapping.week.value; week <= last; week += 1) {
    if (!weeks.includes(week)) weeks.push(week);
  }
  statedWeeks[entry.mapping.module.value] = weeks.sort((a, b) => a - b);
}

const summary = {
  generatedAt: new Date().toISOString(),
  roots: roots.map((root) => ({ root, files: entries.filter((entry) => entry.root === root).length, missing: missingRoots.includes(root) })),
  files: entries.length,
  uniqueFiles: unique.length,
  duplicateFiles: entries.length - unique.length,
  megabytes: Math.round(entries.reduce((total, entry) => total + entry.size, 0) / 1048576),
  uniqueMegabytes: Math.round(unique.reduce((total, entry) => total + entry.size, 0) / 1048576),
  byExtension: tally(unique, (entry) => entry.extension || "(none)"),
  byStatus: tally(unique, (entry) => entry.mapping.status),
  byActivity: tally(unique, (entry) => entry.mapping.activity?.value ?? "(none)"),
  byModule: tally(unique, (entry) => entry.mapping.module?.value ?? "(none)"),
  byTerm: tally(unique, (entry) => entry.mapping.term?.value ?? "(none)"),
  withWeek: unique.filter((entry) => entry.mapping.week).length,
  pairedQuizzes: unique.filter((entry) => entry.pairedWith && entry.mapping.variant === "with-answers").length,
  referenceCandidates: unique.filter((entry) => entry.mapping.referenceCandidate).length,
  conflicts: unique.filter((entry) => entry.mapping.conflicts.length).length,
  importStatus: tally(unique, (entry) => entry.importStatus),
  vocabulary: vocabulary.modules.map((module) => `${module.code}${module.term ? ` (${termKey(module.term)})` : ""}`),
  statedWeeks,
  templates,
  deepSampled: entries.filter((entry) => entry.deep).length,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ summary, entries }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nManifest: ${join(outDir, "manifest.json")} (private: it names course files; artifacts/ is ignored by git)`);
