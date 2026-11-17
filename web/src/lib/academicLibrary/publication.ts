/**
 * Publish a prepared private library that holds many courses: one academic
 * collection per term and module, each through the existing uploader, batch
 * runner and owner readback. The plan proposes and the reviewer confirms;
 * nothing is filed without evidence, and every source left out is listed with
 * its reason. No second store, cloud catalog or approval path is created.
 */
import { canonicalModuleKey } from "../course-engine/vocabulary";
import { parseCourseTemplate } from "../course-engine/templateParse";
import { SGU_CURRICULUM } from "../curricula";
import { questionScope } from "../question-content/package";
import { sha256 } from "../question-content/assets";
import { hasUniformUnfiledSourceScope, readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { LibraryInputLimits } from "../privateLibrary/inputRoot";
import type { PrivateLibraryCatalog, ReviewedFiling } from "../privateLibrary/types";
import { academicCoursePlan, moduleIdentity, reviewedTermNumber, type AcademicPlanTerm } from "./coursePlan";
import { compareCourses } from "./catalogOrder";
import { prepareAcademicUpload, preflightAcademicUpload } from "./upload";
import { inspectPreparedUploadExplanationsBySource } from "./explanationReview";
import type { AcademicBatchJob } from "./batch";

type Term = ReviewedFiling["term"];
type CatalogSource = PrivateLibraryCatalog["sources"][number];
const TERMS: readonly Term[] = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
const UPLOADABLE_ORIGINALS = new Set(["pdf", "docx", "txt"]);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
/** Publishing reads a library one course at a time, so a whole term's folder
 * may exceed the limits that bound installing everything on this device. */
export const PUBLICATION_INPUT_LIMITS: LibraryInputLimits = { maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 * 1024 };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export interface PublicationSection {
  file: string;
  name: string;
  checksum: string;
  text: string;
  module: string;
  moduleKey: string;
  term?: Term;
  title: string;
  activities: number;
  /** A reason this section cannot be published, when it has one. */
  problem?: string;
}

export interface PublicationSource {
  id: string;
  name: string;
  checksum: string;
  status: CatalogSource["status"];
  reason: string;
  ready: number;
  review: number;
  /** The catalog's own module label, when it has one. */
  moduleKey?: string;
  hasBank: boolean;
  /** Question rows in its package, unreadable rows included, when the package could be read. */
  rows?: number;
  original?: { extension: string };
  /** Term and module read from the question package itself. */
  bank?: { term: Term; module: string; moduleKey: string; reviewedFiling: boolean; reviewedUnfiled?: boolean;
    reviewedOverride?: boolean; humanReviewed?: boolean } | { problem: string };
  duplicateOf?: string;
}

/** Everything the plan needs, read once from the prepared library. */
export interface PublicationInventory {
  library: Pick<PrivateLibraryCatalog, "format" | "schemaVersion" | "id" | "version" | "preparerVersion">;
  sections: PublicationSection[];
  sources: PublicationSource[];
}

export type TermBasis = "plan" | "confirmed" | "proposed" | "questions";

export interface PlannedCourse {
  /** Stable per library and course: publishing again updates the same collection. */
  catalogId: string;
  term: Term;
  module: string;
  moduleKey: string;
  /** How AXOM knows the term. "proposed" needs a reviewer's confirmation. */
  termBasis: TermBasis;
  proposalReason?: string;
  sections: PublicationSection[];
  activities: number;
  sourceIds: string[];
  /** Original-only sources that may stay on this device if the course is too large. */
  optionalSourceIds: string[];
  banks: number;
  ready: number;
  review: number;
  originals: number;
}

export interface PublicationPlan {
  courses: PlannedCourse[];
  /** Plan sections that cannot be published, with the reason. */
  blocked: Array<{ name: string; reason: string; moduleKey?: string; proposedTerm?: Term; needsTerm?: boolean }>;
  /** Sources left out of every course, with the reason. */
  excluded: Array<{ id: string; name: string; reason: string; hasBank: boolean }>;
}

/** Terms the SGU outline gives each module, used only as a proposal to confirm. */
function curriculumTerms(): Map<string, Term[]> {
  const terms = new Map<string, Term[]>();
  for (const term of SGU_CURRICULUM.terms) {
    if (!TERMS.includes(term.name as Term)) continue;
    for (const course of term.courses) for (const module of course.modules) {
      const key = canonicalModuleKey(module);
      terms.set(key, [...new Set([...(terms.get(key) ?? []), term.name as Term])]);
    }
  }
  return terms;
}

/** Collection identity survives new library versions from the same preparer. */
export function publicationCatalogId(libraryId: string, term: Term, moduleKey: string): string {
  const namespace = libraryId.startsWith("native-") ? "native" : libraryId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60);
  return `${namespace}-t${reviewedTermNumber(term)}-${moduleKey}`.slice(0, 120);
}

