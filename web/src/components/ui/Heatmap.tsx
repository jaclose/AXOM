import { heatColor, lastNDays, isoDate, dayTotals, gradeThresholds } from "../../lib/scoring";
import { useStore } from "../../lib/store";
import type { StudyLog } from "../../lib/types";

// 56-day calendar heatmap — ported from the Swift Heatmap. Cells are clickable.
export function Heatmap({
  logs, onPick,
}: {
  logs: StudyLog[];
  onPick?: (key: string) => void;
}) {
  const days = lastNDays(56);
  const minuteTarget = useStore((s) => s.profile.dailyMinuteTarget);
  const cardTarget = useStore((s) => s.profile.dailyCardTarget);
  const targets = { minutes: minuteTarget, cards: cardTarget };
  const blue = gradeThresholds(targets).blue;
  return (
    <div className="heatmap">
      {days.map((d) => {
        const key = isoDate(d);
        const { minutes, cards } = dayTotals(logs, key);
        const crown = minutes >= blue.minutes || cards >= blue.cards;
        const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <div
            key={key}
            className="heat-cell"
            style={{ background: heatColor(minutes, cards, targets) }}
            title={`${label}: ${minutes} min, ${cards} cards — click to open`}
            onClick={() => onPick?.(key)}
          >
            {crown ? "👑" : ""}
          </div>
        );
      })}
    </div>
  );
}
