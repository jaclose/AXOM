import { todayGrade, gradeLabel, gradeColor, gradeThresholds } from "../../lib/scoring";
import { useStore } from "../../lib/store";

// Day-score ring — ported from RingScore. Fills toward the "excellent" line
// (1.6× the learner's minute target; 480 min with the original defaults).
export function Ring({ minutes, cards }: { minutes: number; cards: number }) {
  const minuteTarget = useStore((s) => s.profile.dailyMinuteTarget);
  const cardTarget = useStore((s) => s.profile.dailyCardTarget);
  const targets = { minutes: minuteTarget, cards: cardTarget };
  const grade = todayGrade(minutes, cards, targets);
  const color = gradeColor(grade);
  const pct = Math.min(minutes / gradeThresholds(targets).blue.minutes, 1);
  const r = 51;
  const c = 2 * Math.PI * r;

  return (
    <div className="ring-wrap">
      <div className="ring">
        <svg width="116" height="116" viewBox="0 0 116 116">
          <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
          <circle
            cx="58" cy="58" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset .5s ease" }}
          />
        </svg>
        <div className="ring-label" style={{ color }}>{gradeLabel(grade).replace("👑 ", "")}</div>
      </div>
      <div className="stack gap8">
        <div style={{ fontSize: 18, fontWeight: 800 }}>{minutes} minutes</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-60)" }}>{cards} cards</div>
        <div style={{ fontSize: 12, color: "var(--text-45)" }}>
          Useful day score: <span style={{ color, fontWeight: 700 }}>{gradeLabel(grade)}</span>
        </div>
      </div>
    </div>
  );
}
