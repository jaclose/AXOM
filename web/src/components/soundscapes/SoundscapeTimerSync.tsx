import { useEffect } from "react";
import { usePomodoro } from "../../lib/pomodoro";
import { REST_PRESET, useSoundscape } from "../../lib/soundscapes/store";
import type { SoundscapeId } from "../../lib/soundscapes/presets";

/**
 * "Follow my timer": when a soundscape is playing, a Pomodoro break crossfades
 * to the rest preset and the next focus block returns to the block's preset —
 * the learner's rotation (focus tone → 10 Hz rest) without touching controls.
 */
export function SoundscapeTimerSync() {
  useEffect(() => {
    let focusPreset: SoundscapeId | null = null;
    return usePomodoro.subscribe((state, previous) => {
      if (state.phase === previous.phase) return;
      const sound = useSoundscape.getState();
      if (!sound.followTimer || sound.status !== "playing" || !sound.presetId) return;
      if (state.phase === "break" && sound.presetId !== REST_PRESET) {
        focusPreset = sound.presetId;
        void sound.play(REST_PRESET, { stopAfterMinutes: null });
      } else if (state.phase === "focus" && sound.presetId === REST_PRESET && focusPreset) {
        void sound.play(focusPreset, { stopAfterMinutes: null });
        focusPreset = null;
      }
    });
  }, []);
  return null;
}
