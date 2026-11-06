import { STORAGE_KEYS } from "./brand";
import { isoDate } from "./scoring";
import { entryDayKey } from "./journal";
import type { DailyLoopReminderPreferences, AxomState } from "./types";

export type DailyLoopReminderKind = "check-in" | "closeout";
export type DailyLoopReminderDisposition = "pending" | "shown" | "skipped";

export const DEFAULT_DAILY_LOOP_REMINDERS: Readonly<Required<DailyLoopReminderPreferences>> = {
  checkInEnabled: true,
  checkInTime: "08:00",
  closeoutEnabled: true,
  closeoutTime: "20:30",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

export interface DailyLoopReminderEntry {
  disposition: DailyLoopReminderDisposition;
  updatedAt?: string;
  snoozedUntil?: string;
}

export interface DailyLoopReminderMetadata {
  day: string;
  checkIn: DailyLoopReminderEntry;
  closeout: DailyLoopReminderEntry;
}

export interface DailyLoopReminderSignal {
  kind: DailyLoopReminderKind;
  dayKey: string;
  dueAt: string;
  reason: "preferred-time" | "snooze-ended";
}

export interface DailyLoopReminderEvaluation {
  dayKey: string;
  signal: DailyLoopReminderSignal | null;
}

export interface DailyLoopReminderEvaluationInput {
  now: Date;
  preferences?: Partial<DailyLoopReminderPreferences>;
  metadata: DailyLoopReminderMetadata;
  checkInComplete: boolean;
  closeoutComplete: boolean;
}

/** A finished journal page closes the writing loop even without a quick closeout. */
export function journalPageComplete(
  journal: Pick<AxomState, "journal">["journal"],
  dayKey: string,
): boolean {
  return journal.some((entry) => entryDayKey(entry) === dayKey && entry.notebookStatus === "complete");
}

/** Offer only yesterday, once there is something real to return to after 08:00. */
export function journalCatchUpDay(
  state: Pick<AxomState, "journal" | "logs" | "dayPlans" | "closeouts">,
  now: Date = new Date(),
): string | null {
  if (!Number.isFinite(now.getTime()) || now.getHours() < 8) return null;
  const yesterday = new Date(now);
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = isoDate(yesterday);
  if (journalPageComplete(state.journal, key)) return null;
  const active = state.journal.some((entry) => entryDayKey(entry) === key)
    || state.logs.some((log) => log.dayKey === key && (log.minutes > 0 || log.cards > 0 || (log.quantity ?? 0) > 0))
    || state.dayPlans.some((plan) => plan.dayKey === key)
    || state.closeouts.some((closeout) => closeout.dayKey === key);
  return active ? key : null;
}

type ReminderStorage = Pick<Storage, "getItem" | "setItem">;
type StorageProvider = () => ReminderStorage | undefined;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeDailyLoopReminderPreferences(value: unknown): Required<DailyLoopReminderPreferences> {
  const record = value && typeof value === "object" ? value as Partial<DailyLoopReminderPreferences> : {};
  return {
    checkInEnabled: typeof record.checkInEnabled === "boolean"
      ? record.checkInEnabled
      : DEFAULT_DAILY_LOOP_REMINDERS.checkInEnabled,
    checkInTime: validTime(record.checkInTime)
      ? record.checkInTime
      : DEFAULT_DAILY_LOOP_REMINDERS.checkInTime,
    closeoutEnabled: typeof record.closeoutEnabled === "boolean"
      ? record.closeoutEnabled
      : DEFAULT_DAILY_LOOP_REMINDERS.closeoutEnabled,
    closeoutTime: validTime(record.closeoutTime)
      ? record.closeoutTime
      : DEFAULT_DAILY_LOOP_REMINDERS.closeoutTime,
    quietHoursEnabled: typeof record.quietHoursEnabled === "boolean"
      ? record.quietHoursEnabled
      : DEFAULT_DAILY_LOOP_REMINDERS.quietHoursEnabled,
    quietHoursStart: validTime(record.quietHoursStart)
      ? record.quietHoursStart
      : DEFAULT_DAILY_LOOP_REMINDERS.quietHoursStart,
    quietHoursEnd: validTime(record.quietHoursEnd)
      ? record.quietHoursEnd
      : DEFAULT_DAILY_LOOP_REMINDERS.quietHoursEnd,
  };
}

export function emptyDailyLoopReminderMetadata(day: string): DailyLoopReminderMetadata {
  return {
    day,
    checkIn: { disposition: "pending" },
    closeout: { disposition: "pending" },
  };
}

/**
 * Select at most one reminder for the device-local day. Evening closeout wins
 * after its configured time; a late first open never produces a stale morning
 * check-in followed immediately by a closeout.
 */
export function evaluateDailyLoopReminder(input: DailyLoopReminderEvaluationInput): DailyLoopReminderEvaluation {
  const dayKey = isoDate(input.now);
  const preferences = normalizeDailyLoopReminderPreferences(input.preferences);
  const metadata = input.metadata.day === dayKey ? input.metadata : emptyDailyLoopReminderMetadata(dayKey);
  const minute = input.now.getHours() * 60 + input.now.getMinutes();
  const checkInMinute = timeToMinute(preferences.checkInTime);
  const closeoutMinute = timeToMinute(preferences.closeoutTime);

  // Quiet hours suppress delivery without changing the device-local ledger.
  // A reminder that is still pending when a same-day interval ends can be
  // reconsidered. Device-local day rollover keeps the existing policy: a
  // prior-day reminder is never carried into the new day.
  if (isWithinDailyLoopQuietHours(input.now, preferences)) {
    return { dayKey, signal: null };
  }

  if (
    preferences.closeoutEnabled
    && !input.closeoutComplete
    && minute >= closeoutMinute
    && reminderEntryDue(metadata.closeout, input.now)
  ) {
    return {
      dayKey,
      signal: signalFor("closeout", dayKey, preferences.closeoutTime, metadata.closeout),
    };
  }

  const beforeEveningBoundary = !preferences.closeoutEnabled || minute < closeoutMinute;
  if (
    preferences.checkInEnabled
    && !input.checkInComplete
    && beforeEveningBoundary
    && minute >= checkInMinute
    && reminderEntryDue(metadata.checkIn, input.now)
  ) {
    return {
      dayKey,
      signal: signalFor("check-in", dayKey, preferences.checkInTime, metadata.checkIn),
    };
  }

  return { dayKey, signal: null };
}

/**
 * Inclusive at the start and exclusive at the end. Overnight intervals wrap
 * across midnight; equal endpoints are treated as an empty interval rather
 * than an accidental all-day mute.
 */
export function isWithinDailyLoopQuietHours(
  now: Date,
  value?: Partial<DailyLoopReminderPreferences>,
): boolean {
  const preferences = normalizeDailyLoopReminderPreferences(value);
  if (!preferences.quietHoursEnabled) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinute(preferences.quietHoursStart);
  const end = timeToMinute(preferences.quietHoursEnd);
  if (start === end) return false;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function signalFor(
  kind: DailyLoopReminderKind,
  dayKey: string,
  preferredTime: string,
  entry: DailyLoopReminderEntry,
): DailyLoopReminderSignal {
  return {
    kind,
    dayKey,
    dueAt: entry.snoozedUntil ?? `${dayKey}T${preferredTime}:00`,
    reason: entry.snoozedUntil ? "snooze-ended" : "preferred-time",
  };
}

function reminderEntryDue(entry: DailyLoopReminderEntry, now: Date): boolean {
  if (entry.disposition !== "pending") return false;
  if (!entry.snoozedUntil) return true;
  const snoozedUntil = Date.parse(entry.snoozedUntil);
  return Number.isFinite(snoozedUntil) && snoozedUntil <= now.getTime();
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function parseEntry(value: unknown): DailyLoopReminderEntry {
  if (!value || typeof value !== "object") return { disposition: "pending" };
  const record = value as Partial<DailyLoopReminderEntry>;
  const disposition = record.disposition === "shown" || record.disposition === "skipped"
    ? record.disposition
    : "pending";
  return {
    disposition,
    updatedAt: validIso(record.updatedAt),
    snoozedUntil: disposition === "pending" ? validIso(record.snoozedUntil) : undefined,
  };
}

function parseMetadata(raw: string | null, day: string): DailyLoopReminderMetadata {
  if (!raw) return emptyDailyLoopReminderMetadata(day);
  try {
    const record = JSON.parse(raw) as Partial<DailyLoopReminderMetadata>;
    if (record.day !== day || !DAY_KEY.test(record.day)) return emptyDailyLoopReminderMetadata(day);
    return {
      day,
      checkIn: parseEntry(record.checkIn),
      closeout: parseEntry(record.closeout),
    };
  } catch {
    return emptyDailyLoopReminderMetadata(day);
  }
}

function newerEntry(a: DailyLoopReminderEntry, b: DailyLoopReminderEntry): DailyLoopReminderEntry {
  return String(a.updatedAt ?? "") >= String(b.updatedAt ?? "") ? a : b;
}

function mergeMetadata(a: DailyLoopReminderMetadata, b: DailyLoopReminderMetadata): DailyLoopReminderMetadata {
  return {
    day: a.day,
    checkIn: newerEntry(a.checkIn, b.checkIn),
    closeout: newerEntry(a.closeout, b.closeout),
  };
}

function browserStorage(): ReminderStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Device-only date/time metadata with an in-memory fallback for blocked storage. */
export function createDailyLoopReminderLedger(getStorage: StorageProvider = browserStorage) {
  let session = emptyDailyLoopReminderMetadata("");

  function read(day: string): DailyLoopReminderMetadata {
    const memory = session.day === day ? session : emptyDailyLoopReminderMetadata(day);
    try {
      const persisted = parseMetadata(getStorage()?.getItem(STORAGE_KEYS.dailyLoopReminders) ?? null, day);
      return mergeMetadata(memory, persisted);
    } catch {
      return memory;
    }
  }

  function write(metadata: DailyLoopReminderMetadata) {
    session = metadata;
    try {
      getStorage()?.setItem(STORAGE_KEYS.dailyLoopReminders, JSON.stringify(metadata));
    } catch {
      // The session value still protects against duplicate reminders.
    }
  }

  function update(day: string, kind: DailyLoopReminderKind, entry: DailyLoopReminderEntry) {
    const current = read(day);
    write({ ...current, [kind === "check-in" ? "checkIn" : "closeout"]: entry });
  }

  return {
    read,

    markShown(day: string, kind: DailyLoopReminderKind, at: Date = new Date()) {
      if (!DAY_KEY.test(day)) return;
      update(day, kind, { disposition: "shown", updatedAt: at.toISOString() });
    },

    snooze(day: string, kind: DailyLoopReminderKind, until: Date, at: Date = new Date()) {
      if (!DAY_KEY.test(day) || !Number.isFinite(until.getTime()) || until <= at) return;
      update(day, kind, {
        disposition: "pending",
        updatedAt: at.toISOString(),
        snoozedUntil: until.toISOString(),
      });
    },

    skip(day: string, kind: DailyLoopReminderKind, at: Date = new Date()) {
      if (!DAY_KEY.test(day)) return;
      update(day, kind, { disposition: "skipped", updatedAt: at.toISOString() });
    },
  };
}

export type DailyLoopReminderLedger = ReturnType<typeof createDailyLoopReminderLedger>;
export const dailyLoopReminderLedger = createDailyLoopReminderLedger();
