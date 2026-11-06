import { Pause, Play } from "lucide-react";
import { SOUNDSCAPES, versionOf } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { PinButton } from "./PinButton";
import "../../styles/main-sound.css";

/** A stable choice, independent of what happened to play most recently. */
export function MainSound() {
  const main = useSoundscape((state) => state.mainSound);
  const catalog = useSoundscape((state) => state.catalog);
  const active = useSoundscape((state) => state.status === "playing" && state.presetId === main.presetId && state.loadedVersionId === main.versionId);
  void catalog;
  const preset = SOUNDSCAPES[main.presetId];
  const version = preset.versions.find((entry) => entry.id === main.versionId);
  const label = version?.label ?? (main.versionId.startsWith("user-") ? "Your sound" : versionOf(preset, main.versionId).label);
  const original = main.versionId === "axom-soundscape-1" || main.versionId === "axom-afterlight";
  return <section className="main-sound" aria-label="Main sound">
    <div><span className="main-sound-kicker">MAIN SOUND {original && "· AXOM ORIGINAL"}</span><h2>{label}</h2><p>{version?.description ?? "Your sound on this device"}</p></div>
    <div className="main-sound-actions"><button type="button" className="gbtn primary" disabled={!version} onClick={() => {
      const player = useSoundscape.getState();
      if (active) void player.pause();
      else if (player.status === "paused" && player.presetId === main.presetId && player.loadedVersionId === main.versionId) {
        player.setVersion(main.presetId, main.versionId);
        void player.resume();
      } else void player.play(main.presetId, { version: main.versionId });
    }}>{active ? <Pause size={16} /> : <Play size={16} />} {active ? "Pause" : "Play"}</button><PinButton presetId={main.presetId} /></div>
  </section>;
}
