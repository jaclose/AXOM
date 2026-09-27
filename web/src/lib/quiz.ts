// ===========================================================================
// Quiz sessions (pre-beta directive §7–8): tutor mode (immediate feedback)
// and exam mode (deferred feedback, optional timer). Sessions persist so the
// dashboard/reports can surface weak categories, recent blocks, and retry
// queues. Pure + testable; persistence in store.ts (schema v29).
// ===========================================================================
import type { ID } from "./types";
import {
  questionMappingStatus,
  type QuestionDifficulty, type QuestionExamType, type QuestionRecord,
} from "./questions";
import type { QuestionSet } from "./library";

export type QuizMode = "tutor" | "exam";

export type QuizPoolStatus = "all" | "unused" | "incorrect" | "marked";

export interface QuizFilters {
  count: number;
  status: QuizPoolStatus;
  categories?: string[];
  examTypes?: QuestionExamType[];
  difficulties?: QuestionDifficulty[];
  banks?: string[];
  topics?: string[];
  /** Restrict to specific question sets / source documents (Block Builder). */
  setIds?: string[];
  documentIds?: string[];
  /** Keep document order instead of shuffling. */
  ordered?: boolean;
}

/** A saved, re-runnable custom block definition (Block Builder). */
export interface QuizBlock {
  id: ID;
  title: string;
  mode: QuizMode;
  timed: boolean;
  filters: QuizFilters;
  createdAt: string;
  lastRunAt?: string;
}

export interface QuizAnswer {
  questionId: ID;
  answerKey?: string;
  correct?: boolean; // undefined when the question has no correct key set
  flagged: boolean;
  seconds?: number;
}

export interface QuizSession {
  id: ID;
  mode: QuizMode;
  startedAt: string;
  endedAt?: string;
  timed: boolean;
  /** Planned limit in seconds for timed exams; elapsed derives from timestamps. */
  timeLimitSeconds?: number;
  filters: QuizFilters;
  questionIds: ID[];
  answers: QuizAnswer[];
  score?: { correct: number; scored: number; total: number; pct: number };
  /** Set when the block ran in an exam-interface simulation (lib/examSim). */
  simulation?: { skin: string; preset?: string; elapsedSeconds?: number };
}

// --- pool building -----------------------------------------------------------

export function buildQuizPool(
  questions: QuestionRecord[],
  filters: QuizFilters,
  questionSets: readonly Pick<QuestionSet, "id" | "questionIds">[] = [],
): QuestionRecord[] {
  // Imported mappings are runnable only after the canonical review gate says
  // they are trustworthy. This prevents a provisional/unresolved key from
  // being scored or revealed as fact.
  let pool = questions.filter((q) => q.options.length >= 2 && questionMappingStatus(q) === "ready");
  let explicitMembership = false;
  if (filters.setIds?.length) {
    const setsById = new Map(questionSets.map((set) => [set.id, set]));
    const explicitIds: string[] = [];
    const legacySetIds = new Set<string>();
    for (const setId of filters.setIds) {
      const selected = setsById.get(setId);
      if (selected?.questionIds.length) {
        explicitMembership = true;
        explicitIds.push(...selected.questionIds);
      } else {
        legacySetIds.add(setId);
      }
    }
    if (explicitMembership) {
      const runnableById = new Map(pool.map((question) => [question.id, question]));
      const seen = new Set<string>();
      const snapshotPool = explicitIds.flatMap((id) => {
        const question = runnableById.get(id);
        if (!question || seen.has(id)) return [];
        seen.add(id);
        return [question];
      });
      const legacyPool = legacySetIds.size
        ? pool.filter((question) => question.setId && legacySetIds.has(question.setId) && !seen.has(question.id))
        : [];
      pool = [...snapshotPool, ...legacyPool];
    } else {
      pool = pool.filter((question) => question.setId && legacySetIds.has(question.setId));
    }
  }
  if (filters.status === "unused") pool = pool.filter((q) => q.attempts.length === 0);
  else if (filters.status === "incorrect") pool = pool.filter((q) => q.status === "incorrect" || q.status === "guessed");
  else if (filters.status === "marked") pool = pool.filter((q) => q.marked || q.status === "flagged");
  if (filters.categories?.length) {
    const set = new Set(filters.categories.map((c) => c.toLowerCase()));
    pool = pool.filter((q) => (q.category && set.has(q.category.toLowerCase()))
      || (q.system && set.has(q.system.toLowerCase())));
  }
  if (filters.examTypes?.length) {
    const set = new Set(filters.examTypes);
    pool = pool.filter((q) => q.examType && set.has(q.examType));
  }
  if (filters.difficulties?.length) {
    const set = new Set(filters.difficulties);
    pool = pool.filter((q) => q.difficulty && set.has(q.difficulty));
  }
  if (filters.banks?.length) {
    const set = new Set(filters.banks.map((b) => b.toLowerCase()));
    pool = pool.filter((q) => q.bank && set.has(q.bank.toLowerCase()));
  }
  if (filters.topics?.length) {
    const set = new Set(filters.topics.map((t) => t.toLowerCase()));
    pool = pool.filter((q) => q.topic && set.has(q.topic.toLowerCase()));
  }
  if (filters.documentIds?.length) {
    const set = new Set(filters.documentIds);
    pool = pool.filter((q) => q.sourceDocumentId && set.has(q.sourceDocumentId));
  }
  const picked = explicitMembership
    ? pool
    : filters.ordered
    ? [...pool].sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0))
    : shuffle(pool);
  return picked.slice(0, Math.max(1, filters.count));
}

/** Deterministic-enough Fisher–Yates; callers wanting stable order can sort after. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- scoring -----------------------------------------------------------------

export function scoreSession(answers: QuizAnswer[]): { correct: number; scored: number; total: number; pct: number } {
  const scored = answers.filter((a) => a.correct !== undefined);
  const correct = scored.filter((a) => a.correct).length;
  return {
    correct,
    scored: scored.length,
    total: answers.length,
    pct: scored.length ? Math.round((correct / scored.length) * 100) : 0,
  };
}

// --- summaries (§8) ------------------------------------------------------------

export interface CategoryScore {
  category: string;
  attempts: number;
  correct: number;
  pct: number;
}

/** Accuracy by category/system across saved sessions. */
export function scoresByCategory(sessions: QuizSession[], questions: QuestionRecord[]): CategoryScore[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const agg = new Map<string, { attempts: number; correct: number }>();
  for (const session of sessions) {
    for (const answer of session.answers) {
      if (answer.correct === undefined) continue;
      const q = byId.get(answer.questionId);
      const category = q?.category ?? q?.system ?? q?.topic;
      if (!category) continue;
      const entry = agg.get(category) ?? { attempts: 0, correct: 0 };
      entry.attempts++;
      if (answer.correct) entry.correct++;
      agg.set(category, entry);
    }
  }
  return [...agg.entries()]
    .map(([category, v]) => ({ category, ...v, pct: Math.round((v.correct / v.attempts) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.attempts - a.attempts);
}

/** Question ids missed in a session — feeds "retake missed" and repair cards. */
export function missedQuestionIds(session: QuizSession): ID[] {
  return session.answers.filter((a) => a.correct === false).map((a) => a.questionId);
}

export function sessionElapsedSeconds(session: QuizSession, now: Date = new Date()): number {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 1000);
}
