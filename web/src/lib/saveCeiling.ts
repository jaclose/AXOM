/**
 * Saving never blocks studying (owner decision D13). A screen may wait for a
 * save or a network reply for at most UI_SAVE_CEILING_MS. After that it tells
 * the learner the honest state ("Not saved yet · Retry") and gives every
 * control back, while the work stays in memory and in its recovery copy and
 * the write carries on in the background.
 */
export const UI_SAVE_CEILING_MS = 5_000;

export const VAULT_WRITE_TIMEOUT_CODE = "AXOM_VAULT_WRITE_TIMEOUT";

/** A wait that reached its ceiling. The underlying work was not cancelled. */
export class VaultWriteTimeout extends Error {
  readonly code = VAULT_WRITE_TIMEOUT_CODE;
  readonly waitedMs: number;

  constructor(waitedMs: number, message?: string) {
    super(message ?? `The save did not finish within ${Math.max(1, Math.round(waitedMs / 1000))} seconds.`);
    this.name = "VaultWriteTimeout";
    this.waitedMs = waitedMs;
  }
}

export function isVaultWriteTimeout(error: unknown): error is VaultWriteTimeout {
  return error instanceof Error && (
    error.name === "VaultWriteTimeout"
    || ("code" in error && error.code === VAULT_WRITE_TIMEOUT_CODE)
  );
}

/**
 * Settle with `work`, or reject with VaultWriteTimeout once `ms` has passed,
 * whichever comes first. The timer is always cleared, and a late result of
 * `work` is ignored here (callers that care keep their own handle on it).
 */
export function withSaveCeiling<T>(work: Promise<T>, ms: number = UI_SAVE_CEILING_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VaultWriteTimeout(ms)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
