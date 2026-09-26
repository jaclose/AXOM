import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../lib/motion";

export const ACTIVITY_PLACEHOLDERS = [
  "Reviewing Lecture 12",
  "Practice questions",
  "Coding",
  "Language learning",
  "Working out",
  "Reading",
  "Research",
  "Step 1 review",
] as const;

export function ActivityLabelInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const reducedMotion = useRef(prefersReducedMotion());

  useEffect(() => {
    if (focused || value || reducedMotion.current) return;
    const interval = window.setInterval(() => setIndex((current) => (current + 1) % ACTIVITY_PLACEHOLDERS.length), 3200);
    return () => window.clearInterval(interval);
  }, [focused, value]);

  return (
    <label className="fast-field fast-activity-field">
      <span>What did you do?</span>
      <input
        className="field fast-activity-label"
        aria-label="What did you do?"
        placeholder={ACTIVITY_PLACEHOLDERS[index]}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
      />
      <small>For example: study, questions, exercise, reading, or research.</small>
    </label>
  );
}

