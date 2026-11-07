import { describe, expect, it } from "vitest";
import { adaptLegacyDashboardLayout } from "../dashboardWidgets";
import { AXOM_CORRESPONDENTS } from "./correspondents";
import { atlasStudyLens, planAtlasDashboardPriority, undoAtlasDashboardPriority } from "./atlasRecommendations";

const layout = () => {
  const source = adaptLegacyDashboardLayout({ order: ["welcome", "commandBrief", "tasks", "courseTracker", "questionBank", "pomodoro"] });
  source.widgets.questionBank = { size: "large", enabledFields: ["attempts"], preferences: { showSource: true } };
  source.widgets.courseTracker = { size: "small", enabledFields: ["active"], preferences: {} };
  source.preset = "custom";
  return source;
};

describe("Atlas recommendations have real, reversible AXOM effects", () => {
  it("offers a unique practical study action for each of the 25 companions", () => {
    expect(AXOM_CORRESPONDENTS).toHaveLength(25);
    for (const card of AXOM_CORRESPONDENTS) {
      const lens = atlasStudyLens(card.id);
      expect(lens.title.length).toBeGreaterThan(12);
      expect(lens.rationale.length).toBeGreaterThan(35);
      expect(lens.route).toMatch(/^(tracker|questions|methods|tasks|productivity)$/);
      expect(lens.actionLabel).toMatch(/^Open /);
      expect(lens.rationale).not.toMatch(/diagnos|IQ|intelligent|personality score/i);
    }
    expect(atlasStudyLens("juniper").route).toBe("productivity");
    expect(atlasStudyLens("fathom").route).toBe("questions");
  });

  it("prioritizes Question Bank only after approval without changing visibility, content, size or settings", () => {
    const previous = layout();
    const proposal = planAtlasDashboardPriority(previous, "question-bank", "2026-11-07T12:00:00.000Z");
    expect(proposal.status).toBe("ready");
    expect(proposal.next?.order).toEqual(["welcome", "commandBrief", "questionBank", "tasks", "courseTracker", "pomodoro"]);
    expect(proposal.next?.hiddenWidgetIds).toEqual(previous.hiddenWidgetIds);
    expect(proposal.next?.widgets.questionBank).toEqual(previous.widgets.questionBank);
    expect(previous.order[2]).toBe("tasks");
    expect(proposal.next?.preset).toBe("custom");
    expect(proposal.next?.updatedAt).toBe("2026-11-07T12:00:00.000Z");
  });

  it("does not reverse a student's deliberate hiding of a widget", () => {
    const previous = layout();
    previous.hiddenWidgetIds.push("questionBank");
    const plan = planAtlasDashboardPriority(previous, "question-bank");
    expect(plan.status).toBe("blocked");
    expect(plan.next).toBeUndefined();
    expect(previous.hiddenWidgetIds).toContain("questionBank");
  });

  it("does not create a bogus change for already-first or insufficient priority", () => {
    const current = layout();
    expect(planAtlasDashboardPriority(current, "keep-current").status).toBe("not-applicable");
    expect(planAtlasDashboardPriority(null, "question-bank").status).toBe("blocked");
    const first = planAtlasDashboardPriority(current, "course-tracker");
    expect(first.status).toBe("ready");
    expect(planAtlasDashboardPriority(first.next, "course-tracker").status).toBe("already-set");
  });

  it("can undo the exact applied proposal, but never overwrite intervening user edits", () => {
    const previous = layout();
    const plan = planAtlasDashboardPriority(previous, "question-bank");
    expect(plan.next).toBeDefined();
    expect(undoAtlasDashboardPriority(plan.next, previous, plan.next)).toEqual(previous);
    const changed = { ...plan.next!, hiddenWidgetIds: ["questionBank"] };
    expect(undoAtlasDashboardPriority(changed, previous, plan.next)).toBeNull();
  });
});
