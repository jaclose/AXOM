import { useEffect } from "react";
import { closeoutForDay } from "../../lib/closeout";
import {
  dailyLoopReminderLedger,
  evaluateDailyLoopReminder,
  normalizeDailyLoopReminderPreferences,
  type DailyLoopReminderLedger,
  type DailyLoopReminderSignal,
} from "../../lib/dailyLoopReminders";
import { isoDate } from "../../lib/scoring";
import { useStore } from "../../lib/store";
import { pushToast, REMINDER_TOAST_DURATION_MS } from "../../lib/toast";
import { useUi } from "../../lib/uiStore";

export const DAILY_LOOP_REMINDER_OPEN_EVENT = "axom:daily-loop-reminder-open";

const systemNow = () => new Date();

export interface DailyLoopReminderWatcherProps {
  ledger?: DailyLoopReminderLedger;
  clock?: () => Date;
  onSignal?: (signal: DailyLoopReminderSignal) => void;
  onOpen?: (signal: DailyLoopReminderSignal) => void;
  pollIntervalMs?: number;
}

/**
 * App-root delivery for the morning check-in and evening closeout. It renders
 * no overlay: signals use the existing bottom-corner toast region and every
 * reconciliation recomputes the device-local day before checking completion.
 */
export function DailyLoopReminderWatcher({
  ledger = dailyLoopReminderLedger,
  clock = systemNow,
  onSignal,
  onOpen,
  pollIntervalMs = 60_000,
}: DailyLoopReminderWatcherProps = {}) {
  const reminderPreferences = useStore((state) => state.profile.dailyLoopReminders);
  const dayPlans = useStore((state) => state.dayPlans);
  const closeouts = useStore((state) => state.closeouts);

  useEffect(() => {
    function reconcile() {
      const now = clock();
      const preferences = normalizeDailyLoopReminderPreferences(reminderPreferences);
      const dayKey = isoDate(now);
      const evaluation = evaluateDailyLoopReminder({
        now,
        preferences,
        metadata: ledger.read(dayKey),
        checkInComplete: dayPlans.some((plan) => plan.dayKey === dayKey),
        closeoutComplete: Boolean(closeoutForDay(closeouts ?? [], dayKey)),
      });
      const signal = evaluation.signal;
      if (!signal) return;

      // Mark before publishing so StrictMode replay and simultaneous lifecycle
      // events cannot create a second toast.
      ledger.markShown(signal.dayKey, signal.kind, now);
      onSignal?.(signal);
      pushToast(toastForSignal(signal, {
        open: () => {
          routeToDailyLoop(signal);
          onOpen?.(signal);
        },
        snooze: () => {
          const actionTime = clock();
          ledger.snooze(signal.dayKey, signal.kind, new Date(actionTime.getTime() + 30 * 60_000), actionTime);
        },
        skip: () => ledger.skip(signal.dayKey, signal.kind, clock()),
      }));
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    reconcile();
    const poll = pollIntervalMs > 0 ? window.setInterval(reconcile, pollIntervalMs) : undefined;
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (poll !== undefined) window.clearInterval(poll);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [clock, closeouts, dayPlans, ledger, onOpen, onSignal, pollIntervalMs, reminderPreferences]);

  return null;
}

function routeToDailyLoop(signal: DailyLoopReminderSignal) {
  useUi.getState().requestDailyLoop(signal.kind, signal.dayKey);
  window.location.hash = "dashboard";
  window.dispatchEvent(new CustomEvent(DAILY_LOOP_REMINDER_OPEN_EVENT, {
    detail: { kind: signal.kind, dayKey: signal.dayKey },
  }));
}

function toastForSignal(
  signal: DailyLoopReminderSignal,
  actions: { open: () => void; snooze: () => void; skip: () => void },
) {
  const checkIn = signal.kind === "check-in";
  return {
    title: checkIn ? "Set today’s direction" : "Wrap up today",
    body: checkIn
      ? "Choose one intention for today. It takes less than a minute, and it is optional."
      : "Review what changed and choose tomorrow’s first step. This is optional.",
    tone: "info" as const,
    duration: REMINDER_TOAST_DURATION_MS,
    dedupe: `daily-loop:${signal.dayKey}:${signal.kind}`,
    actions: [
      { label: checkIn ? "Open check-in" : "Open closeout", onAction: actions.open },
      { label: "Snooze 30 min", onAction: actions.snooze },
      { label: "Skip today", onAction: actions.skip },
    ],
  };
}
