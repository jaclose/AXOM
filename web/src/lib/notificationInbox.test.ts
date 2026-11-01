// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localNoticeCopy, localNoticeJournalDay, readLocalNotices, recordLocalNotice } from "./notificationInbox";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("local notification inbox", () => {
  it("records only fixed prompt kinds once and never stores private journal content", () => {
    recordLocalNotice("daily-loop:2026-11-01:closeout", "closeout", new Date("2026-11-01T20:30:00.000Z"));
    recordLocalNotice("daily-loop:2026-11-01:closeout", "closeout", new Date("2026-11-01T20:31:00.000Z"));
    expect(readLocalNotices()).toEqual([{ id: "daily-loop:2026-11-01:closeout", kind: "closeout", createdAt: "2026-11-01T20:30:00.000Z" }]);
    expect(localStorage.getItem("axom.notificationInbox.v1")).not.toContain("journalText");
    expect(localNoticeCopy("journal-feedback").href).toBe("#journal?feedback=1");
  });

  it("routes yesterday and saved evening notices to their original day without storing writing", () => {
    recordLocalNotice("journal-catch-up:2026-11-01", "journal-catch-up", new Date("2026-11-02T12:00:00.000Z"));
    const [catchUp] = readLocalNotices();
    expect(localNoticeJournalDay(catchUp)).toBe("2026-11-01");
    expect(localNoticeCopy(catchUp.kind).title).toBe("Yesterday is still open");
    expect(localStorage.getItem("axom.notificationInbox.v1")).not.toContain("freeWriting");
    expect(localNoticeJournalDay({ ...catchUp, id: "journal-catch-up:private-text" })).toBeNull();
  });
});
