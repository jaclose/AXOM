import { ATLAS25_AXES, ATLAS25_TARGETS, type Atlas25Axis, type Atlas25Vector } from "./learningPreferences25";
import { AXOM_CORRESPONDENTS, type CorrespondentId } from "./correspondents";

/**
 * One consented first-run session. NEVER store raw mouse/scroll events, routes,
 * click coordinates, timestamps per action, free text, journal, exam or account IDs.
 * This is an exploratory UI preference suggestion, not a personality assessment.
 */
export const FIRST_RUN_WINDOW_MS = 6 * 60 * 1000;
export const FIRST_RUN_ACTIONS = [
  "visit-questions", "visit-tracker", "visit-reports", "visit-productivity",
  "dashboard-customize", "begin-practice", "review-source", "start-focus", "explore-content",
] as const;
export type PassiveAction = typeof FIRST_RUN_ACTIONS[number];
export type ChangedField = "tools" | "questionTiming";
export type PracticeTiming = "after-first-pass" | "after-learning" | "near-exam";
export type ToolChoice = "lectures" | "questions" | "uworld" | "amboss" | "anki" | "noji" | "quizlet" | "other";

export interface PassiveSession {
  version: 1;
  consent: true;
  startedAt: number;
  expiresAt: number;
  changedFields: ChangedField[];
  tools: ToolChoice[];
  questionTiming: PracticeTiming | null;
  counts: Record<PassiveAction, number>;
}
export interface StartPassiveOptions {
  consent: boolean;
  now: number;
  changedFields: readonly string[];
  tools?: readonly string[];
  questionTiming?: string;
}
export type PassiveProposal = {
  status: "off" | "observing" | "insufficient" | "ready";
  confidenceLabel: "provisional" | null;
  suggestion?: { id: CorrespondentId; name: string; description: string };
  alternatives: { id: CorrespondentId; name: string }[];
  explanation: string[];
  proposedConfig: {
    dashboardPriority: "question-bank" | "course-tracker" | "keep-current";
    requiresApproval: true;
    automaticallyChangesAccount: false;
    subscribesToEmail: false;
  };
};
const ACTION_SET = new Set<string>(FIRST_RUN_ACTIONS);
const TOOL_SET = new Set<string>(["lectures", "questions", "uworld", "amboss", "anki", "noji", "quizlet", "other"]);
const CHANGED_SET = new Set<string>(["tools", "questionTiming"]);
const TIMINGS = new Set<string>(["after-first-pass", "after-learning", "near-exam"]);
const countsZero = () => Object.fromEntries(FIRST_RUN_ACTIONS.map(action => [action, 0])) as Record<PassiveAction, number>;
const bounded = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(2, value) : 0;

export function beginPassiveFirstRun(input: StartPassiveOptions): PassiveSession | null {
  if (input.consent !== true || !Number.isFinite(input.now) || input.now < 0) return null;
  const changedFields = [...new Set(input.changedFields.filter(field => CHANGED_SET.has(field)))] as ChangedField[];
  const tools = changedFields.includes("tools")
    ? [...new Set((input.tools ?? []).filter(tool => TOOL_SET.has(tool)))] as ToolChoice[] : [];
  const questionTiming = changedFields.includes("questionTiming") && TIMINGS.has(input.questionTiming ?? "")
    ? input.questionTiming as PracticeTiming : null;
  return { version: 1, consent: true, startedAt: input.now, expiresAt: input.now + FIRST_RUN_WINDOW_MS, changedFields, tools, questionTiming, counts: countsZero() };
}

/** Only whitelisted semantic actions count. No DOM events or arbitrary strings. */
export function capturePassiveFirstRun(session: PassiveSession | null, action: unknown, now: number): PassiveSession | null {
  if (!session || typeof action !== "string" || !ACTION_SET.has(action) || !Number.isFinite(now)) return session;
  if (now < session.startedAt || now >= session.expiresAt) return session;
  const id = action as PassiveAction;
  return { ...session, counts: { ...session.counts, [id]: Math.min(2, session.counts[id] + 1) } };
}

export function serializePassiveFirstRun(session: PassiveSession): string {
  // Whitelist every stored field, even when callers supply extra properties.
  return JSON.stringify({
    version: 1,
    consent: true,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    changedFields: session.changedFields.filter(field => CHANGED_SET.has(field)),
    tools: session.tools.filter(tool => TOOL_SET.has(tool)),
    questionTiming: TIMINGS.has(session.questionTiming ?? "") ? session.questionTiming : null,
    counts: Object.fromEntries(FIRST_RUN_ACTIONS.map(id => [id, bounded(session.counts[id])])),
  });
}

