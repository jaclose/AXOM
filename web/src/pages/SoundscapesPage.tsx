import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioWaveform, Ear, FlaskConical, Info, Maximize2, Minimize2, VolumeX, Wind } from "lucide-react";
import { GlassCard, PanelHeader } from "../components/ui/primitives";
import { ICON_SIZE } from "../lib/iconSize";
import { useStore } from "../lib/store";
import {
  LISTENING_PRINCIPLES,
  LISTENING_REGIMEN,
  SOUNDSCAPES,
  FREQUENCY_ORDER,
  AMBIENT_ORDER,
  type SoundscapeId,
} from "../lib/soundscapes/presets";
import { useSoundscape } from "../lib/soundscapes/store";
import { carrierPair } from "../lib/soundscapes/engine";
import { MIN_COMPARISON_SAMPLE, compareListeningConditions, readListeningLog } from "../lib/soundscapes/listeningLog";
import { SoundscapeStage } from "../components/soundscapes/SoundscapeStage";
import { ScenePicker } from "../components/soundscapes/ScenePicker";
import { AmbientCard, FrequencyCard } from "../components/soundscapes/FrequencyCard";
import { SpotifySection } from "../components/soundscapes/SpotifySection";
import { SoundscapeOpener } from "../components/soundscapes/SoundscapeOpener";
import { ForYouRow } from "../components/soundscapes/ForYouRow";
import { YourSounds } from "../components/soundscapes/YourSounds";
import { PinButton } from "../components/soundscapes/PinButton";
import { forYouOrder, preferFirst } from "../lib/soundscapes/taste";
import {
  FollowTimerToggle,
  OutputToggle,
  StopTimerControl,
  TransportButtons,
  VersionChips,
  VolumeControl,
  useStopTimerLabel,
} from "../components/soundscapes/SoundscapeControls";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function SoundscapesPage() {
  const taste = useSoundscape((state) => state.taste);
  const pinned = useSoundscape((state) => state.pinned);
  const [openerOpen, setOpenerOpen] = useState(() => !useSoundscape.getState().taste.completedAt);
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const lastPresetId = useSoundscape((state) => state.lastPresetId);
  const output = useSoundscape((state) => state.output);
  const supported = useSoundscape((state) => state.supported);
  const error = useSoundscape((state) => state.error);
  const [focused, setFocused] = useState<SoundscapeId | null>(null);
  const [previewScene, setPreviewScene] = useState<string | null>(null);
  const heroId = focused ?? presetId ?? lastPresetId;
  const hero = SOUNDSCAPES[heroId];
  const heroPair = carrierPair(hero, output);
  const stopLabel = useStopTimerLabel();
  const { heroRef, heroEl, fullscreen, toggleFullscreen, awake, wake, rest } = useStageChrome();
  // While a sound plays, the controls step back when you're not using them, leaving just the scene.
  const calm = status === "playing" && !awake && !previewScene;
  // Lead with what the learner said they're into.
  const firstPick = taste.sounds.find((genre) => genre !== "music");
  const ambientFirst = Boolean(firstPick && firstPick !== "frequencies");
  const musicFirst = taste.sounds[0] === "music";

  return (
    <div className="soundscapes-page">
      {openerOpen && <SoundscapeOpener onClose={() => setOpenerOpen(false)} />}
      <ForYouRow onPersonalize={() => setOpenerOpen(true)} />
      <section
        ref={heroRef}
        className={`soundscape-hero ${status === "playing" && presetId === heroId ? "live" : ""} ${calm ? "calm" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
        onPointerEnter={wake}
        onPointerMove={wake}
        onPointerLeave={rest}
      >
        <SoundscapeStage
          preset={hero}
          animate={status === "playing" || focused !== null || previewScene !== null}
          reactive={status === "playing" && presetId === heroId}
          orb
          className="soundscape-hero-visual"
          label={`${hero.name} visual`}
          sceneOverride={previewScene}
        />
        <button type="button" className="soundscape-fullscreen" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen (Esc)" : "Full screen: just the scene"}>
          {fullscreen ? <Minimize2 size={ICON_SIZE.body} aria-hidden="true" /> : <Maximize2 size={ICON_SIZE.body} aria-hidden="true" />}
        </button>
        <div className="soundscape-hero-copy">
          <span className="soundscape-kicker"><AudioWaveform size={ICON_SIZE.body} aria-hidden="true" /> Soundscapes</span>
          <h2>{hero.name}</h2>
          <p>{hero.bestFor.join(" · ")}</p>
          <p className="soundscape-hero-meta">
            {heroPair ? `${output === "headphones" ? "Left" : "Tones"} ${heroPair[0]} Hz · ${output === "headphones" ? "Right" : ""} ${heroPair[1]} Hz → ${hero.beatHz} Hz beat` : hero.band}
            {stopLabel && status !== "idle" ? ` · ${stopLabel}` : ""}
          </p>
          <VersionChips presetId={heroId} />
          <div className="soundscape-hero-controls">
            <TransportButtons presetId={heroId} />
            <PinButton presetId={heroId} />
            <VolumeControl />
            <StopTimerControl />
            <ScenePicker presetId={heroId} onPreview={setPreviewScene} host={heroEl} />
          </div>
          <div className="soundscape-hero-options">
            <OutputToggle />
            <FollowTimerToggle />
          </div>
          {!supported && <p className="soundscape-warning" role="alert"><VolumeX size={ICON_SIZE.body} aria-hidden="true" /> This browser can’t synthesize audio. Try Chrome, Safari, or the AXOM desktop app.</p>}
          {error && <p className="soundscape-warning" role="alert">{error}</p>}
        </div>
      </section>
      <p className="soundscape-comfort">
        <Ear size={ICON_SIZE.microInline} aria-hidden="true" />
        <span><b>Hearing comfort is built in:</b> AXOM fades sound in, softens hiss, and caps sudden peaks. If a tone ever feels uncomfortable, stop it and pick a nature sound. On speakers, or AirPods with Spatial Audio, choose <b>Speakers</b> so the beat stays gentle.</span>
      </p>

      <YourSounds />

      <GlassCard pad>
        <PanelHeader
          headingLevel={3}
          title="Your rotation"
          sub="Your starting experiment for 90-minute blocks. Every tone is generated on this device and matched to the recordings you used."
        />
        <ol className="soundscape-regimen">
          {LISTENING_REGIMEN.map((step) => {
            const preset = step.presetId ? SOUNDSCAPES[step.presetId] : null;
            return (
              <li key={step.activity}>
                <b>{step.activity}</b>
                {preset ? (
                  <button type="button" className="soundscape-regimen-pick" onClick={() => void useSoundscape.getState().play(preset.id)} onMouseEnter={() => setFocused(preset.id)} onMouseLeave={() => setFocused(null)}>
                    {preset.name}
                  </button>
                ) : (
                  <span className="soundscape-regimen-quiet">
                    Silence
                    {step.optional && <button type="button" className="soundscape-regimen-pick subtle" onClick={() => void useSoundscape.getState().play(step.optional!)}>or {SOUNDSCAPES[step.optional].short}</button>}
                  </span>
                )}
                <small>{step.note}</small>
              </li>
            );
          })}
        </ol>
      </GlassCard>

      {musicFirst && <SpotifySection />}
      {ambientFirst && (
      <section className="soundscape-section" aria-labelledby="ambient-title">
        <div className="soundscape-section-head">
          <div><span className="soundscape-kicker"><Wind size={ICON_SIZE.body} aria-hidden="true" /> Ambient</span><h2 id="ambient-title">Noise, rooms & nature</h2></div>
          <p>Everything here is generated on your device, so it never loops or seams. Use it to mask a noisy room or for breaks.</p>
        </div>
        <div className="ambient-grid">
          {preferFirst(AMBIENT_ORDER, forYouOrder(taste, pinned)).map((id) => <AmbientCard key={id} id={id} />)}
        </div>
      </section>
      )}
      <section className="soundscape-section" aria-labelledby="frequencies-title">
        <div className="soundscape-section-head">
          <div><span className="soundscape-kicker"><AudioWaveform size={ICON_SIZE.body} aria-hidden="true" /> Brainwave frequencies</span><h2 id="frequencies-title">What each frequency is for</h2></div>
          <p>Each band is named after a brain rhythm. Your own recordings lead; two designed versions sit beside them. Use headphones for binaural beats.</p>
        </div>
        <div className="frequency-grid">
          {preferFirst(FREQUENCY_ORDER, forYouOrder(taste, pinned)).map((id) => <FrequencyCard key={id} id={id} />)}
        </div>
      </section>

      {!ambientFirst && (
      <section className="soundscape-section" aria-labelledby="ambient-title">
        <div className="soundscape-section-head">
          <div><span className="soundscape-kicker"><Wind size={ICON_SIZE.body} aria-hidden="true" /> Ambient</span><h2 id="ambient-title">Noise, rooms & nature</h2></div>
          <p>Everything here is generated on your device, so it never loops or seams. Use it to mask a noisy room or for breaks.</p>
        </div>
        <div className="ambient-grid">
          {preferFirst(AMBIENT_ORDER, forYouOrder(taste, pinned)).map((id) => <AmbientCard key={id} id={id} />)}
        </div>
      </section>
      )}
      {!musicFirst && <SpotifySection />}

      <ListeningExperiment />

      <GlassCard pad>
        <PanelHeader headingLevel={3} title="What the research supports" sub="Frequency labels describe brain-activity bands; playing a beat does not reliably put your brain in that state." />
        <ul className="soundscape-principles">
          {LISTENING_PRINCIPLES.map((line) => <li key={line}><Info size={ICON_SIZE.microInline} aria-hidden="true" /> {line}</li>)}
        </ul>
      </GlassCard>
    </div>
  );
}

function ListeningExperiment() {
  const questions = useStore((state) => state.questions);
  const reviews = useStore((state) => state.cardReviews);
  const status = useSoundscape((state) => state.status);
  const rows = useMemo(() => compareListeningConditions({
    log: readListeningLog(),
    attempts: (questions ?? []).flatMap((question) => question.attempts ?? []),
    reviews: reviews ?? [],
  }),
  // The log grows when playback stops; re-read then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [questions, reviews, status]);
  return (
    <GlassCard pad>
      <PanelHeader
        headingLevel={3}
        title="Is it working for you?"
        sub={`Your question accuracy and in-app Anki “again” rate, split by what was playing. Numbers appear once a condition has ${MIN_COMPARISON_SAMPLE}+ answers. This is observational — material and time of day differ — so look for repeated gaps, not one-off ones.`}
        action={<FlaskConical size={ICON_SIZE.emphasis} aria-hidden="true" />}
      />
      {rows.length === 0 ? (
        <p className="sub">Play a soundscape during a study block (a minute or more) and AXOM starts comparing it with quiet study from the same period.</p>
      ) : (
        <table className="soundscape-table">
          <thead>
            <tr><th scope="col">Condition</th><th scope="col">Listening</th><th scope="col">Question accuracy</th><th scope="col">Anki “again” rate</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.condition}>
                <th scope="row">{row.label}</th>
                <td>{row.condition === "quiet" ? "—" : `${row.minutes} min`}</td>
                <td>{percent(row.questions.accuracy)} <small>({row.questions.answered})</small></td>
                <td>{percent(row.cards.againRate)} <small>({row.cards.reviewed})</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassCard>
  );
}

/**
 * Full screen for the hero, plus "awake" chrome: controls show while the
 * pointer is over the stage and fade when it leaves. In full screen they also
 * fade after a few idle seconds (and the cursor hides), like a screensaver.
 */
function useStageChrome() {
  const heroNode = useRef<HTMLElement | null>(null);
  const [heroEl, setHeroEl] = useState<HTMLElement | null>(null);
  const heroRef = useCallback((node: HTMLElement | null) => { heroNode.current = node; setHeroEl(node); }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const [awake, setAwake] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === heroNode.current && heroNode.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.clearTimeout(timer.current);
    };
  }, []);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(timer.current);
    if (document.fullscreenElement) timer.current = window.setTimeout(() => setAwake(false), 2600);
  }, []);

  const rest = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAwake(false), 450);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = heroNode.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void element.requestFullscreen?.().then(() => wake()).catch(() => undefined);
  }, [wake]);

  return { heroRef, heroEl, fullscreen, toggleFullscreen, awake, wake, rest };
}
