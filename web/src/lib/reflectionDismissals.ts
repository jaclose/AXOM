import { useMemo, useSyncExternalStore } from "react";

const PREFIX = "axom.reflectionDismissals.v1:";
const CHANGE_EVENT = "axom:reflection-dismissals-changed";
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function reflectionDismissalKey(workspaceKey: string, dayKey: string): string {
  return `${PREFIX}${encodeURIComponent(workspaceKey.trim() || "local")}:${dayKey}`;
}

function undoKey(dayKey: string, token: string): string {
  return `${dayKey}:undo:${token}`;
}

function validDays(dayKeys: string[]): string[] {
  return [...new Set(dayKeys.filter((day) => DAY_KEY.test(day)))];
}

export function readDismissedReflectionDays(workspaceKey: string, dayKeys: string[]): string[] {
  return validDays(dayKeys).filter((day) => {
    try {
      const key = reflectionDismissalKey(workspaceKey, day);
      const token = localStorage.getItem(key);
      return Boolean(token && localStorage.getItem(undoKey(key, token)) !== "1");
    } catch {
      return false;
    }
  });
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Only exact date preferences live here, never Journal text or completion state.
 * Separate date keys avoid overwriting another tab's dismissal of a different day.
 */
export function dismissReflectionDays(workspaceKey: string, dayKeys: string[]) {
  const token = crypto.randomUUID();
  const dismissedDays: string[] = [];
  const failedDays: string[] = [];
  for (const day of validDays(dayKeys)) {
    const key = reflectionDismissalKey(workspaceKey, day);
    try {
      localStorage.setItem(key, token);
      if (localStorage.getItem(key) !== token) throw new Error("Dismissal was not saved");
      dismissedDays.push(day);
    } catch {
      failedDays.push(day);
    }
  }
  notify();

  return {
    dismissedDays,
    failedDays,
    undo(): string[] {
      const failed: string[] = [];
      for (const day of dismissedDays) {
        const key = undoKey(reflectionDismissalKey(workspaceKey, day), token);
        try {
          // A token-specific tombstone cannot erase a concurrent newer action.
          // localStorage read/compare/remove cannot provide that guarantee.
          localStorage.setItem(key, "1");
          if (localStorage.getItem(key) !== "1") throw new Error("Undo was not saved");
        } catch {
          failed.push(day);
        }
      }
      notify();
      return failed;
    },
  };
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDismissedReflectionDays(workspaceKey: string, dayKeys: string[]): Set<string> {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => readDismissedReflectionDays(workspaceKey, dayKeys).join("\u001f"),
    () => "",
  );
  return useMemo(() => new Set(snapshot.split("\u001f").filter(Boolean)), [snapshot]);
}