/** Read the catalog, every plan section and every question package's scope. */
export async function readPublicationInventory(
  read: LibraryReader, progress: (message: string) => void = () => {}, signal?: AbortSignal,
): Promise<PublicationInventory> {
  const catalog = readCatalog(JSON.parse(decode(await read("catalog.json"))));
  const sections: PublicationSection[] = [];
  for (const [index, entry] of catalog.templates.entries()) {
    if (signal?.aborted) throw new DOMException("Reading the library was cancelled.", "AbortError");
    progress(`Reading course plans · ${index + 1} of ${catalog.templates.length}`);
    const bytes = await read(safeLibraryPath(entry.file));
    const text = decode(bytes);
    const section = parseCourseTemplate(text, entry.name);
    const moduleKey = moduleIdentity(section.module) ?? "";
    const problem = await sha256(bytes) !== `sha256:${entry.checksum}` ? "The course plan file does not match its recorded checksum."
      : section.problems.length ? `${section.problems.length} line${section.problems.length === 1 ? "" : "s"} could not be read: ${section.problems[0]}`
        : !section.items.length || !moduleKey ? "No module heading or activities could be read."
          : section.term && !reviewedTermNumber(section.term) ? `${section.term} is not a supported term.` : undefined;
    sections.push({ file: entry.file, name: entry.name, checksum: entry.checksum, text, module: section.module.trim(),
      moduleKey, ...(section.term ? { term: section.term as Term } : {}), title: section.title,
      activities: section.items.length, ...(problem ? { problem } : {}) });
  }
  const sources: PublicationSource[] = [];
  for (const [index, source] of catalog.sources.entries()) {
    if (signal?.aborted) throw new DOMException("Reading the library was cancelled.", "AbortError");
    if (index % 10 === 0) progress(`Reading sources · ${index + 1} of ${catalog.sources.length}`);
    const extension = source.originalFile?.split(".").at(-1)?.toLowerCase();
    const entry: PublicationSource = { id: source.id, name: source.name, checksum: source.checksum, status: source.status,
      reason: source.reason, ready: source.ready, review: source.review, hasBank: Boolean(source.bankFile),
      ...(source.module !== undefined && moduleIdentity(source.module) ? { moduleKey: moduleIdentity(source.module) } : {}),
      ...(source.originalFile && extension ? { original: { extension } } : {}),
      ...(source.duplicateOf ? { duplicateOf: source.duplicateOf } : {}) };
    if (source.bankFile) {
      try {
        const bank = readPreparedBank(JSON.parse(decode(await read(safeLibraryPath(source.bankFile)))));
        entry.rows = bank.pkg.questions.length + (bank.unreadableQuestions ?? 0);
        const manifest = bank.pkg.manifest;
        const filing = bank.reviewedFiling;
        const reviewedUnfiled = Boolean(filing && hasUniformUnfiledSourceScope(manifest, bank.pkg.questions));
        const reviewedOverride = Boolean(filing && filing.evidence === "human-reviewed"
          && (moduleIdentity(filing.module) !== moduleIdentity(manifest.course.name)
            || reviewedTermNumber(filing.term) !== manifest.course.term));
        const scopes = reviewedOverride && filing ? [{ module: filing.module, term: reviewedTermNumber(filing.term) }] :
          [{ module: manifest.course.name, term: manifest.course.term }, ...bank.pkg.questions.map(question => {
          const scope = questionScope(manifest, question);
          return { module: scope.course, term: scope.term };
        })];
        const keys = new Set(scopes.map(scope => `${moduleIdentity(scope.module) ?? ""}|${scope.term ?? ""}`));
        const [moduleKey, number] = [...keys][0].split("|");
        const term = `Term ${number}` as Term;
        entry.bank = keys.size !== 1 ? { problem: "Its questions span several modules or terms. Split the source before publishing." }
          : !moduleKey || moduleKey === "unfiled" || !TERMS.includes(term) ? { problem: "Its questions have no reviewed Term 1-5 and module." }
            : filing && !reviewedOverride && (moduleIdentity(filing.module) !== moduleKey || filing.term !== term)
              ? { problem: "Its manual filing differs from its source's own module or term. Publish it on its own after review." }
              : { term, module: reviewedOverride && filing ? filing.module : manifest.course.name.trim(), moduleKey,
                reviewedFiling: Boolean(filing), ...(reviewedUnfiled ? { reviewedUnfiled: true } : {}),
                ...(reviewedOverride ? { reviewedOverride: true } : {}),
                ...(filing?.evidence === "human-reviewed" ? { humanReviewed: true } : {}) };
      } catch {
        entry.bank = { problem: "Its question package could not be read." };
      }
    }
    sources.push(entry);
  }
  return {
    library: { format: catalog.format, schemaVersion: catalog.schemaVersion, id: catalog.id, version: catalog.version,
      ...(catalog.preparerVersion !== undefined ? { preparerVersion: catalog.preparerVersion } : {}) },
    sections, sources,
  };
}

