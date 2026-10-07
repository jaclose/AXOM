import type { Course, Term } from "./types";
import type { QuestionAttempt, QuestionRecord } from "./questions";
import { questionMappingStatus } from "./questions";
import type { QuestionSet, SourceDocument } from "./library";
import type { DecodeState, LearningScope, QuestionAnalysis, QuestionAssignment, SourceTrace, DecodeSourcePack, DecodeSheet } from "./decodeTypes";

export function emptyDecodeState(): DecodeState {
  return { version: 1, scope: {}, priority: "questions", assignments: [], analyses: [], packs: [], sheets: [] };
}
export const EMPTY_DECODE_STATE = emptyDecodeState();

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function str(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function strings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.flatMap((v) => str(v) ? [str(v)!] : []))] : []; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function date(value: unknown): string | undefined { const s = str(value); return s && Number.isFinite(Date.parse(s)) ? s : undefined; }
function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en"); }
function unique<T extends { id: string }>(values: T[]): T[] { return [...new Map(values.map((v) => [v.id, v])).values()]; }
function array<T>(input: unknown, parse: (value: unknown) => T | undefined): T[] { return Array.isArray(input) ? input.flatMap((v) => { const parsed = parse(v); return parsed ? [parsed] : []; }) : []; }

/** Weeks sort numerically; labels such as Week 02 and 2 name the same week. */
export function normalizeDecodeWeek(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  const match = /^(?:week\s*)?(\d+)$/i.exec(text);
  return match && Number(match[1]) > 0 ? String(Number(match[1])) : text;
}
export function sortDecodeWeeks(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeDecodeWeek).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
export function normalizeLearningScope(input: unknown): LearningScope {
  if (!record(input)) return {};
  return { termId: str(input.termId), courseId: str(input.courseId), module: str(input.module), week: normalizeDecodeWeek(input.week), lecture: str(input.lecture), setId: str(input.setId), cumulative: input.cumulative === true || undefined };
}
function assignment(input: unknown): QuestionAssignment | undefined {
  if (!record(input) || !str(input.id) || !str(input.subjectId) || !str(input.module) || !date(input.updatedAt)
    || !["question", "set"].includes(String(input.subjectType)) || !["manual", "source", "ai"].includes(String(input.method))) return undefined;
  return { id: str(input.id)!, subjectId: str(input.subjectId)!, subjectType: input.subjectType as QuestionAssignment["subjectType"], module: str(input.module)!, termId: str(input.termId), courseId: str(input.courseId), week: normalizeDecodeWeek(input.week), lecture: str(input.lecture), method: input.method as QuestionAssignment["method"], confirmed: input.confirmed === true, updatedAt: date(input.updatedAt)! };
}
function trace(input: unknown): SourceTrace | undefined {
  if (!record(input) || !str(input.documentId) || !count(input.page) || input.page < 1 || !str(input.quote) || !["question", "answer", "teaching", "slide"].includes(String(input.role))) return undefined;
  return { documentId: str(input.documentId)!, page: input.page, quote: str(input.quote)!, role: input.role as SourceTrace["role"] };
}
function analysis(input: unknown): QuestionAnalysis | undefined {
  if (!record(input) || input.version !== 1 || !str(input.id) || !str(input.questionId) || !str(input.sourceFingerprint)
    || !["source", "ai"].includes(String(input.origin)) || !["proposed", "reviewed", "rejected"].includes(String(input.status))
    || !str(input.concept) || !str(input.task) || !str(input.rule) || !str(input.explanation) || !date(input.generatedAt)
    || !Array.isArray(input.references) || !Array.isArray(input.distractors)) return undefined;
  const references = array(input.references, trace);
  const distractors = array(input.distractors, (value) => record(value) && str(value.key) && str(value.whyWrong)
    ? { key: str(value.key)!, whyWrong: str(value.whyWrong)!, wouldFitIf: str(value.wouldFitIf) } : undefined);
  // Dropping a broken citation while retaining a reviewed assertion would imply false trust.
  if (references.length !== input.references.length || distractors.length !== input.distractors.length) return undefined;
  return { id: str(input.id)!, questionId: str(input.questionId)!, sourceFingerprint: str(input.sourceFingerprint)!, version: 1, origin: input.origin as QuestionAnalysis["origin"], concept: str(input.concept)!, task: str(input.task)!, rule: str(input.rule)!, explanation: str(input.explanation)!, decisiveClues: strings(input.decisiveClues), mechanism: strings(input.mechanism), distractors, lecture: str(input.lecture), sourcePages: Array.isArray(input.sourcePages) ? [...new Set(input.sourcePages.filter((v): v is number => count(v) && v > 0))] : [], references, status: input.status as QuestionAnalysis["status"], provider: str(input.provider), promptVersion: str(input.promptVersion), generatedAt: date(input.generatedAt)! };
}
function pack(input: unknown): DecodeSourcePack | undefined {
  if (!record(input) || !str(input.id) || !str(input.title) || !str(input.documentId) || !str(input.checksum) || !str(input.fileName)
    || !count(input.pageCount) || !count(input.extractedPageCount) || !count(input.sparsePageCount)
    || input.extractedPageCount > input.pageCount || input.sparsePageCount > input.pageCount || !date(input.importedAt)
    || input.distribution !== "private-local" || !["user-authored", "permission-recorded", "unknown"].includes(String(input.rights))) return undefined;
  return { id: str(input.id)!, title: str(input.title)!, documentId: str(input.documentId)!, setId: str(input.setId), checksum: str(input.checksum)!, fileName: str(input.fileName)!, pageCount: input.pageCount, extractedPageCount: input.extractedPageCount, sparsePageCount: input.sparsePageCount, importedAt: date(input.importedAt)!, author: str(input.author), distribution: "private-local", rights: input.rights as DecodeSourcePack["rights"] };
}
function sheet(input: unknown): DecodeSheet | undefined {
  if (!record(input) || !str(input.id) || !str(input.title) || !date(input.createdAt) || !str(input.sourceFingerprint) || !Array.isArray(input.entries)) return undefined;
  const entries = array(input.entries, (value) => {
    if (!record(value) || !str(value.questionId) || !str(value.rule) || !Array.isArray(value.references)) return undefined;
    const references = array(value.references, trace);
    return references.length === value.references.length ? { questionId: str(value.questionId)!, rule: str(value.rule)!, trap: str(value.trap), references } : undefined;
  });
  if (entries.length !== input.entries.length) return undefined;
  return { id: str(input.id)!, title: str(input.title)!, scope: normalizeLearningScope(input.scope), examDate: date(input.examDate), createdAt: date(input.createdAt)!, questionIds: strings(input.questionIds), analysisIds: strings(input.analysisIds), sourceFingerprint: str(input.sourceFingerprint)!, entries };
}
/** Deeply normalize untrusted backups, without upgrading proposals into reviewed teaching. */
export function normalizeDecodeState(input: unknown): DecodeState {
  if (!record(input) || input.version !== 1) return emptyDecodeState();
  return { version: 1, scope: normalizeLearningScope(input.scope), priority: input.priority === "repair" || input.priority === "source" ? input.priority : "questions", assignments: unique(array(input.assignments, assignment)), analyses: unique(array(input.analyses, analysis)), packs: unique(array(input.packs, pack)), sheets: unique(array(input.sheets, sheet)) };
}

