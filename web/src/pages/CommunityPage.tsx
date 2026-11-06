import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Heart, LockKeyhole, RefreshCw, Share2, UserPlus, Users, EyeOff, Trash2 } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import { useStore } from "../lib/store";
import { isoDate } from "../lib/scoring";
import {
  acceptFriend, dayProgress, deleteCommunityPost, joinCommunity, leaveCommunity, loadCommunity,
  publishCommunityPost, reportCommunityPost, removeFriend, requestFriend, saveShareMode, searchCommunityProfiles, setDiscoverable, setReaction,
  type CommunityConnection, type CommunityProfile, type CommunitySnapshot,
} from "../lib/community/community";
import { setCommunityShareMode, useCommunityShare } from "../lib/community/shareStore";
import { CommunityLeaderboard } from "../components/community/CommunityLeaderboard";
import { CommunityReportsPanel } from "../components/community/CommunityReportsPanel";
import { CommunityShareCard } from "../components/community/CommunityShareCard";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { useAccountIdentity, useOperatorAccess } from "../lib/operator/hostClient";
import { canOpenHost } from "../lib/operator/hostAccess";
import { useUi } from "../lib/uiStore";
import "../styles/community.css";

type PostKind = "progress" | "question_set";
type Audience = "private" | "friends" | "community";
type PeopleSearch = { query: string; status: "loading" | "ready" | "error"; profiles: CommunityProfile[]; message?: string };
function otherPerson(friendship: CommunityConnection, me: string) {
  return friendship.requester_id === me ? friendship.addressee_id : friendship.requester_id;
}
function initials(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).map(word => word.slice(0, 1).toUpperCase()).join("");
}

export function CommunityPage() {
  const identity = useAccountIdentity();
  return <CommunityAccountPage key={identity} />;
}

