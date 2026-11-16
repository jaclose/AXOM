import { describe, expect, it } from "vitest";
import { ACADEMIC_PLAN_SECTION_BREAK } from "./coursePlan";
import { publicPlanPreview } from "./publicPlanPreview";

const outline = (text: string) => {
  const preview = publicPlanPreview(text, "Term 1");
  return {
    weeks: preview.weeks.map(week => ({ week: week.week, labels: week.items.map(item => item.label), tentative: week.tentative })),
    unscheduled: preview.unscheduled.map(item => item.label),
    activities: preview.activities, tentative: preview.tentative, unreadable: preview.unreadable,
  };
};

describe("visitor plan preview", () => {
  it("lists the weeks a plan states, in order, with nothing marked tentative", () => {
    expect(outline("T1 - FTM 1 - Lectures:\nWeek 2:\nLecture 02 Systems [Lecture]\nWeek 1:\nLecture 01 Foundations [Lecture]\n")).toEqual({
      weeks: [{ week: 1, labels: ["Lecture 01 Foundations"], tentative: 0 }, { week: 2, labels: ["Lecture 02 Systems"], tentative: 0 }],
      unscheduled: [], activities: 2, tentative: false, unreadable: false,
    });
  });

  it("never invents a week: activities without an evidenced week stay unscheduled", () => {
    expect(outline("T1 - FTM 1 - Lectures:\nLecture 01 Foundations [Lecture]\n\nLecture 02 Systems [Lecture]\n")).toEqual({
      weeks: [], unscheduled: ["Lecture 01 Foundations", "Lecture 02 Systems"], activities: 2, tentative: false, unreadable: false,
    });
  });

  it("counts only the activities AXOM placed by ordering as tentative, not the whole week", () => {
    const text = `T1 - FTM 1 - Small groups:\nWeek 1:\nSG 1 Cases [Small Group]\nWeek 2:\nSG 2 Cases [Small Group]\n${ACADEMIC_PLAN_SECTION_BREAK}T1 - FTM 1 - Lectures:\nLecture 01 Foundations [Lecture]\n\nLecture 02 Systems [Lecture]\n`;
    expect(outline(text)).toEqual({
      weeks: [{ week: 1, labels: ["SG 1 Cases", "Lecture 01 Foundations"], tentative: 1 }, { week: 2, labels: ["SG 2 Cases", "Lecture 02 Systems"], tentative: 1 }],
      unscheduled: [], activities: 4, tentative: true, unreadable: false,
    });
  });

  it("treats a course without a plan as an empty outline and unread text as unreadable", () => {
    expect(outline("  \n ")).toEqual({ weeks: [], unscheduled: [], activities: 0, tentative: false, unreadable: false });
    expect(outline("not a course plan")).toMatchObject({ weeks: [], activities: 0, unreadable: true });
  });
});
