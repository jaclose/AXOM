import { useEffect, useMemo, useState } from "react";
import { Flame, Medal, RefreshCw, Trophy } from "lucide-react";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import { isoDate } from "../../lib/scoring";
import { addDays, formatBoardValue, progressBoard, type BoardMetric, type BoardScope } from "../../lib/community/progressBoard";
import type { ProgressBoardData } from "../../lib/community/community";
import { CommunityAvatar, CommunityPersonButton } from "./CommunityIdentity";
import "../../styles/community.css";

const METRICS: Array<{ id: BoardMetric; label: string }> = [
  { id: "minutes", label: "Study time" }, { id: "questions", label: "Questions" }, { id: "cards", label: "Cards" },
];
const SCOPES: Array<{ id: BoardScope; label: string }> = [{ id: "friends", label: "Friends" }, { id: "community", label: "Community" }];
const PERIODS = [7, 30] as const;
const LOADED_DAYS = 30;

/** Shared daily totals ranked among friends or across Community. Every number
 * here was shared on purpose by its owner; private days never count. */
export function CommunityLeaderboard({ accountId, refreshKey = 0, headingLevel = 2, onOpenProfile }: {
  accountId: string; refreshKey?: number; headingLevel?: 2 | 3; onOpenProfile?: (id: string) => void;
}) {
  const [scope, setScope] = useState<BoardScope>("friends");
  const [metric, setMetric] = useState<BoardMetric>("minutes");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(7);
  const [visibleCount, setVisibleCount] = useState(10);
  const [result, setResult] = useState<{ accountId: string; data: ProgressBoardData }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const today = isoDate(new Date());
  const data = result?.accountId === accountId ? result.data : undefined;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void import("../../lib/community/community")
      .then(module => module.loadProgressBoard(accountId, addDays(today, -(LOADED_DAYS - 1))))
      .then(value => { if (active) setResult({ accountId, data: value }); })
      .catch(cause => { if (active) { setResult(undefined); setError(cause instanceof Error ? cause.message : "Leaderboards could not be loaded."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, today, refreshKey, retry]);

  const friendIds = useMemo(() => new Set(data?.friendIds ?? []), [data]);
  const profiles = useMemo(() => new Map(data?.profiles.map(profile => [profile.user_id, profile]) ?? []), [data]);
  const rows = useMemo(() => {
    if (!data || (scope === "friends" && data.connectionsError)) return [];
    // RLS can return a hidden friend's Community-audience posts through the
    // friendship permission. Those rows belong only on this viewer's Friends
    // board; public standings must have the same eligibility for every viewer.
    const eligible = scope === "community" ? data.posts.filter(post => profiles.get(post.user_id)?.discoverable === true) : data.posts;
    return progressBoard(eligible, { scope, metric, periodDays: period, today, me: accountId, friendIds });
  }, [data, profiles, scope, metric, period, today, accountId, friendIds]);
  const max = Math.max(1, ...rows.map(row => row[metric]));
  const mine = rows.find(row => row.userId === accountId);
  const scopeLabel = scope === "friends" ? "Friends" : "Community";
  const metricLabel = METRICS.find(item => item.id === metric)!.label;

  return <GlassCard pad className="community-board-card">
    <PanelHeader headingLevel={headingLevel} title="Leaderboard"
      sub={`Shared study, last ${period} days.`}
      action={mine ? <span className="community-board-you">You: #{mine.rank} of {rows.length}</span> : undefined} />
    <div className="community-board-controls">
      <div className="community-segment" role="group" aria-label="Who to compare">
        {SCOPES.map(item => <button key={item.id} type="button" aria-pressed={scope === item.id} className={scope === item.id ? "on" : ""} onClick={() => { setScope(item.id); setVisibleCount(10); }}>{item.label}</button>)}
      </div>
      <div className="community-segment" role="group" aria-label="Period">
        {PERIODS.map(days => <button key={days} type="button" aria-pressed={period === days} className={period === days ? "on" : ""} onClick={() => { setPeriod(days); setVisibleCount(10); }}>{days} days</button>)}
      </div>
    </div>
    <div className="community-board-metrics" role="group" aria-label="Rank by">
      {METRICS.map(item => <button key={item.id} type="button" aria-pressed={metric === item.id} className={`filter-pill ${metric === item.id ? "on" : ""}`} onClick={() => { setMetric(item.id); setVisibleCount(10); }}>{item.label}</button>)}
    </div>
    {loading && !data && <p role="status" className="sub">Loading shared study…</p>}
    {error && <div role="alert" className="community-error"><p>{error}</p><GButton size="sm" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Retry leaderboard</GButton></div>}
    {data && !data.me && <p className="sub">Join Community to appear here. You can still see what others share with everyone.</p>}
    {data && scope === "friends" && data.connectionsError && <p role="alert" className="sub">{data.connectionsError}</p>}
    {data && rows.length === 0 && !(scope === "friends" && data.connectionsError) && <p className="sub">{scope === "friends"
      ? `No shared study from you or your friends in the last ${period} days. You can share a day from the composer or choose automatic sharing in account settings.`
      : `Nobody has shared study with all of Community in the last ${period} days.`}</p>}
    {rows.length > 0 && <ol className="community-board" aria-label={`${scopeLabel} leaderboard by ${metricLabel.toLowerCase()}, last ${period} days`}>
      {rows.slice(0, visibleCount).map(row => {
        const profile = profiles.get(row.userId);
        const you = row.userId === accountId;
        const name = you ? "You" : profile?.display_name ?? "Learner";
        const person = <><b>{name}</b><small>{profile ? `@${profile.handle}` : "Shared study"}{row.streak > 1 && <> · <Flame size={12} aria-hidden="true" /> {row.streak >= LOADED_DAYS ? `${LOADED_DAYS}+` : row.streak}-day shared streak</>}</small></>;
        return <li key={row.userId} className={`community-board-row${you ? " you" : ""}`}>
          <span className={`community-board-rank rank-${Math.min(row.rank, 4)}`} aria-label={`Rank ${row.rank}`}>
            {row.rank <= 3 ? <Medal size={14} aria-hidden="true" /> : null}{row.rank}
          </span>
          <CommunityAvatar name={profile?.display_name ?? name} />
          {onOpenProfile ? <CommunityPersonButton className="community-board-name" profile={profile} name={name} avatar={false}
            onClick={() => onOpenProfile(row.userId)} /> : <span className="community-board-name">{person}</span>}
          <span className="community-board-value">
            <strong>{formatBoardValue(row[metric], metric)}</strong>
            <small>{row.today ? `Today ${formatBoardValue(row.today[metric], metric)}` : `Last shared ${row.lastDay}`}</small>
          </span>
          <span className="community-board-track" aria-hidden="true"><i style={{ width: `${(row[metric] / max) * 100}%` }} /></span>
          <small className="community-board-detail">{row.days} {row.days === 1 ? "day" : "days"} shared · {formatBoardValue(row.minutes, "minutes")} · {formatBoardValue(row.questions, "questions")} · {formatBoardValue(row.cards, "cards")}</small>
        </li>;
      })}
    </ol>}
    {rows.length > visibleCount && <GButton size="sm" className="community-board-more" onClick={() => setVisibleCount(value => value + 10)}>
      Show {Math.min(10, rows.length - visibleCount)} more rankings</GButton>}
    <details className="community-board-note"><summary><Trophy size={14} aria-hidden="true" /> How these standings work</summary>
      <p className="sub">Self-shared daily totals, not independently verified. Equal totals share a rank. Days kept as "Only me" never count. Shared streaks use the last 30 days visible to you. Daily Challenges keep separate server-checked standings.</p>
    </details>
  </GlassCard>;
}