export function effectiveAssignment(question: QuestionRecord, sets: readonly QuestionSet[], assignments: readonly QuestionAssignment[]): QuestionAssignment | undefined {
  const memberships = new Set(sets.filter((set) => set.questionIds.includes(question.id)).map((set) => set.id));
  const candidates = assignments.filter((a) => a.confirmed && ((a.subjectType === "question" && a.subjectId === question.id) || (a.subjectType === "set" && memberships.has(a.subjectId))));
  return candidates.sort((a, b) => Number(b.subjectType === "question") - Number(a.subjectType === "question") || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))[0];
}
export interface DecodeSelectionInput {
  questions: readonly QuestionRecord[];
  questionSets: readonly QuestionSet[];
  assignments: readonly QuestionAssignment[];
  scope: LearningScope;
  courses?: readonly Course[];
}
export function selectDecodeQuestions({ questions, questionSets, assignments, scope, courses = [] }: DecodeSelectionInput): QuestionRecord[] {
  const members = scope.setId ? new Set(questionSets.find((s) => s.id === scope.setId)?.questionIds ?? []) : undefined;
  return questions.filter((q) => {
    if (members && !members.has(q.id)) return false;
    const a = effectiveAssignment(q, questionSets, assignments);
    const courseId = a?.courseId ?? q.courseId;
    const termId = a?.termId ?? courses.find((c) => c.id === courseId)?.termId;
    if (!scope.cumulative && scope.termId && termId !== scope.termId) return false;
    if (!scope.cumulative && scope.courseId && courseId !== scope.courseId) return false;
    if (scope.module && normalize(a?.module ?? q.module ?? "") !== normalize(scope.module)) return false;
    if (scope.week && normalizeDecodeWeek(a?.week) !== normalizeDecodeWeek(scope.week)) return false;
    if (scope.lecture && normalize(a?.lecture ?? "") !== normalize(scope.lecture)) return false;
    return true;
  });
}
export function scopeLabel(scope: LearningScope, courses: readonly Course[] = [], terms: readonly Term[] = []): string {
  return [scope.cumulative ? "Cumulative assessment" : terms.find((t) => t.id === scope.termId)?.name,
    !scope.cumulative ? courses.find((c) => c.id === scope.courseId)?.code : undefined, scope.module,
    scope.week ? `Week ${normalizeDecodeWeek(scope.week)}` : undefined, scope.lecture].filter(Boolean).join(" / ") || "All modules";
}

