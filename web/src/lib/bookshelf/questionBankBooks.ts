// ===========================================================================
// Question bank books: one for each module that has questions, or that has a
// question package AXOM knows about. Inside: weeks, then the sets filed under
// each week, with real counts.
//
// Sets and questions in the workspace are the authority. A package that is
// known but not imported is listed as what it is (not built, source missing)
// and adds nothing to the book's thickness: a book is as thick as the
// questions that are really on this device.
// ===========================================================================
import { questionScope } from "../course-engine/scope";
import { courseForScope } from "../course-engine/questionBank";
import { moduleKey } from "../course-engine/vocabulary";
import type { CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import type { PackageManifest } from "../question-content/package";
import type { PackageSummary } from "../question-content/validate";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import type { Course, Term } from "../types";
import { countWords, type ShelfBook } from "./model";

export type CollectionStatus =
  /** In the workspace and ready to practise. */
  | "imported"
  /** In the workspace, with answers or mappings still to confirm. */
  | "awaiting-review"
  /** A package with questions, not imported yet. */
  | "available"
  /** A package whose questions have not been built from its source. */
  | "not-built"
  /** A package whose source file is not on this device. */
  | "source-missing"
  /** A package this AXOM cannot read. */
  | "unsupported";

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  imported: "Imported",
  "awaiting-review": "Awaiting review",
  available: "Ready to import",
  "not-built": "Not built yet",
  "source-missing": "Source file missing",
  unsupported: "Cannot be read",
};

export interface BankCollection {
  id: string;
  title: string;
  /** "School PQ", "IMCQ", "Personal" ... as the caller's own rule names it. */
  source: string;
  week?: number;
  /** Questions on this device. */
  questions: number;
  /** Of those, how many can be practised now. */
  ready: number;
  questionIds?: string[];
  readyQuestionIds?: string[];
  attempted: number;
  awaitingReview: number;
  status: CollectionStatus;
  /** One plain line for a status that needs explaining. */
  note?: string;
  setId?: string;
  packageBankId?: string;
  /** What a package says it holds, when one is known. Never added to `questions`. */
  declared?: Pick<PackageSummary, "questions" | "images" | "tables" | "answerReveals">;
}

export interface BankWeek {
  week?: number;
  label: string;
  collections: BankCollection[];
  questions: number;
  ready: number;
}

export interface QuestionBankBook extends ShelfBook {
  kind: "question-bank";
  module: string;
  term: string;
  courseId?: string;
  courseCode?: string;
  weeks: BankWeek[];
  ready: number;
  attempted: number;
}

/** A question package AXOM knows about, imported or not. */
export interface KnownPackage {
  manifest: PackageManifest;
  /** Present once the package's questions have been read and checked. */
  summary?: PackageSummary;
  /** Whether the source file the manifest names is on this device. */
  hasSource: boolean;
  /** False when the package is a newer version than this AXOM reads. */
  readable?: boolean;
}

export interface QuestionBankInput {
  terms: readonly Term[];
  courses: readonly Course[];
  sets: readonly QuestionSet[];
  questions: readonly QuestionRecord[];
  packages?: readonly KnownPackage[];
  /** Course maps that say which term and course a module belongs to when the workspace has not loaded it. */
  curricula?: readonly CurriculumTemplate[];
  /** How a set's source is named. Stream 1's `bankSource` goes here once it is on the line. */
  sourceOf?: (set: QuestionSet) => string;
}

/** The set's own kind first; a name in the title only when the kind does not say. */
export function defaultSourceOf(set: QuestionSet): string {
  if (set.kind === "generated") return "AXOM generated";
  if (set.kind === "review") return "Review";
  if (set.kind === "custom") return "Personal";
  if (/\bimcq/i.test(set.title)) return "IMCQ";
  if (/\be[ -]?soft/i.test(set.title)) return "ESoft";
  if (/\bpq\b|practice questions/i.test(set.title)) return "School PQ";
  return "Imported";
}

const same = <T,>(values: T[]): T | undefined => (values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined);

interface Draft {
  module: string;
  courseId?: string;
  weeks: Map<string, BankWeek>;
  questionIds: Set<string>;
}

