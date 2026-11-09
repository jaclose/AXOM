import type { JournalEntry } from "./types";
import { getQuestionAttachmentScope, type QuestionAttachmentScope } from "./questionAttachmentScope";

/** Ephemeral provenance from the authenticated workspace replacement boundary.
 * Ordinary journal edits and profile changes can never mint this receipt. */
let receipt: { accountId: string; journal: JournalEntry[]; scope: QuestionAttachmentScope } | undefined;
let version = 0;
const listeners = new Set<() => void>();

export function recordWorkspaceHydration(accountId: string | undefined, journal: JournalEntry[]): void {
  receipt = accountId ? { accountId, journal, scope: getQuestionAttachmentScope() } : undefined;
  version += 1;
  for (const listener of listeners) listener();
}

export const workspaceHydrationReceiptVersion = (): number => version;
export function subscribeWorkspaceHydrationReceipt(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hasWorkspaceHydrationReceipt(accountId: string | null, journal: JournalEntry[]): boolean {
  return Boolean(accountId && receipt?.accountId === accountId && receipt.journal === journal
    && receipt.scope === getQuestionAttachmentScope() && receipt.scope.accountId === accountId);
}

/** Carry existing ownership through a journal edit, never through a new
 * workspace or an account transition. This does not mint an initial receipt. */
export function carryWorkspaceHydrationForJournalEdit(previous: JournalEntry[], next: JournalEntry[]): void {
  if (receipt && hasWorkspaceHydrationReceipt(receipt.accountId, previous)) {
    recordWorkspaceHydration(receipt.accountId, next);
  }
}
