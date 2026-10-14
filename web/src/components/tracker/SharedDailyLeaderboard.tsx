import { useEffect, useState } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useStore } from "../../lib/store";
import { STORAGE_KEYS } from "../../lib/brand";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { challengeStandings, joinChallenge, listDailyChallenges, matchChallengeQuestions, type DailyChallenge, type DailyStandings } from "../../lib/academicLibrary/challenges";
import { observeChallengeRun, prepareChallengeRun, readChallengeRun, verifyChallengeRun, type ChallengeRunIntent } from "../../lib/academicLibrary/challengeRun";
import { openAcademicCourse } from "../../lib/academicLibrary/navigation";
import { ExamRunner } from "../questions/ExamRunner";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import "../../styles/daily-leaderboard.css";

export function SharedDailyLeaderboard() {
  const accountId = useAccount(state => state.user?.id);
  return accountId ? <DailyBoard key={accountId} accountId={accountId} /> : <GlassCard pad><PanelHeader headingLevel={2} title="Daily challenge" sub="Sign in to see approved challenges and shared daily standings." /></GlassCard>;
}
function DailyBoard({ accountId }: { accountId: string }) {
  const [challenges,setChallenges] = useState<DailyChallenge[]>([]);
  const [selected,setSelected] = useState("");
  const [alias,setAlias] = useState("");
  const [standings,setStandings] = useState<DailyStandings>();
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [refresh,setRefresh] = useState(0);
  const [run,setRun] = useState<ChallengeRunIntent>();
  const [runner,setRunner] = useState<ChallengeRunIntent>();
  const [automaticRunId,setAutomaticRunId] = useState<string>();
  const [runLoading,setRunLoading] = useState(true);
  const [showRunner,setShowRunner] = useState(false);
  const challenge = challenges.find(item => item.id===selected) ?? challenges[0];
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void listDailyChallenges(accountId).then(items => { if (!cancelled) setChallenges(items); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Challenges are unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled=true; };
  },[accountId,refresh]);
  useEffect(() => {
    if (!challenge) { setStandings(undefined); return; }
    let cancelled=false;
    setStandings(undefined);
    void challengeStandings(accountId,challenge.id).then(value => { if (!cancelled) setStandings(value); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Standings are unavailable."); });
    return () => { cancelled=true; };
  },[accountId,challenge,refresh]);
  useEffect(() => { setAlias(challenge?.participation?.alias ?? ""); },[challenge?.id,challenge?.participation?.alias]);
  useEffect(() => {
    const timer=window.setInterval(() => { if (!document.hidden && !showRunner && !busy) setRefresh(value => value+1); },60_000);
    return () => window.clearInterval(timer);
  },[showRunner,busy]);
  const challengeId = challenge?.id;
  useEffect(() => {
    let cancelled = false;
    setRun(undefined); setRunLoading(true);
    if (!challengeId) { setRunLoading(false); return; }
    void readChallengeRun(accountId, challengeId).then(value => { if (!cancelled) setRun(value); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Saved challenge unavailable."); })
      .finally(() => { if (!cancelled) setRunLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, challengeId, refresh]);
  useEffect(() => {
    if (!run || automaticRunId !== run.sessionId) return;
    return observeChallengeRun(run,setMessage,() => setRefresh(value => value+1),() => { setRun(undefined); setAutomaticRunId(undefined); },setBusy);
  },[run,automaticRunId]);
  const completedRun = useStore(state => run ? state.quizSessions.some(session => session.id === run.sessionId) : false);
  async function retryVerification() {
    if (!run || busy) return;
    setBusy(true); setError(""); setMessage("Checking saved answers with the server…");
    try {
      const checked = await verifyChallengeRun(run);
      setMessage(`${checked} answers checked by the server. Repeated questions earn no additional points.`);
      setRun(undefined); setRefresh(value => value+1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verification remains pending."); }
    finally { setBusy(false); }
  }
  function resume() {
    if (!run || !challenge) return;
    try {
      const active = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null") as { runId?: string } | null;
      if (active?.runId && active.runId !== run.sessionId) throw new Error("Resume or finish your other quiz in Question Bank first.");
      if (run.revisionId !== challenge.revisionId) throw new Error("This challenge revision changed. Your personal results remain saved.");
      matchChallengeQuestions(challenge,useStore.getState().questions);
      setRunner(run); setAutomaticRunId(run.sessionId); setShowRunner(true); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This challenge cannot resume yet."); }
  }
  async function participate(visible: boolean) {
    if (!challenge || busy) return;
    const scope=academicAccountScope(accountId);
    setBusy(true); setError("");
    try { await joinChallenge(accountId,challenge.id,alias,visible); scope.assertCurrent(); setMessage(visible ? "You are participating under your chosen alias." : "You are hidden from this challenge. Your personal results are preserved."); setRefresh(value => value+1); }
    catch(cause) { setError(cause instanceof Error ? cause.message : "Participation could not be saved."); }
    finally { scope.dispose(); setBusy(false); }
  }
  async function start() {
    if (!challenge || busy) return;
    const scope=academicAccountScope(accountId);
    setBusy(true); setError("");
    try {
      const active=JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null") as { poolIds?: unknown[] } | null;
      if (active?.poolIds?.length) throw new Error("Resume or finish your current quiz in Question Bank first.");
      const mapping=matchChallengeQuestions(challenge,useStore.getState().questions);
      // Recheck participation online at the start; the server also checks it
      // when answers arrive. No local score is ever submitted.
      await joinChallenge(accountId,challenge.id,alias,true); scope.assertCurrent();
      const prepared = await prepareChallengeRun(accountId, challenge, mapping);
      scope.assertCurrent();
      setRun(prepared); setRunner(prepared); setAutomaticRunId(prepared.sessionId);
      setShowRunner(true); setMessage("");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "The daily challenge could not start."); }
    finally { scope.dispose(); setBusy(false); }
  }
  function openCourse() {
    if (!challenge) return;
    openAcademicCourse(challenge.collectionId);
  }
  return <GlassCard pad className="daily-board">
    <PanelHeader headingLevel={2} title="Daily challenge" sub="The same reviewed questions. Independent answers. Real shared standings."
      action={<GButton onClick={() => setRefresh(value => value+1)} disabled={loading || busy}><RefreshCw size={16} /> Refresh</GButton>} />
    {run && run.challengeId === challenge?.id && !showRunner && <div className="daily-board-pending" role="region" aria-label="Saved daily challenge">
      <p>{completedRun ? "Your saved daily answers are waiting for verification. Retrying cannot add duplicate points." : "Your daily challenge is saved on this device. Continue with the same questions."}</p>
      <GButton variant="primary" disabled={busy || runLoading} onClick={completedRun ? () => void retryVerification() : resume}>{completedRun ? "Retry verification" : "Continue daily challenge"}</GButton>
    </div>}
    {loading && !challenges.length && <p role="status">Loading today’s challenges…</p>}
    {!loading && !challenges.length && !error && <p>No approved challenge is scheduled for your courses today. Your personal practice remains available below.</p>}
    {challenge && <>
      <div className="daily-board-controls">
        <label>Module<select value={challenge.id} disabled={busy || showRunner} onChange={event => { setSelected(event.target.value); setAutomaticRunId(undefined); setError(""); setMessage(""); }}>
          {challenges.map(item => <option key={item.id} value={item.id}>{item.module} · {item.questionCount} questions</option>)}
        </select></label>
        <p>{challenge.day} · 00:00–24:00 UTC<br />{challenge.questionCount} questions in a fixed source revision</p>
      </div>
      {standings && <div className="daily-board-standings" aria-live="polite">
        <h3><Trophy size={18} aria-hidden="true" /> Today’s standings <span>{standings.participants} participants</span></h3>
        {standings.rows.length ? <table><caption className="sr-only">Verified daily challenge standings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Learner</th><th scope="col">Points</th><th scope="col">Answered</th></tr></thead><tbody>
          {standings.rows.map((row,index) => <tr key={`${row.alias}:${index}`} className={row.you ? "daily-board-you" : ""}><td>{row.rank}</td><th scope="row">{row.alias}{row.you ? " · you" : ""}</th><td>{row.points}</td><td>{row.answered}/{challenge.questionCount}</td></tr>)}
        </tbody></table> : <p>No participants yet. Choose an alias to join.</p>}
        {standings.yourRank && <p>Your rank: {standings.yourRank}. Standings refresh each minute and after verified answers.</p>}
      </div>}
      <p className="sub">One point per correct, unassisted first challenge answer. A canonical question earns points only once across challenges. Ties share a rank. Ordinary practice stays personal. Offline or interrupted submissions remain unverified until you explicitly retry and the server accepts them.</p>
      <div className="daily-board-controls">
        <label>Display alias<input value={alias} minLength={2} maxLength={32} disabled={busy || showRunner} onChange={event => setAlias(event.target.value)} autoComplete="off" /></label>
        <GButton disabled={busy || showRunner || alias.trim().length<2} onClick={() => void participate(true)}>{challenge.participation?.visible ? "Save alias" : "Participate today"}</GButton>
        {challenge.participation?.visible && <GButton disabled={busy || showRunner} onClick={() => void participate(false)}>Hide my participation</GButton>}
      </div>
      <p className="sub">Only your alias and aggregate score are shared. Your answers and notes stay private. Participation applies to this module’s challenge today.</p>
      <div className="row wrap gap8">{!run && <GButton disabled={busy || runLoading || !challenge.participation?.visible || showRunner} onClick={() => void start()}>Start daily challenge</GButton>}<GButton onClick={openCourse} disabled={showRunner}>Open course</GButton></div>

    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {showRunner && runner && <ExamRunner mode="exam" sessionId={runner.sessionId} retakeIds={runner.keys.map(([id]) => id)} onClose={() => setShowRunner(false)} />}
  </GlassCard>;
}
