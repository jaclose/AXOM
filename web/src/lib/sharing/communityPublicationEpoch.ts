/**
 * Same-origin, cross-tab signal only. No question, account, publication ID,
 * review evidence, or protected payload is written into browser storage.
 *
 * This is a conservative UI consent invalidation signal, NOT a substitute for
 * authenticated SQL/RLS, reviewer approval, or an atomic server-side generation.
 * It cannot coordinate other devices or a transaction whose network result is
 * unknown; the publication RPC remains authoritative.
 */
export const COMMUNITY_PUBLICATION_EPOCH_KEY = "axom.communityPublicationEpoch.v1";

export function readCommunityPublicationEpoch(): string | null {
  try {
    return window.localStorage.getItem(COMMUNITY_PUBLICATION_EPOCH_KEY) ?? "initial";
  } catch {
    // Without a reliable cross-tab read, never reuse a cached checkbox grant.
    return null;
  }
}

/** Call immediately after an acknowledged submission/withdrawal RPC. */
export function signalCommunityPublicationChange(): boolean {
  try {
    // Only a fresh opaque marker crosses tabs, never owner or question data.
    const marker = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(COMMUNITY_PUBLICATION_EPOCH_KEY, marker);
    return true;
  } catch {
    // The server action may already have committed; callers must not retry it
    // just because this advisory browser signal could not be stored.
    return false;
  }
}
