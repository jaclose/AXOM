import { describe, expect, it } from "vitest";
import {
  canvasItemKind, inferYear, parseCanvasPastedText, parseCourseSchedule, parseLooseDate, reconcileScheduleDuplicates, scheduleCandidatesToTracker,
} from "./courseScheduleImport";
import type { TrackerItem } from "./types";

describe("course schedule intake", () => {
  it("extracts dated course work conservatively", () => {
    const rows = parseCourseSchedule("2026-08-14,Renal Physiology,Lecture\n2026-08-14,Renal DLA,DLA\n2026-08-20,IMCQ 2,Assessment");
    expect(rows.map((row) => [row.date, row.kind])).toEqual([
      ["2026-08-14", "Lecture"], ["2026-08-14", "DLA"], ["2026-08-20", "Assessment"],
    ]);
    expect(scheduleCandidatesToTracker(rows, "T1/Cardio")[2].assessmentDate).toBe("2026-08-20");
  });

  it("parses quoted CSV titles without splitting their commas", () => {
    const [row] = parseCourseSchedule('08/14/2026,"Acid, base, and renal compensation",Lecture');
    expect(row).toMatchObject({ date: "2026-08-14", label: "Acid, base, and renal compensation", kind: "Lecture" });
  });

  it("imports ICS events and preserves source provenance", () => {
    const rows = parseCourseSchedule([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/Grenada:20260814T080000", "SUMMARY:Renal Physiology Lecture", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260820", "SUMMARY:IMCQ 2", "DESCRIPTION:Quiz assessment", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"), [], "BPM schedule.ics");
    expect(rows.map((row) => [row.date, row.kind])).toEqual([["2026-08-14", "Lecture"], ["2026-08-20", "Assessment"]]);
    expect(scheduleCandidatesToTracker(rows, "T1/BPM")[0].note).toBe("Scheduled 2026-08-14 · Imported from BPM schedule.ics");
  });

  it("marks duplicates across both the existing tracker and one incoming batch", () => {
    const existing: TrackerItem[] = [
      { id: "x", path: "T1", label: "Renal Physiology", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-08-01", note: "Scheduled 2026-08-14" },
      { id: "y", path: "T1", label: "Cardiac Lab", kind: "Lab", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-08-01" },
    ];
    const rows = parseCourseSchedule("2026-08-14,Renal Physiology,Lecture\n2026-08-15,Cardiac Lab,Lab\n2026-08-15,Cardiac Lab,Lab", existing);
    expect(rows[0]).toMatchObject({ duplicate: "exact", selected: false });
    expect(rows[1].duplicate).toBe("likely");
    expect(rows[2]).toMatchObject({ duplicate: "exact", selected: false });
  });

  it("surfaces malformed calendar events instead of silently discarding them", () => {
    const [row] = parseCourseSchedule("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260814T080000\nEND:VEVENT\nEND:VCALENDAR", [], "broken.ics");
    expect(row).toMatchObject({ selected: false, sourceName: "broken.ics", problem: "Calendar event 1 has no title." });
    expect(scheduleCandidatesToTracker([row], "T1")).toEqual([]);
  });

  it("stores each date in the field that matches the kind, with source provenance", () => {
    const rows = parseCourseSchedule("2026-08-14,Renal Physiology,Lecture\n2026-08-18,Reflection essay,Assignment\n2026-08-20,IMCQ 2,Assessment");
    const items = scheduleCandidatesToTracker(rows, "T1/Cardio", "2026-08-01T00:00:00.000Z");
    expect(items[0]).toMatchObject({ scheduledDate: "2026-08-14", source: { kind: "text", importedAt: "2026-08-01T00:00:00.000Z" } });
    expect(items[0].assessmentDate).toBeUndefined();
    expect(items[1]).toMatchObject({ kind: "Requirement", dueDate: "2026-08-18" });
    expect(items[2]).toMatchObject({ assessmentDate: "2026-08-20" });
  });

  it("keeps Canvas calendar identities and links so a re-import is recognized", () => {
    const feed = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:event-assignment-9", "DTSTART;VALUE=DATE:20260901", "SUMMARY:Homework 1 [BIO 1]",
      "URL:https://school.instructure.com/courses/1/assignments/9", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const [row] = parseCourseSchedule(feed, [], "canvas.ics", { timeZone: "UTC" });
    expect(row).toMatchObject({ label: "Homework 1", sourceRef: "canvas:assignment:9", sourceUrl: "https://school.instructure.com/courses/1/assignments/9" });
    const [item] = scheduleCandidatesToTracker([row], "T1/BIO 1", "2026-08-01T00:00:00.000Z");
    expect(item).toMatchObject({ source: { kind: "calendar", ref: "canvas:assignment:9" }, sourceUrl: "https://school.instructure.com/courses/1/assignments/9" });
    const existing = { ...item, id: "saved", updated: "2026-08-01", label: "Renamed by learner" } as TrackerItem;
    expect(reconcileScheduleDuplicates([row], [existing])[0]).toMatchObject({ duplicate: "exact", selected: false });
  });

  it("keeps a 2,000-row intake linear enough for an ordinary browser interaction", () => {
    const input = Array.from({ length: 2_000 }, (_, index) => `2026-09-${String(index % 28 + 1).padStart(2, "0")},Synthetic Lecture ${index + 1},Lecture`).join("\n");
    const started = performance.now();
    expect(parseCourseSchedule(input)).toHaveLength(2_000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("text copied from a Canvas Modules page", () => {
  const COPIED = [
    "Modules",
    "Collapse All",
    "View Progress",
    "Week 1: Foundations",
    "Complete All Items",
    "Page",
    "Welcome and course map",
    "File",
    "Lecture 1 - Cell injury slides.pdf",
    "Quiz",
    "Practice quiz: Cell injury",
    "Sep 12 | 10 pts",
    "Assignment",
    "Reflection essay",
    "Due Sep 15, 2026 at 11:59pm | 5 pts",
    "Mark as done",
    "",
    "Week 2: Inflammation",
    "Lecture 2: Acute inflammation",
    "DLA 3 Chemical mediators",
    "Quiz",
    "Midterm Exam",
    "10/3/2026 | 100 pts",
  ].join("\n");

  it("keeps modules, items, Canvas types, dates and points, and drops interface text", () => {
    const parsed = parseCanvasPastedText(COPIED, { today: "2026-09-01" });
    expect(parsed.modules.map((module) => module.name)).toEqual(["Week 1: Foundations", "Week 2: Inflammation"]);
    expect(parsed.modules[0].items.map((item) => [item.label, item.kind, item.canvasType ?? ""])).toEqual([
      ["Welcome and course map", "Reading", "Page"],
      ["Lecture 1 - Cell injury slides.pdf", "Lecture", "File"],
      ["Practice quiz: Cell injury", "PQ", "Quiz"],
      ["Reflection essay", "Requirement", "Assignment"],
    ]);
    expect(parsed.modules[0].items[2]).toMatchObject({ date: "2026-09-12", yearInferred: true, points: 10, dateText: "Sep 12" });
    expect(parsed.modules[0].items[3]).toMatchObject({ date: "2026-09-15", yearInferred: false, points: 5 });
    expect(parsed.modules[1].items.map((item) => item.kind)).toEqual(["Lecture", "DLA", "Assessment"]);
    expect(parsed.modules[1].items[2]).toMatchObject({ date: "2026-10-03", yearInferred: false, points: 100 });
    expect(parsed.warnings).toEqual(["1 date had no year; AXOM chose the nearest year. Check them before importing."]);
    expect(parsed.ignoredLines).toBeGreaterThanOrEqual(4);
  });

  it("puts items outside any heading in an unnamed module and explains an empty paste", () => {
    const loose = parseCanvasPastedText("Lecture 1 Cardiac cycle\nLecture 2 Heart failure", { today: "2026-09-01" });
    expect(loose.modules).toHaveLength(1);
    expect(loose.modules[0]).toMatchObject({ name: "", items: [{ label: "Lecture 1 Cardiac cycle" }, { label: "Lecture 2 Heart failure" }] });
    expect(parseCanvasPastedText("Modules\nCollapse All\n", { today: "2026-09-01" }).warnings[0]).toMatch(/No module items/);
  });

  it("parses written dates and picks the nearest year only when none is given", () => {
    expect(parseLooseDate("Sep 12", "2026-09-01")).toEqual({ date: "2026-09-12", yearInferred: true });
    expect(parseLooseDate("Jan 5", "2026-11-20")).toEqual({ date: "2027-01-05", yearInferred: true });
    expect(parseLooseDate("Dec 20", "2027-01-10")).toEqual({ date: "2026-12-20", yearInferred: true });
    expect(parseLooseDate("Friday, October 2, 2026 at 5pm", "2026-01-01")).toEqual({ date: "2026-10-02", yearInferred: false });
    expect(parseLooseDate("2026-02-30", "2026-01-01")).toBeUndefined();
    expect(parseLooseDate("Feb 30", "2026-01-01")).toBeUndefined();
    expect(parseLooseDate("Lecture 4", "2026-01-01")).toBeUndefined();
    expect(inferYear(8, 1, "2026-12-01")).toBe(2026);
  });

  it("maps Canvas item types and titles to tracker kinds", () => {
    expect(canvasItemKind("Chapter 3", "Page")).toBe("Reading");
    expect(canvasItemKind("Week 1 overview", "Page")).toBe("Reading");
    expect(canvasItemKind("Quiz 1", "Quiz", "assignment")).toBe("Assessment");
    expect(canvasItemKind("Warm-up", "Quiz", "practice_quiz")).toBe("PQ");
    expect(canvasItemKind("Course evaluation", "Quiz", "survey")).toBe("Requirement");
    expect(canvasItemKind("Case write-up", "Assignment")).toBe("Requirement");
    expect(canvasItemKind("Lecture 7 recording", "ExternalTool")).toBe("Lecture");
    expect(canvasItemKind("Anatomy Lab 2", "Assignment")).toBe("Lab");
  });
});
