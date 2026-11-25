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
import { ANNOTATION_TONES, type QuestionAnnotationTone } from "./questionAnnotations";

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
const EXAM_SIM_RUN_ID_KEY = `${EXAM_SIM_SUSPENDED_KEY}:run-id`;
const EXAM_SIM_RUN_PREFIX = `${EXAM_SIM_SUSPENDED_KEY}:run:`;

export interface SuspendedBlock {
  version: 1;
  /** Stable identity for durable finalization. Absent on legacy snapshots. */
  runId?: string;
  skin: ExamSkin;
  mode: "exam" | "tutor";
  poolIds: string[];
  /** SHA-256 of the immutable displayed source, never raw question content. Missing entries are unverified. */
  sourceEvidenceV1?: Record<string, string>;
  index: number;
  items: Record<string, ExamItemState>;
  elapsedMs: number;
  timeLimitSeconds?: number;
  notes: string;
  startedAt: string;
  suspendedAt: string;
}

/** V1 snapshots are untrusted browser data. Sparse items and the documented
 * optional legacy fields are valid; malformed values must not reach the engine
 * or be silently normalized and rewritten by a resume. */
function parseSuspendedBlock(raw: string | null): SuspendedBlock | undefined {
  try {
    const value = JSON.parse(raw ?? "null") as SuspendedBlock | null;
    if (!value || value.version !== 1 || !Array.isArray(value.poolIds) || !value.poolIds.length
      || value.poolIds.some((id) => typeof id !== "string" || !id
        || Object.prototype.hasOwnProperty.call(Object.prototype, id))
      || new Set(value.poolIds).size !== value.poolIds.length
      || (value.runId !== undefined && (typeof value.runId !== "string" || !value.runId))
      || typeof value.skin !== "string" || !Object.prototype.hasOwnProperty.call(EXAM_SKINS, value.skin)
      || (value.mode !== "exam" && value.mode !== "tutor")
      || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.poolIds.length
      || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0
      || (value.timeLimitSeconds !== undefined && (!Number.isFinite(value.timeLimitSeconds) || value.timeLimitSeconds <= 0))
      || typeof value.notes !== "string"
      || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
      || typeof value.suspendedAt !== "string" || !Number.isFinite(Date.parse(value.suspendedAt))
      || !value.items || typeof value.items !== "object" || Array.isArray(value.items)) return undefined;

    const pool = new Set(value.poolIds);
    for (const [id, item] of Object.entries(value.items)) {
      if (!pool.has(id) || !item || typeof item !== "object" || Array.isArray(item)
        || (item.answerKey !== undefined && (typeof item.answerKey !== "string" || !item.answerKey))
        || typeof item.marked !== "boolean" || typeof item.visited !== "boolean"
        || (item.submitted !== undefined && typeof item.submitted !== "boolean")
        || !Array.isArray(item.struck) || item.struck.some((key) => typeof key !== "string" || !key)
        || !Number.isFinite(item.seconds) || item.seconds < 0) return undefined;
    }
    if (value.sourceEvidenceV1 !== undefined
      && (!value.sourceEvidenceV1 || typeof value.sourceEvidenceV1 !== "object" || Array.isArray(value.sourceEvidenceV1)
        || Object.entries(value.sourceEvidenceV1).some(([id, fingerprint]) => !pool.has(id) || typeof fingerprint !== "string"))) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function suspendedRunKey(runId: string): string {
  return `${EXAM_SIM_RUN_PREFIX}${runId}`;
}

function rememberSuspendedRun(runId: string): boolean {
  try {
    sessionStorage.setItem(EXAM_SIM_RUN_ID_KEY, runId);
    return sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY) === runId;
  } catch {
    return false;
  }
}

function sameLegacySuspendedRun(left: SuspendedBlock, right: SuspendedBlock): boolean {
  return left.mode === right.mode && left.skin === right.skin && left.startedAt === right.startedAt
    && left.poolIds.length === right.poolIds.length
    && left.poolIds.every((id, index) => id === right.poolIds[index]);
}

function anotherSuspendedBlock(excludingKey: string): SuspendedBlock | undefined {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key === excludingKey || !key.startsWith(EXAM_SIM_RUN_PREFIX)) continue;
      const candidate = parseSuspendedBlock(localStorage.getItem(key));
      if (candidate) return candidate;
    }
  } catch { /* no replacement is available */ }
  return undefined;
}

