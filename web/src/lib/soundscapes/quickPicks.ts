// The four sounds the dashboard widget offers one tap away. Your own choices
// lead (pinned, then what you said you're into, then what you played last);
// a study-first default set fills the rest so a new student still sees range.
import { isPlayable, type SoundscapeId } from "./presets";
import { forYouOrder, type Taste } from "./taste";

export const DEFAULT_QUICK_PICKS: readonly SoundscapeId[] = ["gamma-40", "beta-20", "brown-noise", "soft-rain"];

export function dashboardQuickPicks(
  pinned: readonly SoundscapeId[],
  taste: Taste,
  lastPresetId: SoundscapeId,
  limit = 4,
): SoundscapeId[] {
  const ordered = [...new Set([...forYouOrder(taste, pinned), lastPresetId, ...DEFAULT_QUICK_PICKS])];
  return ordered.filter((id) => isPlayable(id)).slice(0, limit);
}
