import { expect, it } from "vitest";
import { examUrgency, normalizeExamCountdown, upcomingModuleExams, validExamDate } from "./examDeadlines";
it("validates real calendar dates, including leap years", () => {
  expect(validExamDate("2028-02-29")).toBe(true);
  for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "tomorrow", null]) expect(validExamDate(value)).toBe(false);
});
it("keeps Step 1 awareness earlier than module exams and handles passed dates", () => {
  for (const [days, urgency] of [[181, "calm"], [180, "watch"], [90, "aware"], [30, "approaching"], [14, "soon"], [7, "imminent"], [0, "today"], [-1, "past"]] as const) expect(examUrgency(days, "step1")).toBe(urgency);
  expect(examUrgency(90, "module")).toBe("calm");
  expect(examUrgency(10, "module")).toBe("aware");
  expect(examUrgency(1, "module")).toBe("imminent");
});
it("sanitizes imported deadlines and preserves complete records through serialization", () => {
  const base = { id: "renal", name: " Renal ", date: "2026-10-01", priority: "high" };
  const normalized = normalizeExamCountdown({ step1DateKind: "booked", moduleExams: [base, base, { ...base, id: "bad", date: "no" }, { ...base, id: "done", completedAt: "2026-09-29T12:00:00Z" }] });
  expect(normalized.moduleExams).toHaveLength(2);
  expect(normalizeExamCountdown(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  expect(upcomingModuleExams(normalized.moduleExams, "2026-09-29").map((exam) => exam.id)).toEqual(["renal"]);
});
it("leads with the nearest upcoming exam, leaving overdue exams reviewable", () => {
  const exams = normalizeExamCountdown({ moduleExams: [
    { id: "past", name: "Past", date: "2026-09-01" }, { id: "future", name: "Future", date: "2026-10-03" }, { id: "next", name: "Next", date: "2026-09-30" },
  ] }).moduleExams;
  expect(upcomingModuleExams(exams, "2026-09-29").map((exam) => exam.id)).toEqual(["next", "future", "past"]);
});
