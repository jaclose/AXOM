import { useMemo, useState } from "react";
import { AudioWaveform, FlaskConical, Info, VolumeX, Wind } from "lucide-react";
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
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const lastPresetId = useSoundscape((state) => state.lastPresetId);
  const output = useSoundscape((state) => state.output);
  const supported = useSoundscape((state) => state.supported);
  const error = useSoundscape((state) => state.error);
  const [focused, setFocused] = useState<SoundscapeId | null>(null);
  const heroId = focused ?? presetId ?? lastPresetId;
  const hero = SOUNDSCAPES[heroId];
  const heroPair = carrierPair(hero, output);
  const stopLabel = useStopTimerLabel();

  return (
    <div className="soundscapes-page">
      <section className={`soundscape-hero ${status === "playing" && presetId === heroId ? "live" : ""}`}>
        <SoundscapeStage
          preset={hero}
          animate={status === "playing" || focused !== null}
          reactive={status === "playing" && presetId === heroId}
          className="soundscape-hero-visual"
          label={`${hero.name} visual`}
        />
        <div className="soundscape-hero-copy">
          <span className="soundscape-kicker"><AudioWaveform size={ICON_SIZE.body} aria-hidden="true" /> Soundscapes</span>
          <h2>{hero.name}</h2>
          <p>{hero.bestFor.join(" · ")}</p>
          <p className="soundscape-hero-meta">
            {heroPair ? `${output === "headphones" ? "Left" : "Tones"} ${heroPair[0]} Hz · ${output === "headphones" ? "Right" : ""} ${heroPair[1]} Hz → ${hero.beatHz} Hz beat` : hero.band}
            {stopLabel && status !== "idle" ? ` · ${stopLabel}` : ""}
          </p>
          <VersionChips presetId={heroId} />
          <ScenePicker presetId={heroId} />
          <div className="soundscape-hero-controls">
            <TransportButtons presetId={heroId} />
            <VolumeControl />
            <StopTimerControl />
          </div>
          <div className="soundscape-hero-options">
            <OutputToggle />
            <FollowTimerToggle />
          </div>
          {!supported && <p className="soundscape-warning" role="alert"><VolumeX size={ICON_SIZE.body} aria-hidden="true" /> This browser can’t synthesize audio. Try Chrome, Safari, or the AXOM desktop app.</p>}
          {error && <p className="soundscape-warning" role="alert">{error}</p>}
        </div>
      </section>

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

      <section className="soundscape-section" aria-labelledby="frequencies-title">
        <div className="soundscape-section-head">
          <div><span className="soundscape-kicker"><AudioWaveform size={ICON_SIZE.body} aria-hidden="true" /> Brainwave frequencies</span><h2 id="frequencies-title">What each frequency is for</h2></div>
          <p>Each band is named after a brain rhythm. Your own recordings lead; two designed versions sit beside them. Use headphones for binaural beats.</p>
        </div>
        <div className="frequency-grid">
          {FREQUENCY_ORDER.map((id) => <FrequencyCard key={id} id={id} />)}
        </div>
      </section>

      <section className="soundscape-section" aria-labelledby="ambient-title">
        <div className="soundscape-section-head">
          <div><span className="soundscape-kicker"><Wind size={ICON_SIZE.body} aria-hidden="true" /> Ambient</span><h2 id="ambient-title">Noise, rooms & nature</h2></div>
          <p>Everything here is generated on your device, so it never loops or seams. Use it to mask a noisy room or for breaks.</p>
        </div>
        <div className="ambient-grid">
          {AMBIENT_ORDER.map((id) => <AmbientCard key={id} id={id} />)}
        </div>
      </section>

      <SpotifySection />

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
