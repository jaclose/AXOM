// ===========================================================================
// Menu bar timer: pure helpers for mirroring the Pomodoro clock into the macOS
// menu bar of the desktop app. The web timer stays the source of truth. It
// sends the native side a snapshot only when something visible changes, and
// the native side (src-tauri/src/menu_bar_timer.rs) counts down on its own
// between snapshots, so nothing crosses the bridge on every tick.
// ===========================================================================
import type { PomodoroPhase } from "./pomodoro";
import type { PomodoroPreferences } from "./types";

export const MENU_BAR_UPDATE_COMMAND = "menu_bar_timer_update";
export const MENU_BAR_CLEAR_COMMAND = "menu_bar_timer_clear";
export const MENU_BAR_ACTION_EVENT = "menu-bar-timer://action";
/** Longest label shown in the menu bar tooltip (characters). */
export const MENU_BAR_LABEL_MAX = 40;
/** Longest countdown the native side accepts (24 hours). */
export const MENU_BAR_MAX_SECONDS = 24 * 60 * 60;
/** Drift between the two running clocks tolerated before a re-sync (seconds). */
export const MENU_BAR_DRIFT_TOLERANCE_SECONDS = 2;

/** Mirrors `MenuBarTimerInput` in menu_bar_timer.rs. */
export interface MenuBarTimerSnapshot {
  enabled: boolean;
  phase: PomodoroPhase;
  running: boolean;
  secondsLeft: number;
  /** The phase has not started yet: paused at its full length. */
  idle: boolean;
  label?: string;
}

/** The slice of Pomodoro state the menu bar needs. */
export interface MenuBarTimerSource {
  phase: PomodoroPhase;
  running: boolean;
  secondsLeft: number;
  targetLabel?: string;
  intention?: string;
}

export type MenuBarTimerAction = "toggle" | "start" | "pause" | "skip" | "reset";

const MENU_BAR_ACTIONS: readonly MenuBarTimerAction[] = ["toggle", "start", "pause", "skip", "reset"];

/** The menu bar timer is on unless the learner switched it off. */
export function isMenuBarTimerEnabled(preferences: Pick<PomodoroPreferences, "showInMenuBar"> | undefined): boolean {
  return preferences?.showInMenuBar !== false;
}

/** Sprint target, else intention: whitespace-collapsed and capped at 40 characters. */
export function menuBarLabel(source: Pick<MenuBarTimerSource, "targetLabel" | "intention">): string | undefined {
  const raw = source.targetLabel?.trim() ? source.targetLabel : source.intention;
  const characters = Array.from((raw ?? "").replace(/\s+/g, " ").trim()).filter((character) => !isControlCharacter(character));
  if (characters.length === 0) return undefined;
  if (characters.length <= MENU_BAR_LABEL_MAX) return characters.join("");
  return `${characters.slice(0, MENU_BAR_LABEL_MAX - 1).join("").trimEnd()}…`;
}

/**
 * Snapshot for the native side. `phaseSeconds` is the full length of the
 * current phase; when given, a paused clock at that length reads as idle so
 * the menu offers "Start focus" instead of "Resume".
 */
export function menuBarSnapshot(source: MenuBarTimerSource, enabled: boolean, phaseSeconds?: number): MenuBarTimerSnapshot {
  const secondsLeft = clampSeconds(source.secondsLeft);
  const label = menuBarLabel(source);
  return {
    enabled,
    phase: source.phase === "break" ? "break" : "focus",
    running: source.running,
    secondsLeft,
    idle: !source.running && phaseSeconds !== undefined && secondsLeft >= clampSeconds(phaseSeconds),
    ...(label ? { label } : {}),
  };
}

/**
 * Whether `next` must be sent, given the last sent snapshot and when it was
 * sent. Any change the native side cannot infer is sent (enabled, phase,
 * running, idle, label). A running clock is only re-sent once it drifts from
 * the native countdown by the tolerance, so ordinary ticks never cross the
 * bridge while reset, skip, or a new preset (clock jumps) always do. A paused
 * clock does not count down, so any change to it is sent.
 */
export function shouldSendSnapshot(
  prev: MenuBarTimerSnapshot | null,
  next: MenuBarTimerSnapshot,
  prevSentAtMs: number,
  nowMs: number,
): boolean {
  if (!prev) return true;
  if (prev.enabled !== next.enabled) return true;
  // Hidden either way: nothing to redraw until it is switched back on.
  if (!next.enabled) return false;
  if (prev.phase !== next.phase || prev.running !== next.running || prev.idle !== next.idle || prev.label !== next.label) return true;
  if (!next.running) return next.secondsLeft !== prev.secondsLeft;
  const elapsedSeconds = Math.max(0, (nowMs - prevSentAtMs) / 1000);
  const expected = Math.max(0, prev.secondsLeft - elapsedSeconds);
  return Math.abs(next.secondsLeft - expected) >= MENU_BAR_DRIFT_TOLERANCE_SECONDS;
}

/** Validate an event payload from the native menu. */
export function parseMenuBarAction(payload: unknown): MenuBarTimerAction | null {
  return typeof payload === "string" && (MENU_BAR_ACTIONS as readonly string[]).includes(payload)
    ? (payload as MenuBarTimerAction)
    : null;
}

function clampSeconds(value: number): number {
  const seconds = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(MENU_BAR_MAX_SECONDS, seconds));
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}
