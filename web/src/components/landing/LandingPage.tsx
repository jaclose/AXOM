import { useRef, useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { AxomWordmark } from "../ui/BrandMark";
import { ICON_SIZE } from "../../lib/iconSize";
import { ACCOUNT_ENTRY, BROWSER_ENTRY } from "../../lib/landing/entry";
import { LandingFilm } from "./LandingFilm";
import { DownloadDialog } from "./DownloadDialog";
import "../../styles/landing.css";
import "../../styles/landing-alpha.css";

export default function LandingPage() {
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const downloadButton = useRef<HTMLButtonElement>(null);
  return <div className="landing-page landing-page--cinematic">
    <a className="landing-skip" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand" href="/" aria-label="AXOM home">
        <img className="landing-orb" src="/icons/axom-orb-512.png" width="32" height="32" alt="" />
        <AxomWordmark />
      </a>
      <nav aria-label="Main navigation">
        <a className="landing-signin" href={ACCOUNT_ENTRY}>Sign In</a>
        <a className="landing-open" href={BROWSER_ENTRY}>Open AXOM <ArrowUpRight size={ICON_SIZE.emphasis} aria-hidden="true" /></a>
      </nav>
    </header>
    <main className="landing-cinematic-main" id="main-content" tabIndex={-1}>
      <h1 className="landing-visually-hidden">AXOM. A private academic operating system.</h1>
      <p className="landing-visually-hidden">A fictional demonstration workspace: start a focus timer, record a lecture pass, select and check an answer, log study work, and write a private reflection. The timer counts three, two, one, then switches to Break. The AXOM identity appears before the film returns to the Dashboard. Open AXOM is available throughout.</p>
      <LandingFilm suspended={downloadsOpen} />
    </main>
    <footer className="landing-footer">
      <button ref={downloadButton} type="button" className="landing-download-trigger" onClick={() => setDownloadsOpen(true)}>
        <Download size={ICON_SIZE.body} aria-hidden="true" /> Download for Desktop
      </button>
    </footer>
    {downloadsOpen && <DownloadDialog onClose={() => { setDownloadsOpen(false); requestAnimationFrame(() => downloadButton.current?.focus()); }} />}
  </div>;
}
