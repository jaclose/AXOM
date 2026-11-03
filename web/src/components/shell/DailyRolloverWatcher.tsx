import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { millisecondsUntilNextLocalDay, ROLLOVER_DONE_KEY, type RolloverReason } from "../../lib/dailyRollover";
import { pushToast } from "../../lib/toast";
import { StudyStreakWatcher } from "./StudyStreakWatcher";

export function DailyRolloverWatcher() {
  useEffect(() => {
    let midnightTimer: number | undefined;

    function run(reason: RolloverReason) {
      const result = useStore.getState().checkDailyRollover(reason, new Date());
      if (!result.changed || result.daysAway === 0) return;
      pushToast({
        title: "New day ready",
        body: result.carriedTaskIds?.length
          ? `${result.carriedTaskIds.length} unfinished task${result.carriedTaskIds.length === 1 ? "" : "s"} carried forward.`
          : "AXOM advanced to your device-local date.",
        tone: "success",
        href: "#journal",
        actionLabel: "Review yesterday",
        duration: 8000,
        dedupe: `daily-rollover-${result.toDate}`,
      });
    }

    function scheduleMidnight() {
      if (midnightTimer) window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(() => {
        run("midnight");
        scheduleMidnight();
      }, millisecondsUntilNextLocalDay(new Date()));
    }

    const onFocus = () => run("focus");
    const onVisible = () => {
      if (document.visibilityState === "visible") run("visible");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ROLLOVER_DONE_KEY) run("visible");
    };

    run("app-load");
    scheduleMidnight();
    const pollTimer = window.setInterval(() => run("manual-check"), 60_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (midnightTimer) window.clearTimeout(midnightTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <StudyStreakWatcher />;
}
