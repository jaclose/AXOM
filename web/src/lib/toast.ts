// Lightweight global toast/notification store. Kept out of the persisted vault —
// toasts are ephemeral UI. Shared by the Pomodoro completion notice, the missed-
// standup alert, and anything else that needs a transient, dismissible message.
import { create } from "zustand";

export type ToastTone = "info" | "success" | "warn";

export interface ToastAction {
  label: string;
  href?: string;
  onAction?: () => void;
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: ToastTone;
  href?: string;        // optional deep-link the action button follows
  actionLabel?: string;
  onAction?: () => void;
  /** Multiple named actions. Legacy actionLabel/href/onAction remain supported. */
  actions?: ToastAction[];
  duration: number;     // ms before auto-dismiss; 0 = sticky
  /** De-dupe key so the same alert isn't stacked repeatedly. */
  dedupe?: string;
}

/**
 * Optional reminders (daily check-in/closeout, journal catch-up) leave on
 * their own so they never keep covering the page. Sticky toasts (duration 0)
 * are reserved for notices that need a decision, such as data-safety alerts.
 */
export const REMINDER_TOAST_DURATION_MS = 20_000;
/** After hover/focus/background ends, a nearly expired toast stays this long. */
export const TOAST_RESUME_GRACE_MS = 2_000;

/** Why an auto-dismiss countdown is paused. The countdown runs only with none. */
export type ToastHold = "hover" | "focus" | "hidden";

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "duration" | "tone"> & { tone?: ToastTone; duration?: number }) => void;
  dismiss: (id: string) => void;
  /** Pause a toast's countdown while the learner is reading or using it. */
  hold: (id: string, reason: ToastHold) => void;
  release: (id: string, reason: ToastHold) => void;
}

interface Countdown {
  remaining: number;
  startedAt: number;
  handle?: ReturnType<typeof setTimeout>;
  holds: Set<ToastHold>;
}

// Timers live outside zustand state: they are runtime handles, not UI data.
const countdowns = new Map<string, Countdown>();

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export const useToasts = create<ToastStore>((set, get) => {
  function run(id: string, countdown: Countdown, ms: number) {
    countdown.remaining = ms;
    countdown.startedAt = Date.now();
    countdown.handle = setTimeout(() => get().dismiss(id), ms);
  }

  return {
    toasts: [],
    push: (toast) => {
      const { dedupe } = toast;
      if (dedupe && get().toasts.some((existing) => existing.dedupe === dedupe)) return;
      const id = crypto.randomUUID();
      const duration = toast.duration ?? 6000;
      set((state) => ({
        toasts: [...state.toasts, { tone: "info", ...toast, id, duration }],
      }));
      if (duration > 0) {
        // A toast raised while the tab is in the background (for example a
        // scheduled reminder) waits until the learner can actually see it.
        const countdown: Countdown = { remaining: duration, startedAt: Date.now(), holds: new Set(pageHidden() ? ["hidden"] : []) };
        countdowns.set(id, countdown);
        if (countdown.holds.size === 0) run(id, countdown, duration);
      }
    },
    dismiss: (id) => {
      const countdown = countdowns.get(id);
      if (countdown?.handle) clearTimeout(countdown.handle);
      countdowns.delete(id);
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
    hold: (id, reason) => {
      const countdown = countdowns.get(id);
      if (!countdown) return;
      countdown.holds.add(reason);
      if (!countdown.handle) return;
      clearTimeout(countdown.handle);
      countdown.handle = undefined;
      countdown.remaining = Math.max(0, countdown.remaining - (Date.now() - countdown.startedAt));
    },
    release: (id, reason) => {
      const countdown = countdowns.get(id);
      if (!countdown || !countdown.holds.delete(reason)) return;
      if (countdown.holds.size > 0 || countdown.handle) return;
      run(id, countdown, Math.max(countdown.remaining, TOAST_RESUME_GRACE_MS));
    },
  };
});

// Countdowns pause while the page is hidden and resume when it is visible
// again, so a reminder is not dismissed before anyone could have seen it.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const { hold, release } = useToasts.getState();
    for (const id of [...countdowns.keys()]) {
      if (pageHidden()) hold(id, "hidden");
      else release(id, "hidden");
    }
  });
}

export function pushToast(toast: Parameters<ToastStore["push"]>[0]) {
  useToasts.getState().push(toast);
}
