import { Sparkles, WandSparkles } from "lucide-react";
import { lookFor, SOUNDSCAPES, type SoundscapeId } from "../../lib/soundscapes/presets";
import { SCENES, sceneUrl } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";
import { ICON_SIZE } from "../../lib/iconSize";

/** Choose what a soundscape looks like: its own scene, the generative visual, or any scene. */
export function ScenePicker({ presetId }: { presetId: SoundscapeId }) {
  const choice = useSoundscape((state) => state.scenes[presetId]);
  const versionId = useSoundscape((state) => state.versions[presetId]);
  const setScene = useSoundscape((state) => state.setScene);
  const auto = lookFor(SOUNDSCAPES[presetId], versionId).scene;
  const current = choice ?? "auto";
  if (!SCENES.length) return null;
  return (
    <div className="scene-picker" role="radiogroup" aria-label="Scene">
      <button type="button" role="radio" aria-checked={current === "auto"} className={`scene-pick text ${current === "auto" ? "on" : ""}`} onClick={() => setScene(presetId, "auto")} title="The scene this version was designed with">
        <Sparkles size={ICON_SIZE.body} aria-hidden="true" /><span>Auto</span>
      </button>
      <button type="button" role="radio" aria-checked={current === "generative"} className={`scene-pick text ${current === "generative" ? "on" : ""}`} onClick={() => setScene(presetId, "generative")} title="Live generative visual that follows the sound">
        <WandSparkles size={ICON_SIZE.body} aria-hidden="true" /><span>Generative</span>
      </button>
      {SCENES.map((scene) => (
        <button
          key={scene.id}
          type="button"
          role="radio"
          aria-checked={current === scene.id}
          className={`scene-pick ${current === scene.id ? "on" : ""} ${current === "auto" && auto === scene.id ? "auto" : ""}`}
          onClick={() => setScene(presetId, scene.id)}
          title={`${scene.label} · ${scene.mood}${scene.credit ? ` · ${scene.credit}` : ""}`}
          aria-label={`${scene.label} scene`}
        >
          <img src={sceneUrl(scene.poster)} alt="" loading="lazy" />
          <span>{scene.label}</span>
        </button>
      ))}
    </div>
  );
}
