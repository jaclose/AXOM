import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, Inbox, X } from "lucide-react";
import type { DayPlan } from "../../lib/types";
import { ICON_SIZE } from "../../lib/iconSize";
import { prettyDate } from "../../lib/scoring";
import { planForDay } from "../../lib/journal";
import { journalReminderLedger } from "../../lib/journalReminder";
import { dismissReflectionDays, useDismissedReflectionDays } from "../../lib/reflectionDismissals";
import { pushToast, useToasts } from "../../lib/toast";
import { gotoJournalDay } from "../../lib/uiStore";
import { GlassCard, GButton, GhostButton } from "../ui/primitives";
import "../../styles/dashboard-inbox.css";

const STORAGE_KEY = "axom.reflectionInbox.v1";
const SNOOZE_MS = 4 * 60 * 60_000;
const systemNow = () => new Date();

interface ReflectionInboxCourtesy {
  hiddenForDay?: string;
  snoozedUntil?: string;
}
interface ReflectionInboxProps {
  dayKeys: string[];
  dayPlans: DayPlan[];
  activeDayKey: string;
  workspaceKey: string;
  now?: () => Date;
  onOpenDay?: (dayKey: string) => void;
}

function courtesyStorageKey(workspaceKey: string): string {
  return `${STORAGE_KEY}:${encodeURIComponent(workspaceKey.trim() || "local")}`;
}

function readCourtesy(storageKey: string): ReflectionInboxCourtesy | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReflectionInboxCourtesy>;
    return {
      hiddenForDay: typeof value.hiddenForDay === "string" ? value.hiddenForDay : undefined,
      snoozedUntil: typeof value.snoozedUntil === "string" && Number.isFinite(Date.parse(value.snoozedUntil))
        ? value.snoozedUntil
        : undefined,
    };
  } catch {
    return null;
  }
}

function writeCourtesy(storageKey: string, value: ReflectionInboxCourtesy) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Courtesy state may be unavailable in private storage contexts. The
    // learner's Journal remains untouched either way.
  }
}