/**
 * Group plan sections into courses and assign each source to at most one
 * course. Pure: the reviewer can confirm or change a term and plan again.
 */
export function planPublication(inventory: PublicationInventory, confirmedTerms: Readonly<Record<string, Term>> = {}): PublicationPlan {
  const blocked: PublicationPlan["blocked"] = [];
  const excluded: PublicationPlan["excluded"] = [];
  const outline = curriculumTerms();
  const courses = new Map<string, PlannedCourse>();
  const courseKey = (term: Term, moduleKey: string) => `${term}|${moduleKey}`;
  const create = (term: Term, module: string, moduleKey: string, termBasis: TermBasis, sections: PublicationSection[], proposalReason?: string) => {
    const course: PlannedCourse = { catalogId: publicationCatalogId(inventory.library.id, term, moduleKey), term, module, moduleKey, termBasis,
      ...(proposalReason ? { proposalReason } : {}), sections, activities: sections.reduce((sum, section) => sum + section.activities, 0),
      sourceIds: [], optionalSourceIds: [], banks: 0, ready: 0, review: 0, originals: 0 };
    courses.set(courseKey(term, moduleKey), course);
    return course;
  };

  const usable = inventory.sections.filter(section => {
    if (section.problem) blocked.push({ name: section.name, reason: section.problem,
      ...(section.moduleKey ? { moduleKey: section.moduleKey } : {}),
      ...(section.term && TERMS.includes(section.term) ? { proposedTerm: section.term } : {}) });
    return !section.problem;
  });
  const byModule = new Map<string, PublicationSection[]>();
  for (const section of usable) byModule.set(section.moduleKey, [...(byModule.get(section.moduleKey) ?? []), section]);
  for (const [moduleKey, sections] of byModule) {
    const stated = [...new Set(sections.flatMap(section => section.term ? [section.term] : []))].sort();
    const unstated = sections.filter(section => !section.term);
    const groups: Array<{ term: Term; basis: TermBasis; sections: PublicationSection[]; proposalReason?: string }> = [];
    if (stated.length) {
      for (const term of stated) groups.push({ term, basis: "plan", sections: sections.filter(section => section.term === term) });
      if (stated.length === 1) groups[0].sections.push(...unstated);
      else for (const section of unstated)
        blocked.push({ name: section.name, moduleKey, reason: "This section does not name its term, and its module appears in several terms. Add the term to its first line." });
    } else {
      const confirmed = confirmedTerms[moduleKey];
      const fromOutline = outline.get(moduleKey) ?? [];
      const fromQuestions = [...new Set(inventory.sources.flatMap(source => source.bank && "term" in source.bank
        && source.bank.moduleKey === moduleKey && !source.bank.reviewedFiling ? [source.bank.term] : []))];
      const proposal = fromOutline.length === 1 ? fromOutline[0] : fromQuestions.length === 1 ? fromQuestions[0] : undefined;
      if (confirmed && TERMS.includes(confirmed)) groups.push({ term: confirmed, basis: "confirmed", sections });
      else if (proposal) groups.push({ term: proposal, basis: "proposed", sections, proposalReason: fromOutline.length === 1
        ? `The SGU outline lists ${sections[0].module} in ${proposal}.` : `Its question packages are filed in ${proposal}.` });
      else for (const section of sections)
        blocked.push({ name: section.name, moduleKey, needsTerm: true, reason: "This course plan does not name its term. Choose its term to publish it." });
    }
    for (const group of groups) {
      const ordered = [...group.sections].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }) || left.checksum.localeCompare(right.checksum));
      try {
        academicCoursePlan(ordered.map(section => section.text), group.basis === "plan" ? undefined : { term: group.term, evidence: "human-reviewed" });
        create(group.term, ordered[0].module, moduleKey, group.basis, ordered, group.proposalReason);
      } catch (cause) {
        for (const section of ordered) blocked.push({ name: section.name, moduleKey, proposedTerm: group.term,
          reason: cause instanceof Error ? cause.message : "These course plan sections cannot be combined." });
      }
    }
  }

  // A rejected plan revision cannot quietly become a question-only course in its term.
  const blockedModules = new Set<string>();
  const blockedCourses = new Set<string>();
  const blockedSourceModules = new Set<string>();
  for (const section of blocked) {
    if (!section.moduleKey) continue;
    blockedSourceModules.add(section.moduleKey);
    if (section.proposedTerm) blockedCourses.add(courseKey(section.proposedTerm, section.moduleKey));
    else blockedModules.add(section.moduleKey);
  }
  const blockedCourse = (term: Term, moduleKey: string) => blockedModules.has(moduleKey) || blockedCourses.has(courseKey(term, moduleKey));
  for (const [key, course] of courses) if (blockedCourse(course.term, course.moduleKey)) courses.delete(key);

  const templateChecksums = new Set(inventory.sections.map(section => section.checksum));
  const publishedChecksums = new Set([...courses.values()].flatMap(course => course.sections.map(section => section.checksum)));
  const seen = new Set<string>();
  const exclude = (source: PublicationSource, reason: string) => excluded.push({ id: source.id, name: source.name, reason, hasBank: source.hasBank });
  // Question packages first, so a module's own questions decide its course.
  const ordered = [...inventory.sources].sort((left, right) => Number(right.hasBank) - Number(left.hasBank));
  for (const source of ordered) {
    if (source.status === "duplicate-linked" || source.duplicateOf || seen.has(source.checksum)) {
      exclude(source, "Same file as another source, which is published once.");
      continue;
    }
    seen.add(source.checksum);
    if (source.bank) {
      if ("problem" in source.bank) { exclude(source, source.bank.problem); continue; }
      const scope = source.bank;
      if (source.moduleKey && source.moduleKey !== scope.moduleKey) {
        exclude(source, "Its catalog module and its question package disagree. Review its filing.");
        continue;
      }
      if (blockedCourse(scope.term, scope.moduleKey)) {
        exclude(source, "Its course plan needs attention before its questions can be published.");
        continue;
      }
      let course = courses.get(courseKey(scope.term, scope.moduleKey));
      if (course?.sections.length && scope.reviewedFiling && !scope.reviewedOverride) {
        exclude(source, "It carries a manual filing, which cannot be combined with this module's course plan.");
        continue;
      }
      course ??= create(scope.term, scope.module, scope.moduleKey, "questions", []);
      course.sourceIds.push(source.id);
      course.banks += 1;
      course.ready += source.ready;
      course.review += source.review;
      if (source.original) course.originals += 1;
      continue;
    }
    if (templateChecksums.has(source.checksum)) {
      exclude(source, publishedChecksums.has(source.checksum) ? "Its text is published as the course plan."
        : "Its course plan needs attention before it can be published.");
      continue;
    }
    if (!source.original) {
      exclude(source, source.status === "missing" ? "The original file is missing from this library."
        : `There is no file to publish (${source.status}).`);
      continue;
    }
    if (!UPLOADABLE_ORIGINALS.has(source.original.extension)) {
      exclude(source, "This file type cannot be stored in an academic course yet. The original stays on this device.");
      continue;
    }
    if (!source.moduleKey) {
      exclude(source, "No module is recorded for this source, so AXOM cannot place it in a course.");
      continue;
    }
    if (blockedSourceModules.has(source.moduleKey)) {
      exclude(source, "Its course plan needs attention before this file can be published.");
      continue;
    }
    const matches = [...courses.values()].filter(course => course.moduleKey === source.moduleKey);
    if (matches.length !== 1) {
      exclude(source, matches.length ? "Its module appears in several terms, so its course is unknown."
        : "No course in this library has its module.");
      continue;
    }
    matches[0].sourceIds.push(source.id);
    matches[0].optionalSourceIds.push(source.id);
    matches[0].originals += 1;
  }
  return { courses: [...courses.values()].sort(compareCourses), blocked, excluded };
}

