export const CATEGORIES = {
  daily_learning: { label: "Daily learning", group: "Study", description: "A small next step from your current course." },
  daily_games: { label: "Daily Games", group: "Study", description: "Only the games you have enabled." },
  weekly_report: { label: "Weekly Report", group: "Study", description: "Your recorded effort, progress and next opportunity." },
  monthly_report: { label: "Monthly Report", group: "Study", description: "A longer view of your learning." },
  exam_reminders: { label: "Exam reminders", group: "Study", description: "Upcoming assessments, without readiness promises." },
  annual_pulse: { label: "AXOM Pulse", group: "Study", description: "Your year in medicine, measured." },
  essays_from_jafar: { label: "Essays & Notes from Jafar", group: "Editorial", description: "Medicine, attention and the work of learning." },
  product_updates: { label: "Product updates", group: "AXOM", description: "Meaningful additions to your workspace." },
  research_news: { label: "Research & News", group: "AXOM", description: "Selected research and academic news." },
  marketing: { label: "Offers & announcements", group: "AXOM", description: "Occasional optional announcements." },
} as const;
export type OptionalCategory = keyof typeof CATEGORIES;
export type Category = OptionalCategory | "auth" | "security" | "account" | "privacy" | "data_export" | "account_deletion";
export const TEMPLATE_CATEGORY = {
  welcome: "account", auth: "auth", security: "security", daily_learning: "daily_learning", daily_games: "daily_games",
  weekly_report: "weekly_report", monthly_report: "monthly_report", exam_reminder: "exam_reminders", inactivity: "daily_learning",
  essay: "essays_from_jafar", product_update: "product_updates", research: "research_news", marketing: "marketing", pulse: "annual_pulse",
  export_requested: "data_export", export_ready: "data_export", deletion_requested: "account_deletion",
  deletion_scheduled: "account_deletion", deletion_cancelled: "account_deletion", deletion_completed: "account_deletion",
} as const satisfies Record<string, Category>;
export type EmailType = keyof typeof TEMPLATE_CATEGORY;
export interface Preference { category: OptionalCategory; enabled: boolean; time: string; weekday: number; timezone: string }
export function optional(category: Category): category is OptionalCategory { return Object.hasOwn(CATEGORIES, category); }
export function preferences(timezone = "UTC"): Preference[] {
  return (Object.keys(CATEGORIES) as OptionalCategory[]).map(category => ({ category, enabled: false, time: category === "daily_games" ? "18:00" : "08:00", weekday: 0, timezone }));
}
export function validTimezone(value: string): boolean { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }
export function validatePreference(p: Preference): void {
  if (!Object.hasOwn(CATEGORIES, p.category) || typeof p.enabled !== "boolean" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) || !Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6 || !validTimezone(p.timezone)) throw new Error("Choose a valid category, local time, weekday and timezone.");
}
export interface PulseMetric { id: string; label: string; value: number; unit: string; note: string }
export interface SystemResult { name: string; attempts: number; accuracy: number; delta?: number }
export interface PulseData {
  version: 1; scope: "week" | "month" | "year" | "term"; periodStart: string; periodEnd: string;
  generatedAt: string; sourceUpdatedAt?: string; source: "device" | "protected-copy"; displayName: string; accent: string;
  metrics: PulseMetric[]; systems: SystemResult[]; trend: { label: string; accuracy: number | null; attempts: number }[];
  comparison?: { accuracyDelta?: number; previousScored: number; currentScored: number };
  milestones: string[]; coverage: string[]; courses: string[]; games: { name: string; count: number }[];
}
export interface Personalization {
  displayName: string; accent: string; theme: "dark" | "light"; locale: string; timezone: string; snapshot?: PulseData;
  games?: { name: string; url: string; detail: string }[]; exam?: { name: string; date: string; days: number; route?: string };
  course?: string; orbUrl: string;
}
export interface Editorial { id?: string; title: string; excerpt: string; body?: string; url: string; readingMinutes?: number; imageUrl?: string; subject?: string; preview?: string; cta?: string }
export interface EmailInput { type: EmailType; context: Personalization; baseUrl: string; unsubscribeUrl?: string; actionUrl?: string; date?: string; editorial?: Editorial }
export interface RenderedEmail { subject: string; html: string; text: string; category: Category }
export function safeAccent(value: string): string { return /^#[0-9a-f]{6}$/i.test(value) ? value : "#c8a96a"; }
export function safeUrl(value: string, fallback = "https://axom.info"): string { try { const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.href : fallback; } catch { return fallback; } }
export function firstName(name: string): string { return name.trim().split(/\s+/)[0] || "there"; }
export function resolveVariables(text: string, context: Personalization): string {
  const values: Record<string, string> = { firstName: firstName(context.displayName), displayName: context.displayName || "Learner", currentCourse: context.course || "your course", examName: context.exam?.name || "your assessment", daysUntilExam: context.exam ? String(context.exam.days) : "" };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => { if (!Object.hasOwn(values, key)) throw new Error(`Unsupported template variable: ${key}`); return values[key]; });
}
export function suppressionReason(category: Category, opts: { verified: boolean; addressValid: boolean; suppressed: boolean; deletionPending: boolean; preference?: Preference }): string | null {
  if (!opts.addressValid) return "invalid-address";
  if (!opts.verified && category !== "auth") return "unverified-address";
  if (opts.suppressed) return "address-suppressed";
  if (optional(category) && opts.deletionPending) return "deletion-pending";
  if (optional(category) && !opts.preference?.enabled) return "not-subscribed";
  return null;
}
export function localClock(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}
/** Late workers catch up within the same local day; unique period keys cover DST repeats. */
export function duePeriod(p: Preference, now: Date): string | null {
  validatePreference(p);
  if (!p.enabled) return null;
  const local = localClock(now, p.timezone);
  if (local.time < p.time) return null;
  if (p.category === "weekly_report") return local.weekday === p.weekday ? local.day : null;
  if (p.category === "monthly_report") return Number(local.day.slice(-2)) <= 7 && local.weekday === p.weekday ? local.day.slice(0, 7) : null;
  if (p.category === "annual_pulse") return local.day.slice(5) === "01-01" ? String(Number(local.day.slice(0, 4)) - 1) : null;
  return ["daily_games", "daily_learning", "exam_reminders"].includes(p.category) ? local.day : null;
}
export function periodBefore(day: string, scope: PulseData["scope"]): { start: string; end: string } {
  const end = new Date(`${day}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  if (scope === "week") start.setUTCDate(start.getUTCDate() - 6);
  else if (scope === "month") { start.setUTCDate(1); if (end.getUTCDate() !== new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()) { end.setUTCDate(0); start.setUTCMonth(start.getUTCMonth() - 1); } }
  else { start.setUTCFullYear(end.getUTCFullYear(), 0, 1); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
