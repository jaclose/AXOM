import type { DashboardLayoutPreferences } from "../types";
import { normalizeDashboardLayoutPreferences } from "../dashboardWidgets";
import { AXOM_CORRESPONDENTS, CORRESPONDENT_ORDERS, type CorrespondentId } from "./correspondents";
import type { PassiveProposal } from "./passiveFirstRun";

type DashboardPriority = PassiveProposal["proposedConfig"]["dashboardPriority"];
export type AtlasDashboardPlan = {
  status: "ready" | "already-set" | "blocked" | "not-applicable";
  description: string;
  next?: DashboardLayoutPreferences;
};

const STUDY_LENSES = {
  ARCHITECTS: {
    title: "Find the structure beneath the work",
    rationale: "Open Course Tracker to locate the current module, identify its dependencies and choose one source-backed objective to close next.",
    actionLabel: "Open Course Tracker",
    route: "tracker",
  },
  INVESTIGATORS: {
    title: "Test a distinction with evidence",
    rationale: "Open Question Bank to practice an approved question, inspect the reasoning and separate what the evidence supports from tempting distractors.",
    actionLabel: "Open Question Bank",
    route: "questions",
  },
  ALCHEMISTS: {
    title: "Connect one mechanism to another",
    rationale: "Open Study Methods to make a concrete, testable connection between ideas; retrieve the explanation afterward rather than relying on familiarity.",
    actionLabel: "Open Study Methods",
    route: "methods",
  },
  WAYFINDERS: {
    title: "Turn the next decision into a small action",
    rationale: "Open Tasks to pick a single achievable academic step, then check whether the work actually moved your learning forward.",
    actionLabel: "Open Tasks",
    route: "tasks",
  },
  WARDENS: {
    title: "Build a sustainable practice rhythm",
    rationale: "Open Productivity to set a realistic focus block and follow it with meaningful review, without treating time logged as proof of mastery.",
    actionLabel: "Open Productivity",
    route: "productivity",
  },
} as const;

export function atlasStudyLens(id: CorrespondentId) {
  const order = (Object.keys(CORRESPONDENT_ORDERS) as (keyof typeof CORRESPONDENT_ORDERS)[])
    .find(key => (CORRESPONDENT_ORDERS[key] as readonly string[]).includes(id));
  // A missing roster mapping is a development error, never a fictitious persona.
  if (!order || !AXOM_CORRESPONDENTS.some(card => card.id === id)) {
    throw new Error("Atlas companion is not assigned to a valid academic order.");
  }
  return STUDY_LENSES[order];
}

export function planAtlasDashboardPriority(
  value: unknown,
  priority: DashboardPriority,
  now = new Date().toISOString(),
): AtlasDashboardPlan {
  if (priority === "keep-current") {
    return { status: "not-applicable", description: "Your existing dashboard is already the safest starting point." };
  }
  const layout = normalizeDashboardLayoutPreferences(value);
  if (!layout) {
    return { status: "blocked", description: "A saved dashboard layout is needed before any changes can be proposed." };
  }
  const target = priority === "question-bank" ? "questionBank" : "courseTracker";
  const label = priority === "question-bank" ? "Question Bank" : "Course Tracker";
  const hidden = new Set(layout.hiddenWidgetIds);
  if (hidden.has(target) || !layout.order.includes(target)) {
    return { status: "blocked", description: "You previously hid or removed " + label + ". AXOM will not reverse that choice." };
  }
  const pinned = new Set(["welcome", "commandBrief"]);
  const firstVisible = layout.order.find(id => !pinned.has(id) && !hidden.has(id));
  if (!firstVisible) return { status: "blocked", description: "Your dashboard has no eligible visible widgets to reorder." };
  if (firstVisible === target) {
    return { status: "already-set", description: label + " is already your first visible dashboard widget." };
  }
  const remainder = layout.order.filter(id => id !== target);
  const beforeIndex = remainder.indexOf(firstVisible);
  if (beforeIndex < 0) return { status: "blocked", description: "Unable to create a safe dashboard preview." };
  remainder.splice(beforeIndex, 0, target);
  const next = normalizeDashboardLayoutPreferences({
    ...layout, order: remainder, preset: "custom", updatedAt: now,
  });
  if (!next) return { status: "blocked", description: "Unable to validate the proposed dashboard layout." };
  return { status: "ready", description: "Move " + label + " to the first visible dashboard position. All other widget settings remain unchanged.", next };
}

/** Only reverse the exact proposal applied by this feature, never newer edits. */
export function undoAtlasDashboardPriority(
  current: unknown, previous: DashboardLayoutPreferences, applied: DashboardLayoutPreferences | undefined,
): DashboardLayoutPreferences | null {
  const normalized = normalizeDashboardLayoutPreferences(current);
  if (!normalized || !applied) return null;
  return JSON.stringify(normalized) === JSON.stringify(applied) ? previous : null;
}
