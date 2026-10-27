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
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { LibraryInputLimits } from "../privateLibrary/inputRoot";
import type { PrivateLibraryCatalog, ReviewedFiling } from "../privateLibrary/types";
import { academicCoursePlan, moduleIdentity, reviewedTermNumber, type AcademicPlanTerm } from "./coursePlan";
import { compareCourses } from "./catalogOrder";
import { prepareAcademicUpload, type AcademicUpload } from "./upload";
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
  original?: { extension: string };
  /** Term and module read from the question package itself. */
  bank?: { term: Term; module: string; moduleKey: string; reviewedFiling: boolean } | { problem: string };
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
  excluded: Array<{ id: string; name: string; reason: string }>;
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
        const manifest = bank.pkg.manifest;
        const scopes = [{ module: manifest.course.name, term: manifest.course.term }, ...bank.pkg.questions.map(question => {
          const scope = questionScope(manifest, question);
          return { module: scope.course, term: scope.term };
        })];
        const keys = new Set(scopes.map(scope => `${moduleIdentity(scope.module) ?? ""}|${scope.term ?? ""}`));
        const [moduleKey, number] = [...keys][0].split("|");
        const term = `Term ${number}` as Term;
        const filing = bank.reviewedFiling;
        entry.bank = keys.size !== 1 ? { problem: "Its questions span several modules or terms. Split the source before publishing." }
          : !moduleKey || moduleKey === "unfiled" || !TERMS.includes(term) ? { problem: "Its questions have no reviewed Term 1-5 and module." }
            : filing && (moduleIdentity(filing.module) !== moduleKey || filing.term !== term)
              ? { problem: "Its manual filing differs from its source's own module or term. Publish it on its own after review." }
              : { term, module: manifest.course.name.trim(), moduleKey, reviewedFiling: Boolean(filing) };
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
    if (section.problem) blocked.push({ name: section.name, reason: section.problem });
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

  const templateChecksums = new Set(inventory.sections.map(section => section.checksum));
  const publishedChecksums = new Set([...courses.values()].flatMap(course => course.sections.map(section => section.checksum)));
  const seen = new Set<string>();
  const exclude = (source: PublicationSource, reason: string) => excluded.push({ id: source.id, name: source.name, reason });
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
      let course = courses.get(courseKey(scope.term, scope.moduleKey));
      if (course?.sections.length && scope.reviewedFiling) {
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

/** One course's catalog over the same library files; nothing is copied. */
export function courseLibraryReader(read: LibraryReader, inventory: PublicationInventory, course: PlannedCourse,
  include: (sourceId: string) => boolean = () => true): LibraryReader {
  const sources = inventory.sources.filter(source => course.sourceIds.includes(source.id) && include(source.id))
    .sort((left, right) => left.checksum.localeCompare(right.checksum));
  let catalog: Uint8Array | undefined;
  return async path => {
    if (safeLibraryPath(path) !== "catalog.json") return read(path);
    if (!catalog) {
      const original = readCatalog(JSON.parse(decode(await read("catalog.json"))));
      const rows = new Map(original.sources.map(source => [`${source.id}|${source.checksum}`, source]));
      const selected = sources.map(source => rows.get(`${source.id}|${source.checksum}`));
      if (selected.some(row => !row)) throw new Error("The library changed while publishing. Choose it again and review the plan.");
      catalog = encode({ ...inventory.library, id: course.catalogId,
        templates: course.sections.map(section => ({ file: section.file, name: section.name, checksum: section.checksum })),
        sources: selected });
    }
    return catalog.slice();
  };
}

/** Size errors from the uploader; the course can retry without optional originals. */
const TOO_LARGE = /exceeds the supported upload size|1–1500 verified files/;

export interface PublicationJobNotes {
  /** Original-only files kept on this device so the course fits its size limit. */
  keptLocal: Map<string, number>;
  /** Why a course could not be prepared, in the validator's own words. */
  failures: Map<string, string>;
}

export function publicationJobs(read: LibraryReader, inventory: PublicationInventory, courses: readonly PlannedCourse[]):
  { jobs: AcademicBatchJob[]; notes: PublicationJobNotes } {
  const notes: PublicationJobNotes = { keptLocal: new Map(), failures: new Map() };
  const jobs = courses.map((course): AcademicBatchJob => ({
    key: course.catalogId,
    async prepare(signal) {
      if (course.termBasis === "proposed") throw new Error("Confirm this course's term before publishing it.");
      const planTerm: AcademicPlanTerm | undefined = course.sections.length && course.termBasis !== "plan"
        ? { term: course.term, evidence: "human-reviewed" } : undefined;
      const unscheduled = course.sections.length ? undefined
        : { term: course.term, module: course.module, evidence: "source-metadata" as const };
      const prepare = (include?: (id: string) => boolean): Promise<AcademicUpload> => {
        if (signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError");
        return prepareAcademicUpload(courseLibraryReader(read, inventory, course, include), unscheduled, planTerm ? { planTerm } : {});
      };
      try {
        try { return await prepare(); }
        catch (cause) {
          if (!(cause instanceof Error) || !TOO_LARGE.test(cause.message) || !course.optionalSourceIds.length) throw cause;
          const optional = new Set(course.optionalSourceIds);
          const upload = await prepare(id => !optional.has(id));
          notes.keptLocal.set(course.catalogId, optional.size);
          return upload;
        }
      } catch (cause) {
        // The batch receipt stays generic; keep the validator's reason for the reviewer.
        if (cause instanceof Error && cause.name !== "AbortError") notes.failures.set(course.catalogId, cause.message);
        throw cause;
      }
    },
  }));
  return { jobs, notes };
}
