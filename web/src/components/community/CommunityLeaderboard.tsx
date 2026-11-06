import { useEffect, useMemo, useState } from "react";
import { Flame, Medal, RefreshCw, Trophy } from "lucide-react";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import { isoDate } from "../../lib/scoring";
import { addDays, formatBoardValue, progressBoard, type BoardMetric, type BoardScope } from "../../lib/community/progressBoard";
import type { ProgressBoardData } from "../../lib/community/community";
import "../../styles/community.css";

const METRICS: Array<{ id: BoardMetric; label: string }> = [
  { id: "minutes", label: "Study time" }, { id: "questions", label: "Questions" }, { id: "cards", label: "Cards" },
];
const SCOPES: Array<{ id: BoardScope; label: string }> = [{ id: "friends", label: "Friends" }, { id: "community", label: "Community" }];
const PERIODS = [7, 30] as const;
const LOADED_DAYS = 30;

function initials(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).map(word => word.slice(0, 1).toUpperCase()).join("") || "?";
}

/** Shared daily totals ranked among friends or across Community. Every number
 * here was shared on purpose by its owner; private days never count. */
export function CommunityLeaderboard({ accountId, refreshKey = 0, headingLevel = 2 }: {
  accountId: string; refreshKey?: number; headingLevel?: 2 | 3;
}) {
  const [scope, setScope] = useState<BoardScope>("friends");
  const [metric, setMetric] = useState<BoardMetric>("minutes");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(7);
  const [data, setData] = useState<ProgressBoardData>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const today = isoDate(new Date());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void import("../../lib/community/community")
      .then(module => module.loadProgressBoard(accountId, addDays(today, -(LOADED_DAYS - 1))))
      .then(result => { if (active) setData(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Leaderboards could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, today, refreshKey, retry]);

  const friendIds = useMemo(() => new Set(data?.friendIds ?? []), [data]);
  const profiles = useMemo(() => new Map(data?.profiles.map(profile => [profile.user_id, profile]) ?? []), [data]);
  const rows = useMemo(() => data ? progressBoard(data.posts, { scope, metric, periodDays: period, today, me: accountId, friendIds }) : [],
    [data, scope, metric, period, today, accountId, friendIds]);
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
        {SCOPES.map(item => <button key={item.id} type="button" aria-pressed={scope === item.id} className={scope === item.id ? "on" : ""} onClick={() => setScope(item.id)}>{item.label}</button>)}
      </div>
      <div className="community-segment" role="group" aria-label="Period">
        {PERIODS.map(days => <button key={days} type="button" aria-pressed={period === days} className={period === days ? "on" : ""} onClick={() => setPeriod(days)}>{days} days</button>)}
      </div>
    </div>
    <div className="community-board-metrics" role="group" aria-label="Rank by">
      {METRICS.map(item => <button key={item.id} type="button" aria-pressed={metric === item.id} className={`filter-pill ${metric === item.id ? "on" : ""}`} onClick={() => setMetric(item.id)}>{item.label}</button>)}
    </div>
    {loading && !data && <p role="status" className="sub">Loading shared study…</p>}
    {error && <div role="alert" className="community-error"><p>{error}</p><GButton size="sm" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Retry leaderboard</GButton></div>}
    {data && !data.me && <p className="sub">Join Community to appear here. You can still see what others share with everyone.</p>}
    {data && scope === "friends" && data.connectionsError && <p role="alert" className="sub">{data.connectionsError}</p>}
    {data && rows.length === 0 && <p className="sub">{scope === "friends"
      ? `No shared study from you or your friends in the last ${period} days. Turn on automatic sharing so your circle sees your days.`
      : `Nobody has shared study with all of Community in the last ${period} days.`}</p>}
    {rows.length > 0 && <ol className="community-board" aria-label={`${scopeLabel} leaderboard by ${metricLabel.toLowerCase()}, last ${period} days`}>
      {rows.map(row => {
        const profile = profiles.get(row.userId);
        const you = row.userId === accountId;
        const name = you ? "You" : profile?.display_name ?? "Learner";
        return <li key={row.userId} className={`community-board-row${you ? " you" : ""}`}>
          <span className={`community-board-rank rank-${Math.min(row.rank, 4)}`} aria-label={`Rank ${row.rank}`}>
            {row.rank <= 3 ? <Medal size={14} aria-hidden="true" /> : null}{row.rank}
          </span>
          <span className="community-avatar" aria-hidden="true">{initials(profile?.display_name ?? name)}</span>
          <span className="community-board-name">
            <b>{name}</b>
            <small>{profile ? `@${profile.handle}` : "Shared study"}{row.streak > 1 && <> · <Flame size={12} aria-hidden="true" /> {row.streak}-day streak</>}</small>
          </span>
          <span className="community-board-value">
            <strong>{formatBoardValue(row[metric], metric)}</strong>
            <small>{row.today ? `Today ${formatBoardValue(row.today[metric], metric)}` : `Last shared ${row.lastDay}`}</small>
          </span>
          <span className="community-board-track" aria-hidden="true"><i style={{ width: `${(row[metric] / max) * 100}%` }} /></span>
          <small className="community-board-detail">{row.days} {row.days === 1 ? "day" : "days"} shared · {formatBoardValue(row.minutes, "minutes")} · {formatBoardValue(row.questions, "questions")} · {formatBoardValue(row.cards, "cards")}</small>
        </li>;
      })}
    </ol>}
    <p className="sub community-board-note"><Trophy size={14} aria-hidden="true" /> Self-shared daily totals, not independently verified. Days kept as "Only me" never count. Daily Challenges keep separate server-checked standings.</p>
  </GlassCard>;
}
