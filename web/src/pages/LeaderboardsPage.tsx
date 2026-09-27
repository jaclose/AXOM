import { useMemo, useState } from "react";
import { Award, CalendarDays, Crown, Flame, Lock, Medal, TrendingUp, Trophy, Users, Zap } from "lucide-react";
import { GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { useStore } from "../lib/store";
import {
  bestDay,
  longestActiveStreak,
  personalActivityWeeks,
  rankPersonalWeeks,
  weekPace,
  type PersonalBoardMetric,
  type WeekPace,
} from "../lib/leaderboards";
import { isoDate } from "../lib/scoring";
import { ICON_SIZE } from "../lib/iconSize";
import { useAccount } from "../lib/account/accountStore";

const BOARDS: Array<{ id: PersonalBoardMetric; label: string }> = [
  { id: "activeDays", label: "Study days" }, { id: "cards", label: "Logged cards" }, { id: "minutes", label: "Study time" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatValue(amount: number, metric: PersonalBoardMetric, compact = false) {
  if (metric === "minutes") {
    if (!compact && amount < 90) return `${Math.round(amount)} min`;
    const hours = amount / 60;
    return compact ? `${hours >= 10 ? Math.round(hours) : Number(hours.toFixed(1))}h` : `${Number(hours.toFixed(1))} hours`;
  }
  const rounded = metric === "activeDays" ? Math.round(amount * 10) / 10 : Math.round(amount);
  return compact ? rounded.toLocaleString() : `${rounded.toLocaleString()} ${metric === "cards" ? "cards" : rounded === 1 ? "day" : "days"}`;
}

function paceHeadline(pace: WeekPace): { title: string; body: string } {
  const metric = pace.metric;
  if (pace.status === "no-history") {
    return { title: "Your first week is the baseline", body: "Finish this week and AXOM will race every future week against it." };
  }
  const gap = Math.abs(pace.current - pace.typicalSoFar);
  if (pace.status === "ahead") {
    return {
      title: pace.projectedRank === 1 ? "On track for your best week yet" : "Ahead of your usual pace",
      body: `${formatValue(gap, metric)} ahead of where a typical week is by ${WEEKDAYS[pace.elapsedDays - 1]}. Projected: ${formatValue(pace.projected, metric)}.`,
    };
  }
  if (pace.status === "on-track") {
    return {
      title: "Right on your usual pace",
      body: `Keep today normal and this lands near your average week (${formatValue(pace.typicalWeek, metric)}).`,
    };
  }
  return {
    title: "Behind your usual pace — still very catchable",
    body: `${formatValue(gap, metric)} behind a typical week by ${WEEKDAYS[pace.elapsedDays - 1]}. One solid block today closes most of it.`,
  };
}

/** What it takes to set a new personal record this week, in plain words. */
export function beatYourBestMessage(pace: WeekPace): { done: boolean; text: string } | null {
  if (!pace.best || pace.neededPerDayToBeatBest === null) return null;
  if (pace.neededPerDayToBeatBest === 0) return { done: true, text: "You’ve already beaten your best week. Anything more is a new record." };
  const remaining = 7 - pace.elapsedDays + 1;
  const dayWord = (count: number) => `${count} day${count === 1 ? "" : "s"}`;
  if (pace.metric === "activeDays") {
    const needed = Math.max(0, pace.best.activeDays + 1 - pace.current);
    return needed > remaining
      ? { done: false, text: `Your best week (${dayWord(pace.best.activeDays)}) is out of reach this week — matching your usual pace is still a strong week.` }
      : { done: false, text: `To beat your best week: study on ${needed} of the next ${dayWord(remaining)}.` };
  }
  return { done: false, text: `To beat your best week: about ${formatValue(pace.neededPerDayToBeatBest, pace.metric)} per day for the next ${dayWord(remaining)}.` };
}

function BeatYourBest({ pace }: { pace: WeekPace }) {
  const message = beatYourBestMessage(pace);
  if (!message) return null;
  return (
    <div className={`lb-beat ${message.done ? "done" : ""}`}>
      {message.done ? <Crown size={ICON_SIZE.body} aria-hidden="true" /> : <Zap size={ICON_SIZE.body} aria-hidden="true" />}
      <span>{message.text}</span>
    </div>
  );
}

export function LeaderboardsPage() {
  const logs = useStore((s) => s.logs);
  const accountPhase = useAccount((s) => s.phase);
  const [metric, setMetric] = useState<PersonalBoardMetric>("activeDays");
  const today = isoDate(new Date());
  const now = useMemo(() => new Date(`${today}T12:00:00`), [today]);
  const weeks = useMemo(() => personalActivityWeeks(logs, now), [logs, now]);
  const ranked = useMemo(() => rankPersonalWeeks(weeks, metric), [weeks, metric]);
  const pace = useMemo(() => weekPace(logs, metric, now), [logs, metric, now]);
  const longest = useMemo(() => longestActiveStreak(logs, now), [logs, now]);
  const bestMinutesDay = useMemo(() => bestDay(logs, "minutes", now), [logs, now]);
  const current = weeks[0];
  const headline = paceHeadline(pace);
  const maxRanked = Math.max(1, ...ranked.map((week) => week[metric]));
  const raceMax = Math.max(1, pace.series.best.at(-1) ?? 0, pace.series.typical.at(-1) ?? 0, pace.series.you.at(-1) ?? 0);

  return (
    <div className="lb-page">
      <GlassCard pad className="lb-hero">
        <div className="lb-hero-head">
          <span className="lb-hero-icon"><Trophy size={ICON_SIZE.control} aria-hidden="true" /></span>
          <div className="grow">
            <span className="lb-kicker">Race your past self</span>
            <h2>{headline.title}</h2>
            <p>{headline.body}</p>
          </div>
          <Tag tone="cyan">Personal standings</Tag>
        </div>
        <div className="lb-tabs" role="group" aria-label="Leaderboard measure">
          {BOARDS.map((board) => (
            <button type="button" key={board.id} className={`filter-pill ${metric === board.id ? "on" : ""}`} aria-pressed={metric === board.id} onClick={() => setMetric(board.id)}>{board.label}</button>
          ))}
        </div>

        <div className="lb-race" aria-label="This week compared with your typical and best weeks">
          {([
            { key: "you", label: "You, this week", value: pace.current, tone: "you", note: `${pace.elapsedDays} of 7 days in` },
            { key: "typical", label: "Your typical week, by today", value: pace.typicalSoFar, tone: "typical", note: `full week ≈ ${formatValue(pace.typicalWeek, metric)}` },
            { key: "best", label: "Your best week, by today", value: pace.series.best[pace.elapsedDays - 1] ?? 0, tone: "best", note: pace.best ? `full week ${formatValue(pace.best[metric], metric)} · ${pace.best.start}` : "no completed weeks yet" },
          ] as const).map((lane) => (
            <div className={`lb-lane ${lane.tone}`} key={lane.key}>
              <div className="lb-lane-label"><b>{lane.label}</b><small>{lane.note}</small></div>
              <div className="lb-lane-track">
                <i style={{ width: `${Math.min(100, (lane.value / raceMax) * 100)}%` }} />
                <span className="lb-lane-value">{formatValue(lane.value, metric)}</span>
              </div>
            </div>
          ))}
        </div>

        {pace.best && pace.neededPerDayToBeatBest !== null && <BeatYourBest pace={pace} />}
      </GlassCard>

      <div className="lb-stat-strip">
        <div className="lb-stat"><CalendarDays size={ICON_SIZE.emphasis} aria-hidden="true" /><div><b>{current.activeDays}/7</b><span>study days this week</span></div></div>
        <div className="lb-stat"><Award size={ICON_SIZE.emphasis} aria-hidden="true" /><div><b>{current.cards.toLocaleString()}</b><span>logged cards this week</span></div></div>
        <div className="lb-stat"><TrendingUp size={ICON_SIZE.emphasis} aria-hidden="true" /><div><b>{Number((current.minutes / 60).toFixed(1))}</b><span>study hours this week</span></div></div>
        <div className="lb-stat"><Flame size={ICON_SIZE.emphasis} aria-hidden="true" /><div><b>{longest}</b><span>longest day streak</span></div></div>
        <div className="lb-stat"><Crown size={ICON_SIZE.emphasis} aria-hidden="true" /><div><b>{bestMinutesDay ? `${Math.round(bestMinutesDay.value / 6) / 10}h` : "—"}</b><span>{bestMinutesDay ? `best day · ${bestMinutesDay.dayKey}` : "best day"}</span></div></div>
      </div>

      <GlassCard pad>
        <PanelHeader
          title="Your completed weeks"
          sub="Your last eight completed Monday–Sunday weeks. Equal totals share a rank; the week in progress is shown with its projection, never ranked early."
          action={pace.projectedRank && pace.status !== "no-history" ? <Tag tone={pace.projectedRank <= 3 ? "green" : "neutral"}>This week on pace for #{pace.projectedRank}</Tag> : undefined}
        />
        {ranked.length ? (
          <ol className="lb-rows" aria-label="Personal weekly standings">
            {ranked.map((week) => (
              <li className={`lb-row rank-${Math.min(week.rank, 4)}`} key={week.start}>
                <span className="lb-rank">{week.rank}</span>
                <span className="lb-medal" aria-hidden="true">{week.rank <= 3 ? <Medal size={ICON_SIZE.body} /> : null}</span>
                <span className="lb-row-dates"><b>{week.start}</b><small>to {week.end}</small></span>
                <span className="lb-row-bar" aria-hidden="true"><i style={{ width: `${(week[metric] / maxRanked) * 100}%` }} /></span>
                <b className="lb-value">{formatValue(week[metric], metric)}</b>
              </li>
            ))}
          </ol>
        ) : (
          <div className="application-state">
            <h3>No completed weeks with {BOARDS.find((board) => board.id === metric)?.label.toLowerCase()} yet</h3>
            <p className="sub">Log your study from Today. Your standings appear after the week ends.</p>
            <a className="ghost-btn" href="#dashboard">Go to Today</a>
          </div>
        )}
        <p className="sub">Based only on academic activity recorded in AXOM. Logged cards are not a verified connection to the Anki Leaderboard add-on.</p>
      </GlassCard>

      <GlassCard pad className="lb-friends">
        <PanelHeader title="Study with friends" sub="Planned · not connected" action={<Tag tone="neutral"><Lock size={ICON_SIZE.microInline} /> Private by design</Tag>} />
        <div className="lb-friends-body">
          <Users size={ICON_SIZE.display} aria-hidden="true" />
          <div>
            <p>
              Small private groups will compare <b>this week’s pace</b> the same way you race your past self above — “on track for a better week”,
              “needs a stronger push” — never raw rankings of strangers. Groups will require an account, an explicit invite, opt-in per measure,
              and the ability to leave and delete your shared numbers at any time.
            </p>
            <p className="sub">
              {accountPhase === "signed-in" ? "You’re signed in, so you’ll be ready when groups open." : "Nothing from this page leaves your device today. No participants are invented."}
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

