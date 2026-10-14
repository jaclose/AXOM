import { DB_NAME, DB_VERSION, STORE_NAME, ensureVaultStores } from "../localVault";
import { accountOperationClient } from "../account/supabase";
import { setMissingAttachmentLoader } from "../questionAttachments";
import { downloadCloudMediaAsset, readMediaManifest, workspaceMedia, type CloudMediaReference } from "./cloudMedia";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import type { NoctyriumState } from "../types";

const keyFor = (userId: string) => `axom.cloud.media.v2:${userId}`;
async function indexStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => ensureVaultStores(request.result);
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Close older AXOM tabs before restoring account images.")); };
  });
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Could not save the account image index.")); };
  });
}

export async function saveCloudMediaIndex(userId: string, value: CloudMediaReference[]): Promise<void> {
  const entries = readMediaManifest(value);
  await indexStore("readwrite", (store) => store.put(entries, keyFor(userId)));
}

/** Install only for the linked, signed-in account. Images load when a question
 * is opened, then stay in the normal offline/export vault. Sign-out removes
 * the network resolver; it never clears cached learner files. */
export function installCloudMediaCache(userId: string, state: () => NoctyriumState): () => void {
  let disposed = false;
  const pending = new Map<string, ReturnType<Parameters<typeof setMissingAttachmentLoader>[0]>>();
  const unregister = setMissingAttachmentLoader((blobKey) => {
    const existing = pending.get(blobKey);
    if (existing) return existing;
    const work = (async () => {
      const reference = workspaceMedia(state()).get(blobKey);
      if (!reference || disposed) return undefined;
      const stored = await indexStore<CloudMediaReference[] | undefined>("readonly", (store) => store.get(keyFor(userId)));
      const entry = stored?.find((item) => item.blobKey === blobKey);
      if (!entry || entry.updatedAt !== reference.attachment.updatedAt || entry.byteSize !== reference.attachment.byteSize) return undefined;
      const operation = await accountOperationClient();
      if (operation.userId !== userId || disposed) return undefined;
      const data = await downloadCloudMediaAsset(operation.client, userId, entry);
      await operation.assertCurrent();
      const current = workspaceMedia(state()).get(blobKey)?.attachment;
      if (disposed || !current || current.updatedAt !== reference.attachment.updatedAt || current.byteSize !== reference.attachment.byteSize) return undefined;
      const record = { ...reference.attachment, questionId: reference.questionId, blob: new Blob([data], { type: reference.attachment.mimeType }) };
      await putQuestionAttachmentBlob(blobKey, record);
      return record;
    })().finally(() => pending.delete(blobKey));
    pending.set(blobKey, work);
    return work;
  });
  return () => { disposed = true; unregister(); };
}
