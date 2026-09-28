import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Images, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import { lookFor, SOUNDSCAPES, type SoundscapeId } from "../../lib/soundscapes/presets";
import { SCENES, SCENE_GENRES, sceneById, sceneUrl, type Scene } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia } from "../../lib/soundscapes/userMedia";
import { ICON_SIZE } from "../../lib/iconSize";

function SceneThumb({ scene }: { scene: Scene }) {
  if (scene.image || scene.poster) return <img src={sceneUrl(scene.image ? scene.src : scene.poster)} alt="" loading="lazy" />;
  // Your own videos have no poster: show their first frame.
  return <video src={sceneUrl(scene.src)} muted playsInline preload="metadata" aria-hidden="true" />;
}

/**
 * The "Background" button and its picker: every scene, grouped, bigger than
 * a strip of thumbnails, plus your own photos and clips. Hovering a tile
 * previews it on the stage behind the panel.
 */
export function ScenePicker({ presetId, onPreview, host }: {
  presetId: SoundscapeId;
  onPreview?: (sceneId: string | null) => void;
  /** Where the panel opens (the stage), so it sits over the scene instead of above the page. */
  host?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const choice = useSoundscape((state) => state.scenes[presetId]);
  const versionId = useSoundscape((state) => state.versions[presetId]);
  useSoundscape((state) => state.catalog);
  const setScene = useSoundscape((state) => state.setScene);
  const addFile = useUserMedia((state) => state.add);
  const removeFile = useUserMedia((state) => state.remove);
  const uploadError = useUserMedia((state) => state.error);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const auto = lookFor(SOUNDSCAPES[presetId], versionId).scene;
  const current = choice ?? "auto";
  const currentScene = current === "generative" ? undefined : sceneById(current === "auto" ? auto : current);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: PointerEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node) && !(event.target as HTMLElement).closest(".scene-picker-trigger")) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      onPreview?.(null);
    };
  }, [open, onPreview]);

  const pick = (id: string) => {
    setScene(presetId, id);
    onPreview?.(null);
  };

  return (
    <div className="scene-picker-wrap">
      <button type="button" className={`scene-picker-trigger ${open ? "on" : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        {currentScene ? <SceneThumb scene={currentScene} /> : <span className="scene-picker-trigger-glyph"><WandSparkles size={ICON_SIZE.body} aria-hidden="true" /></span>}
        <span><small>Background</small>{current === "generative" ? "Generative" : currentScene?.label ?? "Auto"}</span>
        <Images size={ICON_SIZE.body} aria-hidden="true" />
      </button>
      {open && renderPanel(
        <div ref={panel} className={`scene-picker-panel ${host ? "hosted" : ""}`} role="dialog" aria-label="Choose a background" onMouseLeave={() => onPreview?.(null)}>
          <div className="scene-picker-head">
            <b>Background</b>
            <button type="button" className="scene-picker-close" aria-label="Close backgrounds" onClick={() => setOpen(false)}><X size={ICON_SIZE.body} aria-hidden="true" /></button>
          </div>
          <div className="scene-picker-grid" role="radiogroup" aria-label="Scene">
            <button type="button" role="radio" aria-checked={current === "auto"} className={`scene-tile text ${current === "auto" ? "on" : ""}`} onClick={() => pick("auto")} title="The scene this version was designed with">
              <Sparkles size={ICON_SIZE.emphasis} aria-hidden="true" /><span>Auto</span>
            </button>
            <button type="button" role="radio" aria-checked={current === "generative"} className={`scene-tile text ${current === "generative" ? "on" : ""}`} onClick={() => pick("generative")} title="Live generative visual that follows the sound">
              <WandSparkles size={ICON_SIZE.emphasis} aria-hidden="true" /><span>Generative</span>
            </button>
            <button type="button" className="scene-tile text add" onClick={() => input.current?.click()} title="A photo or short clip from your device. It stays on this device.">
              <ImagePlus size={ICON_SIZE.emphasis} aria-hidden="true" /><span>Add your own</span>
            </button>
          </div>
          {uploadError && <p className="scene-picker-error" role="alert">{uploadError}</p>}
          {SCENE_GENRES.map((genre) => {
            const scenes = SCENES.filter((scene) => scene.genre === genre.id);
            if (!scenes.length) return null;
            return (
              <section key={genre.id} className="scene-picker-group" aria-label={genre.label}>
                <h4>{genre.label}</h4>
                <div className="scene-picker-grid">
                  {scenes.map((scene) => (
                    <div key={scene.id} className="scene-tile-wrap">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={current === scene.id}
                        className={`scene-tile ${current === scene.id ? "on" : ""} ${current === "auto" && auto === scene.id ? "auto" : ""}`}
                        onClick={() => pick(scene.id)}
                        onMouseEnter={() => onPreview?.(scene.id)}
                        onFocus={() => onPreview?.(scene.id)}
                        title={`${scene.label}${scene.credit ? ` · ${scene.credit}` : ""}`}
                        aria-label={`${scene.label} scene`}
                      >
                        <SceneThumb scene={scene} />
                        <span>{scene.label}</span>
                      </button>
                      {scene.genre === "yours" && (
                        <button type="button" className="scene-tile-remove" aria-label={`Remove ${scene.label}`} onClick={() => {
                          if (current === scene.id) setScene(presetId, "auto");
                          void removeFile(scene.id.replace(/^user-/, ""));
                        }}>
                          <Trash2 size={ICON_SIZE.microInline} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <input
            ref={input}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const added = await addFile(file, "scene");
              if (added) setScene(presetId, `user-${added.id}`);
            }}
          />
        </div>,
      )}
    </div>
  );

  function renderPanel(node: React.ReactNode) {
    return host ? createPortal(node, host) : node;
  }
}
