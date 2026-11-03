import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "./brand";
import {
  createDailyLoopReminderLedger,
  emptyDailyLoopReminderMetadata,
  evaluateDailyLoopReminder,
  isWithinDailyLoopQuietHours,
  journalCatchUpDay,
  journalPageComplete,
  normalizeDailyLoopReminderPreferences,
} from "./dailyLoopReminders";

const DAY = "2026-07-13";

function localTime(hour: number, minute = 0, day = 13): Date {
  return new Date(2026, 6, day, hour, minute, 0, 0);
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STORAGE_KEYS.dailyLoopReminders, initial);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  };
}

describe("daily-loop reminder policy", () => {
  it("offers one yesterday page after 08:00 when activity or a draft exists", () => {
    const draft = {
      id: "page", date: "2026-07-13T18:00:00.000Z", today: "", tomorrow: "", blockers: "",
      energy: "" as const, rating: "", notebookStatus: "draft" as const,
    };
    const state = { journal: [draft], logs: [], dayPlans: [], closeouts: [] };
    expect(journalCatchUpDay(state, localTime(7, 59, 14))).toBeNull();
    expect(journalCatchUpDay(state, localTime(8, 0, 14))).toBe(DAY);
    expect(journalCatchUpDay({ ...state, journal: [{ ...draft, notebookStatus: "complete" }] }, localTime(9, 0, 14))).toBeNull();
    expect(journalPageComplete([{ ...draft, notebookStatus: "complete" }], DAY)).toBe(true);
    expect(journalCatchUpDay({ journal: [], logs: [], dayPlans: [], closeouts: [] }, localTime(9, 0, 14))).toBeNull();
  });

  it("uses safe morning and 20:30 local defaults while normalizing invalid preferences", () => {
    expect(normalizeDailyLoopReminderPreferences(undefined)).toEqual({
      checkInEnabled: true,
      checkInTime: "08:00",
      closeoutEnabled: true,
      closeoutTime: "20:30",
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });
    expect(normalizeDailyLoopReminderPreferences({
      checkInEnabled: false,
      checkInTime: "30:99",
      closeoutEnabled: false,
      closeoutTime: "noon",
      quietHoursEnabled: true,
      quietHoursStart: "24:00",
      quietHoursEnd: "tomorrow",
    })).toEqual({
      checkInEnabled: false,
      checkInTime: "08:00",
      closeoutEnabled: false,
      closeoutTime: "20:30",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });
  });

  it("suppresses signals across overnight quiet hours and resumes at the end boundary", () => {
    const metadata = emptyDailyLoopReminderMetadata(DAY);
    const preferences = {
      checkInEnabled: true,
      checkInTime: "05:30",
      closeoutEnabled: true,
      closeoutTime: "22:30",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    expect(isWithinDailyLoopQuietHours(localTime(22), preferences)).toBe(true);
    expect(isWithinDailyLoopQuietHours(localTime(23, 59), preferences)).toBe(true);
    expect(isWithinDailyLoopQuietHours(localTime(6, 59), preferences)).toBe(true);
    expect(evaluateDailyLoopReminder({
      now: localTime(22, 30), preferences, metadata, checkInComplete: true, closeoutComplete: false,
    }).signal).toBeNull();
    expect(evaluateDailyLoopReminder({
      now: localTime(6, 59), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(isWithinDailyLoopQuietHours(localTime(7), preferences)).toBe(false);
    expect(evaluateDailyLoopReminder({
      now: localTime(7), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toMatchObject({ kind: "check-in", dayKey: DAY });
  });

  it("supports daytime quiet windows and treats matching endpoints as a safe empty interval", () => {
    const metadata = emptyDailyLoopReminderMetadata(DAY);
    const preferences = {
      checkInEnabled: true,
      checkInTime: "08:00",
      closeoutEnabled: false,
      closeoutTime: "20:30",
      quietHoursEnabled: true,
      quietHoursStart: "12:00",
      quietHoursEnd: "14:00",
    };

    expect(isWithinDailyLoopQuietHours(localTime(11, 59), preferences)).toBe(false);
    expect(isWithinDailyLoopQuietHours(localTime(12), preferences)).toBe(true);
    expect(evaluateDailyLoopReminder({
      now: localTime(13), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(isWithinDailyLoopQuietHours(localTime(14), preferences)).toBe(false);
    expect(evaluateDailyLoopReminder({
      now: localTime(14), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal?.kind).toBe("check-in");
    expect(isWithinDailyLoopQuietHours(localTime(13), {
      ...preferences, quietHoursStart: "12:00", quietHoursEnd: "12:00",
    })).toBe(false);
  });

  it("offers the check-in only after its preferred time and never follows it with a stale late-night check-in", () => {
    const metadata = emptyDailyLoopReminderMetadata(DAY);
    expect(evaluateDailyLoopReminder({
      now: localTime(7, 59), metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(evaluateDailyLoopReminder({
      now: localTime(8), metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toMatchObject({ kind: "check-in", dayKey: DAY, reason: "preferred-time" });
    expect(evaluateDailyLoopReminder({
      now: localTime(20, 30), metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toMatchObject({ kind: "closeout", dayKey: DAY });
    expect(evaluateDailyLoopReminder({
      now: localTime(21), metadata, checkInComplete: false, closeoutComplete: true,
    }).signal).toBeNull();
  });

  it("honors enabled controls, custom times, and canonical completion records", () => {
    const metadata = emptyDailyLoopReminderMetadata(DAY);
    const preferences = {
      checkInEnabled: false,
      checkInTime: "06:30",
      closeoutEnabled: true,
      closeoutTime: "19:15",
    };
    expect(evaluateDailyLoopReminder({
      now: localTime(7), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(evaluateDailyLoopReminder({
      now: localTime(19, 15), preferences, metadata, checkInComplete: false, closeoutComplete: false,
    }).signal?.kind).toBe("closeout");
    expect(evaluateDailyLoopReminder({
      now: localTime(19, 15), preferences, metadata, checkInComplete: false, closeoutComplete: true,
    }).signal).toBeNull();

    expect(evaluateDailyLoopReminder({
      now: localTime(9), metadata, checkInComplete: true, closeoutComplete: false,
    }).signal).toBeNull();
  });

  it("always derives the target from the current local date instead of a stale workspace cursor", () => {
    const stale = emptyDailyLoopReminderMetadata("2026-07-12");
    const result = evaluateDailyLoopReminder({
      now: localTime(9), metadata: stale, checkInComplete: false, closeoutComplete: false,
    });
    expect(result.dayKey).toBe(DAY);
    expect(result.signal).toMatchObject({ kind: "check-in", dayKey: DAY });
  });
});

describe("daily-loop reminder ledger", () => {
  it("shows each reminder once per day and starts clean on the next local day", () => {
    const { storage } = memoryStorage();
    const ledger = createDailyLoopReminderLedger(() => storage);
    ledger.markShown(DAY, "check-in", localTime(8));

    expect(evaluateDailyLoopReminder({
      now: localTime(9), metadata: ledger.read(DAY), checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(evaluateDailyLoopReminder({
      now: localTime(9, 0, 14), metadata: ledger.read("2026-07-14"), checkInComplete: false, closeoutComplete: false,
    }).signal).toMatchObject({ kind: "check-in", dayKey: "2026-07-14" });
  });

  it("supports snooze and independent daily skip without suppressing the evening closeout", () => {
    const { storage } = memoryStorage();
    const ledger = createDailyLoopReminderLedger(() => storage);
    ledger.markShown(DAY, "check-in", localTime(8));
    ledger.snooze(DAY, "check-in", localTime(10, 30), localTime(8, 1));

    expect(evaluateDailyLoopReminder({
      now: localTime(10), metadata: ledger.read(DAY), checkInComplete: false, closeoutComplete: false,
    }).signal).toBeNull();
    expect(evaluateDailyLoopReminder({
      now: localTime(10, 30), metadata: ledger.read(DAY), checkInComplete: false, closeoutComplete: false,
    }).signal).toMatchObject({ kind: "check-in", reason: "snooze-ended" });

    ledger.skip(DAY, "check-in", localTime(10, 31));
    expect(evaluateDailyLoopReminder({
      now: localTime(20, 30), metadata: ledger.read(DAY), checkInComplete: false, closeoutComplete: false,
    }).signal?.kind).toBe("closeout");
  });

  it("persists only bounded date/status/timestamp metadata and survives blocked storage", () => {
    const { storage, values } = memoryStorage();
    const ledger = createDailyLoopReminderLedger(() => storage);
    ledger.markShown(DAY, "check-in", localTime(8));
    ledger.snooze(DAY, "check-in", localTime(8, 30), localTime(8, 1));
    ledger.skip(DAY, "closeout", localTime(20, 30));

    expect([...values.keys()]).toEqual([STORAGE_KEYS.dailyLoopReminders]);
    const persisted = values.get(STORAGE_KEYS.dailyLoopReminders)!;
    expect(persisted).not.toMatch(/journal|question|workspace|intention/i);
    expect(JSON.parse(persisted)).toEqual({
      day: DAY,
      checkIn: {
        disposition: "pending",
        updatedAt: localTime(8, 1).toISOString(),
        snoozedUntil: localTime(8, 30).toISOString(),
      },
      closeout: {
        disposition: "skipped",
        updatedAt: localTime(20, 30).toISOString(),
      },
    });

    const blocked = createDailyLoopReminderLedger(() => ({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    }));
    blocked.markShown(DAY, "check-in", localTime(8));
    expect(blocked.read(DAY).checkIn.disposition).toBe("shown");
  });
});
