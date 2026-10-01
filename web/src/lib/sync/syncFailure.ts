import type { SyncFailure } from "./syncTypes";

export type FailureDetails = Omit<SyncFailure, "at">;

/** A failed upload, already sorted into "worth another try" or "do not repeat". */
export class SyncPushError extends Error {
  constructor(readonly failure: FailureDetails, message: string) {
    super(message);
    this.name = "SyncPushError";
  }
}

/**
 * Sort a failed upload by what the account said, not by the fact that it
 * failed. PostgREST maps SQLSTATE to HTTP status (class 54 and 57 become 500,
 * P0001 becomes 400, PTxyz becomes xyz), so the SQLSTATE is checked first: a
 * refusal that arrives as HTTP 500 is still a refusal.
 */
export function classifyPushFailure(error: { message?: string; code?: string }, status: number): FailureDetails {
  const code = typeof error.code === "string" && error.code ? error.code : undefined;
  const message = error.message ?? "";
  const base = { status, ...(code ? { code } : {}) };
  if (code === "PT413" || status === 413 || /payload too large/i.test(message)) return { ...base, kind: "rejected", rejection: "too-large" };
  // Accounts before migration 20261001090000 refuse a full history with SQLSTATE 54000 (HTTP 500).
  if (code === "54000" || /storage limit reached/i.test(message)) return { ...base, kind: "rejected", rejection: "storage-limit" };
  if (status === 401 || status === 403 || code === "42501" || code?.startsWith("PGRST3")) return { ...base, kind: "auth" };
  if (status === 0) return { ...base, kind: "network" };
  if (status === 408 || status === 429 || status >= 500) return { ...base, kind: "server" };
  if (status >= 400) return { ...base, kind: "rejected", rejection: "refused" };
  return { ...base, kind: "server" };
}

/** Anything thrown on the way to the account that is not already sorted never reached it. */
export function failureOf(error: unknown): FailureDetails {
  return error instanceof SyncPushError ? error.failure : { kind: "network", status: 0 };
}
