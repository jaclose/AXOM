// Anki integration via AnkiConnect. Connects to the local Anki app, shows
// today's reviews + deck stats, and syncs review counts into the productivity
// log (only the new reviews since the last sync, so it never double-counts).
import { useEffect, useState } from "react";
import { Layers, Plug, RefreshCw, CheckCircle2, AlertTriangle, Wand2, ExternalLink, Copy } from "lucide-react";
import { useStore } from "../../lib/store";
import { GlassCard, GButton, PanelHeader, Tag } from "../ui/primitives";
import {
  AnkiError, DEFAULT_ANKI_ENDPOINT, createAnkiClient, fetchAnkiSnapshot, getAnkiAutoSync, getAnkiEndpoint,
  setAnkiAutoSync, setAnkiEndpoint, pendingSyncDelta, commitSync, alreadySyncedToday,
  ANKI_DIAGNOSTIC_TEMPLATE,
} from "../../lib/ankiConnect";
import type { AnkiDiagnosticStatus, AnkiDiagnosticStepId, AnkiSnapshot } from "../../lib/ankiConnect";
import { ICON_SIZE } from "../../lib/iconSize";
import { loadLinkSettings } from "../../lib/anki/linkSettings";

type Status = "idle" | "connecting" | "connected" | "error";

export function AnkiConnectPanel() {
  const logStudy = useStore((s) => s.logStudy);
  const [endpoint, setEndpointState] = useState(getAnkiEndpoint());
  const [status, setStatus] = useState<Status>("idle");
  const [snapshot, setSnapshot] = useState<AnkiSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; kind: AnkiError["kind"] } | null>(null);
  const [autoSync, setAutoSyncState] = useState(getAnkiAutoSync());
  const [syncNote, setSyncNote] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState(() => ANKI_DIAGNOSTIC_TEMPLATE.map((step) => ({ ...step })));

  const origin = typeof window !== "undefined" ? window.location.origin : "your origin";
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const localEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(endpoint);
  const mixedContentRisk = isHttps && localEndpoint && endpoint.startsWith("http://");
  const corsConfigSnippet = JSON.stringify({
    apiKey: null,
    apiLogPath: null,
    ignoreOriginList: [],
    webBindAddress: "127.0.0.1",
    webBindPort: 8765,
    webCorsOriginList: ["http://localhost", "http://localhost:5173", "http://127.0.0.1:5173", origin],
  }, null, 2);
  const localAppUrl = "http://127.0.0.1:5173/#integrations";
  const localLaunchCommand = "npm --prefix web run dev -- --host 127.0.0.1";

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? "" : current)), 2500);
    } catch {
      setCopied("");
    }
  }

  async function connect(silentSync = autoSync) {
    setStatus("connecting");
    setError(null);
    setSyncNote("");
    setSteps(ANKI_DIAGNOSTIC_TEMPLATE.map((step) => ({ ...step })));
    setAnkiEndpoint(endpoint);
    try {
      const snap = await fetchAnkiSnapshot(createAnkiClient({ endpoint, apiKey: loadLinkSettings().apiKey }), markStep);
      setSnapshot(snap);
      setStatus("connected");
      if (silentSync) doSync(snap.today, true);
    } catch (err) {
      const e = err as AnkiError;
      setError({ message: e.message, kind: e.kind ?? "network" });
      failRunningStep(e.kind ?? "network");
      setStatus("error");
    }
  }

  function markStep(id: AnkiDiagnosticStepId, stepStatus: AnkiDiagnosticStatus, detail?: string) {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, status: stepStatus, detail } : step));
  }

  function failRunningStep(kind: AnkiError["kind"]) {
    setSteps((current) => {
      const runningIndex = current.findIndex((step) => step.status === "running");
      if (runningIndex === -1) return current;
      return current.map((step, index) => index === runningIndex ? { ...step, status: "failed", detail: failureKindLabel(kind) } : step);
    });
  }

  function doSync(reviewsToday: number, silent = false) {
    const delta = pendingSyncDelta(reviewsToday);
    if (delta <= 0) {
      if (!silent) setSyncNote(`Already up to date — ${alreadySyncedToday()} review${alreadySyncedToday() === 1 ? "" : "s"} synced today.`);
      return;
    }
    logStudy({ type: "Anki", cards: delta, note: "Anki review sync" });
    commitSync(reviewsToday);
    setSyncNote(`Logged ${delta} review${delta === 1 ? "" : "s"} to today's productivity.`);
  }

  async function refresh() {
    setBusy(true);
    try { await connect(false); } finally { setBusy(false); }
  }

  // Reflect the manual auto-sync toggle to storage.
  useEffect(() => { setAnkiAutoSync(autoSync); }, [autoSync]);

  const reviewedRecent = (snapshot?.byDay ?? []).slice(-7);
  const maxReviewed = Math.max(1, ...reviewedRecent.map(([, n]) => n));
  const pending = snapshot ? pendingSyncDelta(snapshot.today) : 0;

  return (
    <GlassCard pad className="anki-connect-card">
      <PanelHeader
        title="Anki"
        sub="Connect the desktop Anki app through AnkiConnect. It is a local HTTP bridge, not a public HTTPS API."
        action={
          status === "connected"
            ? <Tag tone="green"><CheckCircle2 size={ICON_SIZE.microInline} /> Connected</Tag>
            : status === "error"
              ? <Tag tone="orange">Not connected</Tag>
              : <Tag tone="neutral">Available</Tag>
        }
      />

      <div className="anki-not-working-note">
        <AlertTriangle size={ICON_SIZE.body} />
        <span>
          Anki sync is not considered working yet. This panel is now a local diagnostic path only until the connection is user-confirmed on your machine.
        </span>
      </div>

      <div className={`anki-path-card ${mixedContentRisk ? "hosted" : "local"}`}>
        <b>{mixedContentRisk ? "Hosted browser path" : "Local browser path"}</b>
        <span>
          {mixedContentRisk
            ? "This can be blocked by Chrome before AnkiConnect ever answers. For reliable sync, run AXOM locally and connect from 127.0.0.1."
            : "This is the supported path: AXOM and AnkiConnect are both local, so the browser can reach the bridge directly."}
        </span>
      </div>

      <div className="anki-endpoint-row">
        <label className="stack gap6 grow">
          <span className="field-label">AnkiConnect endpoint</span>
          <input className="field" value={endpoint} onChange={(e) => setEndpointState(e.target.value)}
            placeholder={DEFAULT_ANKI_ENDPOINT} spellCheck={false} />
        </label>
        <GButton variant="primary" onClick={() => connect()} disabled={status === "connecting"}>
          {status === "connecting" ? <><RefreshCw size={ICON_SIZE.body} className="spin" /> Connecting…</> : <><Plug size={ICON_SIZE.body} /> Connect</>}
        </GButton>
      </div>

      <div className="anki-quiet-actions">
        <a className="gbtn sm" href={endpoint} target="_blank" rel="noreferrer noopener">Open local check <ExternalLink size={ICON_SIZE.body} /></a>
        <details className="anki-advanced">
          <summary>Setup details</summary>
          <div className="anki-advanced-body">
            <div><b>Current origin</b><span className="mono">{origin}</span></div>
            <div className="row wrap gap6">
              <GButton size="sm" onClick={() => copyText(origin, "origin")}><Copy size={ICON_SIZE.body} /> {copied === "origin" ? "Copied" : "Copy origin"}</GButton>
              <GButton size="sm" onClick={() => copyText(corsConfigSnippet, "config")}><Copy size={ICON_SIZE.body} /> {copied === "config" ? "Copied" : "Copy config"}</GButton>
              <GButton size="sm" onClick={() => copyText(localLaunchCommand, "local")}><Copy size={ICON_SIZE.body} /> {copied === "local" ? "Copied" : "Copy local command"}</GButton>
            </div>
          </div>
        </details>
      </div>

      {(status === "connecting" || steps.some((step) => step.status !== "pending")) && (
        <div className="anki-diagnostic-steps">
          {steps.map((step) => (
            <div className={`anki-diagnostic-step ${step.status}`} key={step.id}>
              <span className="anki-step-dot" />
              <div className="grow">
                <b>{step.label}</b>
                {step.detail && <span>{step.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "error" && error && (
        <div className="anki-setup compact">
          <div className="anki-setup-head"><AlertTriangle size={ICON_SIZE.body} /> <b>{failureKindLabel(error.kind)}</b></div>
          <p className="sub">{error.message}</p>
          <div className="anki-next-steps">
            <span>1. Open Anki desktop and keep it running.</span>
            <span>2. Confirm AnkiConnect is installed: Tools → Add-ons → code <span className="mono">2055492159</span>.</span>
            <span>3. If hosted keeps failing, use the local app path: <a href={localAppUrl}>127.0.0.1:5173</a>.</span>
          </div>
        </div>
      )}

      {status === "connected" && snapshot && (
        <>
          <div className="trend-widget anki-stat-row">
            <div><b>{snapshot.today}</b><span>reviews today</span></div>
            <div><b>{snapshot.decks.length}</b><span>decks</span></div>
            <div><b>{snapshot.decks.reduce((sum, d) => sum + d.review_count + d.new_count + d.learn_count, 0)}</b><span>due + new</span></div>
          </div>

          <div className="anki-sync-row">
            <GButton variant={pending > 0 ? "primary" : "default"} onClick={() => doSync(snapshot.today)} disabled={pending <= 0}>
              <Wand2 size={ICON_SIZE.body} /> {pending > 0 ? `Sync ${pending} review${pending === 1 ? "" : "s"} to productivity` : "Productivity is in sync"}
            </GButton>
            <GButton size="sm" onClick={refresh} disabled={busy}><RefreshCw size={ICON_SIZE.body} className={busy ? "spin" : ""} /> Refresh</GButton>
            <label className="anki-autosync">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSyncState(e.target.checked)} />
              <span>Auto-sync on connect</span>
            </label>
          </div>
          {syncNote && <div className="anki-sync-note"><CheckCircle2 size={ICON_SIZE.body} /> {syncNote}</div>}

          {reviewedRecent.length > 0 && (
            <div className="anki-byday">
              <div className="field-label">Reviews — last 7 days</div>
              <div className="anki-byday-bars">
                {reviewedRecent.map(([date, n]) => (
                  <div className="anki-byday-col" key={date} title={`${date}: ${n} reviews`}>
                    <div className="anki-byday-track">
                      <div className="anki-byday-fill" style={{ height: `${Math.max(4, (n / maxReviewed) * 100)}%` }} />
                    </div>
                    <small>{date.slice(5)}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="anki-deck-list">
            {snapshot.decks.slice(0, 8).map((deck) => (
              <div className="anki-deck-row" key={deck.deck_id}>
                <span className="anki-deck-mark"><Layers size={ICON_SIZE.body} /></span>
                <div className="grow"><b>{deck.name}</b><span>{deck.total_in_deck} cards</span></div>
                <span className="anki-deck-counts">
                  <em className="due">{deck.review_count}</em>
                  <em className="learn">{deck.learn_count}</em>
                  <em className="new">{deck.new_count}</em>
                </span>
              </div>
            ))}
            {snapshot.decks.length > 8 && <div className="sub">…and {snapshot.decks.length - 8} more decks</div>}
            <div className="anki-deck-legend">
              <span><i className="due" /> due</span>
              <span><i className="learn" /> learning</span>
              <span><i className="new" /> new</span>
            </div>
          </div>
        </>
      )}
    </GlassCard>
  );
}

function failureKindLabel(kind: AnkiError["kind"]): string {
  switch (kind) {
    case "malformed-endpoint": return "Malformed endpoint";
    case "endpoint-unreachable": return "Endpoint unreachable / Anki not running";
    case "local-network-blocked": return "Browser local-network access blocked";
    case "mixed-content-blocked": return "HTTPS to HTTP endpoint blocked";
    case "cors-blocked": return "CORS origin blocked";
    case "anki-connect-absent": return "AnkiConnect absent or wrong port";
    case "permission-denied": return "AnkiConnect permission denied";
    case "api-incompatibility": return "AnkiConnect API version mismatch";
    case "anki": return "AnkiConnect returned an error";
    default: return "Network request failed";
  }
}