/** Exact normalized content key; answer letters and option order are not identity. */
export function decodeQuestionIdentity(q: QuestionRecord): string {
  return JSON.stringify([normalize(q.stem), q.options.map((o) => normalize(o.text)).sort()]);
}
export interface DecodeDuplicateGroup { representative: QuestionRecord; questionIds: string[]; sourceDocumentIds: string[] }
export function deduplicateDecodeQuestions(questions: readonly QuestionRecord[]): { questions: QuestionRecord[]; duplicateCount: number; groups: DecodeDuplicateGroup[] } {
  const grouped = new Map<string, DecodeDuplicateGroup>();
  for (const question of questions) {
    const key = decodeQuestionIdentity(question);
    const group = grouped.get(key) ?? { representative: question, questionIds: [], sourceDocumentIds: [] };
    if (!group.questionIds.includes(question.id)) group.questionIds.push(question.id);
    if (question.sourceDocumentId && !group.sourceDocumentIds.includes(question.sourceDocumentId)) group.sourceDocumentIds.push(question.sourceDocumentId);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()];
  return { questions: groups.map((g) => g.representative), duplicateCount: new Set(questions.map((q) => q.id)).size - groups.length, groups };
}
function fingerprint(value: unknown): string {
  const json = JSON.stringify(value);
  let left = 2166136261; let right = 5381;
  for (let i = 0; i < json.length; i++) { left = Math.imul(left ^ json.charCodeAt(i), 16777619); right = Math.imul(right, 33) ^ json.charCodeAt(i); }
  return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}:${json.length}`;
}
/** Only source-bearing fields participate. Attempts and learner edits never stale teaching. */
export function questionSourceFingerprint(q: QuestionRecord, documents: readonly SourceDocument[] = []): string {
  const doc = documents.find((d) => d.id === q.sourceDocumentId);
  const pages = [...new Set([q.sourcePage, q.extraction?.questionSourcePage, q.extraction?.answerEvidencePage, q.extraction?.explanationSourcePage].filter((v): v is number => Boolean(v)))];
  return fingerprint([q.id, q.stem, q.options.map((o) => [o.key, o.text]), q.correctKey, q.explanation, q.choiceRationales,
    q.objective, q.sourceDocumentId, q.sourcePage, q.extraction?.questionSourceSnippet, q.extraction?.answerEvidenceSnippet,
    q.extraction?.answerEvidence, q.extraction?.explanationSourceSnippet, doc?.checksum,
    pages.map((page) => [page, doc?.pageTexts?.[page - 1]])]);
}
export const questionFingerprint = questionSourceFingerprint;
export function analysisIsCurrent(a: QuestionAnalysis, q: QuestionRecord, documents: readonly SourceDocument[] = []): boolean {
  return a.questionId === q.id && a.sourceFingerprint === questionSourceFingerprint(q, documents);
}
export function decodeScopeFingerprint(questions: readonly QuestionRecord[], documents: readonly SourceDocument[] = []): string {
  return fingerprint(questions.map((q) => questionSourceFingerprint(q, documents)).sort());
}
function scored(attempt: QuestionAttempt): boolean { return attempt.status === "correct" || attempt.status === "incorrect" || attempt.status === "guessed"; }
function latestAttempt(q: QuestionRecord): QuestionAttempt | undefined {
  return q.attempts.filter(scored).map((attempt, index) => ({ attempt, index })).sort((a, b) => (Date.parse(b.attempt.at) || 0) - (Date.parse(a.attempt.at) || 0) || b.index - a.index)[0]?.attempt;
}
export interface DecodeMetrics {
  total: number; unique: number; duplicates: number; ready: number; needsReview: number;
  attempted: number; unseen: number; correct: number; incorrect: number; attempts: number;
  accuracy: number | null; averageSeconds: number | null; highConfidenceMisses: number;
}
export function decodeMetrics(questions: readonly QuestionRecord[]): DecodeMetrics {
  const dedup = deduplicateDecodeQuestions(questions);
  const byId = new Map(questions.map((q) => [q.id, q]));
  let attempted = 0; let correct = 0; let incorrect = 0; let attempts = 0; let highConfidenceMisses = 0; let seconds = 0; let timed = 0;
  for (const group of dedup.groups) {
    const seen = new Set<string>();
    const history = group.questionIds.flatMap((id) => {
      const question = byId.get(id)!;
      return question.attempts.filter(scored).filter((a) => {
        const answerText = question.options.find((o) => o.key === a.answerKey)?.text ?? a.answerKey;
        const key = JSON.stringify([a.at, answerText ? normalize(answerText) : undefined, a.status, a.confidence, a.timeSpentSeconds]);
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    }).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    attempts += history.length;
    for (const a of history) if (typeof a.timeSpentSeconds === "number" && Number.isFinite(a.timeSpentSeconds) && a.timeSpentSeconds >= 0) { seconds += a.timeSpentSeconds; timed++; }
    if (!history.length) continue;
    attempted++;
    if (history[0].status === "correct") correct++; else incorrect++;
    if (history[0].status !== "correct" && (history[0].confidence ?? 0) >= 4) highConfidenceMisses++;
  }
  return { total: questions.length, unique: dedup.questions.length, duplicates: dedup.duplicateCount, ready: dedup.groups.filter((g) => g.questionIds.some((id) => questionMappingStatus(byId.get(id)!) === "ready")).length, needsReview: questions.filter((q) => questionMappingStatus(q) !== "ready").length, attempted, unseen: dedup.questions.length - attempted, correct, incorrect, attempts, accuracy: attempted ? Math.round(correct / attempted * 100) : null, averageSeconds: timed ? Math.round(seconds / timed) : null, highConfidenceMisses };
}
export interface DecodePattern {
  id: string; concept: string; rule: string; questionIds: string[]; analysisIds: string[];
  uniqueQuestions: number; duplicateCount: number; sourceCount: number;
  sources: Array<{ documentId: string; title: string; questionCount: number }>;
  repairQuestionIds: string[]; evidence: "single-question" | "single-source" | "multiple-sources";
}
export function buildDecodePatterns(questions: readonly QuestionRecord[], analyses: readonly QuestionAnalysis[], documents: readonly SourceDocument[] = []): DecodePattern[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const newest = new Map<string, QuestionAnalysis>();
  for (const a of analyses) {
    const q = byId.get(a.questionId);
    if (!q || a.status !== "reviewed" || !analysisIsCurrent(a, q, documents)) continue;
    const existing = newest.get(q.id);
    if (!existing || Date.parse(a.generatedAt) > Date.parse(existing.generatedAt)) newest.set(q.id, a);
  }
  const patterns = new Map<string, DecodePattern>();
  for (const a of newest.values()) {
    const key = JSON.stringify([normalize(a.concept), normalize(a.rule)]);
    const pattern = patterns.get(key) ?? { id: `pattern-${fingerprint(key)}`, concept: a.concept, rule: a.rule, questionIds: [], analysisIds: [], uniqueQuestions: 0, duplicateCount: 0, sourceCount: 0, sources: [], repairQuestionIds: [], evidence: "single-question" };
    pattern.questionIds.push(a.questionId); pattern.analysisIds.push(a.id); patterns.set(key, pattern);
  }
  return [...patterns.values()].map((p) => {
    const members = p.questionIds.map((id) => byId.get(id)!);
    const groups = deduplicateDecodeQuestions(members);
    const sources = new Map<string, Set<string>>();
    for (const q of members) if (q.sourceDocumentId) { const keys = sources.get(q.sourceDocumentId) ?? new Set<string>(); keys.add(decodeQuestionIdentity(q)); sources.set(q.sourceDocumentId, keys); }
    return { ...p, uniqueQuestions: groups.questions.length, duplicateCount: groups.duplicateCount, sourceCount: sources.size,
      sources: [...sources].map(([documentId, keys]) => ({ documentId, title: documents.find((d) => d.id === documentId)?.title ?? "Imported source", questionCount: keys.size })),
      repairQuestionIds: members.filter((q) => { const latest = latestAttempt(q); return latest && latest.status !== "correct" && questionMappingStatus(q) === "ready"; }).map((q) => q.id),
      evidence: groups.questions.length < 2 ? "single-question" as const : sources.size > 1 ? "multiple-sources" as const : "single-source" as const };
  }).sort((a, b) => b.repairQuestionIds.length - a.repairQuestionIds.length || b.uniqueQuestions - a.uniqueQuestions || a.concept.localeCompare(b.concept));
}
export const buildPatternMap = buildDecodePatterns;
export interface DecodeNextAction { kind: "import" | "mapping" | "repair" | "questions" | "source"; title: string; reason: string; questionIds: string[] }
export function nextDecodeAction(questions: readonly QuestionRecord[], analyses: readonly QuestionAnalysis[] = [], priority: DecodeState["priority"] = "questions", documents: readonly SourceDocument[] = []): DecodeNextAction {
  if (!questions.length) return { kind: "import", title: "Load a question set", reason: "This scope has no questions yet.", questionIds: [] };
  const ready = questions.filter((q) => questionMappingStatus(q) === "ready");
  const readyIds = new Set(ready.map((q) => q.id));
  const needsReview = questions.filter((q) => !readyIds.has(q.id));
  if (!ready.length) return { kind: "mapping", title: "Review answer mappings", reason: `${needsReview.length} questions need a confirmed answer before scored practice.`, questionIds: needsReview.map((q) => q.id) };
  const repairs = ready.filter((q) => { const latest = latestAttempt(q); return latest && latest.status !== "correct"; }).sort((a, b) => (latestAttempt(b)?.confidence ?? 0) - (latestAttempt(a)?.confidence ?? 0));
  const unseen = ready.filter((q) => !latestAttempt(q));
  if (priority === "source") {
    const missing = ready.filter((q) => !analyses.some((a) => a.questionId === q.id && a.status === "reviewed" && analysisIsCurrent(a, q, documents)));
    return { kind: "source", title: "Review source teaching", reason: missing.length ? `${missing.length} questions have no current reviewed teaching map.` : "Use the reviewed explanations and source evidence for this scope.", questionIds: (missing.length ? missing : ready).map((q) => q.id) };
  }
  if (repairs.length && (priority === "repair" || !unseen.length)) return { kind: "repair", title: "Repair recent misses", reason: `${repairs.length} questions were missed or guessed on the latest scored attempt; higher-confidence misses come first.`, questionIds: deduplicateDecodeQuestions(repairs).questions.slice(0, 10).map((q) => q.id) };
  return { kind: "questions", title: unseen.length ? "Questions first" : "Practice this scope", reason: unseen.length ? `${unseen.length} ready questions have no scored attempt. Start with retrieval, then review the source.` : "The available questions are ready for another retrieval pass.", questionIds: deduplicateDecodeQuestions(unseen.length ? unseen : ready).questions.slice(0, 10).map((q) => q.id) };
}
