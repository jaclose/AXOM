import { DB_NAME, DB_VERSION, STORE_NAME, ensureVaultStores } from "../localVault";
import type { CloudSnapshot } from "./cloudSnapshot";
import { canonicalJson, sha256 } from "../compressedText";

export interface SyncBaseline { revision: number; contentHash: string; packed: CloudSnapshot }
const key = (accountId: string) => `axom.sync.baseline.v1:${accountId}`;
const memory = new Map<string, SyncBaseline>();
const checksum = (value: CloudSnapshot) => sha256(new TextEncoder().encode(canonicalJson(value)));

/** A replaceable cache of an acknowledged server version, never pending work.
 * Failure leaves the durable workspace/outbox intact and uses a full transfer. */
async function access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => ensureVaultStores(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Sync cache is blocked by an older tab.")); };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else { request.result.onversionchange = () => request.result.close(); resolve(request.result); }
    };
  });
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Sync cache could not be saved.")); };
  });
}
export async function readSyncBaseline(accountId: string, revision: number): Promise<SyncBaseline | undefined> {
  const cached = memory.get(accountId);
  if (cached?.revision === revision) return cached;
  try {
    const value = await access<(SyncBaseline & { checksum: string }) | undefined>("readonly", store => store.get(key(accountId)));
    if (value?.revision !== revision || value.packed?._axomDeltaFormat !== 1 || typeof value.packed.content !== "string"
      || !/^[a-f0-9]{64}$/.test(value.contentHash) || await checksum(value.packed) !== value.checksum) return undefined;
    remember(accountId, value);
    return value;
  } catch { return undefined; }
}
export async function saveSyncBaseline(accountId: string, value: SyncBaseline): Promise<void> {
  remember(accountId, value);
  try {
    const stored = { ...value, checksum: await checksum(value.packed) };
    await access("readwrite", store => store.put(stored, key(accountId)));
  }
  catch { /* This optional cache cannot turn an acknowledged upload into failure. */ }
}
function remember(accountId: string, value: SyncBaseline) {
  memory.delete(accountId); memory.set(accountId, value);
  while (memory.size > 2) memory.delete(memory.keys().next().value!);
}
