import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, RefreshCw, X } from "lucide-react";
import { BROWSER_ENTRY } from "../../lib/landing/entry";
import { fetchDesktopRelease, RELEASES_URL, type DesktopRelease } from "../../lib/landing/releases";

type ReleaseState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; release: DesktopRelease | null };

export function DownloadDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ReleaseState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    void fetchDesktopRelease(controller.signal).then((release) => { if (active) setState({ status: "ready", release }); }).catch((error: unknown) => {
      if (!active) return;
      if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Desktop releases are unavailable right now." });
      else setState({ status: "error", message: "The release service took too long to respond. Try again or open the release page." });
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <dialog ref={dialog} className="landing-download" aria-labelledby="download-title" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <button className="landing-close" onClick={onClose} aria-label="Close downloads"><X size={20} /></button>
    <span className="landing-eyebrow">YOUR DESKTOP. YOUR WORKSPACE.</span>
    <h2 id="download-title">Take AXOM with you.</h2>
    {state.status === "loading" && <p role="status">Checking available desktop installers…</p>}
    {state.status === "error" && <div role="alert"><p>{state.message}</p><button className="landing-link" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}><RefreshCw size={16} /> Try again</button></div>}
    {state.status === "ready" && (state.release ? <>
      <p>{state.release.version}{state.release.prerelease ? " · Preview release" : ""}. Choose the installer for your computer.</p>
      <div className="landing-download-list">{state.release.downloads.map((item) => <a key={item.url} href={item.url}>
        <Download size={19} /><span><strong>{item.platform}</strong><small>{item.name} · {(item.size / 1_000_000).toFixed(1)} MB</small></span><ArrowUpRight size={17} />
      </a>)}</div>
    </> : <p role="status">The next desktop release is being prepared. You can use AXOM in your browser now.</p>)}
    <a className="landing-button landing-button--primary" href={BROWSER_ENTRY}>Launch in Browser <ArrowUpRight size={18} /></a>
    <a className="landing-release-link" href={RELEASES_URL} target="_blank" rel="noreferrer">View releases on GitHub <ArrowUpRight size={14} /></a>
  </dialog>;
}
