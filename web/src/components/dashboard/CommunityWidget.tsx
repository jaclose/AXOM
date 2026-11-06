import { useEffect, useState } from "react";
import { ArrowUpRight, MessageCircle, RefreshCw, UserPlus, UsersRound } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import type { CommunitySnapshot } from "../../lib/community/community";
import type { DashboardWidgetSize } from "../../lib/types";
import { useUi } from "../../lib/uiStore";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import "../../styles/community-widget.css";

export function CommunityWidget({ size, enabledFields }: { size: DashboardWidgetSize; enabledFields: ReadonlySet<string> }) {
  const accountId = useAccount(state => state.user?.id);
  const phase = useAccount(state => state.phase);
  return <GlassCard pad className="community-widget">
    <PanelHeader headingLevel={2} title="Community" sub="A little company for the work."
      action={<UsersRound size={20} aria-hidden="true" />} />
    {phase === "loading" ? <p role="status" className="sub">Checking your account…</p>
      : phase === "unconfigured" ? <p className="sub">Community needs an account connection. Your local study tools are ready.</p>
      : accountId ? <CommunityWidgetActivity key={accountId} accountId={accountId} size={size} enabledFields={enabledFields} />
        : <div className="community-widget-empty"><MessageCircle size={24} aria-hidden="true" />
          <p>Find study partners, share a small win, and encourage a friend.</p>
          <GButton size="sm" onClick={() => useUi.getState().requestSettings("account")}>Sign in to connect</GButton>
        </div>}
  </GlassCard>;
}

function CommunityWidgetActivity({ accountId, size, enabledFields }: {
  accountId: string; size: DashboardWidgetSize; enabledFields: ReadonlySet<string>;
}) {
  const [data, setData] = useState<CommunitySnapshot>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void import("../../lib/community/community").then(module => module.loadCommunity(accountId))
      .then(snapshot => { if (active && useAccount.getState().user?.id === accountId) setData(snapshot); })
      .catch(cause => {
        if (!active) return;
        setData(undefined);
        setError(cause instanceof Error ? cause.message : "Community could not be refreshed.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") setRefresh(value => value + 1); };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("axom:community-changed", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("axom:community-changed", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, []);
  const friends = new Set(data?.connections.filter(connection => connection.status === "accepted")
    .map(connection => connection.requester_id === accountId ? connection.addressee_id : connection.requester_id) ?? []);
  const incoming = data?.connections.filter(connection => connection.status === "pending" && connection.addressee_id === accountId).length ?? 0;
  const mine = data?.profiles.find(profile => profile.user_id === accountId);
  const posts = data?.posts.filter(post => post.visibility !== "private" && friends.has(post.user_id)).slice(0, size === "large" ? 4 : 2) ?? [];
  const profiles = new Map(data?.profiles.map(profile => [profile.user_id, profile]) ?? []);
  return <div className="community-widget-body" aria-busy={loading}>
    {loading && !data && <p role="status" className="sub">Loading your circle…</p>}
    {error && <div role="alert"><p className="sub">{error}</p><GButton size="sm" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Retry Community</GButton></div>}
    {data && <>
      {data.connectionsError ? <p role="alert" className="sub">{data.connectionsError}</p> : enabledFields.has("friends") && <div className="community-widget-counts">
        <span><b>{friends.size}</b> {friends.size === 1 ? "friend" : "friends"}</span>
        {incoming > 0 && <a href="#communities"><UserPlus size={14} aria-hidden="true" /> {incoming} {incoming === 1 ? "request" : "requests"}</a>}
      </div>}
      {enabledFields.has("activity") && (posts.length ? <ul className="community-widget-posts">{posts.map(post => <li key={post.id}>
        <a href="#communities"><b>{profiles.get(post.user_id)?.display_name ?? "A learner"}</b>
          <span>{post.kind === "progress" ? `${post.minutes} min · ${post.questions} questions · ${post.cards} cards`
            : post.caption || post.set_title || "Shared an update"}</span></a>
      </li>)}</ul> : <p className="sub">{mine ? "Your friends’ shared updates will appear here. Say hello or find a study partner." : "Choose your community name to introduce yourself. You can browse while keeping your study private."}</p>)}
    </>}
    <div className="community-widget-footer"><a className="gbtn sm" href="#communities">Open Community <ArrowUpRight size={14} aria-hidden="true" /></a>
      <button className="ghost-btn" type="button" aria-label="Refresh community widget" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /></button>
    </div>
  </div>;
}
