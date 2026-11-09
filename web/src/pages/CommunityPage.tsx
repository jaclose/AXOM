import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, MessageCircle, Pencil, RefreshCw, Users } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import { loadCommunity, type CommunitySnapshot } from "../lib/community/community";
import { communityUpgradeMessage } from "../lib/community/client";
import { useCommunityShare } from "../lib/community/shareStore";
import { CommunityLeaderboard } from "../components/community/CommunityLeaderboard";
import { CommunityReportsPanel } from "../components/community/CommunityReportsPanel";
import { CommunityComposer, type CommunityComposerDraft } from "../components/community/CommunityComposer";
import { CommunityIdentityDialog, CommunityPersonButton, CommunitySettingsLink } from "../components/community/CommunityIdentity";
import { CommunityProfileDialog } from "../components/community/CommunityProfileDialog";
import { CommunityPostCard } from "../components/community/CommunityPostCard";
import { CommunityFriendAction, CommunityPeople, communityOtherPerson } from "../components/community/CommunityPeople";
import { createCommunityDraftCache } from "../components/community/communityDraftCache";
import { GButton, GlassCard, PanelHeader } from "../components/ui/primitives";
import { useAccountIdentity, useOperatorAccess } from "../lib/operator/hostClient";
import { canOpenHost } from "../lib/operator/hostAccess";
import { useUi } from "../lib/uiStore";
import "../styles/community.css";

type FeedFilter = "all" | "friends" | "mine";
const FEEDS: Array<{ id: FeedFilter; label: string }> = [
  { id: "all", label: "All activity" }, { id: "friends", label: "Friends" }, { id: "mine", label: "My posts" },
];

/** Replacing the account subtree clears posts, open profiles and drafts immediately. */
export function CommunityPage() {
  const identity = useAccountIdentity();
  return <CommunityAccountPage key={identity} />;
}