export function readSuspendedBlock(): SuspendedBlock | undefined {
  try {
    const remembered = sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY);
    const scoped = remembered ? parseSuspendedBlock(localStorage.getItem(suspendedRunKey(remembered))) : undefined;
    if (scoped) return scoped;
    const legacy = parseSuspendedBlock(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY));
    if (legacy?.runId) rememberSuspendedRun(legacy.runId);
    return legacy;
  } catch {
    return undefined;
  }
}

export type SuspendedRecoveryRead =
  | { status: "absent" }
  | { status: "present"; block: SuspendedBlock }
  | { status: "unreadable" };

function readCheckedSuspendedCopy(key: string): SuspendedBlock | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  const block = parseSuspendedBlock(raw);
  if (!block || !Object.prototype.hasOwnProperty.call(EXAM_SKINS, block.skin)
    || !block.items || typeof block.items !== "object" || Array.isArray(block.items)
    || (block.mode !== "exam" && block.mode !== "tutor")) {
    throw new Error("Unverifiable suspended exam recovery.");
  }
  return block;
}

function sameSuspendedSnapshot(left: SuspendedBlock, right: SuspendedBlock): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Setup actions must distinguish verified absence from unavailable or conflicting
 * recovery. Do not silently select orphaned runs or rewrite recovery on read. */
export function inspectSuspendedBlock(): SuspendedRecoveryRead {
  try {
    const remembered = sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY);
    const scoped = remembered ? readCheckedSuspendedCopy(suspendedRunKey(remembered)) : undefined;
    if (scoped && scoped.runId !== remembered) return { status: "unreadable" };
    const legacy = readCheckedSuspendedCopy(EXAM_SIM_SUSPENDED_KEY);
    const current = scoped ?? legacy;
    if (current) {
      if (current.runId) {
        const mirror = readCheckedSuspendedCopy(suspendedRunKey(current.runId));
        if (mirror && !sameSuspendedSnapshot(mirror, current)) return { status: "unreadable" };
        if (legacy?.runId === current.runId && !sameSuspendedSnapshot(legacy, current)) return { status: "unreadable" };
      }
      return { status: "present", block: current };
    }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || key.startsWith(EXAM_SIM_RUN_PREFIX)) return { status: "unreadable" };
    }
    return { status: "absent" };
  } catch {
    return { status: "unreadable" };
  }
}

/** Explicit, consented discard is not best-effort post-save cleanup. Verify
 * the selected snapshot and all matching copies before removing any of them,
 * then require readback. A distinct run (including a legacy run) is untouched. */
export function discardSuspendedBlock(expected: SuspendedBlock): boolean {
  try {
    const current = inspectSuspendedBlock();
    if (current.status !== "present" || !sameSuspendedSnapshot(current.block, expected)) return false;
    const keys: string[] = [];
    if (expected.runId) {
      const key = suspendedRunKey(expected.runId);
      const scoped = readCheckedSuspendedCopy(key);
      if (scoped) {
        if (!sameSuspendedSnapshot(scoped, expected)) return false;
        keys.push(key);
      }
    }
    const legacy = readCheckedSuspendedCopy(EXAM_SIM_SUSPENDED_KEY);
    if (legacy && legacy.runId === expected.runId) {
      if (!sameSuspendedSnapshot(legacy, expected)) return false;
      keys.push(EXAM_SIM_SUSPENDED_KEY);
    }
    if (!keys.length) return false;
    // Scoped first: if that removal fails, the legacy discovery copy survives.
    for (const key of keys) {
      const copy = readCheckedSuspendedCopy(key);
      if (!copy || !sameSuspendedSnapshot(copy, expected)) return false;
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) return false;
    }
    if (expected.runId && localStorage.getItem(suspendedRunKey(expected.runId)) !== null) return false;
    const remainingLegacy = readCheckedSuspendedCopy(EXAM_SIM_SUSPENDED_KEY);
    if (remainingLegacy && remainingLegacy.runId === expected.runId) return false;
    // The pointer contains no answers. Leave it intact on failed removal; a
    // later read can fall back to a distinct legacy run or verified absence.
    try {
      if (expected.runId && sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY) === expected.runId) {
        sessionStorage.removeItem(EXAM_SIM_RUN_ID_KEY);
      }
    } catch { /* optional pointer cleanup after verified removal */ }
    return true;
  } catch {
    return false;
  }
}

