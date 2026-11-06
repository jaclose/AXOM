import { toPortableState } from "../lib/backup";
import type { AxomState } from "../lib/types";
import type { SyncMeta } from "../types/sync";

const SYNC_META_KEY = "noctyrium-sync-meta";

export function getPortableState(state: AxomState) {
  return toPortableState(state);
}

export function fingerprintState(state: AxomState) {
  const text = JSON.stringify(getPortableState(state));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function loadSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    return raw ? { autoSync: false, ...JSON.parse(raw) } : defaultSyncMeta();
  } catch {
    return defaultSyncMeta();
  }
}

export function saveSyncMeta(meta: SyncMeta) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export function clearSyncMeta() {
  localStorage.removeItem(SYNC_META_KEY);
}

export function defaultDeviceLabel() {
  const platform = navigator.platform || "Browser";
  return `${platform} / ${location.hostname || "local"}`;
}

function defaultSyncMeta(): SyncMeta {
  return { autoSync: false, deviceLabel: defaultDeviceLabel() };
}
