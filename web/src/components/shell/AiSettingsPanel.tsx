// ===========================================================================
// AI settings (directive Phase 3). Modes: Off · Local (Ollama, no key) ·
// AXOM Cloud AI (Claude through the account's ai-proxy Edge Function; the
// model key lives only on the server) · Demo (labeled mock). Detection is
// live and honest: nothing claims to work until probed.
// ===========================================================================
import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, ShieldCheck, Cpu, Cloud, FlaskConical, Power } from "lucide-react";
import {
  DEFAULT_AI_SETTINGS, checkProviderHealth, detectOllama, loadAiSettings, saveAiSettings,
  type AiSettings,
} from "../../lib/ai";
import type { AiAvailability, AiMode } from "../../lib/ai";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { Field, SelectField } from "../ui/Modal";
import { ICON_SIZE } from "../../lib/iconSize";

const MODES: Array<{ id: AiMode; label: string; icon: ReactNode; note: string }> = [
  { id: "off", label: "Off", icon: <Power size={ICON_SIZE.body} />, note: "The app is fully usable without AI." },
  { id: "local", label: "Local (Ollama)", icon: <Cpu size={ICON_SIZE.body} />, note: "Free, private, on-device. No API key." },
  { id: "cloud", label: "AXOM Cloud AI", icon: <Cloud size={ICON_SIZE.body} />, note: "Claude through your AXOM account. No API key in the app; a daily allowance applies." },
  { id: "mock", label: "Demo", icon: <FlaskConical size={ICON_SIZE.body} />, note: "Canned outputs for exploring the flows. Clearly labeled." },
];

export function AiSettingsPanel() {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [probe, setProbe] = useState<AiAvailability | null>(null);
  const [probing, setProbing] = useState(false);

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAiSettings(next);
  }

  async function runProbe(endpoint = settings.localEndpoint) {
    setProbing(true);
    const result = await detectOllama(endpoint);
    setProbe(result);
    setProbing(false);
    // Auto-select the first model when none is chosen yet.
    if (result.ok && result.models?.length && !settings.localModel) {
      update({ localModel: result.models[0] });
    }
  }

  useEffect(() => {
    if (settings.mode === "local") void runProbe();
    if (settings.mode === "cloud") {
      setProbing(true);
      void checkProviderHealth(settings).then((result) => { setProbe(result); setProbing(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <ShieldCheck size={ICON_SIZE.body} style={{ color: "var(--cyan)" }} />
        <span className="sub">
          Local-first by design: with Local mode, your study data never leaves this machine. Cloud AI stays optional, and API keys are never stored in the browser.
        </span>
      </div>

      <div className="stack gap6">
        <span className="field-label">AI mode</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {MODES.map((m) => (
            <button key={m.id} className={`filter-pill ${settings.mode === m.id ? "on" : ""}`} onClick={() => update({ mode: m.id })}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <span className="sub">{MODES.find((m) => m.id === settings.mode)?.note}</span>
      </div>

      {settings.mode === "local" && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow">
              <Field label="Ollama endpoint" value={settings.localEndpoint}
                onChange={(e) => update({ localEndpoint: e.target.value })} />
            </div>
            <GButton size="sm" onClick={() => runProbe()} disabled={probing} style={{ marginTop: 20 }}>
              {probing ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <RefreshCw size={ICON_SIZE.body} />} Detect
            </GButton>
          </div>
          {probe && (
            <div className="row" style={{ gap: 8 }}>
              <Tag tone={probe.ok ? "green" : "orange"}>{probe.ok ? "Reachable" : "Not detected"}</Tag>
              <span className="sub">{probe.detail}</span>
            </div>
          )}
          {probe?.ok && (probe.models?.length ?? 0) > 0 && (
            <SelectField label="Model" value={settings.localModel ?? ""}
              onChange={(e) => update({ localModel: e.target.value || undefined })}>
              <option value="">Choose a model…</option>
              {probe.models!.map((m) => <option key={m} value={m}>{m}</option>)}
            </SelectField>
          )}
          {!probe?.ok && (
            <div className="setup-steps">
              <b>Set up local AI (once, ~5 minutes):</b>
              <ol>
                <li>Install Ollama from <span className="mono">ollama.com</span> (macOS/Windows/Linux).</li>
                <li>Pull a model: <span className="mono">ollama pull llama3.2</span> (light) or <span className="mono">ollama pull qwen2.5:14b</span> (stronger reasoning).</li>
                <li>Ollama serves on <span className="mono">localhost:11434</span> automatically — click Detect above.</li>
              </ol>
              <span className="sub">Any Ollama-compatible endpoint works; no model is hardcoded.</span>
            </div>
          )}
        </div>
      )}

      {settings.mode === "cloud" && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <Tag tone={probe?.ok ? "green" : probing ? "neutral" : "orange"}>{probing ? "Checking…" : probe?.ok ? "Ready" : "Not available"}</Tag>
            <span className="sub">{probe?.detail ?? "Checking your account…"}</span>
          </div>
          <div className="sub">
            Requests go to Claude through AXOM's server with your account session — the model key never touches this device.
            Only the text a feature sends (a card source, a question) leaves your machine, and every result still lands in a review step.
          </div>
          {!probe?.ok && !probing && <GhostButton onClick={() => update({ mode: "local" })}>Use local AI instead</GhostButton>}
        </div>
      )}

      {settings.mode === "mock" && (
        <div className="sub">
          Demo outputs are deterministic, prefixed with [DEMO], and never stored as real analysis. Use this to preview flows only.
        </div>
      )}

      {settings.mode !== "off" && settings.mode !== DEFAULT_AI_SETTINGS.mode && (
        <div className="sub">
          AI proposals never change your plan directly — everything lands in a review step first.
        </div>
      )}
    </div>
  );
}