export function writeSuspendedBlock(block: SuspendedBlock | null): void {
  if (!block) {
    try {
      const remembered = sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY);
      if (remembered) localStorage.removeItem(suspendedRunKey(remembered));
      sessionStorage.removeItem(EXAM_SIM_RUN_ID_KEY);
      localStorage.removeItem(EXAM_SIM_SUSPENDED_KEY);
    } catch { /* explicit legacy cleanup remains best effort */ }
    return;
  }

  const serialized = JSON.stringify(block);
  try {
    if (!block.runId) {
      localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, serialized);
      if (localStorage.getItem(EXAM_SIM_SUSPENDED_KEY) === serialized) return;
      throw new Error("The browser did not retain the suspended exam.");
    }

    const pointerSaved = rememberSuspendedRun(block.runId);
    const runKey = suspendedRunKey(block.runId);
    let scopedSaved = false;
    try {
      localStorage.setItem(runKey, serialized);
      scopedSaved = localStorage.getItem(runKey) === serialized;
    } catch { /* the legacy key may still retain this run */ }

    let legacySaved = false;
    try {
      const legacyRaw = localStorage.getItem(EXAM_SIM_SUSPENDED_KEY);
      const legacy = parseSuspendedBlock(legacyRaw);
      // Upgrade the same pre-run-id snapshot, but never overwrite a different
      // valid suspended exam merely because this tab finalized later.
      const mayOwnLegacy = legacyRaw === null || legacy?.runId === block.runId
        || Boolean(legacy && !legacy.runId && sameLegacySuspendedRun(legacy, block));
      if (mayOwnLegacy) {
        localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, serialized);
        legacySaved = localStorage.getItem(EXAM_SIM_SUSPENDED_KEY) === serialized;
      }
    } catch { /* the per-run mirror may still be exact and discoverable */ }

    if (legacySaved || (scopedSaved && pointerSaved)) return;
    throw new Error("The browser did not retain the suspended exam.");
  } catch {
    throw new Error("Your exam could not be saved. Keep this window open and try again, or finish the block to save your answers.");
  }
}

/** Clear only the run whose durable workspace save was confirmed. A legacy
 * snapshot with no id, or a different tab's id, is deliberately preserved. */
export function clearSuspendedBlock(runId: string): void {
  const runKey = suspendedRunKey(runId);
  try { localStorage.removeItem(runKey); } catch { /* best effort after the durable save */ }
  try {
    if (sessionStorage.getItem(EXAM_SIM_RUN_ID_KEY) === runId) sessionStorage.removeItem(EXAM_SIM_RUN_ID_KEY);
  } catch { /* optional per-tab pointer */ }
  try {
    const legacyRaw = localStorage.getItem(EXAM_SIM_SUSPENDED_KEY);
    if (legacyRaw !== null) {
      const legacy = parseSuspendedBlock(legacyRaw);
      if (!legacy || legacy.runId !== runId) return;
    }
    const replacement = anotherSuspendedBlock(runKey);
    if (replacement) localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, JSON.stringify(replacement));
    else localStorage.removeItem(EXAM_SIM_SUSPENDED_KEY);
  } catch { /* best effort after the durable save */ }
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
    if (!ANNOTATION_TONES.includes(prefs.highlightColor)) prefs.highlightColor = "yellow";
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