export interface CourseReaderOptions {
  /** Sources to include; the rest stay on this device. */
  include?: (sourceId: string) => boolean;
  /** False publishes the question sets without their original files. */
  originals?: boolean;
  /** Sources whose original file could not be read; they publish without it. */
  withoutOriginals?: ReadonlySet<string>;
}

/** The library lists an original file that the chosen folder cannot provide.
 * Only originals raise this: a missing question package still fails. */
export class UnreadableOriginalError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string, cause?: unknown) {
    super("A source file the library lists is missing or unreadable in the chosen folder.", { cause });
    this.name = "UnreadableOriginalError";
    this.sourceId = sourceId;
  }
}

/** A question set references a figure that the chosen folder cannot provide. */
export class UnreadableFigureError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string, cause?: unknown) {
    super("A figure a question set references is missing or unreadable in the chosen folder.", { cause });
    this.name = "UnreadableFigureError";
    this.sourceId = sourceId;
  }
}

/** One course's catalog over the same library files; nothing is copied. */
export function courseLibraryReader(read: LibraryReader, inventory: PublicationInventory, course: PlannedCourse,
  options: CourseReaderOptions = {}): LibraryReader {
  const include = options.include ?? (() => true);
  const includedIds = course.sourceIds.filter(include);
  const ids = new Set(includedIds);
  if (ids.size !== includedIds.length) throw new Error("The planned course contains duplicate source identities.");
  const sources = inventory.sources.filter(source => ids.has(source.id)
    && source.status !== "duplicate-linked" && !source.duplicateOf)
    .sort((left, right) => left.checksum.localeCompare(right.checksum));
  if (sources.length !== includedIds.length
    || new Set(sources.map(source => source.id)).size !== sources.length
    || new Set(sources.map(source => source.checksum)).size !== sources.length)
    throw new Error("The planned course has missing or duplicate source identities. Review its source filing.");
  let catalog: Uint8Array | undefined;
  // Original path to its source, for the originals this course's catalog lists.
  const originals = new Map<string, string>();
  // A question set's figure folder (beside its bank file) to its source.
  const figureFolders = new Map<string, string>();
  const figureOwner = (path: string) => {
    for (const [folder, owner] of figureFolders) if (path.startsWith(folder)) return owner;
    return undefined;
  };
  return async path => {
    if (safeLibraryPath(path) !== "catalog.json") {
      const original = originals.get(path);
      const figure = original ? undefined : figureOwner(path);
      if (!original && !figure) return read(path);
      try {
        return await read(path);
      } catch (cause) {
        if ((cause as Error | undefined)?.name === "AbortError") throw cause;
        throw original ? new UnreadableOriginalError(original, cause) : new UnreadableFigureError(figure!, cause);
      }
    }
    if (!catalog) {
      const original = readCatalog(JSON.parse(decode(await read("catalog.json"))));
      const rows = new Map<string, CatalogSource>();
      const checksums = new Set<string>();
      for (const source of original.sources) {
        if (!ids.has(source.id) || source.status === "duplicate-linked" || source.duplicateOf) continue;
        if (rows.has(source.id) || checksums.has(source.checksum))
          throw new Error("The library contains duplicate source identities. Review its source filing.");
        rows.set(source.id, source);
        checksums.add(source.checksum);
      }
      const selected = sources.map(source => {
        const row = rows.get(source.id);
        if (!row || row.checksum !== source.checksum || row.name !== source.name || row.status !== source.status
          || Boolean(row.bankFile) !== source.hasBank)
          throw new Error("The library changed while publishing. Choose it again and review the plan.");
        const extension = row.originalFile?.split(".").at(-1)?.toLowerCase() ?? "";
        return options.originals === false || options.withoutOriginals?.has(row.id)
          || (row.originalFile && !UPLOADABLE_ORIGINALS.has(extension))
          ? { ...row, originalFile: undefined } : row;
      });
      const shared = new Set<string>();
      for (const row of selected) {
        if (row.originalFile) originals.set(row.originalFile, row.id);
        if (!row.bankFile) continue;
        const folder = `${row.bankFile.slice(0, row.bankFile.lastIndexOf("/") + 1)}assets/`;
        if (figureFolders.has(folder)) shared.add(folder);
        figureFolders.set(folder, row.id);
      }
      // A figure folder two sets share cannot name its set, so its errors stay as they are.
      for (const folder of shared) figureFolders.delete(folder);
      catalog = encode({ ...inventory.library, id: course.catalogId,
        templates: course.sections.map(section => ({ file: section.file, name: section.name, checksum: section.checksum })),
        sources: selected });
    }
    return catalog.slice();
  };
}

