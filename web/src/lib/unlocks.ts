// ===========================================================================
// Easter eggs. Finding one adds its id to profile.unlocks, which is part of
// the synced workspace, so an unlock is permanent and follows the account.
// ===========================================================================
import { useStore } from "./store";

export type UnlockId = "again";

export const UNLOCKS: Record<UnlockId, { title: string; body: string }> = {
  again: {
    title: "You found “Again”",
    body: "A song from a friend of AXOM. It now lives in Soundscapes for good.",
  },
};

export function hasUnlock(unlocks: readonly string[] | undefined, id: UnlockId): boolean {
  return Boolean(unlocks?.includes(id));
}

export function useUnlocked(id: UnlockId): boolean {
  return useStore((state) => hasUnlock(state.profile.unlocks, id));
}

/** Record an unlock. Returns true only the first time. */
export function unlock(id: UnlockId): boolean {
  const { profile, updateProfile } = useStore.getState();
  if (hasUnlock(profile.unlocks, id)) return false;
  updateProfile({ unlocks: [...(profile.unlocks ?? []), id] });
  return true;
}
