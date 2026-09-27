import { describe, expect, it } from "vitest";
import { buildIcs, calendarEvents, escapeIcsText, foldIcsLine } from "./calendarExport";
import { makeSeed } from "./seed";

describe("calendar export", () => {
  it("includes only chosen, future, open items as all-day events", () => {
    const state = makeSeed();
    state.tasks = [
      { id: "t1", title: "Renal quiz", due: "2026-10-02", done: false, created: "2026-09-01" },
      { id: "t2", title: "Old", due: "2026-09-01", done: false, created: "2026-09-01" },
      { id: "t3", title: "Finished", due: "2026-10-03", done: true, created: "2026-09-01" },
    ];
    state.boardPrep.step1 = { ...state.boardPrep.step1, examDate: "2027-03-15" };
    state.dayPlans = [{ dayKey: "2026-09-27", intention: "Finish cardio", wins: ["2 lectures"], createdAt: "2026-09-27T08:00:00Z" }];
    const all = calendarEvents(state, { tasks: true, exams: true, dayPlans: true, fromDay: "2026-09-26" });
    expect(all.map((event) => event.title)).toEqual(["Intention: Finish cardio", "Due: Renal quiz", "USMLE Step 1 exam day"]);
    expect(calendarEvents(state, { tasks: true, exams: false, dayPlans: false, fromDay: "2026-09-26" })).toHaveLength(1);
  });

  it("writes valid, escaped, folded iCalendar text", () => {
    const ics = buildIcs([{ uid: "task-1", day: "2026-12-31", title: "Due: a, b; c\\d", category: "AXOM task" }], new Date("2026-09-26T10:00:00.000Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101\r\n");
    expect(ics).toContain("SUMMARY:Due: a\\, b\\; c\\\\d");
    expect(ics).toContain("DTSTAMP:20260926T100000Z");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(escapeIcsText("line1\nline2")).toBe("line1\\nline2");
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    expect(folded.split("\r\n").every((line) => line.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });
});
