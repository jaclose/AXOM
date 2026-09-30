import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STORAGE_KEYS } from "../../lib/brand";
import { notify } from "../../lib/notify";
import { Coffee, Lock, Play, Timer, Waves, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import { usePomodoro } from "../../lib/pomodoro";
import { findLiveSession, sessionElapsedMs } from "../../lib/sessions";
import { isoDate } from "../../lib/scoring";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import {
  evaluateFocusCheckIn,
  focusCheckInLedger,
  formatMinutes,
  markPrompted,
  normalizeFocusCheckInPreferences,
  promptLine,
  recordResponse,
  responseLine,
  snooze,
  type FocusCheckInLedger,
  type FocusCheckInResponse,
  type FocusProgressHint,
} from "../../lib/focusCheckIn";
import type { NoctyriumState } from "../../lib/types";

export const FOCUS_CHECKIN_TEST_EVENT = "axom:focus-checkin-preview";

type Phase =
  | { kind: "hidden" }
  | { kind: "prompt"; seed: number; preview: boolean }
  | { kind: "reply"; response: FocusCheckInResponse; line: string; preview: boolean };

function restorePrompt(): Phase {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.focusCheckInPending) ?? "null");
    if (value?.kind === "prompt" && Number.isSafeInteger(value.seed)) return { kind: "prompt", seed: value.seed, preview: false };
  } catch { /* A blocked device store must not prevent a check-in. */ }
  return { kind: "hidden" };
}

const currentClock = () => new Date();

/** What is left right now: the running sprint and the nearest unmet target. */
export function focusProgressHint(
  state: Pick<NoctyriumState, "profile" | "logs" | "productivityTrackers" | "habits" | "habitEntries" | "closeouts" | "activeDayKey"> & Partial<Pick<NoctyriumState, "sessions">>,
  pomodoro: { phase: string; running: boolean; secondsLeft: number },
  now = new Date(),
): FocusProgressHint {
  const hint: FocusProgressHint = {};
  if (pomodoro.running && pomodoro.phase === "focus" && pomodoro.secondsLeft > 0) {
    hint.sprint = `${formatMinutes(Math.ceil(pomodoro.secondsLeft / 60))} left in this focus session`;
    return hint;
  }
  const session = findLiveSession(state.sessions ?? []);
  if (session?.status === "active" && session.plannedMinutes && session.plannedMinutes > 0) {
    const remaining = Math.max(0, Math.ceil(session.plannedMinutes - sessionElapsedMs(session, now) / 60_000));
    hint.sprint = remaining ? `${formatMinutes(remaining)} left in this focus session` : "Your planned focus time is complete";
    return hint;
  }
  try {
    const result = evaluateDailySuccess(state);
    const studyGoals = result.requirements.filter((item) => item.requirement.source.kind === "study-minutes" && item.eligible);
    const open = studyGoals.find((item) => ( item.status !== "met" && item.status !== "unavailable" && item.target > item.current
    ));
    if (open) {
      const remaining = open.target - open.current;
      const unit = open.requirement.unit.toLowerCase();
      const amount = /min/.test(unit) ? formatMinutes(remaining) : `${Math.round(remaining)} ${unit}`;
      const period = ["weekly-total", "times-per-week"].includes(open.requirement.schedule.kind) ? "this week's" : "today's";
      hint.target = `${amount} remaining toward ${period} ${open.requirement.label} goal`;
    } else if (studyGoals.length > 0 && studyGoals.every((item) => item.status === "met")) {
      hint.targetsMet = true;
    }
  } catch {
    // Progress copy is optional; the check-in still works without it.
  }
  return hint;
}

/**
 * App-root watcher + the check-in card. It never steals focus from what the
 * learner is typing; it remains until an explicit response or dismissal.
 */
