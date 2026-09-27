// Mounted once in the app shell. On load, if there are active days with no
// standup, it offers an optional, exact-day catch-up without repeating the same
// target during the current calendar day. Renders nothing.
import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { missedStandupDays } from "../../lib/journal";
import { pushToast, REMINDER_TOAST_DURATION_MS } from "../../lib/toast";
import { isoDate, prettyDate } from "../../lib/scoring";
import { gotoJournalDay } from "../../lib/uiStore";
import { journalReminderLedger } from "../../lib/journalReminder";

export function StandupWatcher() {
  const journal = useStore((s) => s.journal);
  const logs = useStore((s) => s.logs);
  const dayPlans = useStore((s) => s.dayPlans);
  const activeDayKey = useStore((s) => s.activeDayKey);

  useEffect(() => {
    const today = activeDayKey || isoDate(new Date());
    const missed = missedStandupDays({ journal, logs, dayPlans }, today);
    const target = journalReminderLedger.nextTarget(today, missed);
    if (!target) return;
    journalReminderLedger.markShown(today, target);
    const dateLabel = prettyDate(`${target}T12:00:00`);
    pushToast({
      title: `Journal catch-up for ${dateLabel}`,
      body: `You logged activity on ${dateLabel}, but there is no journal entry for that date. Catch-up records what you remember there, and it is optional.`,
      tone: "warn",
      // An optional reminder must not keep covering the page until dismissed.
      duration: REMINDER_TOAST_DURATION_MS,
      dedupe: `missed-standup:${today}:${target}`,
      actions: [
        { label: "Complete catch-up", onAction: () => gotoJournalDay(target) },
        { label: "Skip", onAction: () => journalReminderLedger.skip(today, target) },
        { label: "Do not remind me again today", onAction: () => journalReminderLedger.muteForDay(today) },
      ],
    });
  }, [activeDayKey, journal, logs, dayPlans]);

  return null;
}
