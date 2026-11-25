import { describe, expect, it } from "vitest";
import { canImportScheduleCandidate, parseCourseSchedule, reconcileScheduleDuplicates, scheduleCandidatesToTracker } from "./courseScheduleImport";
import type { TrackerItem } from "./types";
import { absenceStanding, isAttended } from "./course-engine/weekView";

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


  it("does not treat the same assessment title in a different course as a duplicate", () => {
    const completed: TrackerItem = {
      id: "completed-t2", path: "Term 2/ER/Week 3", label: "IMCQ 2",
      kind: "Assessment", passes: 1, ankiPasses: 0, yield: "none", updated: "2026-10-14",
      assessmentDate: "2026-10-14",
    };
    const csv = "2026-10-14,IMCQ 2,Assessment";
    const [otherCourse] = parseCourseSchedule(csv, [completed], "SGU.csv", {}, "Term 4/NCRS/Week 3");
    const [sameCourse] = parseCourseSchedule(csv, [completed], "SGU.csv", {}, "Term 2/ER/Week 3");
    expect(otherCourse).toMatchObject({ duplicate: "none", selected: true });
    expect(sameCourse).toMatchObject({ duplicate: "exact", selected: false });
  });

  it("surfaces malformed calendar events instead of silently discarding them", () => {
    const [row] = parseCourseSchedule("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260814T080000\nEND:VEVENT\nEND:VCALENDAR", [], "broken.ics");
    expect(row).toMatchObject({ selected: false, sourceName: "broken.ics", problem: "Calendar event 1 has no title." });
    expect(scheduleCandidatesToTracker([row], "T1")).toEqual([]);
  });

  it("retains explicit CSV activity types without inventing attendance or policy", () => {
    const rows = parseCourseSchedule([
      "2026-08-14,Renal clearance,Lecture",
      "2026-08-14,Fluid balance,Flipped Lecture",
      "2026-08-14,Case discussion,Small Group",
      "2026-08-14,Clinical quiz,IMCQ",
      "2026-08-14,Weekly quiz,ESoft",
      "2026-08-14,Independent practice,Practice questions",
      "2026-08-14,Personal review",
    ].join("\n"));
    expect(rows.map(({ label, kind, activity }) => [label, kind, activity])).toEqual([
      ["Renal clearance", "Lecture", "lecture"],
      ["Fluid balance", "Lecture", "flipped-lecture"],
      ["Case discussion", "Requirement", "small-group"],
      ["Clinical quiz", "Assessment", "imcq"],
      ["Weekly quiz", "Assessment", "esoft"],
      ["Independent practice", "PQ", "pq"],
      ["Personal review", "Review Loop", undefined],
    ]);
    const path = "Term 1/BPM 500/FTM 1/Week 3";
    const items: TrackerItem[] = scheduleCandidatesToTracker(rows, path).map((row, index) => ({ ...row, id: String(index), updated: "2026-08-14" }));
    expect(items.every((item) => item.attendance === undefined && item.passes === 0)).toBe(true);
    expect(items.map((item) => isAttended(item.activity))).toEqual([true, true, true, true, true, false, false]);
    const term = { name: "Term 1", absenceAllowances: { lecture: 3, "small-group": 2, imcq: 2, esoft: 2 } };
    expect(absenceStanding(items, term).every((entry) => entry.missed === 0)).toBe(true);
    const missed = items.map((item) => isAttended(item.activity) ? { ...item, attendance: "missed" as const } : item);
    expect(absenceStanding(missed, term)).toEqual([
      { category: "lecture", missed: 2, allowed: 3, remaining: 1 },
      { category: "small-group", missed: 1, allowed: 2, remaining: 1 },
      { category: "imcq", missed: 1, allowed: 2, remaining: 1 },
      { category: "esoft", missed: 1, allowed: 2, remaining: 1 },
    ]);
    expect(parseCourseSchedule("2026-08-14,Case discussion,Small Group", items, "schedule.csv", {}, path)[0]).toMatchObject({ duplicate: "exact", selected: false });
  });

  it("does not recreate old coarse-type rows when importing the same typed schedule", () => {
    const path = "Term 1/BPM 500/FTM 1/Week 3";
    const existing: TrackerItem[] = [
      { id: "old-1", path, label: "Fluid balance Flipped", kind: "Lecture", passes: 2, ankiPasses: 1, yield: "high", updated: "2026-08-14", note: "Scheduled 2026-08-14" },
      { id: "old-2", path, label: "Case discussion Small Group", kind: "Lecture", passes: 1, ankiPasses: 0, yield: "none", updated: "2026-08-14", note: "Scheduled 2026-08-14" },
      { id: "old-3", path, label: "Weekly quiz ESoft", kind: "Assessment", passes: 1, ankiPasses: 0, yield: "none", updated: "2026-08-14", assessmentDate: "2026-08-14" },
    ];
    const before = JSON.stringify(existing);
    const csv = "2026-08-14,Fluid balance,Flipped Lecture\n2026-08-14,Case discussion,Small Group\n2026-08-14,Weekly quiz,ESoft";
    const rows = parseCourseSchedule(csv, existing, "schedule.csv", {}, path);
    expect(rows.every((row) => row.duplicate === "exact" && !row.selected)).toBe(true);
    expect(scheduleCandidatesToTracker(rows, path)).toEqual([]);
    expect(JSON.stringify(existing)).toBe(before);
    expect(parseCourseSchedule(csv, existing, "schedule.csv", {}, "Term 2/BPM 500/FTM 1/Week 3").every((row) => row.duplicate === "none" && row.selected)).toBe(true);
    const [edited] = reconcileScheduleDuplicates([{ ...rows[0], label: "Different event", selected: true }], existing, path);
    expect(edited).toMatchObject({ duplicate: "none", selected: true });
    const [classified] = parseCourseSchedule(csv, [{ ...existing[0], activity: "lecture" }], "schedule.csv", {}, path);
    expect(classified.duplicate).toBe("none");
  });

  it("requires explicit category review for ICS and ignores an incompatible category", () => {
    const rows = parseCourseSchedule([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20260814T080000", "SUMMARY:IMCQ 2", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART:20260815T080000", "SUMMARY:Lecture cancellation", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"));
    expect(rows.every((row) => row.activity === undefined)).toBe(true);
    const path = "Term 1/BPM 500/FTM 1/Week 3";
    expect(scheduleCandidatesToTracker([{ ...rows[0], activity: "imcq" }, { ...rows[1], activity: "esoft" }], path)
      .map((row) => row.activity)).toEqual(["imcq", undefined]);
    expect(scheduleCandidatesToTracker(rows, path).every((row) => row.activity === undefined)).toBe(true);
  });

  it.each([["IMCQ", "ESoft"], ["ESoft", "IMCQ"]] as const)("holds incompatible %s/%s categories until distinct-event confirmation", (first, second) => {
    const path = "Term 1/BPM 500/FTM 1/Week 3";
    const csv = (category: string) => `2026-08-14,Session 1,${category}`;
    const initial = parseCourseSchedule(csv(first));
    const existing: TrackerItem[] = scheduleCandidatesToTracker(initial, path).map((row) => ({
      ...row, id: "existing", updated: "2026-08-14", passes: 2, attendance: "missed" as const,
    }));
    const before = JSON.stringify(existing);
    const [collision] = parseCourseSchedule(csv(second), existing, "schedule.csv", {}, path);
    expect(collision).toMatchObject({ duplicate: "conflict", selected: false });
    expect(canImportScheduleCandidate(collision)).toBe(false);
    expect(scheduleCandidatesToTracker([{ ...collision, selected: true }], path)).toEqual([]);
    const confirmed = reconcileScheduleDuplicates([{ ...collision, confirmedConflictKey: collision.conflictKey, selected: true }], existing, path);
    expect(scheduleCandidatesToTracker(confirmed, path)).toHaveLength(1);
    expect(JSON.stringify(existing)).toBe(before);
    const [same] = parseCourseSchedule(csv(first), existing, "schedule.csv", {}, path);
    expect(same).toMatchObject({ duplicate: "exact", selected: false });
    const [legacy] = parseCourseSchedule(csv(second), [{ ...existing[0], activity: undefined }], "schedule.csv", {}, path);
    expect(legacy).toMatchObject({ duplicate: "exact", selected: false });
    const [other] = parseCourseSchedule(csv(second), existing, "schedule.csv", {}, "Term 2/BPM 500");
    expect(other).toMatchObject({ duplicate: "none", selected: true });
    const batch = parseCourseSchedule([csv(first), csv(second), csv(first)].join("\n"), [], "schedule.csv", {}, path);
    expect(batch.map((row) => [row.duplicate, row.selected])).toEqual([["conflict", false], ["conflict", false], ["exact", false]]);
    const approved = reconcileScheduleDuplicates(batch.map((row) => ({ ...row, confirmedConflictKey: row.conflictKey, selected: true })), [], path);
    expect(scheduleCandidatesToTracker(approved, path)).toHaveLength(2);
    const changedDestination = reconcileScheduleDuplicates(approved, [], "Term 2/BPM 500");
    expect(changedDestination.every((row) => !row.selected)).toBe(true);
    const nowDuplicate = reconcileScheduleDuplicates(confirmed, [...existing, {
      ...scheduleCandidatesToTracker(confirmed, path)[0], id: "new-existing", updated: "2026-08-14",
    }], path);
    expect(scheduleCandidatesToTracker(nowDuplicate, path)).toEqual([]);
  });

  it("requires renewed confirmation when material counterpart claims change", () => {
    const path = "Term 1/BPM 500/FTM 1/Week 3";
    const [source] = parseCourseSchedule("2026-08-14,Session 1,IMCQ", [], "original.csv");
    const [item] = scheduleCandidatesToTracker([source], path);
    const existing: TrackerItem = { ...item, id: "existing", updated: "2026-08-14" };
    const other = { ...existing, id: "other", note: "Imported from other.csv" };
    const original = [existing, other];
    const [collision] = parseCourseSchedule("2026-08-14,Session 1,ESoft", original, "incoming.csv", {}, path);
    const [confirmed] = reconcileScheduleDuplicates([{ ...collision, confirmedConflictKey: collision.conflictKey, selected: true }], original, path);
    expect(canImportScheduleCandidate(confirmed)).toBe(true);
    expect(confirmed.conflictClaims).toHaveLength(2);
    const before = JSON.stringify(original);
    const [unchanged] = reconcileScheduleDuplicates([confirmed], [other, { ...existing, passes: 3, attendance: "attended", updated: "2026-09-01" }], path);
    expect(unchanged).toMatchObject({ selected: true, confirmedConflictKey: confirmed.conflictKey });
    for (const changed of [
      [{ ...existing, id: "replacement" }, other],
      [{ ...existing, note: "Imported from replacement.csv" }, other],
      [{ ...existing, templateKey: "new-line" }, other],
      [...original, { ...existing, id: "third" }],
      [...original, existing],
      [existing],
      [],
    ]) {
      const [row] = reconcileScheduleDuplicates([confirmed], changed, path);
      expect(row.selected).toBe(false);
      expect(row.confirmedConflictKey).toBeUndefined();
      expect(scheduleCandidatesToTracker([row], path)).toEqual([]);
    }
    expect(JSON.stringify(original)).toBe(before);
    const [first, second] = parseCourseSchedule("2026-08-14,Session 1,IMCQ\n2026-08-14,Session 1,ESoft", [], "batch.csv", {}, path);
    const batch = reconcileScheduleDuplicates([{ ...first, confirmedConflictKey: first.conflictKey, selected: true }, second], [], path);
    expect(batch[0].selected).toBe(true);
    expect(reconcileScheduleDuplicates([batch[1], batch[0]], [], path)[1].selected).toBe(true);
    expect(reconcileScheduleDuplicates([batch[0], { ...batch[1], sourceName: "different.csv" }], [], path)[0].selected).toBe(false);
    expect(reconcileScheduleDuplicates([batch[0]], [], path)[0].selected).toBe(false);
  });

  it("keeps a 2,000-row intake linear enough for an ordinary browser interaction", () => {
    const input = Array.from({ length: 2_000 }, (_, index) => `2026-09-${String(index % 28 + 1).padStart(2, "0")},Synthetic Lecture ${index + 1},Lecture`).join("\n");
    const started = performance.now();
    expect(parseCourseSchedule(input)).toHaveLength(2_000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
