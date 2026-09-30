import { daysUntilExam } from "./examPlan";

export interface ModuleExamDeadline {
  id: string;
  name: string;
  date: string;
  priority: "normal" | "high";
  completedAt?: string;
}

export interface ExamCountdownPreferences {
  step1DateKind: "booked" | "target";
  moduleExams: ModuleExamDeadline[];
}

export function validExamDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeExamCountdown(value: unknown): ExamCountdownPreferences {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seen = new Set<string>();
  const moduleExams: ModuleExamDeadline[] = [];
  for (const entry of Array.isArray(record.moduleExams) ? record.moduleExams.slice(0, 200) : []) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || !validExamDate(item.date)) continue;
    const id = item.id.slice(0, 120);
    if (seen.has(id)) continue;
    seen.add(id);
    moduleExams.push({
      id, name: item.name.trim().slice(0, 120), date: item.date,
      priority: item.priority === "high" ? "high" : "normal",
      completedAt: typeof item.completedAt === "string" && Number.isFinite(Date.parse(item.completedAt)) ? item.completedAt : undefined,
    });
  }
  return { step1DateKind: record.step1DateKind === "booked" ? "booked" : "target", moduleExams };
}

export type ExamUrgency = "calm" | "watch" | "aware" | "approaching" | "soon" | "imminent" | "today" | "past";

export function examUrgency(days: number | null, kind: "step1" | "module"): ExamUrgency {
  if (days === null) return "calm";
  if (days < 0) return "past";
  if (days === 0) return "today";
  if (kind === "step1") {
    if (days <= 7) return "imminent";
    if (days <= 14) return "soon";
    if (days <= 30) return "approaching";
    if (days <= 90) return "aware";
    if (days <= 180) return "watch";
  } else {
    if (days <= 1) return "imminent";
    if (days <= 3) return "soon";
    if (days <= 7) return "approaching";
    if (days <= 10) return "aware";
  }
  return "calm";
}

export function upcomingModuleExams(exams: ModuleExamDeadline[], today: string): ModuleExamDeadline[] {
  return exams.filter((exam) => !exam.completedAt).sort((a, b) => {
    const aDays = daysUntilExam(a.date, today) ?? 0;
    const bDays = daysUntilExam(b.date, today) ?? 0;
    // A passed but unmarked exam stays available without stealing the lead.
    if (aDays < 0 && bDays >= 0) return 1;
    if (bDays < 0 && aDays >= 0) return -1;
    return aDays - bDays || Number(b.priority === "high") - Number(a.priority === "high") || a.name.localeCompare(b.name);
  });
}
