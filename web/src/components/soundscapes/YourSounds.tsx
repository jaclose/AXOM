import { useRef, useState } from "react";
import { Check, FileAudio, Music2, Pause, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { SOUNDSCAPES, FREQUENCY_ORDER, AMBIENT_ORDER, type SoundscapeId } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia, type UserMediaMeta } from "../../lib/soundscapes/userMedia";
import { useUnlocked } from "../../lib/unlocks";

const HOMES: SoundscapeId[] = ["yours", ...FREQUENCY_ORDER, ...AMBIENT_ORDER];

function homeLabel(id: string | undefined): string {
  const preset = id && id in SOUNDSCAPES ? SOUNDSCAPES[id as SoundscapeId] : SOUNDSCAPES.yours;
  return preset.id === "yours" ? "Your sounds" : `Leads ${preset.name}`;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(bytes > 100 * 1_048_576 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Your own files (kept on this device) and anything you've unlocked. */
export function YourSounds() {
  const items = useUserMedia((state) => state.items).filter((item) => item.kind === "sound");
  const error = useUserMedia((state) => state.error);
  const add = useUserMedia((state) => state.add);
  const againUnlocked = useUnlocked("again");
  const [home, setHome] = useState<SoundscapeId>("yours");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    try {
      for (const file of Array.from(files)) await add(file, "sound", home);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="soundscape-section" aria-labelledby="yours-title">
      <div className="soundscape-section-head">
        <div><span className="soundscape-kicker"><Music2 size={ICON_SIZE.body} aria-hidden="true" /> Yours</span><h2 id="yours-title">Your sounds</h2></div>
        <p>Add a track you own (a focus mix, a recording, a playlist export). It stays on this device, plays from the dock and follows your Pomodoro like any other sound.</p>
      </div>
      <div className="your-sounds">
        {againUnlocked && <AgainCard />}
        {items.map((item) => <YourSoundRow key={item.id} item={item} />)}
        <div
          className={`your-sounds-add ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
          }}
        >
          <Upload size={ICON_SIZE.emphasis} aria-hidden="true" />
          <div>
            <b>{busy ? "Saving to this device…" : "Drop an audio file, or choose one"}</b>
            <small>MP3, M4A, WAV, AAC or OGG · up to 600 MB · never uploaded</small>
          </div>
          <label className="your-sounds-home">
            <span>Put it in</span>
            <select className="field" value={home} onChange={(event) => setHome(event.target.value as SoundscapeId)}>
              {HOMES.map((id) => <option key={id} value={id}>{id === "yours" ? "Your sounds" : `${SOUNDSCAPES[id].name} (as its first version)`}</option>)}
            </select>
          </label>
          <button type="button" className="gbtn primary" disabled={busy} onClick={() => input.current?.click()}>
            <Plus size={ICON_SIZE.body} aria-hidden="true" /> Add a sound
          </button>
          <input ref={input} type="file" accept="audio/*,video/mp4,video/webm" multiple hidden onChange={(event) => {
            const files = event.target.files;
            if (files?.length) void addFiles([...files]);
            event.target.value = "";
          }} />
        </div>
        {error && <p className="soundscape-warning" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function PlayToggle({ presetId, versionId, label }: { presetId: SoundscapeId; versionId: string; label: string }) {
  const status = useSoundscape((state) => state.status);
  const active = useSoundscape((state) => state.presetId === presetId && state.versions[presetId] === versionId);
  const playing = status === "playing" && active;
  return (
    <button type="button" className="your-sound-play" aria-label={playing ? `Pause ${label}` : `Play ${label}`} onClick={() => {
      const store = useSoundscape.getState();
      if (playing) void store.pause();
      else void store.play(presetId, { version: versionId });
    }}>
      {playing ? <Pause size={ICON_SIZE.body} aria-hidden="true" /> : <Play size={ICON_SIZE.body} aria-hidden="true" />}
    </button>
  );
}

function YourSoundRow({ item }: { item: UserMediaMeta }) {
  const update = useUserMedia((state) => state.update);
  const remove = useUserMedia((state) => state.remove);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const presetId = (item.presetId && item.presetId in SOUNDSCAPES ? item.presetId : "yours") as SoundscapeId;
  return (
    <div className="your-sound">
      <PlayToggle presetId={presetId} versionId={`user-${item.id}`} label={item.name} />
      <FileAudio size={ICON_SIZE.body} aria-hidden="true" className="your-sound-icon" />
      <div className="your-sound-copy">
        {editing ? (
          <form onSubmit={(event) => { event.preventDefault(); void update(item.id, { name }); setEditing(false); }}>
            <input className="field" value={name} autoFocus maxLength={60} aria-label="Sound name" onChange={(event) => setName(event.target.value)} />
            <button type="submit" className="gbtn sm icon" aria-label="Save name"><Check size={ICON_SIZE.body} aria-hidden="true" /></button>
          </form>
        ) : (
          <b>{item.name}</b>
        )}
        <small>{homeLabel(item.presetId)} · {sizeLabel(item.size)} · on this device only</small>
      </div>
      <select className="field your-sound-move" aria-label={`Where ${item.name} lives`} value={presetId} onChange={(event) => void update(item.id, { presetId: event.target.value })}>
        {HOMES.map((id) => <option key={id} value={id}>{id === "yours" ? "Your sounds" : SOUNDSCAPES[id].name}</option>)}
      </select>
      <button type="button" className="gbtn sm icon" aria-label={`Rename ${item.name}`} onClick={() => setEditing(true)}><Pencil size={ICON_SIZE.body} aria-hidden="true" /></button>
      <button type="button" className="gbtn sm icon danger" aria-label={`Remove ${item.name}`} onClick={() => {
        if (window.confirm(`Remove “${item.name}” from this device?`)) {
          if (useSoundscape.getState().versions[presetId] === `user-${item.id}` && useSoundscape.getState().status !== "idle") void useSoundscape.getState().stop();
          void remove(item.id);
        }
      }}><Trash2 size={ICON_SIZE.body} aria-hidden="true" /></button>
    </div>
  );
}

function AgainCard() {
  return (
    <div className="your-sound again">
      <PlayToggle presetId="again" versionId="original" label="Again" />
      <span className="again-badge" aria-hidden="true">✦</span>
      <div className="your-sound-copy">
        <b>Again</b>
        <small>Unlocked on the desk · a song from a friend of AXOM</small>
      </div>
    </div>
  );
}