export function restorePassiveFirstRun(raw: string): PassiveSession | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (input.version !== 1 || input.consent !== true
      || typeof input.startedAt !== "number" || !Number.isFinite(input.startedAt) || input.startedAt < 0
      || typeof input.expiresAt !== "number" || input.expiresAt - input.startedAt !== FIRST_RUN_WINDOW_MS
      || !Array.isArray(input.changedFields) || !Array.isArray(input.tools)) return null;
    const original = input.counts && typeof input.counts === "object" && !Array.isArray(input.counts)
      ? input.counts as Record<string, unknown> : {};
    const changedFields = [...new Set(input.changedFields.filter((field): field is ChangedField =>
      typeof field === "string" && CHANGED_SET.has(field)))];
    const tools = changedFields.includes("tools")
      ? [...new Set(input.tools.filter((tool): tool is ToolChoice => typeof tool === "string" && TOOL_SET.has(tool)))] : [];
    const questionTiming = changedFields.includes("questionTiming") && typeof input.questionTiming === "string" && TIMINGS.has(input.questionTiming)
      ? input.questionTiming as PracticeTiming : null;
    return {
      version: 1, consent: true, startedAt: input.startedAt, expiresAt: input.expiresAt,
      changedFields, tools, questionTiming,
      counts: Object.fromEntries(FIRST_RUN_ACTIONS.map(id => [id, bounded(original[id])])) as Record<PassiveAction, number>,
    };
  } catch { return null; }
}

type Weighted = { sum: number; weight: number };
function axisInputs(session: PassiveSession) {
  const sources: Partial<Record<Atlas25Axis, Weighted>> = {};
  const put = (axis: Atlas25Axis, value: number, weight: number) => {
    const current = sources[axis] ?? { sum: 0, weight: 0 };
    sources[axis] = { sum: current.sum + value * weight, weight: current.weight + weight };
  };
  if (session.questionTiming) {
    put("practice", ({ "after-first-pass": 39, "after-learning": 64, "near-exam": 85 } as const)[session.questionTiming], 3);
  }
  if (session.changedFields.includes("tools")) {
    const q = session.tools.some(tool => ["questions", "uworld", "amboss"].includes(tool));
    const l = session.tools.includes("lectures");
    if (q !== l) put("practice", q ? 24 : 78, 1.8);
    // Selecting study tools is about interface features, NOT a personality trait.
  }
  // Navigating a page is weak evidence; no single page choice can yield a match.
  if (session.counts["visit-questions"]) put("practice", 34, 0.25);
  if (session.counts["visit-tracker"]) put("view", 65, 0.25);
  if (session.counts["visit-reports"]) put("view", 77, 0.25);
  if (session.counts["begin-practice"]) put("practice", 21, 1.25);
  if (session.counts["review-source"]) put("practice", 75, 1.25);
  if (session.counts["start-focus"]) put("momentum", 30, 0.4);
  // Dashboard editing and coarse content exploration count toward engagement only.
  // Feedback voice, sensemaking, cadence and ability are not inferred from scrolling.
  return sources;
}

function rank(session: PassiveSession) {
  const evidence = axisInputs(session);
  return (Object.entries(ATLAS25_TARGETS) as [CorrespondentId, Atlas25Vector][]).map(([id, vector]) => {
    let sum = 0, total = 0;
    ATLAS25_AXES.forEach((axis, index) => {
      const input = evidence[axis.id]; if (!input) return;
      const estimate = input.sum / input.weight;
      sum += Math.pow(estimate - vector[index], 2) * input.weight;
      total += input.weight;
    });
    return { id, distance: total > 0 ? Math.sqrt(sum / total) : Infinity };
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

/**
 * Never returns an academic-ability rating or inferred personality category.
 * Needs two distinct strong signals and at least two semantic actions after 60s.
 */
export function proposePassiveAtlas(session: PassiveSession | null, now: number): PassiveProposal {
  const defaultConfig: PassiveProposal["proposedConfig"] = {
    dashboardPriority: "keep-current", requiresApproval: true,
    automaticallyChangesAccount: false, subscribesToEmail: false,
  };
  const base: PassiveProposal = { status: "off", confidenceLabel: null, alternatives: [], explanation: [], proposedConfig: defaultConfig };
  if (!session) return base;
  const events = FIRST_RUN_ACTIONS.filter(id => session.counts[id] > 0);
  const strong = Number(session.questionTiming !== null)
    + Number(session.changedFields.includes("tools") && session.tools.length > 0)
    + Number(session.counts["begin-practice"] > 0)
    + Number(session.counts["review-source"] > 0);
  const elapsed = now - session.startedAt;
  const ready = strong >= 2 && events.length >= 2 && elapsed >= 60_000;
  if (!ready) return { ...base, status: elapsed >= FIRST_RUN_WINDOW_MS ? "insufficient" : "observing" };
  const top = rank(session).slice(0, 3);
  const first = AXOM_CORRESPONDENTS.find(card => card.id === top[0]?.id);
  if (!first) return { ...base, status: "insufficient" };
  const explanation = [
    ...(session.questionTiming || session.changedFields.includes("tools") ? ["Your own study setup choices informed this suggestion."] : []),
    ...(session.counts["begin-practice"] ? ["You began a practice activity during your first exploration."] : []),
    ...(session.counts["review-source"] ? ["You opened source material during your first exploration."] : []),
    "This is a provisional interface preference, not a personality judgment.",
  ];
  const dashboardPriority = session.counts["begin-practice"] > session.counts["review-source"]
    ? "question-bank" : session.counts["review-source"] > session.counts["begin-practice"]
      ? "course-tracker" : "keep-current";
  return {
    status: "ready", confidenceLabel: "provisional",
    suggestion: { id: first.id, name: first.name, description: first.description },
    alternatives: top.slice(1).flatMap(candidate => {
      const card = AXOM_CORRESPONDENTS.find(c => c.id === candidate.id);
      return card ? [{ id: card.id, name: card.name }] : [];
    }),
    explanation, proposedConfig: { ...defaultConfig, dashboardPriority },
  };
}
