import { readStoredSession } from "./supabase";

/** The identity visible to local attachment I/O. It is updated synchronously
 * with account state, independently of the background sync link. */
let accountId: string | null = null;
try {
  accountId = readStoredSession()?.user.id ?? null;
} catch {
  // The account store will supply the confirmed identity as it initializes.
}
let epoch = 0;

export function setQuestionAttachmentAccount(next: string | null): void {
  if (next === accountId) return;
  accountId = next;
  epoch += 1;
}

export function currentQuestionAttachmentScopeToken(): string {
  return `${epoch}:${accountId ?? "local"}`;
}

export function captureQuestionAttachmentScope() {
  const capturedAccountId = accountId;
  const token = currentQuestionAttachmentScopeToken();
  return {
    accountId: capturedAccountId,
    token,
    assertCurrent() {
      if (token !== currentQuestionAttachmentScopeToken()) {
        throw new Error("The signed-in account changed. Reopen this image and try again.");
      }
    },
  };
}