function CommunityAccountPage() {
  const account = useAccount(state => state.user);
  const logs = useStore(state => state.logs);
  const sets = useStore(state => state.questionSets);
  const accountId = account?.id;
  const today = isoDate(new Date());
  const [data, setData] = useState<CommunitySnapshot>();
  const [refreshId, setRefreshId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [handle, setHandle] = useState("");
  const [publicName, setPublicName] = useState("");
  const [kind, setKind] = useState<PostKind>("progress");
  const [audience, setAudience] = useState<Audience>("private");
  const [joinDiscoverable, setJoinDiscoverable] = useState(false);
  const [bio, setBio] = useState("");
  const [day, setDay] = useState(today);
  const [caption, setCaption] = useState("");
  const [setTitle, setSetTitle] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleSearchState, setPeopleSearchState] = useState<PeopleSearch>();
  const [peopleSearchRetry, setPeopleSearchRetry] = useState(0);
  const hostAvailable = canOpenHost(useOperatorAccess());
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<"spam" | "harassment" | "copyright" | "inaccurate" | "other">("other");

  useEffect(() => {
    setHandle((account?.displayName ?? "learner").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30));
    setPublicName(account?.displayName ?? "Learner");
  }, [accountId, account?.displayName]);
  useEffect(() => {
    let active = true;
    if (!accountId) return;
    setLoading(true);
    setError("");
    void loadCommunity(accountId).then(result => { if (active) setData(result); })
      .catch(cause => { if (active) { setData(undefined); setError(cause instanceof Error ? cause.message : "Community is unavailable."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, refreshId]);

  const mine = data?.profiles.find(p => p.user_id === accountId);
  const mineId = mine?.user_id;
  const normalizedPeopleSearch = peopleSearch.trim();
  useEffect(() => {
    if (!accountId || !mineId || normalizedPeopleSearch.length < 2) {
      setPeopleSearchState(undefined);
      return;
    }
    let active = true;
    setPeopleSearchState({ query: normalizedPeopleSearch, status: "loading", profiles: [] });
    const timer = window.setTimeout(() => {
      void searchCommunityProfiles(accountId, normalizedPeopleSearch)
        .then(profiles => { if (active) setPeopleSearchState({ query: normalizedPeopleSearch, status: "ready", profiles }); })
        .catch(cause => { if (active) setPeopleSearchState({ query: normalizedPeopleSearch, status: "error", profiles: [],
          message: cause instanceof Error ? cause.message : "Learner search is unavailable. Retry when connected." }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accountId, mineId, normalizedPeopleSearch, peopleSearchRetry, refreshId]);
  const profiles = useMemo(() => new Map(data?.profiles.map(p => [p.user_id, p]) ?? []), [data]);
  const relationships = useMemo(() => data?.connections ?? [], [data?.connections]);
  const friendIds = useMemo(() => new Set(relationships.filter(c => c.status === "accepted" && accountId).map(c => otherPerson(c, accountId!))), [relationships, accountId]);
  const connectedIds = useMemo(() => new Set(relationships.map(c => otherPerson(c, accountId ?? ""))), [relationships, accountId]);
  const incoming = relationships.filter(c => c.status === "pending" && c.addressee_id === accountId);
  const outgoing = relationships.filter(c => c.status === "pending" && c.requester_id === accountId);
  const activePeopleSearch = peopleSearchState?.query === normalizedPeopleSearch ? peopleSearchState : undefined;
  const knownSearchMatches = normalizedPeopleSearch.length >= 2 ? (data?.profiles ?? []).filter(profile =>
    connectedIds.has(profile.user_id) && [profile.display_name, profile.handle].some(value =>
      value.toLowerCase().includes(normalizedPeopleSearch.toLowerCase()))) : [];
  const peopleMatches = normalizedPeopleSearch.length >= 2
    ? [...new Map([...knownSearchMatches, ...(activePeopleSearch?.status === "ready" ? activePeopleSearch.profiles : [])]
      .map(profile => [profile.user_id, profile])).values()]
    : (data?.profiles ?? []).filter(p => p.user_id !== accountId && (p.discoverable || friendIds.has(p.user_id)))
      .sort((a, b) => Number(friendIds.has(b.user_id)) - Number(friendIds.has(a.user_id)) || a.handle.localeCompare(b.handle));
  const people = peopleMatches.slice(0, 50);
  const progress = useMemo(() => dayProgress(logs, day), [logs, day]);
  // A confirmed automatic share changes the feed and the leaderboard; show it.
  const lastSharedAt = useCommunityShare(state => state.accountId === accountId ? state.lastSharedAt : undefined);
  useEffect(() => { if (lastSharedAt) setRefreshId(value => value + 1); }, [lastSharedAt]);
  const socialPosts = data?.posts ?? [];
  const reactions = useMemo(() => data?.reactions ?? [], [data?.reactions]);
  const reactCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of reactions) counts.set(item.post_id, (counts.get(item.post_id) ?? 0) + 1);
    return counts;
  }, [reactions]);

  async function act(effect: () => Promise<void>, success: string, resetForm = false) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await effect();
      if (resetForm) { setCaption(""); setAudience("private"); }
      setMessage(success);
      setRefreshId(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request did not finish.");
    } finally {
      setBusy(false);
    }
  }
  const person = (userId: string) => profiles.get(userId)?.display_name ?? "Learner";
  const related = (userId: string) => relationships.find(c => otherPerson(c, accountId ?? "") === userId);

  if (!accountId) return <div className="community-page stack">
    <GlassCard pad>
      <PanelHeader title="Community" headingLevel={2} sub="Sign in to find other AXOM learners, compare shared progress and connect." />
      <p>Accounts are optional. Your private study data remains available without signing in.</p>
      <p className="sub">Joining Community is a separate, optional choice after sign-in.</p>
      <GButton onClick={() => useUi.getState().requestSettings("account")}>Open account settings</GButton>
    </GlassCard>
  </div>;

  return <div className="community-page stack">
    <section className="community-banner">
      <div>
        <div className="community-eyebrow"><Users size={16} /> AXOM COMMUNITY</div>
        <h2>Better together.</h2>
        <p>Find your people. Share only what you choose. Make progress worth celebrating.</p>
      </div>
      <div className="community-signal" aria-label="Shared community stats">
        <span><strong>{data?.connectionsError ? "—" : friendIds.size}</strong> Friends</span>
        <span><strong>{socialPosts.length}</strong> Visible posts</span>
      </div>
    </section>
    <div className="row wrap gap8">
      <Tag tone={mine ? "green" : "neutral"}>{mine ? "Community profile active" : "Not yet visible"}</Tag>
      <GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}><RefreshCw size={14} /> Refresh</GButton>
      {hostAvailable && <a className="ghost-btn" href="#host">Host dashboard</a>}
    </div>
    {loading && <p role="status">Loading shared activity…</p>}
    {error && <div role="alert" className="community-error"><p>{error}</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}>Retry Community</GButton></div>}
    {data?.directoryError && <div role="alert" className="community-error"><p>{data.directoryError}</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}>Retry directory</GButton></div>}
    {data?.connectionsError && <div role="alert" className="community-error"><p>{data.connectionsError} Your profile and privacy controls remain available.</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}>Retry friends</GButton></div>}
    {message && <p role="status" className="sub">{message}</p>}
    {!loading && !data && !error && <p className="sub">Unable to load Community right now.</p>}

    {data && !mine && <GlassCard pad className="community-onboard">
      <PanelHeader title="Join Community" headingLevel={2} sub="Your name and handle become searchable only when you opt in." />
      <form onSubmit={event => { event.preventDefault(); void act(() => joinCommunity(accountId, handle, publicName, bio, joinDiscoverable), joinDiscoverable ? "Your profile is now discoverable." : "Your profile is saved and hidden from discovery."); }}>
      <div className="community-fields">
        <label>Public handle <input name="handle" value={handle} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{2,29}" required autoCapitalize="none" spellCheck={false} autoComplete="username" disabled={busy} onChange={e => setHandle(e.target.value.toLowerCase())} placeholder="your_handle" /></label>
        <label>Display name <input name="display-name" value={publicName} maxLength={80} required autoComplete="name" disabled={busy} onChange={e => setPublicName(e.target.value)} /></label>
        <label>Biography <textarea name="bio" value={bio} maxLength={240} disabled={busy} onChange={event => setBio(event.target.value)} /></label>
      </div>
      <label className="community-checkbox"><input type="checkbox" checked={joinDiscoverable} disabled={busy} onChange={event => setJoinDiscoverable(event.target.checked)} /> Make my profile discoverable</label>
      <p className="sub">Nothing is shared automatically. After joining you can choose to share your daily study totals; your journal, notes, question answers and exam results are never posted.</p>
      <GButton type="submit" variant="primary" disabled={busy}>{busy ? "Creating profile…" : "Create profile"}</GButton>
      </form>
    </GlassCard>}

    {data && mine && <>
      <div className="community-grid">
        <div className="community-main stack">
          <CommunityShareCard accountId={accountId} discoverable={mine.discoverable} />
          <GlassCard pad className="community-composer">
            <PanelHeader headingLevel={2} title="Share an update" sub="Post a study day with a note, or celebrate a Question Set. Others see only this card, never your workspace." />
            <div className="community-choice" role="group" aria-label="Update type">
              <button className={kind === "progress" ? "selected" : ""} type="button" disabled={busy} onClick={() => setKind("progress")} aria-pressed={kind === "progress"}><Activity size={16} aria-hidden="true" /> Daily progress</button>
              <button className={kind === "question_set" ? "selected" : ""} type="button" disabled={busy} onClick={() => setKind("question_set")} aria-pressed={kind === "question_set"}><Share2 size={16} aria-hidden="true" /> Question Set</button>
            </div>
            {kind === "progress" ? <div className="community-day">
              <label>Study day <input type="date" value={day} max={today} min="2020-01-01" disabled={busy} onChange={e => setDay(e.target.value)} /></label>
              <div className="community-activity-summary">
                <div><strong>{progress.minutes}</strong><span>minutes</span></div>
                <div><strong>{progress.cards}</strong><span>cards</span></div>
                <div><strong>{progress.questions}</strong><span>questions logged</span></div>
              </div>
              <p className="sub">Only academic activity recorded in AXOM for the selected day. If you did not log questions, this count may be zero.</p>
            </div> : <div className="community-fields">
              <label>Question Set to celebrate
                <select value={setTitle} disabled={busy} onChange={e => setSetTitle(e.target.value)}>
                  <option value="">Choose a set</option>
                  {sets.filter(set => Boolean(set.title?.trim())).slice(0, 200).map(set => <option key={set.id} value={set.title}>{set.title}</option>)}
                </select>
              </label>
              <p className="sub">This posts the title only, not the questions or a private share link. Published Question Sets still require their existing sharing permissions.</p>
            </div>}
            <label className="community-caption">Write a note (optional)
              <textarea name="caption" value={caption} maxLength={500} rows={3} disabled={busy} placeholder="What went well today?" onChange={e => setCaption(e.target.value)} />
            </label>
            <div className="community-publish">
              <label>Who can see this?
                <select value={audience} disabled={busy} onChange={e => setAudience(e.target.value as Audience)}>
                  <option value="private">Only me</option>
                  <option value="friends">Accepted friends</option>
                  <option value="community">Community</option>
                </select>
              </label>
              <GButton variant="primary" disabled={busy || (kind === "question_set" && !setTitle) || (kind === "progress" && !day)}
                onClick={() => void act(() => publishCommunityPost(accountId, {
                  kind, visibility: audience, activityDay: day,
                  ...progress, setTitle: kind === "question_set" ? setTitle : undefined, caption,
                }), audience === "private" ? "Update saved privately." : "Update shared.", true)}><Share2 size={16} /> Publish</GButton>
            </div>
            <p className="sub">Only me is the default each time. Private posts never contribute to the shared leaderboard.</p>
          </GlassCard>

          <GlassCard pad className="community-feed">
            <PanelHeader headingLevel={2} title="Activity feed" sub="Updates shared with you, newest first." />
            {socialPosts.length === 0 && <p className="sub">No shared updates yet. Publish your first day or connect with a friend.</p>}
            <div className="stack community-posts">{socialPosts.map(post => {
              const youLiked = reactions.some(reaction => reaction.post_id === post.id && reaction.user_id === accountId);
              return <article key={post.id} className="community-post">
                <div className="community-post-head">
                  <span className="community-avatar">{initials(person(post.user_id))}</span>
                  <div><strong>{person(post.user_id)}</strong><small>@{profiles.get(post.user_id)?.handle ?? "learner"} · {new Date(post.created_at).toLocaleDateString()}</small></div>
                  <Tag tone="neutral">{post.visibility === "private" ? "Only me" : post.visibility === "friends" ? "Friends" : "Community"}</Tag>
                </div>
                {post.kind === "progress" ? <div className="community-post-feature">
                  <div><Activity size={16}/><b>Daily study</b><small>{post.activity_day}</small></div>
                  <div className="community-totals"><span><b>{post.minutes}</b> min</span><span><b>{post.cards}</b> cards</span><span><b>{post.questions}</b> questions</span></div>
                  <small>Self-shared study log totals. Not independently verified.</small>
                </div> : <div className="community-post-feature">
                  <div><Share2 size={16}/><b>Question Set</b></div>
                  <h3>{post.set_title}</h3>
                  <small>Title shared by its owner; source content is not included.</small>
                </div>}
                {post.caption && <p className="community-post-caption">{post.caption}</p>}
                <div className="community-post-actions">
                  <GButton size="sm" disabled={busy} aria-pressed={youLiked} onClick={() => void act(() => setReaction(accountId, post.id, !youLiked), youLiked ? "Reaction removed." : "Reaction saved.")}>
                    <Heart size={15} fill={youLiked ? "currentColor" : "none"} /> {reactCounts.get(post.id) ?? 0} {youLiked ? "Kudos given" : "Kudos"}
                  </GButton>
                  {post.user_id === accountId && <GhostButton disabled={busy} onClick={() => setDeletePostId(deletePostId === post.id ? null : post.id)}><Trash2 size={15} aria-hidden="true" /> Delete</GhostButton>}
                  {post.user_id !== accountId && <GhostButton disabled={busy} onClick={() => { setReportPostId(reportPostId === post.id ? null : post.id); setReportReason("other"); }}>Report</GhostButton>}
                </div>
                {deletePostId === post.id && <div className="community-report-form" role="group" aria-label="Confirm post removal"><p>Remove this post and its reactions? Your private study records stay intact.</p><GButton size="sm" variant="danger" disabled={busy} onClick={() => void act(async () => { await deleteCommunityPost(accountId, post.id); setDeletePostId(null); }, "Post removed.")}>Remove my post</GButton><GhostButton disabled={busy} onClick={() => setDeletePostId(null)}>Keep post</GhostButton></div>}
                {reportPostId === post.id && <div className="community-report-form">
                  <label>Reason for reporting
                    <select value={reportReason} onChange={e => setReportReason(e.target.value as typeof reportReason)}>
                      <option value="spam">Spam</option><option value="harassment">Harassment</option>
                      <option value="copyright">Copyright concern</option><option value="inaccurate">Misleading study content</option>
                      <option value="other">Other concern</option>
                    </select>
                  </label>
                  <GButton size="sm" disabled={busy} onClick={() => { setReportPostId(null); void act(() => reportCommunityPost(accountId, post.id, reportReason), "Report sent to moderators."); }}>Submit report</GButton>
                  <GhostButton onClick={() => setReportPostId(null)}>Cancel</GhostButton>
                </div>}
              </article>;
            })}</div>
          </GlassCard>
        </div>
        <aside className="community-aside stack">
          <CommunityReportsPanel accountId={accountId} />
          <CommunityLeaderboard accountId={accountId} refreshKey={refreshId} />
          <GlassCard pad>
            <PanelHeader headingLevel={2} title="Find friends" sub="Discoverable learners and friends you already know." />
            <label className="community-search">Find someone<input type="search" value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)} maxLength={80} placeholder="Name or handle" /></label>
            {normalizedPeopleSearch.length === 1 && <p className="sub">Enter one more character to search all discoverable learners.</p>}
            {normalizedPeopleSearch.length >= 2 && activePeopleSearch?.status === "loading" && <p role="status" className="sub">Searching discoverable learners…</p>}
            {normalizedPeopleSearch.length >= 2 && activePeopleSearch?.status === "error" && <div role="alert" className="community-error"><p>{activePeopleSearch.message}</p><GButton size="sm" onClick={() => setPeopleSearchRetry(value => value + 1)}>Retry search</GButton></div>}
            {incoming.length > 0 && !data.connectionsError && <div className="community-invites"><h3>Requests for you</h3>
              {incoming.map(connection => <div key={connection.id} className="community-person">
                <span className="community-avatar">{initials(person(connection.requester_id))}</span>
                <span className="grow"><b>{person(connection.requester_id)}</b><small>Wants to connect</small></span>
                <GButton size="sm" disabled={busy} onClick={() => void act(() => acceptFriend(accountId, connection.id), "Friend request accepted.")}><Check size={15} /> Accept</GButton>
                <GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, connection.id), "Request declined.")}>Decline</GhostButton>
              </div>)}
            </div>}
            {!data.connectionsError && !data.directoryError && normalizedPeopleSearch.length < 2 && people.length > 0 && <p className="sub">Showing up to 50 learners. Search by name or handle to find more.</p>}
            {normalizedPeopleSearch.length < 2 && !data.connectionsError && people.length === 0 && <p className="sub">No other discoverable learners yet. Once someone opts in, you can connect here.</p>}
            {normalizedPeopleSearch.length >= 2 && activePeopleSearch?.status === "ready" && people.length === 0 && <p className="sub">No discoverable learners or existing friends match this search.</p>}
            {normalizedPeopleSearch.length >= 2 && peopleMatches.length > 50 && <p className="sub">Showing the first 50 matches. Narrow your search to find someone specific.</p>}
            {people.length > 0 && <div className="community-people">{people.map((profile: CommunityProfile) => {
              const relation = related(profile.user_id);
              return <div key={profile.user_id} className="community-person">
                <span className="community-avatar">{initials(profile.display_name)}</span>
                <span className="grow"><b>{profile.display_name}</b><small>@{profile.handle}</small></span>
                {data.connectionsError ? <span className="sub">Friend controls unavailable</span>
                  : relation?.status === "accepted" ? <GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, relation.id), "Friend removed.")}><Users size={14} /> Friends · remove</GhostButton>
                  : relation ? <span className="sub">{relation.requester_id === accountId ? "Request sent" : "Awaiting your response"}</span>
                  : <GButton size="sm" disabled={busy} onClick={() => void act(() => requestFriend(accountId, profile.user_id), "Friend request sent.")}><UserPlus size={14} /> Add</GButton>}
              </div>;
            })}</div>}
            {outgoing.length > 0 && !data.connectionsError && <div className="community-invites"><h3>Requests you sent</h3>{outgoing.map(connection => <div className="community-person" key={connection.id}><span className="grow"><b>{person(connection.addressee_id)}</b><small>Waiting for acceptance</small></span><GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, connection.id), "Friend request cancelled.")}>Cancel request</GhostButton></div>)}</div>}
          </GlassCard>
          <GlassCard pad className="community-privacy">
            <PanelHeader headingLevel={2} title="Your privacy" sub="Control whether your profile appears in discovery." />
            <p className="sub"><LockKeyhole size={14} /> Friends do not gain access to your questions, journal or personal study records.</p>
            <div className="community-settings-row">
              <span>{mine.discoverable ? "Discoverable to AXOM members" : "Hidden from discovery"}</span>
              <GButton size="sm" disabled={busy} onClick={() => void act(() => setDiscoverable(accountId, !mine.discoverable), mine.discoverable ? "Profile hidden from discovery." : "Profile is discoverable.")}>
                {mine.discoverable ? <EyeOff size={14} /> : <Users size={14} />} {mine.discoverable ? "Hide me" : "Show me"}
              </GButton>
            </div>
            <GhostButton disabled={busy} onClick={() => {
              if (window.confirm("Leave Community? Your profile, friend connections, posts and reactions will be permanently removed. Private AXOM data stays intact."))
                void act(async () => {
                  await leaveCommunity(accountId);
                  // Without a profile nothing can be shared; turn automatic sharing off too.
                  await saveShareMode(accountId, "off").then(() => setCommunityShareMode(accountId, "off"), () => undefined);
                }, "Community profile and shared activity removed.");
            }}>Leave Community</GhostButton>
          </GlassCard>
        </aside>
      </div>
    </>}
  </div>;
}
