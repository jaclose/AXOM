import type { CommunityPost } from "../../lib/community/community";

/** Ephemeral account-scoped drafts survive a temporary feed fetch failure.
 * The page owns this cache; switching accounts or leaving the route discards it. */
export interface CommunityDraftCache {
  posts: Map<string, { editing: boolean; caption: string; audience: CommunityPost["visibility"]; expectedRevision?: number }>;
  replies: Map<string, { draft: string; editing?: string; editBody: string; editUpdatedAt?: string }>;
}

export function createCommunityDraftCache(): CommunityDraftCache {
  return { posts: new Map(), replies: new Map() };
}
