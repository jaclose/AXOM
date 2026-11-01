// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localNoticeCopy, readLocalNotices, recordLocalNotice } from "./notificationInbox";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("local notification inbox", () => {
  it("records only fixed prompt kinds once and never stores private journal content", () => {
    recordLocalNotice("daily-loop:2026-11-01:closeout", "closeout", new Date("2026-11-01T20:30:00.000Z"));
    recordLocalNotice("daily-loop:2026-11-01:closeout", "closeout", new Date("2026-11-01T20:31:00.000Z"));
    expect(readLocalNotices()).toEqual([{ id: "daily-loop:2026-11-01:closeout", kind: "closeout", createdAt: "2026-11-01T20:30:00.000Z" }]);
    expect(localStorage.getItem("axom.notificationInbox.v1")).not.toContain("journalText");
    expect(localNoticeCopy("journal-feedback").href).toBe("#journal?feedback=1");
  });
});
