// Content AXOM itself puts in a new workspace. It is never evidence of the
// student's own work (Command Brief) and never a reason to keep a workspace
// over an account's saved version (sign-in restore).
const STARTER_TASK_TITLES = new Set([
  "create today's standup",
  "add your real lecture/DLA/PQ list",
  "save progress from settings",
].map(normalizeStarterText));

export function normalizeStarterText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function isStarterTaskTitle(title: string): boolean {
  return STARTER_TASK_TITLES.has(normalizeStarterText(title));
}