/** Size errors from the uploader; the course can retry with fewer files. */
const TOO_LARGE = /exceeds the supported upload size|1–1500 verified files/;

export interface PublicationJobNotes {
  /** Original files kept on this device so the course fits its size limit. */
  keptLocal: Map<string, number>;
  /** Listed original files the chosen folder could not provide; their questions still publish. */
  unreadableOriginals: Map<string, number>;
  /** Question sets left out of a course submitted for review, because approval
   * needs an explanation for every ready question. */
  heldForExplanations: Map<string, { sets: number; readyQuestions: number }>;
  /** Question sets left on this device because the folder lacks a figure they
   * reference; none of their questions was ready, so no practice is lost. */
  heldForFigures: Map<string, { sets: number; reviewQuestions: number }>;
  /** Why a course could not be prepared, in the validator's own words. */
  failures: Map<string, string>;
}

export interface PublicationJobOptions {
  /** For a course submitted for review: leave out each question set with a
   * ready question that has no explanation, which no reviewer could approve. */
  explainedOnly?: boolean;
}

/**
 * One batch job per course. A course over 512 MiB or 1,500 files retries
 * first without its original-only files, then without any original files;
 * its questions and figures still publish and the kept files are counted.
 * An original the folder cannot provide is left out the same way and counted
 * apart, so one lost PDF does not hold back the questions prepared from it.
 * A question set whose figures are missing stays on this device only when
 * none of its questions is ready; with ready questions it still fails.
 */
