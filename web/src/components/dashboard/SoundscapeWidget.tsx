// Dashboard soundscape widget (JD, Ideas 1: "check-in first, then timer, then
// soundscapes next to it"). It only calls the soundscape store's own actions,
// so the engine, listening log and media session behave as they do on the page.
import { AudioWaveform, Pause, Play, Square } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { SOUNDSCAPES, isPlayable, versionOf } from "../../lib/soundscapes/presets";
import { dashboardQuickPicks } from "../../lib/soundscapes/quickPicks";
import { useSoundscape } from "../../lib/soundscapes/store";
import { GlassCard, PanelHeader } from "../ui/primitives";

export function SoundscapeWidget({ enabledFields }: { enabledFields: Set<string> }) {
  const supported = useSoundscape((state) => state.supported);
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const previewing = useSoundscape((state) => state.previewing);
  const lastPresetId = useSoundscape((state) => state.lastPresetId);
  const versions = useSoundscape((state) => state.versions);
  const pinned = useSoundscape((state) => state.pinned);
  const taste = useSoundscape((state) => state.taste);
  const followTimer = useSoundscape((state) => state.followTimer);
  const error = useSoundscape((state) => state.error);
  useSoundscape((state) => state.catalog); // your own files can change what is playable
  const { play, toggle, stop, setFollowTimer } = useSoundscape.getState();

  // A hover preview on the Soundscapes page is not a session; show it as idle.
  const live = status !== "idle" && !previewing;
  const playing = live && status === "playing";
  const currentId = live && presetId ? presetId : isPlayable(lastPresetId) ? lastPresetId : "gamma-40";
  const preset = SOUNDSCAPES[currentId];
  const version = versionOf(preset, versions[currentId]);
  const picks = dashboardQuickPicks(pinned, taste, lastPresetId);
  const detail = [version?.label, preset.significance?.state].filter(Boolean).join(" · ");

  const header = (
    <PanelHeader
      title="Soundscape"
      sub={!supported ? "Not available in this browser" : playing ? "Playing now" : live ? "Paused" : "Ready for your next block"}
      action={<a className="gbtn sm" href="#soundscapes"><AudioWaveform size={ICON_SIZE.body} /> All sounds</a>}
    />
  );

  if (!supported) {
    return (
      <GlassCard pad className="dashboard-core-widget soundscape-widget">
        {header}
        <div className="dashboard-widget-empty">
          <AudioWaveform size={ICON_SIZE.control} />
          <b>Sound needs Web Audio</b>
          <span>This browser has it turned off. The timer still works on its own.</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard
      pad
      className={`dashboard-core-widget soundscape-widget ${playing ? "is-playing" : ""}`}
      style={preset.significance?.tint ? { ["--sw-tint" as string]: preset.significance.tint } : undefined}
    >
      {header}
      <div className="soundscape-widget-now">
        <button
          type="button"
          className="soundscape-widget-play"
          aria-label={playing ? `Pause ${preset.name}` : `Play ${preset.name}`}
          onClick={() => void (live ? toggle() : play(currentId))}
        >
          {playing ? <Pause size={ICON_SIZE.control} /> : <Play size={ICON_SIZE.control} />}
        </button>
        <div className="soundscape-widget-title">
          <b>{preset.name}</b>
          {detail && <span>{detail}</span>}
        </div>
        {live && (
          <span className={`soundscape-widget-eq ${playing ? "playing" : ""}`} aria-hidden="true">
            <i /><i /><i /><i />
          </span>
        )}
        {live && (
          <button type="button" className="soundscape-widget-stop" aria-label={`Stop ${preset.name}`} onClick={() => void stop()}>
            <Square size={ICON_SIZE.microInline} />
          </button>
        )}
      </div>
      {enabledFields.has("quickPicks") && (
        <div className="soundscape-widget-picks" role="group" aria-label="Quick picks">
          {picks.map((id) => {
            const on = live && presetId === id;
            return (
              <button
                key={id}
                type="button"
                className={on ? "on" : ""}
                aria-pressed={on}
                title={on ? `${playing ? "Pause" : "Resume"} ${SOUNDSCAPES[id].name}` : `Play ${SOUNDSCAPES[id].name}`}
                onClick={() => void (on ? toggle() : play(id))}
              >
                {SOUNDSCAPES[id].short}
              </button>
            );
          })}
        </div>
      )}
      {enabledFields.has("followTimer") && (
        <label className="soundscape-widget-follow" title="During Pomodoro breaks, switch to 10 Hz rest, then return to your block's sound.">
          <input type="checkbox" checked={followTimer} onChange={(event) => setFollowTimer(event.target.checked)} />
          Follow my Pomodoro <small>10 Hz on breaks</small>
        </label>
      )}
      {error && <p className="soundscape-widget-error" role="status">{error}</p>}
    </GlassCard>
  );
}
