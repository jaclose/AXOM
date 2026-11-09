import { lazy, Suspense, useState } from "react";
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, ShieldCheck, UsersRound } from "lucide-react";
import { CommunityUploads } from "../components/questions/CommunityUploads";
import { ICON_SIZE } from "../lib/iconSize";
import { useAccount } from "../lib/account/accountStore";
import "../styles/communities.css";

const CommunityPage = lazy(() => import("./CommunityPage")
  .then((module) => ({ default: module.CommunityPage })));
const PersonalStandings = lazy(() => import("./LeaderboardsPage")
  .then((module) => ({ default: module.LeaderboardsPage })));

type CommunitySpace = "courses" | "circle" | "records";

export function CommunitiesPage({ initialSpace = "circle" }: { initialSpace?: CommunitySpace }) {
  const [space, setSpace] = useState<CommunitySpace>(initialSpace);
  const accountId = useAccount((state) => state.user?.id);

  return <main className="communities-page" aria-labelledby="communities-title">
    <header className="communities-masthead">
      <div className="communities-masthead-copy">
        <span className="communities-kicker"><UsersRound size={ICON_SIZE.body} aria-hidden="true" /> AXOM / TOGETHER</span>
        <h1 id="communities-title">Community</h1>
        <p>Find your people. Share the work, the small wins, and what comes next.</p>
      </div>
      <div className="communities-orb" aria-hidden="true">
        <img src="/icons/axom-orb-512.png" width="72" height="72" alt="" />
      </div>
    </header>

    <div className="communities-switch" role="group" aria-label="Choose a community space">
      <button type="button" className={space === "circle" ? "is-active" : ""}
        aria-pressed={space === "circle"} aria-controls="communities-content"
        onClick={() => setSpace("circle")}>
        <UsersRound size={ICON_SIZE.emphasis} aria-hidden="true" />
        <span><b>Study circle</b><small>Friends, posts, leaderboards</small></span>
      </button>
      <button type="button" className={space === "courses" ? "is-active" : ""}
        aria-pressed={space === "courses"} aria-controls="communities-content"
        onClick={() => setSpace("courses")}>
        <BookOpen size={ICON_SIZE.emphasis} aria-hidden="true" />
        <span><b>Course exchange</b><small>Browse, preview, contribute</small></span>
      </button>
      <button type="button" className={space === "records" ? "is-active" : ""}
        aria-pressed={space === "records"} aria-controls="communities-content"
        onClick={() => setSpace("records")}>
        <ChartNoAxesCombined size={ICON_SIZE.emphasis} aria-hidden="true" />
        <span><b>Personal bests</b><small>Your own pace and progress</small></span>
      </button>
    </div>

    <section id="communities-content" className="communities-content" aria-label={space === "courses" ? "Course exchange" : space === "records" ? "Personal bests" : "Study circle"}>
      {space === "courses" ? <CommunityUploads onOpenLibrary={() => { location.hash = "questions"; }} /> : space === "circle" ?
        <Suspense fallback={<p role="status">Opening your study circle…</p>}><CommunityPage key={accountId ?? "signed-out"} /></Suspense> :
        <Suspense fallback={<p role="status">Opening your study record…</p>}><PersonalStandings /></Suspense>}
    </section>

    {space === "courses" && <aside className="communities-boundary" aria-label="Community boundaries">
      <ShieldCheck size={ICON_SIZE.display} aria-hidden="true" />
      <div><h2>Share with care.</h2><p>Contribute only material you have permission to distribute. Community uploads remain marked Unreviewed until an academic reviewer approves that exact revision.</p></div>
      <a href="#help">Community feedback <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></a>
    </aside>}
  </main>;
}
