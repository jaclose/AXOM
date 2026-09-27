import { STORAGE_KEYS } from "./brand";

/**
 * Device-only audit trail of events that REPLACED or MERGED the workspace
 * (restores, merges, resets). It answers "what happened to my data, and
 * when?" without storing any workspace content — just kind, time, and a
 * short human label such as a file name or version number.
 */
export type RestoreEventKind =
  | "portable-restore"
  | "portable-merge"
  | "snapshot-restore"
  | "account-restore"
  | "account-merge"
  | "reset";

export interface RestoreEvent {
  id: string;
  kind: RestoreEventKind;
  at: string;
  detail: string;
}

export const RESTORE_HISTORY_EVENT = "axom:restore-history";
const MAX_EVENTS = 50;
const KINDS = new Set<RestoreEventKind>(["portable-restore", "portable-merge", "snapshot-restore", "account-restore", "account-merge", "reset"]);

export const RESTORE_EVENT_LABELS: Record<RestoreEventKind, string> = {
  "portable-restore": "Restored from a backup file",
  "portable-merge": "Merged a backup file",
  "snapshot-restore": "Restored an automatic snapshot",
  "account-restore": "Restored a protected account version",
  "account-merge": "Merged with the account version",
  reset: "Reset to starter data",
};

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): HistoryStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function readRestoreHistory(storage: HistoryStorage | undefined = browserStorage()): RestoreEvent[] {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEYS.restoreHistory) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RestoreEvent => (
      Boolean(item)
      && typeof item === "object"
      && typeof (item as RestoreEvent).id === "string"
      && KINDS.has((item as RestoreEvent).kind)
      && Number.isFinite(Date.parse((item as RestoreEvent).at))
      && typeof (item as RestoreEvent).detail === "string"
    )).slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export function recordRestoreEvent(
  input: { kind: RestoreEventKind; detail?: string; at?: Date },
  storage: HistoryStorage | undefined = browserStorage(),
): RestoreEvent {
  const event: RestoreEvent = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `restore-${Date.now()}`,
    kind: input.kind,
    at: (input.at ?? new Date()).toISOString(),
    detail: (input.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
  const next = [event, ...readRestoreHistory(storage)].slice(0, MAX_EVENTS);
  try { storage?.setItem(STORAGE_KEYS.restoreHistory, JSON.stringify(next)); } catch { /* audit is best effort */ }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(RESTORE_HISTORY_EVENT));
  }
  return event;
}
