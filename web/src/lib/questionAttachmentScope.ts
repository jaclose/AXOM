/** Account ownership for image I/O, independent from the workspace store.
 * Tokens change on every account transition, including A → B → A. */
export interface QuestionAttachmentScope {
  readonly owner: string;
  readonly accountId?: string;
  readonly generation: number;
}

let scope: QuestionAttachmentScope = { owner: "device", generation: 0 };
let initialized = false;
let legacyOwner: string | null = null;
const listeners = new Set<() => void>();

export function initializeQuestionAttachmentScope(accountId?: string, linkedAccountId?: string): void {
  if (!initialized) {
    // Capture the old device link before any account transition. Absence is
    // ambiguous: it never grants ownership of legacy account-origin bytes.
    legacyOwner = linkedAccountId ? `account:${linkedAccountId}` : null;
    initialized = true;
  }
  setQuestionAttachmentAccount(accountId);
}

export function setQuestionAttachmentAccount(accountId?: string): void {
  if (scope.accountId === accountId) return;
  scope = { owner: accountId ? `account:${accountId}` : "device", accountId, generation: scope.generation + 1 };
  for (const listener of listeners) listener();
}

export const getQuestionAttachmentScope = (): QuestionAttachmentScope => scope;
export const isQuestionAttachmentScopeCurrent = (value: QuestionAttachmentScope): boolean => value === scope;
export const legacyQuestionAttachmentOwnerHint = (): string | null => legacyOwner;
export function subscribeQuestionAttachmentScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test isolation for the module-local identity bridge. */
export function resetQuestionAttachmentScopeForTests(): void {
  initialized = false;
  legacyOwner = null;
  scope = { owner: "device", generation: scope.generation + 1 };
  for (const listener of listeners) listener();
}
