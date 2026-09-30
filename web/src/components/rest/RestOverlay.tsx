import { useEffect, useRef, useState } from "react";
import { AlarmClock, BedDouble, Minimize2, Moon, Plus, Settings2, Sunrise, Trash2, Volume2 } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { formatRestClock, restoreRest, useRest } from "../../lib/rest";
import { availableSystemRestSounds, primeRestAlarm, startRestAlarm, stopRestAlarm } from "../../lib/restAlarm";
import { saveRestAudio } from "../../lib/restAudioFile";
import type { RestSound } from "../../lib/restPreferences";
import { useNotificationPermission } from "../../lib/useNotificationPermission";
import { Field, Modal, SelectField } from "../ui/Modal";
import "../../styles/rest-settings.css";
import { SoundscapeVisual } from "../soundscapes/SoundscapeVisual";

function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** "Put my head down" — the start button used in the timer card. */
export function RestButton({ compact = false }: { compact?: boolean }) {
  const status = useRest((state) => state.status);
  const preferences = useRest((state) => state.preferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { start, setOverlayOpen } = useRest.getState();
  if (status !== "idle") {
    return (
      <button type="button" className="rest-button active" onClick={() => setOverlayOpen(true)}>
        <Moon size={ICON_SIZE.body} aria-hidden="true" /> Resting — open
      </button>
    );
  }
  return (
    <div className={`rest-start ${compact ? "compact" : ""}`}>
      <button type="button" className="rest-button" onClick={() => start()} title={`Pauses your timer, then wakes you in ${preferences.minutes} minutes`}>
        <BedDouble size={ICON_SIZE.body} aria-hidden="true" /> Put my head down <small>{preferences.minutes} min</small>
      </button>
      <button type="button" className="rest-settings-button" onClick={() => setSettingsOpen(true)} aria-label="Rest alarm settings"><Settings2 size={ICON_SIZE.body} /></button>
      {settingsOpen && <RestSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Full-screen rest and wake-up surface. Mounted once at the app root. */
export function RestOverlay() {
  const status = useRest((state) => state.status);
  const endsAt = useRest((state) => state.endsAt);
  const overlayOpen = useRest((state) => state.overlayOpen);
  const paused = useRest((state) => state.paused);
  const now = useClock(status !== "idle");
  const primary = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const audioError = useRest((state) => state.audioError);

  useEffect(() => { restoreRest(); }, []);
  useEffect(() => {
    if (!overlayOpen || status === "idle") return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primary.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); useRest.getState().setOverlayOpen(false); return; }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [overlayOpen, status]);

  if (status === "idle" || !overlayOpen) return null;
  const { extend, wakeNow, snooze, dismiss, setOverlayOpen } = useRest.getState();
  const ringing = status === "ringing";
  const wakeTime = endsAt ? new Date(endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const canResume = Boolean(paused?.pomodoro || paused?.sessionId);

  return (
    <div ref={dialog} className={`rest-overlay ${ringing ? "ringing" : ""}`} role="dialog" aria-modal="true" aria-label={ringing ? "Time to lift your head" : "Resting"}>
      <div className="rest-visual" aria-hidden="true">
        <SoundscapeVisual visual={ringing ? "flow" : "breath"} animate />
      </div>
      <div className="rest-copy">
        {ringing ? <Sunrise size={28} aria-hidden="true" /> : <Moon size={28} aria-hidden="true" />}
        <h2>{ringing ? "Time to lift your head" : "Head down. Breathe slowly."}</h2>
        <div className="rest-clock mono" aria-live="off">{ringing ? wakeTime : formatRestClock((endsAt ?? now) - now)}</div>
        <p>{ringing ? "Take a sip of water and ease back in." : `AXOM will wake you gently at ${wakeTime}.`}</p>
        {audioError && <p role="status">{audioError}</p>}
        <div className="rest-actions">
          {ringing ? (
            <>
              <button ref={primary} type="button" className="rest-primary" onClick={() => dismiss({ resume: canResume })}>
                {canResume ? "I’m up — resume focus" : "I’m up"}
              </button>
              <button type="button" onClick={() => snooze(5)}><AlarmClock size={ICON_SIZE.body} aria-hidden="true" /> 5 more minutes</button>
              {canResume && <button type="button" onClick={() => dismiss()}>I’m up, don’t resume</button>}
            </>
          ) : (
            <>
              <button type="button" onClick={() => extend(5)}><Plus size={ICON_SIZE.body} aria-hidden="true" /> 5 min</button>
              <button ref={primary} type="button" className="rest-primary" onClick={() => wakeNow()}>Wake me now</button>
              <button type="button" onClick={() => setOverlayOpen(false)} aria-label="Minimize to the focus dock"><Minimize2 size={ICON_SIZE.body} aria-hidden="true" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function RestSettings({ onClose }: { onClose: () => void }) {
  const preferences = useRest((state) => state.preferences);
  const presets = useRest((state) => state.presets);
  const { setPreferences, savePreset, removePreset } = useRest.getState();
  const [permission, requestPermission] = useNotificationPermission();
  const [systemSounds, setSystemSounds] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { let active = true; void availableSystemRestSounds().then((sounds) => { if (active) setSystemSounds(sounds); }); return () => { active = false; stopRestAlarm(); }; }, []);
  return <Modal title="Your rest, your pace" onClose={onClose} className="rest-settings-modal" footer={<button type="button" className="gbtn primary" onClick={onClose}>Save settings</button>}>
    <p className="panel-sub">Settings and uploaded sounds stay on this device. Keep AXOM open for the alarm; sleeping devices and suspended browser tabs can delay it.</p>
    <div className="rest-preset-list" aria-label="Saved rest presets">
      {presets.map((preset) => <div key={preset.id} className="rest-preset">
        <button type="button" onClick={() => { setPreferences(preset.preferences); setFeedback(`${preset.name} selected.`); }}>{preset.name}</button>
        {!preset.id.startsWith("default-") && <button type="button" onClick={() => removePreset(preset.id)} aria-label={`Remove ${preset.name} preset`}><Trash2 size={14} /></button>}
      </div>)}
    </div>
    <div className="rest-settings-grid">
      <Field label="Duration (minutes)" type="number" min={1} max={120} value={preferences.minutes} onChange={(event) => setPreferences({ minutes: Number(event.target.value) })} />
      <SelectField label="Alarm sound" value={preferences.sound} onChange={(event) => setPreferences({ sound: event.target.value as RestSound })}>
        <option value="bell">AXOM · Bell</option><option value="warm">AXOM · Warm tones</option><option value="pulse">AXOM · Soft pulse</option>
        {preferences.customName && <option value="custom">Your sound · {preferences.customName}</option>}
        {systemSounds.map((name) => <option key={name} value={`system:${name}`}>macOS · {name}</option>)}
      </SelectField>
    </div>
    <label className="stack gap6"><span className="field-label">Alarm volume · {preferences.volume}%</span><input aria-label="Alarm volume" type="range" min={0} max={100} value={preferences.volume} onChange={(event) => setPreferences({ volume: Number(event.target.value) })} /></label>
    <div className="rest-settings-row"><label><input type="checkbox" checked={preferences.fadeIn} onChange={(event) => setPreferences({ fadeIn: event.target.checked })} /> Gradually fade in over 40 seconds</label>
      <button type="button" className="gbtn sm" onClick={() => { primeRestAlarm(); setFeedback("Playing a short preview."); void startRestAlarm(preferences, { preview: true, onError: setFeedback }); }}><Volume2 size={14} /> Preview</button>
      <button type="button" className="ghost-btn" onClick={stopRestAlarm}>Stop</button>
    </div>
    <SelectField label="AXOM soundscapes during rest" value={preferences.soundscapeMode} onChange={(event) => setPreferences({ soundscapeMode: event.target.value as "keep" | "pause" | "duck" })}>
      <option value="duck">Lower to 20% of current volume</option><option value="pause">Pause, then resume when I wake</option><option value="keep">Keep current volume</option>
    </SelectField>
    <p className="panel-sub">Applies to AXOM audio. Spotify embeds do not expose volume control.</p>
    <div className="rest-settings-row"><label><input type="checkbox" checked={preferences.systemNotification} onChange={(event) => setPreferences({ systemNotification: event.target.checked })} /> Show a system notification</label>
      {permission !== "granted" && <button type="button" className="gbtn sm" disabled={permission === "unavailable" || permission === "denied"} onClick={() => void requestPermission()}>{permission === "denied" ? "Enable in system settings" : permission === "unavailable" ? "Unavailable here" : "Enable notifications"}</button>}
    </div>
    {typeof navigator !== "undefined" && "vibrate" in navigator && <label><input type="checkbox" checked={preferences.vibration} onChange={(event) => setPreferences({ vibration: event.target.checked })} /> Vibrate if this device supports it</label>}
    <label className="stack gap6"><span className="field-label">Use your own sound · WAV, M4A, MP3 · up to 8 MB</span><input type="file" accept=".wav,.m4a,.mp3,audio/wav,audio/mp4,audio/mpeg" disabled={saving} onChange={(event) => {
      const file = event.target.files?.[0]; if (!file) return;
      setSaving(true); setFeedback("Saving sound on this device…");
      void saveRestAudio(file).then(() => { setPreferences({ sound: "custom", customName: file.name }); setFeedback("Sound saved. Preview it before resting."); }).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Sound could not be saved.")).finally(() => setSaving(false));
    }} /></label>
    <div className="rest-settings-row"><Field label="Save as a preset" placeholder="My afternoon reset" value={presetName} maxLength={60} onChange={(event) => setPresetName(event.target.value)} /><button type="button" className="gbtn sm" disabled={!presetName.trim()} onClick={() => { savePreset(presetName); setPresetName(""); setFeedback("Preset saved."); }}>Save preset</button></div>
    {feedback && <p className="panel-sub" role="status">{feedback}</p>}
  </Modal>;
}
