import { describe, expect, it } from "vitest";
import {
  canvasRefFromUid, dayInZone, decodeIcsText, isIcsCalendar, parseIcsEvents, splitContextCode, unfoldIcs, zonedWallClockToInstant,
} from "./icsCalendar";

const CANVAS_FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Instructure//Canvas//EN",
  "X-WR-CALNAME:Student Calendar",
  "BEGIN:VEVENT",
  "DTEND:20260915T035900Z",
  "DTSTART:20260915T035900Z",
  "UID:event-assignment-4411",
  "SUMMARY:Renal physiology problem set [BPM 500 - Basic Principles of Med",
  " icine]",
  "DESCRIPTION:Complete questions 1\\, 2 and 3\\nSubmit as PDF\\; one file.",
  "URL;VALUE=URI:https://school.instructure.com/courses/77/assignments/4411",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Alarm text that is not the event description",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261002",
  "DTEND;VALUE=DATE:20261003",
  "UID:event-calendar-event-981",
  "SUMMARY:Midterm Exam [BPM 500 - Basic Principles of Medicine]",
  "LOCATION:Hall \"A\"",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=\"America/New_York\":20260914T235900",
  "SUMMARY:DLA 4 [PHYS 101]",
  "URL:javascript:alert(1)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("iCalendar reading", () => {
  it("unfolds continuation lines and decodes TEXT escapes", () => {
    expect(unfoldIcs("SUMMARY:Long\r\n  title\r\n\t continues")).toBe("SUMMARY:Long title continues");
    expect(decodeIcsText("a\\, b\\; c\\\\ d\\ne")).toBe("a, b; c\\ d\ne");
    expect(isIcsCalendar(CANVAS_FEED)).toBe(true);
    expect(isIcsCalendar("2026-09-01,Lecture")).toBe(false);
  });

  it("reads a Canvas feed: UTC deadlines on the learner's day, all-day exams, zoned times and course codes", () => {
    const events = parseIcsEvents(CANVAS_FEED, { timeZone: "America/New_York" });
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      uid: "event-assignment-4411",
      title: "Renal physiology problem set",
      contextCode: "BPM 500 - Basic Principles of Medicine",
      description: "Complete questions 1, 2 and 3\nSubmit as PDF; one file.",
      url: "https://school.instructure.com/courses/77/assignments/4411",
      // 03:59 UTC on the 15th is 11:59 pm on the 14th in New York.
      start: { date: "2026-09-14", instant: "2026-09-15T03:59:00.000Z", allDay: false },
    });
    expect(events[1]).toMatchObject({ title: "Midterm Exam", start: { date: "2026-10-02", allDay: true }, location: 'Hall "A"' });
    expect(events[2]).toMatchObject({ title: "DLA 4", contextCode: "PHYS 101", start: { date: "2026-09-14", instant: "2026-09-15T03:59:00.000Z" } });
    expect(events[2].url).toBeUndefined();
  });

  it("places the same UTC deadline on the right day in other zones", () => {
    expect(parseIcsEvents(CANVAS_FEED, { timeZone: "UTC" })[0].start?.date).toBe("2026-09-15");
    expect(parseIcsEvents(CANVAS_FEED, { timeZone: "Asia/Tokyo" })[2].start?.date).toBe("2026-09-15");
  });

  it("keeps floating times and unknown zones on the written day", () => {
    const [floating, unknownZone] = parseIcsEvents([
      "BEGIN:VEVENT", "DTSTART:20260901T080000", "SUMMARY:Lecture", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;TZID=Mars/Olympus:20260902T080000", "SUMMARY:Lab", "END:VEVENT",
    ].join("\n"), { timeZone: "America/New_York" });
    expect(floating.start).toMatchObject({ date: "2026-09-01", allDay: false });
    expect(floating.start?.instant).toBeUndefined();
    expect(unknownZone.start?.date).toBe("2026-09-02");
  });

  it("converts zoned wall-clock times across daylight saving changes", () => {
    const summer = zonedWallClockToInstant({ year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, "America/New_York");
    const winter = zonedWallClockToInstant({ year: 2026, month: 12, day: 1, hour: 12, minute: 0, second: 0 }, "America/New_York");
    expect(new Date(summer!).toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(new Date(winter!).toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(dayInZone(Date.parse("2026-12-31T23:30:00Z"), "Pacific/Auckland")).toBe("2027-01-01");
    expect(dayInZone(0, "Not/AZone")).toBeUndefined();
  });

  it("splits Canvas context codes and reads Canvas UIDs", () => {
    expect(splitContextCode("Quiz 2 [BIOL 101-01]")).toEqual({ title: "Quiz 2", contextCode: "BIOL 101-01" });
    expect(splitContextCode("Office hours")).toEqual({ title: "Office hours" });
    expect(splitContextCode("[Only a code]")).toEqual({ title: "[Only a code]" });
    expect(canvasRefFromUid("event-assignment-4411")).toBe("canvas:assignment:4411");
    expect(canvasRefFromUid("event-calendar-event-981")).toBe("canvas:calendar-event:981");
    expect(canvasRefFromUid("event-assignment-override-5")).toBe("canvas:assignment-override:5");
    expect(canvasRefFromUid("1234@google.com")).toBeUndefined();
  });
});