export function FocusCheckIn({ pollIntervalMs = 20_000, clock = currentClock }: { pollIntervalMs?: number; clock?: () => Date } = {}) {
  const preferencesRaw = useStore((state) => state.profile.focusCheckIn);
  const quietHours = useStore((state) => state.profile.dailyLoopReminders);
  const sessions = useStore((state) => state.sessions);
  const pomodoroRunning = usePomodoro((state) => state.running && state.phase === "focus");
  const [phase, setPhase] = useState<Phase>(restorePrompt);
  const [exiting, setExiting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [, refreshProgress] = useState(0);
  const [ledger, setLedger] = useState<FocusCheckInLedger>(() => focusCheckInLedger.read(dayOf(clock())));
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const preferences = normalizeFocusCheckInPreferences(preferencesRaw);
  const focusActive = pomodoroRunning || findLiveSession(sessions ?? [])?.status === "active";

  const persist = useCallback((next: FocusCheckInLedger) => {
    focusCheckInLedger.write(next);
    setLedger(next);
  }, []);

  const openPrompt = useCallback((preview: boolean) => {
    setExiting(false);
    const now = clock();
    const state = useStore.getState();
    const pomodoro = usePomodoro.getState();
    const current = focusCheckInLedger.read(dayOf(now));
    const next = preview ? current : markPrompted(current, now);
    if (!preview) persist(next);
    setPhase({
      kind: "prompt",
      seed: next.prompts + now.getHours() * 7 + now.getMinutes(),
      preview,
    });
    // A desktop window is often visible but behind other apps: notify
    // whenever AXOM is not the focused window, not only when it is hidden.
    if (!preview && preferences.systemNotifications && typeof document !== "undefined" && (document.visibilityState === "hidden" || !document.hasFocus())) {
      notifyLockIn(focusProgressHint(state, pomodoro, now));
    }
  }, [clock, persist, preferences.systemNotifications]);

  useEffect(() => {
    function reconcile() {
      if (phaseRef.current.kind !== "hidden") return;
      const now = clock();
      const decision = evaluateFocusCheckIn({
        now,
        preferences,
        ledger: focusCheckInLedger.read(dayOf(now)),
        focusActive,
        quietHours,
      });
      const stored = focusCheckInLedger.read(dayOf(now));
      if (decision.ledger.armedAt !== stored.armedAt || decision.ledger.day !== stored.day) persist(decision.ledger);
      if (decision.kind === "prompt") openPrompt(false);
    }
    reconcile();
    const poll = pollIntervalMs > 0 ? window.setInterval(reconcile, pollIntervalMs) : undefined;
    const onVisible = () => { if (document.visibilityState === "visible") reconcile(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reconcile);
    return () => {
      if (poll !== undefined) window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reconcile);
    };
    // preferences is derived each render; its serialized identity is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, focusActive, openPrompt, persist, pollIntervalMs, quietHours, JSON.stringify(preferences)]);

  // Settings → "Preview a check-in" dispatches this event.
  useEffect(() => {
    const onPreview = () => openPrompt(true);
    window.addEventListener(FOCUS_CHECKIN_TEST_EVENT, onPreview);
    return () => window.removeEventListener(FOCUS_CHECKIN_TEST_EVENT, onPreview);
  }, [openPrompt]);

  // Only this small device interaction survives reload. Progress is always
  // derived live; persisting a countdown sentence would make it misleading.
  useEffect(() => {
    try {
      if (phase.kind !== "prompt" || phase.preview || exiting) localStorage.removeItem(STORAGE_KEYS.focusCheckInPending);
      else localStorage.setItem(STORAGE_KEYS.focusCheckInPending, JSON.stringify(phase));
    } catch { /* In-memory interaction still works when storage is unavailable. */ }
  }, [phase, exiting]);

  // Only an answered prompt times out. An unanswered check-in has no deadline.
  useEffect(() => {
    if (phase.kind !== "reply") return;
    const timeout = window.setTimeout(() => setExiting(true), 2200);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(() => {
      if (overlayRef.current?.contains(document.activeElement) && returnFocus.current?.isConnected) returnFocus.current.focus();
      setPhase({ kind: "hidden" });
      setExiting(false);
    }, 240);
    return () => window.clearTimeout(timeout);
  }, [exiting]);

  useEffect(() => {
    if (phase.kind === "hidden") return;
    const remember = () => {
      if (document.activeElement instanceof HTMLElement && !overlayRef.current?.contains(document.activeElement)) returnFocus.current = document.activeElement;
    };
    remember();
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind === "hidden") return;
    const refresh = () => refreshProgress((value) => value + 1);
    let minute = Math.ceil(usePomodoro.getState().secondsLeft / 60);
    const stopTimer = usePomodoro.subscribe((next, previous) => {
      const nextMinute = Math.ceil(next.secondsLeft / 60);
      if (nextMinute !== minute || next.running !== previous.running || next.phase !== previous.phase) { minute = nextMinute; refresh(); }
    });
    const stopStore = useStore.subscribe(refresh);
    const tick = window.setInterval(refresh, 30_000);
    return () => { stopTimer(); stopStore(); window.clearInterval(tick); };
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind === "hidden") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExiting(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase.kind]);

  function answer(response: FocusCheckInResponse) {
    if (phase.kind !== "prompt") return;
    const now = clock();
    const current = focusCheckInLedger.read(dayOf(now));
    const next = phase.preview ? current : recordResponse(current, response, now);
    if (!phase.preview) persist(next);
    // Answer buttons disappear in the reply. Restore the prior task before
    // removing keyboard focus from the document. The polite reply still speaks.
    if (overlayRef.current?.contains(document.activeElement) && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    setPhase({
      kind: "reply",
      response,
      preview: phase.preview,
      line: responseLine(response, preferences.tone, phase.seed + next.lockedIn),
    });
  }

  function snoozeFor(minutes: number) {
    const now = clock();
    if (phase.kind === "prompt" && !phase.preview) persist(snooze(focusCheckInLedger.read(dayOf(now)), minutes, now));
    setExiting(true);
  }

  if (phase.kind === "hidden") return null;

  const pomodoro = usePomodoro.getState();
  const progress = focusProgressHint(useStore.getState(), pomodoro, clock());

  return createPortal(
    <div ref={overlayRef} className={`focus-checkin ${phase.kind}${exiting ? " is-exiting" : ""}`} role="dialog" aria-modal="false" aria-labelledby="focus-checkin-title" aria-live="polite">
      <div className="focus-checkin-glow" aria-hidden="true" />
      <button type="button" className="focus-checkin-close" aria-label="Dismiss check-in" onClick={() => setExiting(true)}>
        <X size={ICON_SIZE.body} aria-hidden="true" />
      </button>
      {phase.kind === "prompt" ? (
        <>
          <div className="focus-checkin-head">
            <span className="focus-checkin-icon"><Lock size={ICON_SIZE.emphasis} aria-hidden="true" /></span>
            <div>
              <div id="focus-checkin-title" className="focus-checkin-title">Are you locked in?</div>
              <div className="focus-checkin-sub">{promptLine(preferences.tone, phase.seed)}</div>
            </div>
          </div>
          {(progress?.sprint || progress?.target) && (
            <div className="focus-checkin-progress">
              {progress.sprint && <span><Timer size={ICON_SIZE.microInline} aria-hidden="true" /> {progress.sprint}</span>}
              {progress.target && <span><Waves size={ICON_SIZE.microInline} aria-hidden="true" /> {progress.target}</span>}
            </div>
          )}
          {!progress.sprint && !progress.target && <p className="focus-checkin-sub">{progress.targetsMet ? "Your study goal is complete." : "Hope you're productive. Remember to log work done outside AXOM."}</p>}
          <div className="focus-checkin-actions">
            <button type="button" className="primary" onClick={() => answer("locked-in")}>
              <Lock size={ICON_SIZE.body} aria-hidden="true" /> Locked in
            </button>
            <button type="button" onClick={() => answer("drifted")}>I drifted</button>
            <button type="button" onClick={() => answer("break")}>
              <Coffee size={ICON_SIZE.body} aria-hidden="true" /> On a break
            </button>
          </div>
          <div className="focus-checkin-foot">
            <button type="button" onClick={() => snoozeFor(15)}>Snooze 15 min</button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => {
              setExiting(true);
              useStore.getState().updateProfile({ focusCheckIn: { ...preferences, enabled: false } });
            }}>Turn off check-ins</button>
            {phase.preview && <em>Preview — nothing is recorded</em>}
            {!phase.preview && ledger.prompts > 1 && <em>{ledger.lockedIn} of {ledger.lockedIn + ledger.drifted} locked in today</em>}
          </div>
        </>
      ) : (
        <div className={`focus-checkin-reply ${phase.response}`}>
          <span className="focus-checkin-icon">
            {phase.response === "break" ? <Coffee size={ICON_SIZE.emphasis} aria-hidden="true" /> : <Lock size={ICON_SIZE.emphasis} aria-hidden="true" />}
          </span>
          <div>
            <div id="focus-checkin-title" className="focus-checkin-title">{phase.response === "locked-in" ? "Locked in" : phase.response === "break" ? "Taking a break" : "Back to the work"}</div>
            <p className="focus-checkin-sub">{phase.line}</p>
            {phase.response === "locked-in" && (progress.sprint || progress.target) && (
              <p className="focus-checkin-sub">{progress.sprint ?? progress.target}</p>
            )}
            <button type="button" className="focus-checkin-restart" onClick={() => setExiting(true)}>Keep going</button>
            {phase.response === "drifted" && !pomodoro.running && (
              <button type="button" className="focus-checkin-restart" onClick={() => {
                usePomodoro.getState().start();
                setExiting(true);
              }}>
                <Play size={ICON_SIZE.body} aria-hidden="true" /> Restart a focus sprint
              </button>
            )}
          </div>
        </div>
      )}
    </div>, document.body,
  );
}

const dayOf = isoDate;

function notifyLockIn(progress: FocusProgressHint) {
  void notify("AXOM — are you locked in?", progress.sprint ?? progress.target ?? "Quick check-in. Come back when you can.", { tag: "axom-lock-in", route: "productivity" });
}
