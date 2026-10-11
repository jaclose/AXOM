import { useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Download } from "lucide-react";
import { AxomMark, AxomWordmark } from "../ui/BrandMark";
import { ACCOUNT_ENTRY, BROWSER_ENTRY } from "../../lib/landing/entry";
import { LandingFilm } from "./LandingFilm";
import { DownloadDialog } from "./DownloadDialog";
import "../../styles/landing.css";

export default function LandingPage() {
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const downloadButton = useRef<HTMLButtonElement>(null);
  return <div className="landing-page">
    <a className="landing-skip" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <LandingFilm />
    <header className="landing-header">
      <a className="landing-brand" href="/" aria-label="AXOM home"><AxomMark size={30} finish="metal" /><AxomWordmark /></a>
      <nav aria-label="Main navigation"><a href={BROWSER_ENTRY}>Open AXOM <ArrowUpRight size={15} /></a><a className="landing-signin" href={ACCOUNT_ENTRY}>Sign In <ArrowRight size={15} /></a></nav>
    </header>
    <main className="landing-main" id="main-content" tabIndex={-1}>
      <div className="landing-copy">
        <p className="landing-eyebrow"><span /> PRIVATE ACADEMIC OPERATING SYSTEM</p>
        <h1>A mind at work.<br /><span>A world in order.</span></h1>
        <p className="landing-description">Your courses, questions, and progress.<br />Connected in one quiet place.</p>
        <div className="landing-actions">
          <button ref={downloadButton} className="landing-button landing-button--primary" onClick={() => setDownloadsOpen(true)}><Download size={17} /> Download for Desktop</button>
          <a className="landing-button landing-button--secondary" href={BROWSER_ENTRY}>Launch in Browser <ArrowUpRight size={18} /></a>
        </div>
        <p className="landing-note">Start locally. Add an account when you’re ready.</p>
      </div>
    </main>
    <footer className="landing-footer"><p>Built for the way you learn.</p><span>COURSES <i /> PRACTICE <i /> PROGRESS</span></footer>
    {downloadsOpen && <DownloadDialog onClose={() => { setDownloadsOpen(false); requestAnimationFrame(() => downloadButton.current?.focus()); }} />}
  </div>;
}
