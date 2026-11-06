import { isCount, isRecord, withCommunityClient } from "./client";
import type { ShareMode } from "./progressBoard";

export interface CommunityPreferences {
  discoverable: boolean;
  shareMode: ShareMode;
  /** Server-issued consent generation. Delayed uploads must name this revision. */
  revision: number;
}

function preferenceResult(value: unknown): CommunityPreferences {
  if (!isRecord(value) || typeof value.discoverable !== "boolean" || !["off", "friends", "community"].includes(String(value.shareMode))
    || !isCount(value.revision)) throw new Error("Your sharing preferences could not be confirmed. Retry when connected.");
  return value as unknown as CommunityPreferences;
}

export async function readCommunityPreferences(accountId: string): Promise<CommunityPreferences> {
  return withCommunityClient(accountId, async client => {
    const { data, error } = await client.rpc("axom_community_preferences");
    if (error) throw new Error("Your sharing preferences could not be checked. Retry when connected.");
    return preferenceResult(data);
  });
}

export async function saveCommunityPreferences(accountId: string, preferences: Pick<CommunityPreferences, "discoverable" | "shareMode">): Promise<CommunityPreferences> {
  if (typeof preferences.discoverable !== "boolean" || !["off", "friends", "community"].includes(preferences.shareMode))
    throw new Error("Choose who can find you and see your daily totals.");
  return withCommunityClient(accountId, async client => {
    const { data, error } = await client.rpc("axom_save_community_preferences", {
      p_discoverable: preferences.discoverable, p_share_mode: preferences.shareMode,
    });
    if (error) throw new Error("Your sharing preferences could not be saved. Retry before assuming they changed.");
    const result = preferenceResult(data);
    if (result.discoverable !== preferences.discoverable || result.shareMode !== preferences.shareMode || result.revision < 1)
      throw new Error("Your sharing preferences could not be confirmed. Refresh before retrying.");
    return result;
  });
}

export async function readShareMode(accountId: string): Promise<ShareMode> {
  return (await readCommunityPreferences(accountId)).shareMode;
}

export async function saveShareMode(accountId: string, mode: ShareMode): Promise<void> {
  const current = await readCommunityPreferences(accountId);
  await saveCommunityPreferences(accountId, { discoverable: current.discoverable, shareMode: mode });
}