export function ReflectionInbox({
  dayKeys,
  dayPlans,
  activeDayKey,
  workspaceKey,
  now = systemNow,
  onOpenDay = gotoJournalDay,
}: ReflectionInboxProps) {
  const [expanded, setExpanded] = useState(false);
  const [, refreshSnooze] = useState(0);
  const storageKey = courtesyStorageKey(workspaceKey);
  const [storedCourtesy, setStoredCourtesy] = useState(() => ({ key: storageKey, value: readCourtesy(storageKey) }));
  const courtesy = storedCourtesy.key === storageKey ? storedCourtesy.value : readCourtesy(storageKey);
  const dismissedDays = useDismissedReflectionDays(workspaceKey, dayKeys);
  const eligibleDays = dayKeys.filter((day) => !dismissedDays.has(day));
  const recommended = eligibleDays[0];
  const recommendedPlan = useMemo(() => planForDay(dayPlans, recommended), [dayPlans, recommended]);
  const recommendedIntention = recommendedPlan?.intention.trim() ?? "";
  const recommendedSummary = recommendedIntention.length > 72
    ? `${recommendedIntention.slice(0, 72).trimEnd()}…`
    : recommendedIntention;
  const hidden = courtesy?.hiddenForDay === activeDayKey
    || Boolean(courtesy?.snoozedUntil && Date.parse(courtesy.snoozedUntil) > now().getTime());
  const targetSignature = dayKeys.join("\u001f");

  useEffect(() => {
    const expiresAt = courtesy?.snoozedUntil ? Date.parse(courtesy.snoozedUntil) : Number.NaN;
    if (!Number.isFinite(expiresAt)) return;
    const remaining = expiresAt - now().getTime();
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => refreshSnooze((value) => value + 1),
      Math.min(remaining + 16, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [courtesy?.snoozedUntil, now, storageKey]);

  // This visible dashboard surface is the catch-up reminder for this route.
  // Record it before the shell watcher's passive effect and clear any reminder
  // already raised on another route so the learner never receives both.
  useLayoutEffect(() => {
    if (!recommended) return;
    // The Dashboard inbox represents the complete missed-day queue. Marking
    // every visible target prevents the shell watcher from surfacing an older
    // toast beside this calmer, learner-controlled surface.
    targetSignature.split("\u001f").filter(Boolean)
      .forEach((target) => journalReminderLedger.markShown(activeDayKey, target));
    const { toasts, dismiss } = useToasts.getState();
    toasts
      .filter((toast) => toast.dedupe?.startsWith("missed-standup:"))
      .forEach((toast) => dismiss(toast.id));
  }, [activeDayKey, recommended, targetSignature]);

  if (!eligibleDays.length || hidden) return null;

  function defer(kind: "later" | "today") {
    const next: ReflectionInboxCourtesy = kind === "later"
      ? { snoozedUntil: new Date(now().getTime() + SNOOZE_MS).toISOString() }
      : { hiddenForDay: activeDayKey };
    writeCourtesy(storageKey, next);
    setStoredCourtesy({ key: storageKey, value: next });
  }

  function dismissDays() {
    const result = dismissReflectionDays(workspaceKey, eligibleDays);
    const undo = () => {
      if (result.undo().length) {
        pushToast({
          title: "Could not undo dismissal",
          body: "Your browser could not save the reminder preference. Retry when storage is available.",
          tone: "warn",
          actionLabel: "Retry Undo",
          onAction: undo,
          duration: 20_000,
        });
      }
    };
    if (result.dismissedDays.length) {
      pushToast({
        title: result.failedDays.length ? "Some reminder preferences could not be saved" : "Catch-up reminders dismissed",
        body: result.failedDays.length
          ? "Some preferences could not be confirmed. Please retry any remaining days. Your Journal is unchanged."
          : "These days will not remind you again on this device. Your Journal is unchanged.",
        tone: result.failedDays.length ? "warn" : "success",
        duration: 12_000,
        actionLabel: "Undo",
        onAction: undo,
      });
    } else if (result.failedDays.length) {
      pushToast({
        title: "Could not dismiss these days",
        body: "Your browser could not confirm dismissal. Please retry when storage is available. Your Journal is unchanged.",
        tone: "warn",
      });
    }
  }

  return (
    <GlassCard className="reflection-inbox" role="region" aria-labelledby="reflection-inbox-title">
      <span className="reflection-inbox__mark" aria-hidden="true"><Inbox size={ICON_SIZE.emphasis} /></span>
      <div className="reflection-inbox__copy">
        <b id="reflection-inbox-title">Reflection inbox</b>
        <span>
          {eligibleDays.length === 1 ? "One day is ready when you are." : `${eligibleDays.length} days are ready when you are.`}
          {recommendedSummary ? ` Start with “${recommendedSummary}”.` : " A few honest lines is enough."}
        </span>
      </div>
      <div className="reflection-inbox__actions">
        <GButton size="sm" variant="primary" onClick={() => onOpenDay(recommended)}>
          Continue {prettyDate(`${recommended}T12:00:00`)} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
        </GButton>
        {eligibleDays.length > 1 && (
          <GhostButton aria-expanded={expanded} aria-controls="reflection-inbox-days" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide list" : `View all ${eligibleDays.length}`}
          </GhostButton>
        )}
      </div>
      {expanded && eligibleDays.length > 1 && (
        <div id="reflection-inbox-days" className="reflection-inbox__days">
          {eligibleDays.map((key) => {
            const plan = planForDay(dayPlans, key);
            return (
              <button key={key} type="button" className="reflection-inbox__day" onClick={() => onOpenDay(key)}>
                <span><b>{prettyDate(`${key}T12:00:00`)}</b>{plan?.intention.trim() && <small>{plan.intention.trim()}</small>}</span>
                <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      <div className="reflection-inbox__courtesy" aria-label="Reflection reminder options">
        <GhostButton onClick={() => defer("later")}><Clock3 size={ICON_SIZE.body} aria-hidden="true" /> Later</GhostButton>
        <GhostButton onClick={() => defer("today")}><X size={ICON_SIZE.body} aria-hidden="true" /> Not today</GhostButton>
        <GhostButton className="reflection-inbox__dismiss" onClick={dismissDays} title="Stop reminders for these past days on this device. Future days are unaffected.">Dismiss these days</GhostButton>
      </div>
      <span className="reflection-inbox__assurance">Opening a day never replaces an existing Journal entry.</span>
    </GlassCard>
  );
}
