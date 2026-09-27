// ===========================================================================
// Extra "Day at a glance" lines for the Journal, built from records the core
// glance selector does not see: study-session takeaways, question accuracy,
// soundscape listening, rests, and lock-in check-ins (device-only ledgers).
// The Journal includes all of these automatically; nothing needs a click.
// ===========================================================================
import type { JournalGlanceSection } from "./journalNotebook";
import type { StudySession } from "./sessions";
import { sessionElapsedMinutes } from "./sessions";
import { SOUNDSCAPES, isSoundscapeId } from "./soundscapes/presets";
import type { ListeningInterval } from "./soundscapes/listeningLog";
import type { RestEntry } from "./rest";

export interface DayExtrasInput {
  day: string;
  sessions: StudySession[];
  attempts: Array<{ at: string; status: string }>;
  listening: ListeningInterval[];
  rests: RestEntry[];
  checkIns?: { day: string; prompts: number; lockedIn: number; drifted: number };
}

const localDay = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Correct share of answered practice questions that day, or null when none. */
export function questionAccuracy(attempts: DayExtrasInput["attempts"], day: string): { answered: number; correct: number } | null {
  const answered = attempts.filter((attempt) => localDay(attempt.at) === day && ["correct", "incorrect", "guessed"].includes(attempt.status));
  if (!answered.length) return null;
  return { answered: answered.length, correct: answered.filter((attempt) => attempt.status === "correct").length };
}

export function buildDayExtraSections(input: DayExtrasInput): JournalGlanceSection[] {
  const { day } = input;
  const finished = input.sessions.filter((session) => session.dayKey === day && session.status === "completed");
  const sessionText = finished.slice(0, 4).map((session) => {
    const minutes = Math.round(sessionElapsedMinutes(session));
    const takeaway = session.capture?.takeaway?.trim();
    return `${session.title} (${minutes} min)${takeaway ? ` — ${takeaway}` : ""}`;
  }).join(" · ");

  const accuracy = questionAccuracy(input.attempts, day);

  const listened = new Map<string, number>();
  for (const interval of input.listening) {
    if (localDay(interval.start) !== day || !isSoundscapeId(interval.presetId)) continue;
    const minutes = (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000;
    listened.set(interval.presetId, (listened.get(interval.presetId) ?? 0) + minutes);
  }
  const soundText = [...listened.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, minutes]) => `${SOUNDSCAPES[id as keyof typeof SOUNDSCAPES].name} ${Math.round(minutes)} min`)
    .join(" · ");

  const rests = input.rests.filter((rest) => localDay(rest.startedAt) === day);
  const restMinutes = rests.reduce((sum, rest) => sum + Math.max(0, Date.parse(rest.endedAt) - Date.parse(rest.startedAt)) / 60_000, 0);

  const checkIns = input.checkIns && input.checkIns.day === day ? input.checkIns : undefined;
  const answered = checkIns ? checkIns.lockedIn + checkIns.drifted : 0;

  return [
    { key: "sessions", label: "Study sessions", value: sessionText || "No sessions finished", hasEvidence: finished.length > 0 },
    {
      key: "accuracy",
      label: "Question accuracy",
      value: accuracy ? `${Math.round((accuracy.correct / accuracy.answered) * 100)}% correct (${accuracy.correct}/${accuracy.answered})` : "No questions answered",
      hasEvidence: Boolean(accuracy),
    },
    { key: "sound", label: "Listening", value: soundText || "Studied without soundscapes", hasEvidence: listened.size > 0 },
    {
      key: "rest",
      label: "Rest",
      value: rests.length ? `${rests.length} rest${rests.length === 1 ? "" : "s"} · ${Math.round(restMinutes)} min` : "No rests taken",
      hasEvidence: rests.length > 0,
    },
    {
      key: "checkins",
      label: "Lock-in check-ins",
      value: answered ? `Locked in ${checkIns!.lockedIn} of ${answered}` : "No check-ins answered",
      hasEvidence: answered > 0,
    },
  ];
}
