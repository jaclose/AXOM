import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "../../lib/notify";
import { Coffee, Lock, Play, Timer, Waves, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import { usePomodoro } from "../../lib/pomodoro";
import { findLiveSession } from "../../lib/sessions";
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
  | { kind: "prompt"; seed: number; progress: FocusProgressHint; preview: boolean }
  | { kind: "reply"; response: FocusCheckInResponse; line: string };

/** What is left right now: the running sprint and the nearest unmet target. */
export function focusProgressHint(
  state: Pick<NoctyriumState, "profile" | "logs" | "productivityTrackers" | "habits" | "habitEntries" | "closeouts" | "activeDayKey">,
  pomodoro: { phase: string; running: boolean; secondsLeft: number },
): FocusProgressHint {
  const hint: FocusProgressHint = {};
  if (pomodoro.running && pomodoro.phase === "focus" && pomodoro.secondsLeft > 0) {
    hint.sprint = `${formatMinutes(Math.ceil(pomodoro.secondsLeft / 60))} left in this sprint`;
  }
  try {
    const result = evaluateDailySuccess(state);
    const open = result.requirements.find((item) => (
      item.eligible && item.status !== "met" && item.status !== "unavailable" && item.target > item.current
    ));
    if (open) {
      const remaining = open.target - open.current;
      const unit = open.requirement.unit.toLowerCase();
      const amount = /min/.test(unit) ? formatMinutes(remaining) : `${Math.round(remaining)} ${unit}`;
      hint.target = `${amount} to go on ${open.requirement.label}`;
    } else if (result.eligibleCount > 0 && result.metCount === result.eligibleCount) {
      hint.targetsMet = true;
    }
  } catch {
    // Progress copy is optional; the check-in still works without it.
  }
  return hint;
}

/**
 * App-root watcher + the check-in card. It never steals focus from what the
 * learner is typing; the card is announced politely and dismisses itself.
 */
export function FocusCheckIn({ pollIntervalMs = 20_000, clock = () => new Date() }: { pollIntervalMs?: number; clock?: () => Date } = {}) {
  const preferencesRaw = useStore((state) => state.profile.focusCheckIn);
  const quietHours = useStore((state) => state.profile.dailyLoopReminders);
  const sessions = useStore((state) => state.sessions);
  const pomodoroRunning = usePomodoro((state) => state.running && state.phase === "focus");
  const [phase, setPhase] = useState<Phase>({ kind: "hidden" });
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
    const now = clock();
    const state = useStore.getState();
    const pomodoro = usePomodoro.getState();
    const current = focusCheckInLedger.read(dayOf(now));
    const next = preview ? current : markPrompted(current, now);
    if (!preview) persist(next);
    setPhase({
      kind: "prompt",
      seed: next.prompts + now.getHours() * 7 + now.getMinutes(),
      progress: focusProgressHint(state, pomodoro),
      preview,
    });
    // A desktop window is often visible but behind other apps: notify
    // whenever AXOM is not the focused window, not only when it is hidden.
    if (!preview && preferences.systemNotifications && typeof document !== "undefined" && (document.visibilityState === "hidden" || !document.hasFocus())) {
      notifyLockIn(focusProgressHint(state, pomodoro));
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

  // Unanswered prompts step aside after a minute; replies after a few seconds.
  useEffect(() => {
    if (phase.kind === "hidden") return;
    const handle = window.setTimeout(() => setPhase({ kind: "hidden" }), phase.kind === "prompt" ? 60_000 : 5_500);
    return () => window.clearTimeout(handle);
  }, [phase]);

  useEffect(() => {
    if (phase.kind === "hidden") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhase({ kind: "hidden" });
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
    setPhase({
      kind: "reply",
      response,
      line: responseLine(response, preferences.tone, phase.seed + next.lockedIn, phase.progress, next.streak),
    });
  }

  function snoozeFor(minutes: number) {
    const now = clock();
    if (phase.kind === "prompt" && !phase.preview) persist(snooze(focusCheckInLedger.read(dayOf(now)), minutes, now));
    setPhase({ kind: "hidden" });
  }

  if (phase.kind === "hidden") return null;

  const pomodoro = usePomodoro.getState();
  const progress = phase.kind === "prompt" ? phase.progress : undefined;

  return (
    <div className={`focus-checkin ${phase.kind}`} role="dialog" aria-modal="false" aria-labelledby="focus-checkin-title" aria-live="polite">
      <div className="focus-checkin-glow" aria-hidden="true" />
      <button type="button" className="focus-checkin-close" aria-label="Dismiss check-in" onClick={() => setPhase({ kind: "hidden" })}>
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
              setPhase({ kind: "hidden" });
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
            <div id="focus-checkin-title" className="focus-checkin-title">{phase.line}</div>
            {phase.response === "drifted" && !pomodoro.running && (
              <button type="button" className="focus-checkin-restart" onClick={() => {
                usePomodoro.getState().start();
                setPhase({ kind: "hidden" });
              }}>
                <Play size={ICON_SIZE.body} aria-hidden="true" /> Restart a focus sprint
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const dayOf = isoDate;

function notifyLockIn(progress: FocusProgressHint) {
  void notify("AXOM — are you locked in?", progress.target ?? progress.sprint ?? "Quick check-in. Come back when you can.", { tag: "axom-lock-in" });
}
