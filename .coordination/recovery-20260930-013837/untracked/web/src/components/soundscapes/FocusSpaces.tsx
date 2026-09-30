import { useState, type ChangeEvent } from "react";
import { ArrowUpRight, Expand, Upload } from "lucide-react";
import { SCENES } from "../../lib/soundscapes/scenes";
import { saveFocusVideo, useFocusSpace, WINDOW_SWAP_URL } from "../../lib/soundscapes/focusSpaces";

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
  return <section className="focus-spaces" aria-labelledby="focus-spaces-title">
    <div className="focus-spaces-copy"><span className="soundscape-kicker">Room to think</span><h2 id="focus-spaces-title">Focus Spaces</h2><p>A quieter view, with your timer and music within reach.</p></div>
    <div className="focus-spaces-actions">
      <label>Environment<select className="field" value={selected} onChange={(event) => useFocusSpace.getState().select(event.target.value)}>
        <option value="axom">AXOM · living light</option>
        {SCENES.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
        <option value="local">My saved video</option>
      </select></label>
      <button type="button" className="gbtn primary" onClick={() => useFocusSpace.getState().select(selected)}><Expand size={16} /> Open space</button>
      <label className="gbtn focus-space-upload"><Upload size={16} />{saving ? "Saving video…" : "Import video"}<input type="file" accept=".mp4,.webm,.m4v" aria-label="Import focus video" disabled={saving} onChange={(event) => void upload(event)} /></label>
      <a href={WINDOW_SWAP_URL} target="_blank" rel="noopener noreferrer" className="focus-space-external">WindowSwap <ArrowUpRight size={16} /></a>
      <small>Imported video stays on this device. WindowSwap opens separately; your AXOM session continues here.</small>
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
