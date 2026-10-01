import { SoundscapeVisual } from "./SoundscapeVisual";
import { ScenePlayer } from "./ScenePlayer";
import { PulseRing } from "./PulseRing";
import { SoundOrb } from "./SoundOrb";
import { lookFor, type SoundscapePreset } from "../../lib/soundscapes/presets";
import { SCENES, sceneById } from "../../lib/soundscapes/scenes";
import { sceneForTaste } from "../../lib/soundscapes/taste";
import { useSoundscape } from "../../lib/soundscapes/store";

/** The visual for a preset: its chosen video scene (with the pulse ring) or the generative shader. */
export function SoundscapeStage({ preset, animate, reactive = false, ring = true, orb = false, className = "", label, sceneOverride }: {
  preset: SoundscapePreset;
  /** Temporarily show another scene (hover preview in the background picker). */
  sceneOverride?: string | null;
  animate: boolean;
  reactive?: boolean;
  ring?: boolean;
  /** The large stage: a sound-reactive orb in the scene's colours instead of the plain ring. */
  orb?: boolean;
  className?: string;
  label?: string;
}) {
  const versionId = useSoundscape((state) => state.versions[preset.id]);
  const chosen = useSoundscape((state) => state.scenes[preset.id]);
  useSoundscape((state) => state.catalog);
  const choice = sceneOverride ?? chosen;
  const visuals = useSoundscape((state) => state.taste.visuals);
  const look = lookFor(preset, versionId);
  // An explicit choice wins; otherwise "Auto" follows the version's design, bent toward your visual taste.
  const auto = look.scene || !look.overlay ? sceneForTaste(`${preset.id}:${versionId ?? ""}`, look.scene, visuals, SCENES) : undefined;
  const scene = choice === "generative" ? undefined : sceneById(choice) ?? sceneById(auto);
  return (
    <div className={`soundscape-stage ${scene ? "has-scene" : ""} ${className}`} role={label ? "img" : undefined} aria-label={label}>
      {scene
        ? <ScenePlayer scene={scene} animate={animate} />
        : <SoundscapeVisual visual={look.visual} overlay={look.overlay} overlayMix={look.overlayMix} animate={animate} reactive={reactive} />}
      {scene && <div className="scene-vignette" />}
      {orb
        ? <SoundOrb tint={preset.significance?.tint} active={animate} reactive={reactive} />
        : ring && <PulseRing tint={preset.significance?.tint} active={animate} />}
    </div>
  );
}
