import { describe, expect, it } from "vitest";
import { parseCourseSchedule, scheduleCandidatesToTracker } from "./courseScheduleImport";
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

  it("puts a deadline on the learner's own day, whatever zone the calendar wrote it in", () => {
    // 11:59 pm on 14 September in New York is 03:59 on the 15th in UTC. Read by its digits it lands a day late.
    const calendar = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "UID:event-assignment-1", "DTSTART:20260915T035900Z", "SUMMARY:Problem set 3 [BIOL 101]", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20260914T235900", "SUMMARY:Reading\\, chapters 4 and 5 [BIOL 101]",
      "BEGIN:VALARM", "TRIGGER:-PT1H", "DESCRIPTION:Quiz reminder", "END:VALARM", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const rows = parseCourseSchedule(calendar, [], "course.ics", { timeZone: "America/New_York" });
    expect(rows.map((row) => [row.date, row.label, row.kind])).toEqual([
      ["2026-09-14", "Problem set 3", "Lecture"],
      // The reminder inside the event is not part of it, so its wording does not make this a quiz.
      ["2026-09-14", "Reading, chapters 4 and 5", "Reading"],
    ]);
    // The same feed read by a learner in Tokyo: both are due on the 15th there.
    expect(parseCourseSchedule(calendar, [], "course.ics", { timeZone: "Asia/Tokyo" }).map((row) => row.date)).toEqual(["2026-09-15", "2026-09-15"]);
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

  it("keeps a 2,000-row intake linear enough for an ordinary browser interaction", () => {
    const input = Array.from({ length: 2_000 }, (_, index) => `2026-09-${String(index % 28 + 1).padStart(2, "0")},Synthetic Lecture ${index + 1},Lecture`).join("\n");
    const started = performance.now();
    expect(parseCourseSchedule(input)).toHaveLength(2_000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
