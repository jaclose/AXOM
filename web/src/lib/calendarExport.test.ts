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
  it("folds long Unicode text to 75 UTF-8 octets without splitting a code point", () => {
    const line = `SUMMARY:${"é🧠الطب".repeat(45)}`;
    const folded = foldIcsLine(line);
    const segments = folded.split("\r\n");
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.every((segment) => new TextEncoder().encode(segment).length <= 75)).toBe(true);
    expect(segments.slice(1).every((segment) => segment.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    expect(folded.includes("�")).toBe(false);
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it.each(
    ["x", "é", "ط", "中", "🧠"].flatMap((character) =>
      [0, 65, 66, 67, 68, 69, 73, 74, 75, 139, 140, 141, 142, 143, 144, 145]
        .map((prefixLength) => ({ character, prefixLength })),
    ),
  )("preserves UTF-8 wire text for $character after $prefixLength ASCII characters", ({ character, prefixLength }) => {
    const original = `SUMMARY:${"x".repeat(prefixLength)}${character.repeat(80)}`;
    const folded = foldIcsLine(original);
    // Unfold after byte serialization: JS-only equality can hide split surrogate pairs.
    const encoded = new TextEncoder().encode(folded);
    const wireText = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    const segments = wireText.split("\r\n");
    expect(wireText.replace(/\r\n /g, "")).toBe(original);
    expect(segments.every((segment) => new TextEncoder().encode(segment).length <= 75)).toBe(true);
    expect(segments.slice(1).every((segment) => segment.startsWith(" "))).toBe(true);
  });

  it("escapes lone CR, LF and CRLF in user event text as TEXT, not calendar records", () => {
    expect(escapeIcsText("one\rtwo\nthree\r\nfour")).toBe("one\\ntwo\\nthree\\nfour");
    const ics = buildIcs([{
      uid: "task-unsafe", day: "2026-12-31",
      title: "Due: review\rBEGIN:VEVENT\nSecond\r\nline",
      category: "AXOM task",
    }], new Date("2026-09-26T10:00:00.000Z"));
    expect(ics).toContain("SUMMARY:Due: review\\nBEGIN:VEVENT\\nSecond\\nline");
    expect(ics.split("\r\n").filter((row) => row === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics.split("\r\n").filter((row) => row === "END:VEVENT")).toHaveLength(1);
  });

  it("escapes UID TEXT so untrusted record delimiters cannot create extra VEVENTs", () => {
    const uid = "task-a\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:forged";
    const at = new Date("2026-11-06T02:00:00.000Z");
    const event = { uid, day: "2026-12-31", title: "Review", category: "AXOM task" };
    const ics = buildIcs([event], at);
    const physical = ics.split("\r\n");
    expect(physical.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(physical.filter((line) => line === "END:VEVENT")).toHaveLength(1);
    expect(ics).toContain("UID:task-a\\nEND:VEVENT\\nBEGIN:VEVENT\\nUID:forged@axom.local");
    expect(ics).not.toContain("\r\nUID:forged");
    const literalBackslash = buildIcs([{ ...event, uid: "x\\ny" }], at);
    const actualNewline = buildIcs([{ ...event, uid: "x\ny" }], at);
    expect(literalBackslash).not.toBe(actualNewline);
    expect(buildIcs([{ ...event, uid: "task-simple" }], at)).toContain("UID:task-simple@axom.local");
  });

  it.each([
    "2026-02-31", "2025-02-29", "2026-13-01", "0000-01-01",
    "9999-12-31", "2026-12-31\r\nBEGIN:VEVENT", "not-a-date",
  ])("rejects malformed calendar date %j without returning partial content", (day) => {
    expect(() => buildIcs([{
      uid: "task-date", day, title: "Renal", category: "AXOM task",
    }], new Date("2026-11-06T02:00:00.000Z"))).toThrow(RangeError);
  });

  it("uses UTC Gregorian days for leap, year-end and DST boundaries", () => {
    const at = new Date("2026-11-06T02:00:00.000Z");
    for (const [day, end] of [
      ["2028-02-29", "20280301"],
      ["2026-03-08", "20260309"],
      ["2026-11-01", "20261102"],
      ["2026-12-31", "20270101"],
    ]) {
      const ics = buildIcs([{ uid: "task-1", day, title: "Review", category: "AXOM task" }], at);
      expect(ics).toContain("DTSTART;VALUE=DATE:" + day.replace(/-/g, ""));
      expect(ics).toContain("DTEND;VALUE=DATE:" + end);
    }
  });

  it("refuses missing, repeated or ambiguous UIDs without merging unrelated events", () => {
    const event = { uid: "task-1", day: "2026-11-20", title: "Review", category: "AXOM task" };
    const at = new Date("2026-11-06T02:00:00.000Z");
    expect(() => buildIcs([{ ...event, uid: "" }], at)).toThrow(RangeError);
    expect(() => buildIcs([event, { ...event }], at)).toThrow(RangeError);
    expect(() => buildIcs([{ ...event, uid: "task-\u0000" }], at)).toThrow(RangeError);
    expect(() => buildIcs([{ ...event, uid: "task-\uD800" }], at)).toThrow(RangeError);
    expect(escapeIcsText("A\u0000B\u007fC")).toBe("A B C");
  });

});
