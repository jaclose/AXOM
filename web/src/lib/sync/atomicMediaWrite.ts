import { ATTACHMENT_STORE_NAME, DB_NAME, DB_VERSION, ensureVaultStores } from "../localVault";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, type QuestionAttachmentScope } from "../questionAttachmentScope";
import type { QuestionAttachmentBlobRecord } from "../questionAttachments";

/** A narrow transaction-bound writer for protected cloud-media recovery.
 * Existing question editors still use the normal attachment store API. This
 * writer shares its database, version and account-scoped key format and adds
 * NO schema/table/namespace. Its transaction must never replace an incumbent.
 *
 * The canonical attachment module is also a hashed input of the generated
 * Communications Edge bundle. This isolated writer avoids an unrelated
 * production bundle change while the Communications owner reviews it.
 */
function assertRecoveryScope(scope: QuestionAttachmentScope, accountId: string): void {
  if (!isQuestionAttachmentScopeCurrent(scope) || scope.accountId !== accountId) {
    throw new Error("The account changed during image access. Reopen the question before retrying.");
  }
}

function openAttachmentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    open.onupgradeneeded = () => ensureVaultStores(open.result);
    open.onsuccess = () => {
      if (blocked) { open.result.close(); return; }
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error("Unable to open the attachment store"));
    open.onblocked = () => {
      blocked = true;
      reject(new Error("The attachment store is blocked by another tab. Close older AXOM tabs and retry."));
    };
  });
}

/** Atomic insert by account-scoped key. An existing key is not a validated
 * original. Callers MUST read back and verify bytes against the protected
 * SHA-256 reference after either result. Quota/abort/auth errors propagate.
 */
export async function addQuestionAttachmentBlobIfAbsent(
  blobKey: string,
  record: QuestionAttachmentBlobRecord,
  options: { accountId: string; scope?: QuestionAttachmentScope },
): Promise<"inserted" | "exists"> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertRecoveryScope(scope, options.accountId);
  const db = await openAttachmentDatabase();
  try {
    assertRecoveryScope(scope, options.accountId);
    const result = await new Promise<"inserted" | "exists">((resolve, reject) => {
      try {
        const tx = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
        const key: IDBValidKey = ["axom-attachment-v1", scope.owner, blobKey];
        const add = tx.objectStore(ATTACHMENT_STORE_NAME).add(record, key);
        tx.oncomplete = () => resolve("inserted");
        tx.onabort = () => {
          const failure = add.error ?? tx.error;
          if (failure?.name === "ConstraintError") resolve("exists");
          else reject(failure ?? new Error("Image-storage transaction was interrupted."));
        };
      } catch (error) {
        reject(error);
      }
    });
    assertRecoveryScope(scope, options.accountId);
    return result;
  } finally {
    db.close();
  }
}
