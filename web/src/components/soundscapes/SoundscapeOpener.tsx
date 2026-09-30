// ===========================================================================
// The Soundscapes opener: two quick, visual questions — what you like to
// hear, then what you like to look at. Tiles are slow looping scenes that
// widen on hover (and play a short preview once sound is on). Everything is
// optional and changeable; picks only decide what comes first.
// ===========================================================================
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, Music2, Shuffle, Volume2, VolumeX, X } from "lucide-react";
import { SCENES, sceneById, type Scene } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";
import { SOUND_GENRES, VISUAL_GENRES, forYouOrder, type SoundGenre, type VisualGenre } from "../../lib/soundscapes/taste";
import { ScenePlayer } from "./ScenePlayer";
import { ICON_SIZE } from "../../lib/iconSize";

const PREVIEW_DELAY_MS = 350;

function representativeScene(genre: VisualGenre): Scene | undefined {
  if (genre === "random") return undefined;
  // Each genre names the scenes that read best on a tall tile; your own
  // wallpapers come first when you have them.
  const lead = VISUAL_GENRES.find((option) => option.id === genre)?.lead ?? [];
  for (const id of lead) {
    const scene = sceneById(id);
    if (scene) return scene;
  }
  const matches = SCENES.filter((scene) => scene.genre === genre);
  return matches.find((scene) => scene.src.includes("/personal/")) ?? matches[0];
}

/** Cycles through every scene for the "Random" tile. */
function useCycledScene(active: boolean): Scene | undefined {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || SCENES.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % SCENES.length), 3200);
    return () => window.clearInterval(timer);
  }, [active]);
  return SCENES[index];
}

function Tile({ label, blurb, scene, tint, selected, onToggle, onHover, onLeave, icon, index }: {
  label: string;
  blurb: string;
  scene?: Scene;
  tint?: string;
  selected: boolean;
  onToggle: () => void;
  onHover?: () => void;
  onLeave?: () => void;
  icon?: React.ReactNode;
  index: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      className={`opener-tile ${selected ? "on" : ""} ${hover ? "hover" : ""}`}
      style={{ "--tile-tint": tint ?? "rgb(var(--accent-rgb))", "--tile-delay": `${index * 70}ms` } as CSSProperties}
      onPointerEnter={() => { setHover(true); onHover?.(); }}
      onPointerLeave={() => { setHover(false); onLeave?.(); }}
      onFocus={() => { setHover(true); onHover?.(); }}
      onBlur={() => { setHover(false); onLeave?.(); }}
      onClick={onToggle}
    >
      {scene ? <ScenePlayer scene={scene} animate className="opener-tile-scene" /> : <span className="opener-tile-fallback" aria-hidden="true" />}
      <span className="opener-tile-shade" aria-hidden="true" />
      <span className="opener-tile-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      <span className="opener-tile-copy">
        {icon}
        <b>{label}</b>
        <small>{blurb}</small>
      </span>
    </button>
  );
}

