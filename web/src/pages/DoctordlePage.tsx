import { ArrowUpRight, Globe2, Heart, ShieldCheck } from "lucide-react";
import { GlassCard, Tag } from "../components/ui/primitives";
import { DOCTORDLE_URL } from "./OptionalDailyGamesPage";
import "../styles/ecosystem.css";

export function DoctordlePage() {
  return <main className="ecosystem-page" aria-labelledby="doctordle-title"><GlassCard pad className="external-game-bridge">
    <Tag tone="green"><Globe2 size={14} /> Verified external destination</Tag>
    <h1 id="doctordle-title">Doctordle</h1>
    <p>Play the independent daily diagnosis game on its verified public website. AXOM does not embed the game, inspect your answers, or claim affiliation.</p>
    <div className="ecosystem-note"><ShieldCheck size={18} /> The provider controls its content, availability, privacy practices, and reset schedule.</div>
    <div className="doctordle-thanks">
      <Heart size={16} aria-hidden="true" />
      <p>
        <b>With thanks to the Doctordle creators.</b> Their game makes daily diagnostic reasoning fun — go support it at the source.
        AXOM and Doctordle are independent today; a future collaboration is something we’d welcome, and this page will say so plainly if it ever happens.
      </p>
    </div>
    <a className="gbtn primary" href={DOCTORDLE_URL} target="_blank" rel="noopener noreferrer">Open doctordle.org <ArrowUpRight size={16} /></a>
    <a href="#daily-games">Back to Daily Games</a>
  </GlassCard></main>;
}
