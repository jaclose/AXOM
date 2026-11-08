/**
 * Content fingerprints are not an account authorization boundary. This tiny
 * publication bridge stays independent of the heavy account/cloud store so
 * QBank import code (and isolated mocks) never load account transport.
 *
 * The canonical accountStore publishes every active-user transition, including
 * sign-out. Monotonic epochs invalidate A -> B -> A operations even if the
 * original account ID later returns. No user content is retained here.
 */
let activeAccountId: string | null = null;
let activeEpoch = 0;

export function publishReviewedImportAccount(accountId: string | null): void {
  if (accountId === activeAccountId) return;
  activeAccountId = accountId;
  activeEpoch += 1;
}

export function currentReviewedImportAccountScope() {
  const accountId = activeAccountId;
  const epoch = activeEpoch;
  return {
    key: (fingerprint: string) => JSON.stringify([epoch, accountId, fingerprint]),
    assertCurrent: () => {
      if (activeEpoch !== epoch || activeAccountId !== accountId) {
        throw new Error("The account changed while importing questions. Reopen this import in your current account.");
      }
    },
  };
}