export function publicationJobs(read: LibraryReader, inventory: PublicationInventory, courses: readonly PlannedCourse[],
  jobOptions: PublicationJobOptions = {}): { jobs: AcademicBatchJob[]; notes: PublicationJobNotes } {
  const notes: PublicationJobNotes = { keptLocal: new Map(), unreadableOriginals: new Map(), heldForExplanations: new Map(),
    heldForFigures: new Map(), failures: new Map() };
  const jobs = courses.map((course): AcademicBatchJob => ({
    key: course.catalogId,
    async prepare(signal) {
      try {
        if (course.termBasis === "proposed") throw new Error("Confirm this course's term before publishing it.");
        const planTerm: AcademicPlanTerm | undefined = course.sections.length && course.termBasis !== "plan"
          ? { term: course.term, evidence: "human-reviewed" } : undefined;
        const optional = new Set(course.optionalSourceIds);
        const byId = new Map(inventory.sources.filter(source => source.status !== "duplicate-linked" && !source.duplicateOf)
          .map(source => [source.id, source]));
        const hasHumanReview = course.sourceIds.some(id => {
          const bank = byId.get(id)?.bank;
          return bank && "term" in bank && bank.humanReviewed;
        });
        const unscheduled = course.sections.length ? undefined
          : { term: course.term, module: course.module, evidence: hasHumanReview ? "human-reviewed" as const : "source-metadata" as const };
        const unsupported = course.sourceIds.filter(id => {
          const original = byId.get(id)?.original;
          return original && !UPLOADABLE_ORIGINALS.has(original.extension);
        });
        const withOriginals = course.sourceIds.filter(id => {
          const original = byId.get(id)?.original;
          return !optional.has(id) && original && UPLOADABLE_ORIGINALS.has(original.extension);
        });
        const stages: Array<{ options: CourseReaderOptions; kept: string[] }> = [{ options: {}, kept: unsupported }];
        if (optional.size) stages.push({ options: { include: id => !optional.has(id) }, kept: [...unsupported, ...optional] });
        if (withOriginals.length) stages.push({ options: { include: id => !optional.has(id), originals: false }, kept: [...unsupported, ...optional, ...withOriginals] });
        // A question set publishes without an original the folder cannot provide;
        // an original-only source has nothing else, so it is left out. Every
        // retry removes one more source, so the attempts end.
        const unreadable = new Set<string>();
        // Question sets left out for review: each has a ready question without an explanation.
        const held = new Set<string>();
        // Question sets with no ready question whose figures this folder lacks.
        const figureless = new Set<string>();
        const attempt = async (options: CourseReaderOptions) => {
          for (;;) {
            if (signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError");
            try {
              return await prepareAcademicUpload(courseLibraryReader(read, inventory, course, {
                ...options, withoutOriginals: unreadable,
                include: id => (options.include?.(id) ?? true) && !held.has(id) && !figureless.has(id)
                  && !(optional.has(id) && unreadable.has(id)),
              }), unscheduled, planTerm ? { planTerm } : {});
            } catch (cause) {
              if (cause instanceof UnreadableOriginalError && !unreadable.has(cause.sourceId)) {
                unreadable.add(cause.sourceId);
                continue;
              }
              if (cause instanceof UnreadableFigureError && !figureless.has(cause.sourceId)) {
                const ready = byId.get(cause.sourceId)?.ready ?? 0;
                if (ready > 0) throw new Error(`A question set with ${ready} ready question${ready === 1 ? "" : "s"} references a figure that is not in this folder. Recover its figures before publishing it.`, { cause });
                figureless.add(cause.sourceId);
                if (!course.sections.length && course.sourceIds.every(id => !byId.get(id)?.hasBank || figureless.has(id) || held.has(id)))
                  throw new Error("Every question set in this course is missing figures and none of its questions is ready. Recover the figures before publishing it.", { cause });
                continue;
              }
              throw cause;
            }
          }
        };
        const heldCount = (field: "ready" | "review") => [...new Set([...held, ...figureless])].reduce((sum, id) => sum + (byId.get(id)?.[field] ?? 0), 0);
        for (const [index, stage] of stages.entries()) {
          if (signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError");
          try {
            let upload = await attempt(stage.options);
            if (jobOptions.explainedOnly) {
              // Explanations come from the bank itself, so one more preparation settles it.
              const unexplained = [...await inspectPreparedUploadExplanationsBySource(upload)]
                .filter(([, coverage]) => coverage.missingExplanations > 0).map(([id]) => id);
              if (unexplained.length) {
                for (const id of unexplained) held.add(id);
                if (course.ready - heldCount("ready") <= 0)
                  throw new Error("No question set in this course has an explanation for every ready question, so a reviewer cannot approve it yet. Publish it without submitting for review, or add reviewed explanations first.");
                upload = await attempt(stage.options);
              }
            }
            if (upload.metadata.ready_questions !== course.ready - heldCount("ready")
              || upload.metadata.review_questions !== course.review - heldCount("review"))
              throw new Error("The prepared course question counts differ from its unique planned sources. Review duplicate or changed source files.");
            await preflightAcademicUpload(upload);
            // Each source is reported once: missing figures, held back for review, unreadable, or kept on this device.
            const kept = stage.kept.filter(id => !unreadable.has(id) && !held.has(id) && !figureless.has(id)).length;
            const unread = [...unreadable].filter(id => !held.has(id) && !figureless.has(id)).length;
            if (kept) notes.keptLocal.set(course.catalogId, kept);
            if (unread) notes.unreadableOriginals.set(course.catalogId, unread);
            if (held.size) notes.heldForExplanations.set(course.catalogId, { sets: held.size,
              readyQuestions: [...held].reduce((sum, id) => sum + (byId.get(id)?.ready ?? 0), 0) });
            if (figureless.size) notes.heldForFigures.set(course.catalogId, { sets: figureless.size,
              reviewQuestions: [...figureless].reduce((sum, id) => sum + (byId.get(id)?.review ?? 0), 0) });
            return upload;
          } catch (cause) {
            if (!(cause instanceof Error) || !TOO_LARGE.test(cause.message)) throw cause;
            if (index === stages.length - 1)
              throw new Error("This course is larger than 512 MB or 1,500 files even without its source files. Publish its question sets in smaller groups.", { cause });
          }
        }
        throw new Error("This course could not be prepared.");
      } catch (cause) {
        // The batch receipt stays generic; keep the validator's reason for the reviewer.
        if (cause instanceof Error && cause.name !== "AbortError") notes.failures.set(course.catalogId, cause.message);
        throw cause;
      }
    },
  }));
  return { jobs, notes };
}
