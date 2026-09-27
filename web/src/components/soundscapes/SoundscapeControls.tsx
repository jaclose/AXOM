import { useEffect, useState } from "react";
import { Headphones, Pause, Play, Speaker, Square, Timer, Volume1, Volume2, VolumeX } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { SOUNDSCAPES, SOUNDSCAPE_ORDER, versionOf, type SoundscapeId } from "../../lib/soundscapes/presets";
import { STOP_TIMER_CHOICES, useSoundscape } from "../../lib/soundscapes/store";

/** Remaining time on the stop timer, refreshed every 15 s. */
export function useStopTimerLabel(): string | null {
  const stopAt = useSoundscape((state) => state.stopAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stopAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [stopAt]);
  if (!stopAt) return null;
  const minutes = Math.max(0, Math.ceil((stopAt - now) / 60_000));
  return `Stops in ${minutes} min`;
}

export function PresetChips({ label = "Soundscape" }: { label?: string }) {
  const presetId = useSoundscape((state) => state.presetId);
  const status = useSoundscape((state) => state.status);
  const play = useSoundscape((state) => state.play);
  return (
    <div className="soundscape-chips" role="group" aria-label={label}>
      {SOUNDSCAPE_ORDER.map((id) => {
        const preset = SOUNDSCAPES[id];
        const active = status !== "idle" && presetId === id;
        return (
          <button key={id} type="button" className={active ? "on" : ""} aria-pressed={active} onClick={() => void play(id)} title={preset.name}>
            {preset.short}
          </button>
        );
      })}
    </div>
  );
}

/** The versions of one preset (three designed ones plus imported recordings). */
export function VersionChips({ presetId }: { presetId: SoundscapeId }) {
  const chosen = useSoundscape((state) => state.versions[presetId]);
  const setVersion = useSoundscape((state) => state.setVersion);
  const preset = SOUNDSCAPES[presetId];
  const current = versionOf(preset, chosen).id;
  return (
    <div className="soundscape-versions" role="radiogroup" aria-label={`${preset.name} versions`}>
      {preset.versions.map((version) => (
        <button
          key={version.id}
          type="button"
          role="radio"
          aria-checked={current === version.id}
          className={current === version.id ? "on" : ""}
          title={version.description}
          onClick={() => setVersion(presetId, version.id)}
        >
          {version.label}{"src" in version ? " ·  your file" : ""}
        </button>
      ))}
    </div>
  );
}

export function VolumeControl() {
  const volume = useSoundscape((state) => state.volume);
  const setVolume = useSoundscape((state) => state.setVolume);
  const Icon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  return (
    <label className="soundscape-volume">
      <Icon size={ICON_SIZE.body} aria-hidden="true" />
      <span className="sr-only">Volume</span>
      <input type="range" min={0} max={100} step={1} value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-valuetext={`${volume}%`} />
    </label>
  );
}

export function StopTimerControl() {
  const stopAt = useSoundscape((state) => state.stopAt);
  const setStopAfter = useSoundscape((state) => state.setStopAfter);
  const remaining = useStopTimerLabel();
  return (
    <label className="soundscape-stop">
      <Timer size={ICON_SIZE.body} aria-hidden="true" />
      <span className="sr-only">Stop timer</span>
      <select
        className="field"
        value=""
        onChange={(event) => setStopAfter(event.target.value === "off" ? null : Number(event.target.value))}
        aria-label="Stop timer"
      >
        <option value="" disabled>{remaining ?? "No stop timer"}</option>
        {stopAt && <option value="off">Turn off the stop timer</option>}
        {STOP_TIMER_CHOICES.map((minutes) => <option key={minutes} value={minutes}>Stop after {minutes} min</option>)}
      </select>
    </label>
  );
}

export function OutputToggle() {
  const output = useSoundscape((state) => state.output);
  const setOutput = useSoundscape((state) => state.setOutput);
  return (
    <div className="soundscape-output" role="radiogroup" aria-label="Listening on">
      {([
        ["headphones", "Headphones", Headphones, "Binaural beats (a different tone in each ear)"],
        ["speakers", "Speakers", Speaker, "Audible beats that work on any speaker"],
      ] as const).map(([value, label, Icon, hint]) => (
        <button key={value} type="button" role="radio" aria-checked={output === value} className={output === value ? "on" : ""} onClick={() => setOutput(value)} title={hint}>
          <Icon size={ICON_SIZE.microInline} aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}

export function FollowTimerToggle() {
  const followTimer = useSoundscape((state) => state.followTimer);
  const setFollowTimer = useSoundscape((state) => state.setFollowTimer);
  return (
    <label className="soundscape-follow" title="During Pomodoro breaks, switch to 10 Hz rest, then return to your block’s sound.">
      <input type="checkbox" checked={followTimer} onChange={(event) => setFollowTimer(event.target.checked)} />
      Follow my Pomodoro (10 Hz on breaks)
    </label>
  );
}

export function TransportButtons({ presetId }: { presetId?: SoundscapeId }) {
  const status = useSoundscape((state) => state.status);
  const active = useSoundscape((state) => state.presetId);
  const { play, toggle, stop } = useSoundscape.getState();
  const target = presetId ?? active ?? useSoundscape.getState().lastPresetId;
  const isCurrent = status !== "idle" && active === target;
  return (
    <div className="soundscape-transport">
      <button
        type="button"
        className="soundscape-play"
        aria-label={isCurrent && status === "playing" ? `Pause ${SOUNDSCAPES[target].name}` : `Play ${SOUNDSCAPES[target].name}`}
        onClick={() => void (isCurrent ? toggle() : play(target))}
      >
        {isCurrent && status === "playing" ? <Pause size={ICON_SIZE.emphasis} aria-hidden="true" /> : <Play size={ICON_SIZE.emphasis} aria-hidden="true" />}
      </button>
      {status !== "idle" && (
        <button type="button" className="soundscape-stop-button" aria-label="Stop sound" onClick={() => void stop()}>
          <Square size={ICON_SIZE.body} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
