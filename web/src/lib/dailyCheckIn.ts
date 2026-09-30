// Small shared pieces of the Daily Check-In and the dashboard's day loop.

export type DayOutcome = "won" | "partial" | "missed";

export const OUTCOMES: { key: DayOutcome; label: string; tone: "green" | "orange" | "red" }[] = [
  { key: "won", label: "Won it", tone: "green" },
  { key: "partial", label: "Partial", tone: "orange" },
  { key: "missed", label: "Missed", tone: "red" },
];

const WRAP_MESSAGES = [
  "Close the loop while the day is still fresh.",
  "A short honest review is enough.",
  "Record the signal before memory edits it.",
  "Name the blocker, keep the useful part.",
  "End clean so tomorrow starts lighter.",
];

/** A stable line per day, so the wording varies without flickering. */
export function wrapUpMessage(dayKey: string): string {
  const code = dayKey.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return WRAP_MESSAGES[code % WRAP_MESSAGES.length];
}

export function isAfterLocalTime(value: string, now: Date = new Date()): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return now >= target;
}

// --- The optional writing prompt after an energy check (Ideas 4) -------------
// Off unless the student turns it on in the Daily Check-In widget's settings.

const LOW = ["What’s weighing on you?", "What’s eating you up today?", "What would make this a little lighter?"];
const MIDDLE = ["What’s on your mind?", "Anything worth remembering about today?", "What would tip today the right way?"];
const HIGH = ["What’s got you feeling so good?", "What’s working today?", "What made today click?"];

/** A different question each time, matched to how the student feels. */
export function writingPrompt(score: number, seed = Date.now()): string {
  const pool = score <= 35 ? LOW : score >= 75 ? HIGH : MIDDLE;
  return pool[Math.abs(Math.floor(seed / 1000)) % pool.length];
}
