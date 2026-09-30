// The day a student finished first-run setup on this device. Habit nudges
// meant for returning days (the morning check-in, the evening closeout) stay
// quiet on that first day: the dashboard already leads with the check-in.
const KEY = "axom.firstRunDay.v1";

export function markFirstRunDay(dayKey: string): void {
  try { localStorage.setItem(KEY, dayKey); } catch { /* device courtesy only */ }
}

export function isFirstRunDay(dayKey: string): boolean {
  try { return localStorage.getItem(KEY) === dayKey; } catch { return false; }
}