function CommunityAccountPage() {
  const account = useAccount(state => state.user);
  const phase = useAccount(state => state.phase);
  const accountId = account?.id;
  const hostAvailable = canOpenHost(useOperatorAccess());
  const [data, setData] = useState<CommunitySnapshot>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [editingProfile, setEditingProfile] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>();
  const [progressReview, setProgressReview] = useState(0);
  const [composerDraft, setComposerDraft] = useState<CommunityComposerDraft>();
  const [draftCache] = useState(createCommunityDraftCache);
  const hadProfile = useRef(false);
  const lastSharedAt = useCommunityShare(state => state.accountId === accountId ? state.lastSharedAt : undefined);
  const shareRevision = useCommunityShare(state => state.accountId === accountId ? state.revision : undefined);
  const shareMode = useCommunityShare(state => state.accountId === accountId ? state.mode : undefined);
  const shareError = useCommunityShare(state => state.accountId === accountId && state.status === "error" ? state.message : "");

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setLoading(true); setError("");
    void loadCommunity(accountId).then(result => { if (active) {
      const hasProfile = result.profiles.some(profile => profile.user_id === accountId);
      if (hadProfile.current && !hasProfile) {
        setComposerDraft(undefined); draftCache.posts.clear(); draftCache.replies.clear();
      }
      hadProfile.current = hasProfile;
      setData(result);
    } })
      .catch(cause => { if (active) { setData(undefined); setError(cause instanceof Error ? cause.message : "Community is unavailable."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, refresh, draftCache]);
  useEffect(() => { setRefresh(value => value + 1); }, [lastSharedAt, shareRevision, shareMode]);
  useEffect(() => {
    if (!accountId) return;
    const refreshVisible = () => { if (document.visibilityState === "visible") setRefresh(value => value + 1); };
    const interval = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("axom:community-changed", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval); window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("axom:community-changed", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [accountId]);

  const profiles = useMemo(() => new Map(data?.profiles.map(profile => [profile.user_id, profile]) ?? []), [data?.profiles]);
  const mine = accountId ? profiles.get(accountId) : undefined;
  const friendIds = useMemo(() => new Set((data?.connections ?? []).filter(item => item.status === "accepted")
    .map(item => communityOtherPerson(item, accountId ?? ""))), [data?.connections, accountId]);
  const posts = (data?.posts ?? []).filter(post => filter === "mine" ? post.user_id === accountId
    : filter === "friends" ? friendIds.has(post.user_id) : true);
  const reactionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.reactions ?? []) counts.set(item.post_id, (counts.get(item.post_id) ?? 0) + 1);
    return counts;
  }, [data?.reactions]);
  const myReactions = useMemo(() => new Set((data?.reactions ?? []).filter(item => item.user_id === accountId)
    .map(item => item.post_id)), [data?.reactions, accountId]);

  function changed(text: string) { setMessage(text); setRefresh(value => value + 1); }

  if (phase === "loading") return <div className="community-loading" role="status"><Users size={24} aria-hidden="true" /><p>Checking your account…</p></div>;
  if (!accountId) return <div className="community-page stack"><GlassCard pad className="community-signin">
    <Users size={28} aria-hidden="true" /><PanelHeader title="Find your study circle" headingLevel={2}
      sub="Friends, conversations, shared progress and a little encouragement along the way." />
    <p>{phase === "unconfigured" ? "Community needs an account service, which is unavailable in this build." : "Sign in to see what learners choose to share. Creating a public profile and sharing your progress are optional."}</p>
    {phase !== "unconfigured" && <GButton variant="primary" onClick={() => useUi.getState().requestSettings("account")}>Open account settings</GButton>}
  </GlassCard></div>;

  return <div className="community-page stack">
    <header className="community-heading">
      <div><span className="community-eyebrow"><Users size={14} aria-hidden="true" /> YOUR CIRCLE</span>
        <h2>Study is better together.</h2><p>Ask a question, celebrate a small win, or find someone to study with.</p></div>
      <div className="community-heading-actions"><GButton size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Refresh</GButton>
        {hostAvailable && <a className="ghost-btn" href="#host">Host dashboard <ArrowUpRight size={14} aria-hidden="true" /></a>}</div>
    </header>

    {mine && <div className="community-own-profile">
      <CommunityPersonButton profile={mine} onClick={() => setSelectedProfile(accountId)} />
      <div className="community-own-summary"><strong>{data?.connectionsError ? "Friend list unavailable" : `${friendIds.size} ${friendIds.size === 1 ? "friend" : "friends"}`}</strong>
        {mine.bio && <p>{mine.bio}</p>}</div>
      <div className="community-own-actions"><GButton size="sm" onClick={() => setEditingProfile(true)}><Pencil size={14} aria-hidden="true" /> Edit profile</GButton><CommunitySettingsLink /></div>
    </div>}

    {loading && !data && <div className="community-loading" role="status"><span className="community-loading-line" /><p>Loading your circle…</p></div>}
    {error && <div role="alert" className="community-error"><p>{error}</p>{composerDraft?.caption && <p>Your draft is kept here while you reconnect.</p>}
      <GButton size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Retry Community</GButton></div>}
    {data?.directoryError && <div role="alert" className="community-error"><p>{data.directoryError}</p><GButton size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Retry directory</GButton></div>}
    {data?.connectionsError && <div role="alert" className="community-error"><p>{data.connectionsError} Your profile and account settings remain available.</p>
      <GButton size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Retry friends</GButton></div>}
    <div className="community-feedback" role="status" aria-live="polite">{message}</div>
    {data?.serviceUpgradeRequired && <p className="community-error" role="status">{communityUpgradeMessage}</p>}

    {data && <div className="community-grid">
      <div className="community-main stack">
        {!data.serviceUpgradeRequired && (mine ? <CommunityComposer accountId={accountId} profile={mine} posts={data.posts} onPublished={changed} progressReview={progressReview}
          initialDraft={composerDraft} onDraftChange={setComposerDraft} />
          : <GlassCard pad className="community-onboard"><div className="community-eyebrow">A PLACE FOR YOUR PACE</div>
            <PanelHeader title="Make yourself at home" headingLevel={2} sub="Create a profile to post, reply and connect. You can keep your progress to yourself." />
            <div className="community-onboard-actions"><GButton variant="primary" onClick={() => setEditingProfile(true)}><Pencil size={15} aria-hidden="true" /> Create profile</GButton><CommunitySettingsLink /></div>
          </GlassCard>)}
        {shareError && !data.serviceUpgradeRequired && <div role="alert" className="community-error"><p>{shareError}</p>
          {mine && <GButton size="sm" onClick={() => setProgressReview(value => value + 1)}>Review daily progress</GButton>}<CommunitySettingsLink /></div>}
        <section className="community-feed" aria-label="Activity feed">
          <div className="community-feed-heading"><h2>Activity feed</h2><span>{loading ? "Refreshing…" : "Newest first"}</span></div>
          <div className="community-feed-filters" role="group" aria-label="Filter activity">
            {FEEDS.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "on" : ""}
              onClick={() => setFilter(item.id)}>{item.label}</button>)}
          </div>
          {filter === "friends" && data.connectionsError ? <div className="community-empty"><Users size={24} aria-hidden="true" />
            <h3>Your friend feed is unavailable</h3><p>Refresh your friend list above to see this feed.</p></div>
            : posts.length === 0 ? <div className="community-empty"><MessageCircle size={25} aria-hidden="true" />
              <h3>{filter === "friends" ? "A conversation starts with one person" : filter === "mine" ? "Your first post is yours to choose" : "Make the first connection"}</h3>
              <p>{filter === "friends" ? "Find a friend in Your people. Their posts appear here when they share with you."
                : filter === "mine" ? "Share a small win, ask a question, or invite someone to study. Only me keeps a post private."
                  : "Shared updates will appear here. You can join in without sharing your study totals."}</p></div>
              : <div className="community-posts">{posts.map(post => <CommunityPostCard key={post.id} accountId={accountId} post={post}
                profile={profiles.get(post.user_id)} liked={myReactions.has(post.id)} reactionCount={reactionCounts.get(post.id) ?? 0}
                canParticipate={Boolean(mine)} serviceUpgradeRequired={data.serviceUpgradeRequired} refreshKey={refresh} draftCache={draftCache} onChanged={changed} onOpenProfile={setSelectedProfile} />)}</div>}
          {data.posts.length >= 100 && <p className="sub community-feed-limit">Showing the latest 100 visible posts. Open a learner’s profile for their recent activity.</p>}
        </section>
      </div>
      <aside className="community-aside stack" aria-label="People and shared study">
        <CommunityPeople accountId={accountId} data={data} canConnect={Boolean(mine)} refreshKey={refresh} onChanged={changed} onOpenProfile={setSelectedProfile} />
        <CommunityLeaderboard accountId={accountId} refreshKey={refresh} onOpenProfile={setSelectedProfile} />
        <div className="community-circle-note"><Users size={18} aria-hidden="true" /><p>Progress comes in many forms. Encourage a friend, share a useful idea, or simply follow along.</p></div>
      </aside>
    </div>}
    <CommunityReportsPanel accountId={accountId} />
    {editingProfile && <CommunityIdentityDialog accountId={accountId} profile={mine} displayName={account?.displayName}
      onClose={() => setEditingProfile(false)} onSaved={changed} />}
    {selectedProfile && <CommunityProfileDialog key={selectedProfile} accountId={accountId} userId={selectedProfile}
      refreshKey={refresh}
      onClose={() => setSelectedProfile(undefined)} onEdit={() => { setSelectedProfile(undefined); setEditingProfile(true); }}
      connectionAction={mine && selectedProfile !== accountId ? <CommunityFriendAction accountId={accountId} otherId={selectedProfile}
        connection={data?.connections.find(item => communityOtherPerson(item, accountId) === selectedProfile)} disabled={Boolean(data?.connectionsError)} onChanged={changed} /> : undefined} />}
  </div>;
}
