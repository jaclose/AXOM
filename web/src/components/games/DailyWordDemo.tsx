// Plays the on-board how-to over the first two rows of the real grid. The layer
// is aria-hidden (the real grid keeps its labels underneath); the caption is
// mirrored into a polite live region so screen readers still hear it.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { buildDemoTimeline, demoFrameAt } from "../../lib/dailyWordDemo";
import { ICON_SIZE } from "../../lib/iconSize";

export function DailyWordDemo({ wordCount, onDone }: { wordCount: number; onDone: () => void }) {
  const { frames, duration, evaluations } = useMemo(() => buildDemoTimeline(wordCount), [wordCount]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timers = frames.slice(1).map((frame) => window.setTimeout(() => setElapsed(frame.at), frame.at));
    const done = window.setTimeout(onDone, duration);
    return () => { timers.forEach(window.clearTimeout); window.clearTimeout(done); };
  }, [frames, duration, onDone]);

  const frame = demoFrameAt(frames, elapsed);
  const leaving = elapsed >= frames[frames.length - 1].at;
  return (
    <>
      <div className={`daily-word-demo ${leaving ? "is-leaving" : ""}`} aria-hidden="true">
        {frame.rows.map((word, rowIndex) => (
          <div className="daily-word-row" key={rowIndex}>
            {Array.from({ length: 5 }, (_, col) => {
              const letter = word[col] ?? "";
              const evaluation = frame.scored[rowIndex] ? evaluations[rowIndex][col] : undefined;
              const focused = rowIndex === 0 && frame.focusCol === col;
              return (
                <div key={col} className={`daily-word-tile ${letter ? "filled" : ""} ${evaluation ?? ""} ${focused ? "is-focus" : ""}`}
                  style={{ ["--flip-delay" as string]: `${col * 90}ms` }}>
                  <span>{letter}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="daily-word-demo-caption" style={{ ["--caret-col" as string]: frame.focusCol ?? 2 }} data-caret={frame.focusCol !== null || undefined}>
          {frame.caption}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">{frame.caption}</div>
      <button type="button" className="daily-word-demo-skip" onClick={onDone}>
        Skip <X size={ICON_SIZE.microInline} aria-hidden="true" />
      </button>
    </>
  );
}
