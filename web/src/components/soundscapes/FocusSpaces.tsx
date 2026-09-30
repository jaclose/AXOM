import { useState, type ChangeEvent } from "react";
import { Expand, Upload } from "lucide-react";
import { SCENES } from "../../lib/soundscapes/scenes";
import { saveFocusVideo, useFocusSpace } from "../../lib/soundscapes/focusSpaces";
import { ExperienceLibrary } from "./ExperienceLibrary";

export function FocusSpaces() {
  const selected = useFocusSpace((state) => state.selected);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setSaving(true);
    try { await saveFocusVideo(file); useFocusSpace.getState().select("local"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This video could not be saved."); }
    finally { setSaving(false); }
  }
  return <><ExperienceLibrary /><section className="focus-spaces" aria-labelledby="focus-spaces-title">
    <div className="focus-spaces-copy"><span className="soundscape-kicker">Room to think</span><h2 id="focus-spaces-title">Focus Spaces</h2><p>A quieter view, with your timer and music within reach.</p></div>
    <div className="focus-spaces-actions">
      <label>Environment<select className="field" value={selected.startsWith("site:") ? "axom" : selected} onChange={(event) => useFocusSpace.getState().select(event.target.value)}>
        <option value="axom">AXOM · living light</option>
        {SCENES.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
        <option value="local">My saved video</option>
      </select></label>
      <button type="button" className="gbtn primary" onClick={() => useFocusSpace.getState().select(selected.startsWith("site:") ? "axom" : selected)}><Expand size={16} /> Open space</button>
      <label className="gbtn focus-space-upload"><Upload size={16} />{saving ? "Saving video…" : "Import video"}<input type="file" accept=".mp4,.webm,.m4v" aria-label="Import focus video" disabled={saving} onChange={(event) => void upload(event)} /></label>
      <small>Imported video stays on this device. Use a video you own or have permission to use.</small>
      {error && <p role="alert">{error}</p>}
    </div>
  </section></>;
}
