import { lazy, Suspense, useState } from "react";
import { ArrowUpRight, BookOpen, ShieldCheck, Trophy, UsersRound } from "lucide-react";
import { CommunityUploads } from "../components/questions/CommunityUploads";
import { GButton, GlassCard, Tag } from "../components/ui/primitives";
import { useAccount } from "../lib/account/accountStore";
import { ICON_SIZE } from "../lib/iconSize";
import { useUi } from "../lib/uiStore";
import "../styles/communities.css";

const SharedDailyLeaderboard = lazy(() => import("../components/tracker/SharedDailyLeaderboard")
  .then((module) => ({ default: module.SharedDailyLeaderboard })));

type CommunitySpace = "courses" | "challenge";

export function CommunitiesPage() {
  const [space, setSpace] = useState<CommunitySpace>("courses");
  const accountPhase = useAccount((state) => state.phase);
  const accountId = useAccount((state) => state.user?.id);

  return <div className="communities-page">
    <header className="communities-masthead">
      <div className="communities-masthead-copy">
        <span className="communities-kicker"><UsersRound size={ICON_SIZE.body} aria-hidden="true" /> AXOM / COMMUNITIES</span>
        <h1>Shared study, with provenance.</h1>
        <p>Explore learner-contributed courses and a daily challenge built from approved questions. Review status is visible before you practice.</p>
        <div className="communities-index" aria-label="Community spaces">
          <span><b>01</b> Course exchange</span>
          <span><b>02</b> Daily challenge</span>
        </div>
      </div>
      <div className="communities-orb" aria-hidden="true">
        <img src="/icons/axom-orb-512.png" width="210" height="210" alt="" />
      </div>
    </header>

    <div className="communities-switch" role="group" aria-label="Choose a community space">
      <button type="button" className={space === "courses" ? "is-active" : ""}
        aria-pressed={space === "courses"} aria-controls="communities-content"
        onClick={() => setSpace("courses")}>
        <BookOpen size={ICON_SIZE.emphasis} aria-hidden="true" />
        <span><b>Course exchange</b><small>Browse, preview, contribute</small></span>
      </button>
      <button type="button" className={space === "challenge" ? "is-active" : ""}
        aria-pressed={space === "challenge"} aria-controls="communities-content"
        onClick={() => setSpace("challenge")}>
        <Trophy size={ICON_SIZE.emphasis} aria-hidden="true" />
        <span><b>Daily challenge</b><small>Answer together, keep your notes private</small></span>
      </button>
    </div>

    <section id="communities-content" className="communities-content" aria-label={space === "courses" ? "Course exchange" : "Daily challenge"}>
      {space === "courses" ? <CommunityUploads onOpenLibrary={() => { location.hash = "questions"; }} /> : <>
        <div className="communities-section-heading">
          <div><span className="communities-kicker">APPROVED QUESTION REVISION</span><h2>One day. One shared field.</h2>
            <p>Join under an alias, answer independently, and compare only verified results. Your answers and notes stay private.</p></div>
          <Tag tone="orange">Work in progress</Tag>
        </div>
        {accountPhase === "loading" ? <p role="status">Checking your account…</p> : accountPhase === "unconfigured" ? <GlassCard pad>
          <h3>Shared challenges are unavailable here</h3>
          <p>This build has no account service. Your personal practice is still available in Question Bank.</p>
          <a className="gbtn sm" href="#questions">Open Question Bank <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></a>
        </GlassCard> : !accountId ? <GlassCard pad>
          <h3>Sign in to join a challenge</h3>
          <p>Participation is optional. Choose an alias before any result appears in shared standings.</p>
          <GButton onClick={() => useUi.getState().requestSettings("account")}>Open account settings</GButton>
        </GlassCard> : <Suspense fallback={<p role="status">Opening today’s challenge…</p>}><SharedDailyLeaderboard /></Suspense>}
      </>}
    </section>

    <aside className="communities-boundary" aria-label="Community boundaries">
      <ShieldCheck size={ICON_SIZE.display} aria-hidden="true" />
      <div><h2>Share with care.</h2><p>Contribute only material you have permission to distribute. Community uploads remain marked Unreviewed until an academic reviewer approves that exact revision.</p></div>
      <a href="#help">Community feedback <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></a>
    </aside>
  </div>;
}
