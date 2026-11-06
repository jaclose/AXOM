import { useEffect, useRef, useState } from "react";
import { Check, FileAudio, Music2, Pause, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { DEFAULT_SOUNDSCAPE_ID, DEFAULT_SOUNDSCAPE_VERSION, SOUNDSCAPES, FREQUENCY_ORDER, AMBIENT_ORDER, type SoundscapeId, type SoundscapeVersion } from "../../lib/soundscapes/presets";
import { DEFAULT_MAIN_SOUND, useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia, type UserMediaMeta } from "../../lib/soundscapes/userMedia";
import { assignUserSound, homeOf, renameUserSound, syncUserSoundCatalog, userVersionId } from "../../lib/soundscapes/userSounds";
import { pushToast } from "../../lib/toast";
import { useUnlocked } from "../../lib/unlocks";

const HOMES: SoundscapeId[] = ["yours", ...FREQUENCY_ORDER, ...AMBIENT_ORDER];

function homeLabel(id: string | undefined): string {
  const home = homeOf({ presetId: id });
  return home === "yours" ? "Your sounds" : `Plays for ${SOUNDSCAPES[home].name}`;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(bytes > 100 * 1_048_576 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Your own files (kept on this device) and anything you've unlocked. */
export function YourSounds() {
  const items = useUserMedia((state) => state.items).filter((item) => item.kind === "sound");
  const libraryRecordings = SOUNDSCAPES.yours.versions.filter((version): version is Extract<SoundscapeVersion, { src: string }> => "src" in version && !version.userFile);
  const axomOriginal = SOUNDSCAPES[DEFAULT_SOUNDSCAPE_ID].versions.find((version): version is Extract<SoundscapeVersion, { src: string }> => "src" in version && version.id === DEFAULT_SOUNDSCAPE_VERSION);
  const error = useUserMedia((state) => state.error);
  const add = useUserMedia((state) => state.add);
  const againUnlocked = useUnlocked("again");
  const [home, setHome] = useState<SoundscapeId>("yours");
  const [makeMain, setMakeMain] = useState(false);
  const makeMainRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = input.current;
    const cancel = () => { makeMainRef.current = false; setMakeMain(false); };
    node?.addEventListener("cancel", cancel);
    return () => node?.removeEventListener("cancel", cancel);
  }, []);

  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const added = await add(file, "sound", home);
        if (!added) break;
        if (makeMainRef.current) {
          syncUserSoundCatalog();
          useSoundscape.getState().setMainSound(home, userVersionId(added.id));
          makeMainRef.current = false;
          setMakeMain(false);
        }
        // Added straight into a preset: it becomes what that preset plays.
        if (added && home !== "yours") {
          syncUserSoundCatalog();
          useSoundscape.getState().setVersion(home, userVersionId(added.id));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="soundscape-section" aria-labelledby="yours-title">
      <div className="soundscape-section-head">
        <div><span className="soundscape-kicker"><Music2 size={ICON_SIZE.body} aria-hidden="true" /> Yours</span><h2 id="yours-title">Your sounds</h2></div>
        <p>Play an AXOM original or add a track you own. Your imports stay on this device and follow your focus timer.</p>
      </div>
      <div className="your-sounds">
        {againUnlocked && <AgainCard />}
        {axomOriginal && <LibraryRecordingRow presetId={DEFAULT_SOUNDSCAPE_ID} version={axomOriginal} />}
        {libraryRecordings.map((version) => <LibraryRecordingRow key={version.id} version={version} />)}
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
              {HOMES.map((id) => <option key={id} value={id}>{id === "yours" ? "Your sounds only" : `Play it for ${SOUNDSCAPES[id].name}`}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={makeMain} onChange={(event) => { makeMainRef.current = event.target.checked; setMakeMain(event.target.checked); }} /> Make the next added sound my main sound</label>
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

function LibraryRecordingRow({ version, presetId = "yours" }: { version: Extract<SoundscapeVersion, { src: string }>; presetId?: SoundscapeId }) {
  const original = version.id === "axom-afterlight" || version.id === DEFAULT_SOUNDSCAPE_VERSION;
  return (
    <div className={`your-sound library-recording ${original ? "axom-original" : "personal-recording"}`}>
      <PlayToggle presetId={presetId} versionId={version.id} label={version.label} />
      {original
        ? <img className="your-sound-orb" src={`${import.meta.env.BASE_URL}icons/axom-orb-512.png`} alt="" width="28" height="28" />
        : <FileAudio size={ICON_SIZE.emphasis} aria-hidden="true" className="your-sound-icon" />}
      <div className="your-sound-copy">
        <b>{original ? `AXOM Original · ${version.label}` : version.label}</b>
        <small>{version.id === "axom-afterlight" ? "Composed for AXOM · no borrowed samples" : original ? "AXOM Soundscapes · 9 min 27 sec loop" : "Your local recording · kept on this Mac"}</small>
        <small>{version.description}</small>
      </div>
      <span className="your-sound-source">{original ? "AXOM ORIGINAL" : "LOCAL FILE"}</span>
      <MakeMainButton presetId={presetId} versionId={version.id} />
    </div>
  );
}

function PlayToggle({ presetId, versionId, label }: { presetId: SoundscapeId; versionId: string; label: string }) {
  const status = useSoundscape((state) => state.status);
  const active = useSoundscape((state) => state.presetId === presetId && state.loadedVersionId === versionId);
  const playing = status === "playing" && active;
  return (
    <button type="button" className="your-sound-play" aria-label={playing ? `Pause ${label}` : `Play ${label}`} onClick={() => {
      const store = useSoundscape.getState();
      if (playing) void store.pause();
      else if (store.status === "paused" && active) {
        store.setVersion(presetId, versionId);
        void store.resume();
      }
      else void store.play(presetId, { version: versionId });
    }}>
      {playing ? <Pause size={ICON_SIZE.body} aria-hidden="true" /> : <Play size={ICON_SIZE.body} aria-hidden="true" />}
    </button>
  );
}

function YourSoundRow({ item }: { item: UserMediaMeta }) {
  const remove = useUserMedia((state) => state.remove);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const presetId = homeOf(item);

  function startRename() {
    setName(item.name);
    setEditing(true);
  }

  /** Enter, the tick, or clicking away all keep the new name; Escape drops it. */
  function saveName() {
    setEditing(false);
    const next = name.replace(/\s+/g, " ").trim();
    if (next && next !== item.name) renameUserSound(item.id, next);
  }

  function assign(to: SoundscapeId) {
    const done = assignUserSound(item.id, to);
    if (!done) return;
    pushToast(to === "yours"
      ? { title: `${done.sound} is back on Your sounds`, tone: "info", duration: 4500, dedupe: `sound-home-${item.id}` }
      : { title: `${done.sound} now plays for ${done.preset}`, body: "It is the one you hear there: in the dock, your rotation, and when your Pomodoro picks it.", tone: "success", duration: 6000, dedupe: `sound-home-${item.id}` });
  }

  return (
    <div className="your-sound">
      <PlayToggle presetId={presetId} versionId={userVersionId(item.id)} label={item.name} />
      <FileAudio size={ICON_SIZE.body} aria-hidden="true" className="your-sound-icon" />
      <div className="your-sound-copy">
        {editing ? (
          <input
            className="field your-sound-name"
            value={name}
            autoFocus
            maxLength={60}
            aria-label="Sound name"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); saveName(); }
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); }
            }}
          />
        ) : (
          <b>{item.name}</b>
        )}
        <small>{homeLabel(item.presetId)} · {sizeLabel(item.size)} · on this device only</small>
      </div>
      <label className="your-sound-move">
        <span>Plays for</span>
        <select className="field" aria-label={`What ${item.name} plays for`} value={presetId} onChange={(event) => assign(event.target.value as SoundscapeId)}>
          {HOMES.map((id) => <option key={id} value={id}>{id === "yours" ? "Your sounds only" : SOUNDSCAPES[id].name}</option>)}
        </select>
      </label>
      <MakeMainButton presetId={presetId} versionId={userVersionId(item.id)} />
      {editing ? (
        // onMouseDown keeps the field from blurring (and saving) before this click lands.
        <button type="button" className="gbtn sm icon primary" aria-label="Save name" onMouseDown={(event) => event.preventDefault()} onClick={saveName}><Check size={ICON_SIZE.body} aria-hidden="true" /></button>
      ) : (
        <button type="button" className="gbtn sm icon" aria-label={`Rename ${item.name}`} onClick={startRename}><Pencil size={ICON_SIZE.body} aria-hidden="true" /></button>
      )}
      <button type="button" className="gbtn sm icon danger" aria-label={`Remove ${item.name}`} onClick={() => {
        if (window.confirm(`Remove “${item.name}” from this device?`)) {
          const versionId = userVersionId(item.id);
          void (async () => {
            try {
              await remove(item.id);
              const player = useSoundscape.getState();
              if (player.loadedVersionId === versionId && player.status !== "idle") await player.stop();
              const current = useSoundscape.getState();
              if (current.mainSound.versionId === versionId) current.setMainSound(DEFAULT_MAIN_SOUND.presetId, DEFAULT_MAIN_SOUND.versionId);
              syncUserSoundCatalog();
            } catch { /* the media store reports the error; keep the selection */ }
          })();
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

function MakeMainButton({ presetId, versionId }: { presetId: SoundscapeId; versionId: string }) {
  const selected = useSoundscape((state) => state.mainSound.presetId === presetId && state.mainSound.versionId === versionId);
  return <button type="button" className="gbtn sm" disabled={selected} onClick={() => useSoundscape.getState().setMainSound(presetId, versionId)}>{selected ? "Main sound" : "Make main"}</button>;
}
