import { useEffect } from "react";
import { resolveTimeZone } from "../../lib/clock";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { previousLocalDateKey, localDateKey } from "../../lib/dailyRollover";
import { useDoctordle } from "../../lib/doctordle";
import { localNoticeCopy, recordLocalNotice, type LocalNoticeKind } from "../../lib/notificationInbox";
import { shellBusy } from "../../lib/shellBusy";
import { useStore } from "../../lib/store";
import { dateKeyInTimeZone, reconcileDailyWordStreak, reconcileProductivityStreak } from "../../lib/studyStreaks";
import { pushToast, REMINDER_TOAST_DURATION_MS } from "../../lib/toast";

/** Rollover and store changes share one idempotent, dated reconciliation path. */
export function StudyStreakWatcher() {
  useEffect(() => {
    let reconciling = false;
    function reconcile() {
      if (reconciling || document.visibilityState === "hidden") return;
      reconciling = true;
      try {
        const now = new Date();
        const state = useStore.getState();
        const today = localDateKey(now);
        if (state.activeDayKey !== today) return;
        const yesterday = previousLocalDateKey(today);
        const productivity = reconcileProductivityStreak(
          state.profile.studyStreaks,
          today,
          evaluateDailySuccess(state, today, today),
          evaluateDailySuccess(state, yesterday, today),
        );
        const wordToday = dateKeyInTimeZone(now, resolveTimeZone(state.profile.timeZonePreference));
        if (!state.profile.studyStreaks) productivity.ledger.dailyWord.startedOn = wordToday;
        const word = reconcileDailyWordStreak(
          productivity.ledger,
          wordToday,
          state.dailyWordPuzzles.filter((puzzle) => puzzle.completed).map((puzzle) => puzzle.puzzleDate),
        );
        if (JSON.stringify(word.ledger) !== JSON.stringify(state.profile.studyStreaks)) {
          state.updateProfile({ studyStreaks: word.ledger });
        }
        const frozen: Array<{ kind: LocalNoticeKind; id: string }> = [];
        if (productivity.frozenDay) frozen.push({ kind: "productivity-freeze", id: productivity.frozenDay });
        if (word.frozenDay) frozen.push({ kind: "daily-word-freeze", id: word.frozenDay });
        const caseNumber = useDoctordle.getState().protectStreak(now.getTime());
        if (caseNumber !== undefined) frozen.push({ kind: "doctordle-freeze", id: String(caseNumber) });
        for (const item of frozen) recordLocalNotice(`streak:${item.kind}:${item.id}`, item.kind, now);
        const rolloverJustAnnounced = (state.dailyRolloverEvents ?? []).some((event) =>
          event.toDate === today && event.daysAway > 0
          && now.getTime() - Date.parse(event.processedAt) >= 0
          && now.getTime() - Date.parse(event.processedAt) < 15_000);
        if (frozen.length && !shellBusy() && !rolloverJustAnnounced) {
          const single = frozen.length === 1 ? localNoticeCopy(frozen[0].kind) : null;
          pushToast({
            title: single?.title ?? "Your streaks were protected",
            body: single?.body ?? "A missed day was covered in your active streaks. Return today when you can.",
            tone: "info",
            href: single?.href ?? "#productivity",
            actionLabel: "View today",
            duration: REMINDER_TOAST_DURATION_MS,
            dedupe: `streak-protection:${today}`,
          });
        }
      } finally {
        reconciling = false;
      }
    }
    reconcile();
    const unsubscribeStore = useStore.subscribe(reconcile);
    const unsubscribeDoctordle = useDoctordle.subscribe(reconcile);
    const onVisible = () => { if (document.visibilityState === "visible") reconcile(); };
    const poll = window.setInterval(reconcile, 60_000);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribeStore();
      unsubscribeDoctordle();
      window.clearInterval(poll);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
