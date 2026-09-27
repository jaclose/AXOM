import type { SyncMetadata } from "./syncTypes";

/** Device-only sync bookkeeping. Never contains tokens or workspace content. */
const KEY = "axom.sync.metadata.v1";

export function deviceId(): string {
  const meta = read();
  if (meta.deviceId) return meta.deviceId;
  const id = crypto.randomUUID();
  write({ ...meta, deviceId: id });
  return id;
}

export function read(): SyncMetadata {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    return defaults();
  }
}

export function write(value: SyncMetadata): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the next successful write repairs it.
  }
}

/** Forget the account link but keep this device's stable id. */
export function clearAccountSync(): void {
  const id = read().deviceId;
  write({ ...defaults(), deviceId: id });
}

function defaults(): SyncMetadata {
  return { deviceId: "", baseRevision: 0, pending: false, attempt: 0 };
}