export function buildQuestionBankBooks(input: QuestionBankInput): QuestionBankBook[] {
  const sourceOf = input.sourceOf ?? defaultSourceOf;
  const setsById = new Map(input.sets.map((set) => [set.id, set]));
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));
  const drafts = new Map<string, Draft>();
  const draftFor = (module: string, courseId?: string): Draft => {
    courseId = courseForScope({ module, courseId }, input.courses)?.id;
    const key = `${courseId ?? "unassigned"}|${moduleKey(module)}`;
    const draft: Draft = drafts.get(key) ?? { module, weeks: new Map(), questionIds: new Set() };
    if (courseId && !draft.courseId) draft.courseId = courseId;
    drafts.set(key, draft);
    return draft;
  };
  const weekFor = (draft: Draft, week: number | undefined): BankWeek => {
    const key = week === undefined ? "none" : String(week);
    const found = draft.weeks.get(key) ?? { ...(week !== undefined ? { week } : {}), label: week === undefined ? "No single week" : `Week ${week}`, collections: [], questions: 0, ready: 0 };
    draft.weeks.set(key, found);
    return found;
  };

  const inSet = new Set<string>();
  for (const set of input.sets) {
    const members = set.questionIds.flatMap((id) => (questionsById.has(id) ? [questionsById.get(id)!] : []));
    const scopes = members.map((question) => questionScope(question, setsById));
    const module = set.scope?.module ?? same(scopes.map((scope) => scope.module));
    if (!module) continue;
    const draft = draftFor(module, set.scope?.courseId ?? same(scopes.map((scope) => scope.courseId)));
    const week = set.scope?.week ?? same(scopes.map((scope) => scope.week));
    const awaiting = members.filter((question) => questionMappingStatus(question) !== "ready").length;
    weekFor(draft, week).collections.push({
      id: `set:${set.id}`,
      title: set.title,
      source: sourceOf(set),
      ...(week !== undefined ? { week } : {}),
      questions: members.length,
      questionIds: members.map((question) => question.id),
      readyQuestionIds: members.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).map((question) => question.id),
      ready: members.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).length,
      attempted: members.filter((question) => question.attempts.length > 0).length,
      awaitingReview: awaiting,
      status: awaiting > 0 ? "awaiting-review" : "imported",
      ...(awaiting > 0 ? { note: `${countWords.one(awaiting, "question")} to confirm before ${awaiting === 1 ? "it counts" : "they count"} as ready.` } : {}),
      setId: set.id,
    });
    for (const question of members) {
      inSet.add(question.id);
      draft.questionIds.add(question.id);
    }
  }

  // Questions that belong to a module but to no set.
  const looseByScope = new Map<string, { module: string; week?: number; courseId?: string; questions: QuestionRecord[] }>();
  for (const question of input.questions) {
    if (inSet.has(question.id)) continue;
    const scope = questionScope(question, setsById);
    if (!scope.module) continue;
    const key = `${scope.courseId ?? ""}|${moduleKey(scope.module)}|${scope.week ?? ""}`;
    const entry = looseByScope.get(key) ?? { module: scope.module, courseId: scope.courseId, ...(scope.week !== undefined ? { week: scope.week } : {}), questions: [] };
    entry.questions.push(question);
    looseByScope.set(key, entry);
  }
  for (const [key, entry] of looseByScope) {
    const draft = draftFor(entry.module, entry.courseId);
    const awaiting = entry.questions.filter((question) => questionMappingStatus(question) !== "ready").length;
    weekFor(draft, entry.week).collections.push({
      id: `loose:${key}`,
      title: "Questions in no set",
      source: "Imported",
      ...(entry.week !== undefined ? { week: entry.week } : {}),
      questions: entry.questions.length,
      questionIds: entry.questions.map((question) => question.id),
      readyQuestionIds: entry.questions.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).map((question) => question.id),
      ready: entry.questions.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).length,
      attempted: entry.questions.filter((question) => question.attempts.length > 0).length,
      awaitingReview: awaiting,
      status: awaiting > 0 ? "awaiting-review" : "imported",
    });
    for (const question of entry.questions) draft.questionIds.add(question.id);
  }

  // Packages AXOM knows about and has not imported. A bank already in the workspace is not listed twice.
  const importedTitles = new Set([...input.sets.map((set) => set.title), ...input.questions.flatMap((question) => (question.bank ? [question.bank] : []))]);
  for (const known of input.packages ?? []) {
    const { manifest } = known;
    if (importedTitles.has(manifest.bank.title)) continue;
    const draft = draftFor(manifest.course.name);
    const status: CollectionStatus = known.readable === false ? "unsupported" : known.summary && known.summary.questions > 0 ? "available" : known.hasSource ? "not-built" : "source-missing";
    weekFor(draft, manifest.course.week).collections.push({
      id: `package:${manifest.bank.id}`,
      title: manifest.bank.title,
      source: manifest.bank.discipline,
      week: manifest.course.week,
      questions: 0,
      ready: 0,
      attempted: 0,
      awaitingReview: 0,
      status,
      note: status === "available"
        ? "Import it to add its questions to this device."
        : status === "not-built"
          ? "Its questions have not been built from the source file yet."
          : status === "source-missing"
            ? `The source file is not on this device: ${manifest.source.filename}`
            : "Made by a newer AXOM than this one.",
      packageBankId: manifest.bank.id,
      ...(known.summary ? { declared: { questions: known.summary.questions, images: known.summary.images, tables: known.summary.tables, answerReveals: known.summary.answerReveals } } : {}),
    });
  }

  const termName = new Map(input.terms.map((term) => [term.id, term.name]));
  const books: { book: QuestionBankBook; termIndex: number; courseIndex: number; moduleIndex: number }[] = [];
  for (const draft of drafts.values()) {
    // A module name that only one course carries says which course it is.
    const owners = input.courses.filter((course) => (draft.courseId ? course.id === draft.courseId : course.modules.some((module) => moduleKey(module.name) === moduleKey(draft.module))));
    const course = owners.length === 1 ? owners[0] : undefined;
    // Not in the workspace: the course map may still say where the module belongs.
    const mapped = course ? [] : (input.curricula ?? []).flatMap((curriculum) => curriculum.terms.flatMap((entry) =>
      entry.courses.filter((item) => item.modules.some((module) => moduleKey(module) === moduleKey(draft.module))).map((item) => ({ term: entry.name, code: item.code }))));
    const place = mapped.length === 1 ? mapped[0] : undefined;
    const term = course ? termName.get(course.termId) ?? "Not in a term" : place?.term ?? "Not filed under a course";
    const weeks = [...draft.weeks.values()].sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity));
    for (const week of weeks) {
      week.collections.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      week.questions = new Set(week.collections.flatMap((collection) => collection.questionIds ?? [])).size;
      week.ready = new Set(week.collections.flatMap((collection) => collection.readyQuestionIds ?? [])).size;
    }
    const members = [...draft.questionIds].map((id) => questionsById.get(id)!);
    const count = members.length;
    const pending = weeks.flatMap((week) => week.collections).filter((collection) => collection.questions === 0).length;
    books.push({
      termIndex: course ? input.terms.findIndex((entry) => entry.id === course.termId) : Number.MAX_SAFE_INTEGER,
      courseIndex: course ? input.courses.indexOf(course) : Number.MAX_SAFE_INTEGER,
      moduleIndex: course ? course.modules.findIndex((module) => moduleKey(module.name) === moduleKey(draft.module)) : 0,
      book: {
        kind: "question-bank",
        id: `bank:${draft.courseId ?? "unassigned"}:${moduleKey(draft.module)}`,
        title: course?.modules.find((module) => moduleKey(module.name) === moduleKey(draft.module))?.name ?? draft.module,
        ...(course ? { identifier: course.code } : place ? { identifier: place.code } : {}),
        shelf: term,
        count,
        countLabel: countWords.one(count, "question"),
        state: count > 0 ? "available" : "empty",
        ...(count > 0 ? {} : { stateNote: pending ? `${countWords.one(pending, "bank")} known, none on this device yet.` : "No questions yet." }),
        module: draft.module,
        term,
        ...(course ? { courseId: course.id, courseCode: course.code } : place ? { courseCode: place.code } : {}),
        weeks,
        ready: members.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 2).length,
        attempted: members.filter((question) => question.attempts.length > 0).length,
      },
    });
  }
  return books.sort((a, b) => a.termIndex - b.termIndex || a.courseIndex - b.courseIndex || a.moduleIndex - b.moduleIndex).map((entry) => entry.book);
}

export interface PracticeSelection {
  courseId?: string;
  module: string;
  week?: number;
  /** The sets to draw from. Sets only: a package that is not imported has nothing to practise. */
  setIds: string[];
  /** Capped at what is ready in those sets. */
  count: number;
}

/** What can be practised from a week's chosen collections, never more than is ready. */
export function practiceSelection(book: QuestionBankBook, week: BankWeek, collectionIds: readonly string[], wanted: number): PracticeSelection {
  const chosen = week.collections.filter((collection) => collectionIds.includes(collection.id) && collection.setId && collection.ready > 0);
  const ready = new Set(chosen.flatMap((collection) => collection.readyQuestionIds ?? [])).size;
  return {
    module: book.module,
    ...(book.courseId ? { courseId: book.courseId } : {}),
    ...(week.week !== undefined ? { week: week.week } : {}),
    setIds: chosen.map((collection) => collection.setId!),
    count: Math.max(0, Math.min(Math.floor(wanted) || 0, ready)),
  };
}
