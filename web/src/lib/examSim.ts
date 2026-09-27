// ===========================================================================
// Exam simulation: block presets, per-item state, the block clock, item
// review and suspend/resume. The UI (components/questions/ExamSimulator)
// renders it in one of three faithful skins:
//
//   uworld   — left item navigator, Mark checkbox, Previous/Next in a navy
//              top bar, "Block Time Remaining" with Suspend/End Block below.
//   nbme     — USMLE/NBME (2026 Prometric software): clean top bar, navigator
//              on demand, settings menu (text up to 200%, dark theme, image
//              contrast), searchable lab values, Item Review screen at the end.
//   examsoft — Examplify: question list pane with Unanswered/Flagged filters,
//              flags, eye strike-out, hideable timer and a 5-minute alarm.
//
// Research notes: USMLE moved Step 1 and Step 2 CK to 30-minute blocks of
// 18–20 items in May 2026 (usmle.org, "Test Delivery Software Updates").
// ===========================================================================
import type { QuizAnswer } from "./quiz";
import type { QuestionAnnotationTone } from "./questionAnnotations";

export type ExamSkin = "uworld" | "nbme" | "examsoft";

export const EXAM_SKINS: Record<ExamSkin, { label: string; description: string }> = {
  uworld: { label: "UWorld-style", description: "Left navigator, Mark, lab values, notes and a block timer with Suspend." },
  nbme: { label: "USMLE / NBME (2026)", description: "The Prometric interface: settings menu, searchable labs, Item Review before you end." },
  examsoft: { label: "ExamSoft (Examplify)", description: "School exams: question list with filters, flags, strike-out and a 5-minute alarm." },
};

export interface BlockPreset {
  id: "usmle-2026" | "classic-40" | "shelf" | "custom";
  label: string;
  items?: number;
  minutes?: number;
  note: string;
}

export const BLOCK_PRESETS: BlockPreset[] = [
  { id: "usmle-2026", label: "USMLE block", items: 20, minutes: 30, note: "20 items · 30 min — Step 1 & 2 CK since May 2026" },
  { id: "classic-40", label: "Classic block", items: 40, minutes: 60, note: "40 items · 60 min — UWorld default, pre-2026 USMLE" },
  { id: "shelf", label: "Shelf pace", items: 50, minutes: 75, note: "50 items · 75 min — NBME subject-exam pace (90 s/item)" },
  { id: "custom", label: "Custom", note: "Your count, 90 s per item when timed" },
];

export interface ExamItemState {
  answerKey?: string;
  marked: boolean;
  struck: string[];
  /** Seconds spent on this item across visits. */
  seconds: number;
  visited: boolean;
  /** Tutor mode: the answer has been submitted and revealed. */
  submitted?: boolean;
}

export function emptyItem(): ExamItemState {
  return { marked: false, struck: [], seconds: 0, visited: false };
}

export type ReviewFilter = "all" | "incomplete" | "marked";

export function reviewIndices(ids: readonly string[], items: Readonly<Record<string, ExamItemState>>, filter: ReviewFilter): number[] {
  return ids.flatMap((id, index) => {
    const item = items[id];
    if (filter === "incomplete" && item?.answerKey) return [];
    if (filter === "marked" && !item?.marked) return [];
    return [index];
  });
}

export function blockCounts(ids: readonly string[], items: Readonly<Record<string, ExamItemState>>) {
  let answered = 0;
  let marked = 0;
  let seen = 0;
  for (const id of ids) {
    const item = items[id];
    if (item?.answerKey) answered += 1;
    if (item?.marked) marked += 1;
    if (item?.visited) seen += 1;
  }
  return { answered, incomplete: ids.length - answered, marked, seen, total: ids.length };
}

// --- Clock ------------------------------------------------------------------
// Elapsed time accumulates only while the block runs, so Suspend pauses it
// (as UWorld does) and a reload never counts time the learner was away.

export interface BlockClock {
  elapsedMs: number;
  runningSince?: number;
}

export function clockElapsedMs(clock: BlockClock, now = Date.now()): number {
  return clock.elapsedMs + (clock.runningSince !== undefined ? Math.max(0, now - clock.runningSince) : 0);
}

export function pauseClock(clock: BlockClock, now = Date.now()): BlockClock {
  return { elapsedMs: clockElapsedMs(clock, now) };
}

export function resumeClock(clock: BlockClock, now = Date.now()): BlockClock {
  return clock.runningSince !== undefined ? clock : { elapsedMs: clock.elapsedMs, runningSince: now };
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
}

// --- Suspend / resume ---------------------------------------------------------

export const EXAM_SIM_SUSPENDED_KEY = "axom.examSim.suspended.v1";
export const EXAM_SIM_PREFS_KEY = "axom.examSim.prefs.v1";

export interface SuspendedBlock {
  version: 1;
  skin: ExamSkin;
  mode: "exam" | "tutor";
  poolIds: string[];
  index: number;
  items: Record<string, ExamItemState>;
  elapsedMs: number;
  timeLimitSeconds?: number;
  notes: string;
  startedAt: string;
  suspendedAt: string;
}

export function readSuspendedBlock(): SuspendedBlock | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY) ?? "null") as SuspendedBlock | null;
    if (!value || value.version !== 1 || !Array.isArray(value.poolIds) || !value.poolIds.length || !(value.skin in EXAM_SKINS)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function writeSuspendedBlock(block: SuspendedBlock | null): void {
  try {
    if (block) localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, JSON.stringify(block));
    else localStorage.removeItem(EXAM_SIM_SUSPENDED_KEY);
  } catch { /* device-only convenience */ }
}

export interface ExamSimPrefs {
  /** 1–2 (USMLE 2026 allows text up to 200%). */
  textScale: number;
  theme: "light" | "dark";
  highlightColor: QuestionAnnotationTone;
  showTimer: boolean;
  fiveMinuteAlert: boolean;
}

export const DEFAULT_EXAM_SIM_PREFS: ExamSimPrefs = { textScale: 1, theme: "light", highlightColor: "yellow", showTimer: true, fiveMinuteAlert: true };

export function readExamSimPrefs(): ExamSimPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(EXAM_SIM_PREFS_KEY) ?? "null") as Partial<ExamSimPrefs> | null;
    const prefs = { ...DEFAULT_EXAM_SIM_PREFS, ...(value ?? {}) };
    prefs.textScale = Math.min(2, Math.max(1, Number(prefs.textScale) || 1));
    if (prefs.theme !== "dark") prefs.theme = "light";
    if (!["yellow", "cyan", "purple"].includes(prefs.highlightColor)) prefs.highlightColor = "yellow";
    return prefs;
  } catch {
    return DEFAULT_EXAM_SIM_PREFS;
  }
}

export function writeExamSimPrefs(prefs: ExamSimPrefs): void {
  try { localStorage.setItem(EXAM_SIM_PREFS_KEY, JSON.stringify(prefs)); } catch { /* device pref only */ }
}

/** Answers in pool order, scored only where the answer mapping is trusted. */
export function answersFromItems(
  ids: readonly string[],
  items: Readonly<Record<string, ExamItemState>>,
  correctKeyFor: (id: string) => string | undefined,
): QuizAnswer[] {
  return ids.map((id) => {
    const item = items[id] ?? emptyItem();
    const correctKey = correctKeyFor(id);
    return {
      questionId: id,
      answerKey: item.answerKey,
      correct: correctKey ? item.answerKey === correctKey : undefined,
      flagged: item.marked,
      seconds: Math.round(item.seconds),
    };
  });
}