export function SoundscapeOpener({ onClose }: { onClose: () => void }) {
  const taste = useSoundscape((state) => state.taste);
  const pinned = useSoundscape((state) => state.pinned);
  const setTaste = useSoundscape((state) => state.setTaste);
  const [step, setStep] = useState<0 | 1>(0);
  const [sounds, setSounds] = useState<SoundGenre[]>(taste.sounds);
  const [visuals, setVisuals] = useState<VisualGenre[]>(taste.visuals);
  const [soundOn, setSoundOn] = useState(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const randomScene = useCycledScene(step === 1);

  const stopPreview = () => {
    window.clearTimeout(previewTimer.current);
    const state = useSoundscape.getState();
    if (state.previewing) void state.stop(0.4);
  };

  useEffect(() => {
    rootRef.current?.focus();
    return () => stopPreview();
  }, []);

  useEffect(() => stopPreview(), [step]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); finish(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function enableSound() {
    const next = !soundOn;
    setSoundOn(next);
    if (next) await useSoundscape.getState().unlockAudio();
    else stopPreview();
  }

  function preview(genre: SoundGenre) {
    const option = SOUND_GENRES.find((item) => item.id === genre);
    if (!soundOn || !option?.preview) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const state = useSoundscape.getState();
      // Never interrupt something the learner is actually listening to.
      if (state.status === "playing" && !state.previewing) return;
      void state.play(option.preview!.preset, { version: option.preview!.version, preview: true });
    }, PREVIEW_DELAY_MS);
  }

  function finish(skip = false) {
    stopPreview();
    const next = skip ? { completedAt: new Date().toISOString() } : { sounds, visuals, completedAt: new Date().toISOString() };
    const first = forYouOrder({ sounds: skip ? taste.sounds : sounds, visuals }, pinned)[0];
    setTaste(next, first);
    onClose();
  }

  const toggle = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

  const dialog = (
    <div ref={rootRef} className="soundscape-opener" role="dialog" aria-modal="true" aria-labelledby="opener-title" tabIndex={-1}>
      <div className="opener-inner">
        <header className="opener-head">
          <span className="opener-step">{step + 1} / 2</span>
          <button type="button" className={`opener-sound ${soundOn ? "on" : ""}`} onClick={() => void enableSound()} aria-pressed={soundOn}>
            {soundOn ? <Volume2 size={ICON_SIZE.body} /> : <VolumeX size={ICON_SIZE.body} />}
            {soundOn ? "Previews on — hover to listen" : "Turn on previews"}
          </button>
          <button type="button" className="opener-close" onClick={() => finish(true)} aria-label="Skip for now"><X size={ICON_SIZE.body} /></button>
        </header>

        <h2 id="opener-title">{step === 0 ? "What are you into?" : "What do you like to look at?"}</h2>
        <p className="opener-sub">{step === 0 ? "Pick as many as you like." : "Scenes play behind your sounds. Pick as many as you like."}</p>

        {step === 0 ? (
          <div className="opener-tiles" role="group" aria-label="Sounds you like">
            {SOUND_GENRES.map((genre, index) => (
              <Tile
                key={genre.id}
                index={index}
                label={genre.label}
                blurb={genre.id === "music" ? "Your piano playlist · plays in Spotify" : genre.blurb}
                scene={sceneById(genre.scene)}
                tint={genre.tint}
                selected={sounds.includes(genre.id)}
                icon={genre.id === "music" ? <Music2 size={16} aria-hidden="true" /> : undefined}
                onToggle={() => setSounds((list) => toggle(list, genre.id))}
                onHover={() => preview(genre.id)}
                onLeave={stopPreview}
              />
            ))}
          </div>
        ) : (
          <div className="opener-tiles" role="group" aria-label="Scenes you like">
            {VISUAL_GENRES.map((genre, index) => (
              <Tile
                key={genre.id}
                index={index}
                label={genre.label}
                blurb={genre.blurb}
                scene={genre.id === "random" ? randomScene : representativeScene(genre.id)}
                selected={visuals.includes(genre.id)}
                icon={genre.id === "random" ? <Shuffle size={16} aria-hidden="true" /> : undefined}
                onToggle={() => setVisuals((list) => toggle(list, genre.id))}
              />
            ))}
          </div>
        )}

        <footer className="opener-foot">
          <p>You can change this anytime, and every sound and scene stays available. What you pick simply comes first and sets the look at the top.</p>
          <div className="opener-actions">
            {step === 1 && <button type="button" className="opener-link" onClick={() => setStep(0)}>Back</button>}
            <button type="button" className="opener-link" onClick={() => finish(true)}>Skip</button>
            {step === 0
              ? <button type="button" className="opener-next" onClick={() => setStep(1)}>{sounds.length ? "Next" : "Next without picks"}</button>
              : <button type="button" className="opener-next" onClick={() => finish()}>Start listening</button>}
          </div>
        </footer>
      </div>
    </div>
  );
  // Portaled: the app shell's backdrop blur would otherwise trap a fixed
  // overlay inside it (clipped, and beneath notices).
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
