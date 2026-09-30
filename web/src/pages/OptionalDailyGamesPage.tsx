import { ArrowUpRight, CircleHelp, Gamepad2, Heart, Stethoscope, WholeWord } from "lucide-react";
import { GlassCard, Tag } from "../components/ui/primitives";
import { useStore } from "../lib/store";
import { DOCTORDLE_URL, useDoctordle } from "../lib/doctordle";
import "../styles/ecosystem.css";

const recordDoctordleOpen = () => useDoctordle.getState().recordOpen();

export function OptionalDailyGamesPage() {
  const history = useStore((state) => state.dailyWordPuzzles);
  const completed = history.filter((puzzle) => puzzle.completed).length;
  return (
    <main className="ecosystem-page" aria-labelledby="daily-games-title">
      <header className="ecosystem-hero">
        <Tag tone="purple"><Gamepad2 size={14} /> Play</Tag>
        <h1 id="daily-games-title">Daily Games</h1>
        <p>Short study-break puzzles with an honest boundary between AXOM-owned play and independent destinations.</p>
      </header>
      <section className="game-grid" aria-label="Available games">
        <GameCard icon={<WholeWord />} title="Daily Word" status="LIVE · LOCAL" description="AXOM’s five-letter daily puzzle. Works locally and keeps history on this device." meta={`${completed} completed`} href="#daily-word" />
        <GameCard icon={<Stethoscope />} title="Doctordle" status="LIVE · EXTERNAL" description="Daily diagnosis game operated independently from AXOM. Opens its verified public website in a new tab." meta="Provider controls availability and reset schedule" href={DOCTORDLE_URL} external onOpen={recordDoctordleOpen} />
        <GameCard icon={<CircleHelp />} title="Sweeper" status="DESTINATION REQUIRES CONFIRMATION" description="A Sweeper destination has not been verified. AXOM will not guess or send you to an unconfirmed site." meta="Unavailable" />
      </section>
      <p className="ecosystem-note">External games are not embedded, proxied, or represented as AXOM products. An internet connection may be required.</p>
      <GameCredits />
    </main>
  );
}

/** Thanks and attribution for the people whose work makes these breaks possible. */
export function GameCredits() {
  return (
    <GlassCard pad className="game-credits" aria-labelledby="game-credits-title">
      <div className="game-credits-head">
        <Heart size={18} aria-hidden="true" />
        <h2 id="game-credits-title">Credits &amp; thanks</h2>
      </div>
      <ul>
        <li>
          <b>Doctordle</b> — thank you to the independent Doctordle team for a genuinely useful daily diagnosis game for medical learners.
          AXOM simply links to <a href={DOCTORDLE_URL} target="_blank" rel="noopener noreferrer" onClick={recordDoctordleOpen}>doctordle.org</a>; we are not affiliated
          and do not use their content. We’d love to explore a collaboration in the future — until then, this link is the whole integration.
        </li>
        <li>
          <b>Daily Word dictionary</b> — word lists derived from SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson and contributors,
          used under its permissive license (<a href="./third-party/DAILY_WORD_SCOWL_LICENSE.txt" target="_blank" rel="noopener noreferrer">license text</a>).
        </li>
        <li>
          <b>The five-letter daily format</b> — popularized by Josh Wardle’s Wordle. AXOM Daily Word is an original implementation with its own
          word list, rules text, and design; it is not affiliated with Wordle or its publisher.
        </li>
      </ul>
    </GlassCard>
  );
}

function GameCard({ icon, title, status, description, meta, href, external, onOpen }: { icon: React.ReactNode; title: string; status: string; description: string; meta: string; href?: string; external?: boolean; onOpen?: () => void }) {
  return <GlassCard pad className="game-card">
    <div className="game-card__icon" aria-hidden="true">{icon}</div>
    <div className="game-card__status">{status}</div>
    <h2>{title}</h2><p>{description}</p><small>{meta}</small>
    {href ? <a className="gbtn primary game-card__action" href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} onClick={onOpen}>{external ? "Open verified site" : "Play now"}<ArrowUpRight size={16} /></a> : <span className="game-card__disabled" aria-disabled="true">Not available yet</span>}
  </GlassCard>;
}
