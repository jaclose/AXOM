import { SoundscapeVisual } from "./SoundscapeVisual";
import { ScenePlayer } from "./ScenePlayer";
import { PulseRing } from "./PulseRing";
import { lookFor, type SoundscapePreset } from "../../lib/soundscapes/presets";
import { sceneById } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";

/** The visual for a preset: its chosen video scene (with the pulse ring) or the generative shader. */
export function SoundscapeStage({ preset, animate, reactive = false, ring = true, className = "", label }: {
  preset: SoundscapePreset;
  animate: boolean;
  reactive?: boolean;
  ring?: boolean;
  className?: string;
  label?: string;
}) {
  const versionId = useSoundscape((state) => state.versions[preset.id]);
  const choice = useSoundscape((state) => state.scenes[preset.id]);
  const look = lookFor(preset, versionId);
  const scene = choice === "generative" ? undefined : sceneById(choice) ?? sceneById(look.scene);
  return (
    <div className={`soundscape-stage ${scene ? "has-scene" : ""} ${className}`} role={label ? "img" : undefined} aria-label={label}>
      {scene
        ? <ScenePlayer scene={scene} animate={animate} />
        : <SoundscapeVisual visual={look.visual} overlay={look.overlay} overlayMix={look.overlayMix} animate={animate} reactive={reactive} />}
      {scene && <div className="scene-vignette" />}
      {ring && <PulseRing tint={preset.significance?.tint} active={animate} />}
    </div>
  );
}
