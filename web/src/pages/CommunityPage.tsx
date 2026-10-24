import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Heart, LockKeyhole, RefreshCw, Share2, Trophy, UserPlus, Users, EyeOff, Trash2 } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import { useStore } from "../lib/store";
import { isoDate } from "../lib/scoring";
import {
  acceptFriend, dayProgress, deleteCommunityPost, joinCommunity, leaveCommunity, loadCommunity,
  publishCommunityPost, removeFriend, requestFriend, setDiscoverable, setReaction, sharedWeeklyStandings,
  type CommunityConnection, type CommunityProfile, type CommunitySnapshot,
} from "../lib/community/community";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import "../styles/community.css";

type PostKind = "progress" | "question_set";
type Audience = "friends" | "community";
function otherPerson(friendship: CommunityConnection, me: string) {
  return friendship.requester_id === me ? friendship.addressee_id : friendship.requester_id;
}
function initials(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).map(word => word.slice(0, 1).toUpperCase()).join("");
}

export function CommunityPage() {
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
  const [audience, setAudience] = useState<Audience>("friends");
  const [day, setDay] = useState(today);
  const [caption, setCaption] = useState("");
  const [setTitle, setSetTitle] = useState("");

  useEffect(() => {
    setHandle((account?.displayName ?? "learner").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30));
    setPublicName(account?.displayName ?? "Learner");
  }, [accountId, account?.displayName]);
  useEffect(() => {
    let active = true;
    setData(undefined);
    if (!accountId) return;
    setLoading(true);
    setError("");
    void loadCommunity(accountId).then(result => { if (active) setData(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Community is unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, refreshId]);

  const mine = data?.profiles.find(p => p.user_id === accountId);
  const profiles = useMemo(() => new Map(data?.profiles.map(p => [p.user_id, p]) ?? []), [data]);
  const relationships = data?.connections ?? [];
  const friendIds = useMemo(() => new Set(relationships.filter(c => c.status === "accepted" && accountId).map(c => otherPerson(c, accountId!))), [relationships, accountId]);
  const incoming = relationships.filter(c => c.status === "pending" && c.addressee_id === accountId);
  const outgoing = relationships.filter(c => c.status === "pending" && c.requester_id === accountId);
  const people = (data?.profiles ?? []).filter(p => p.user_id !== accountId && (p.discoverable || friendIds.has(p.user_id)));
  const progress = useMemo(() => dayProgress(logs, day), [logs, day]);
  const rankings = useMemo(() => sharedWeeklyStandings(
    (data?.posts ?? []).filter(post => post.user_id === accountId || friendIds.has(post.user_id)), today
  ), [data, friendIds, today]);
  const maxMinutes = Math.max(1, ...rankings.map(r => r.minutes));
  const socialPosts = data?.posts ?? [];
  const reactions = data?.reactions ?? [];
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
      if (resetForm) setCaption("");
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
      <p className="sub">Open Account in Settings to sign in. Joining Community is a separate, optional choice.</p>
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
        <span><strong>{friendIds.size}</strong> Friends</span>
        <span><strong>{socialPosts.length}</strong> Visible posts</span>
      </div>
    </section>
    <div className="row wrap gap8">
      <Tag tone={mine ? "green" : "neutral"}>{mine ? "Community profile active" : "Not yet visible"}</Tag>
      <GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}><RefreshCw size={14} /> Refresh</GButton>
    </div>
    {loading && <p role="status">Loading shared activity…</p>}
    {error && <p role="alert" className="community-error">{error}</p>}
    {message && <p role="status" className="sub">{message}</p>}
    {!loading && !data && !error && <p className="sub">Unable to load Community right now.</p>}

    {data && !mine && <GlassCard pad className="community-onboard">
      <PanelHeader title="Join Community" headingLevel={2} sub="Your name and handle become searchable only when you opt in." />
      <div className="community-fields">
        <label>Public handle <input value={handle} maxLength={30} autoComplete="off" onChange={e => setHandle(e.target.value.toLowerCase())} placeholder="your_handle" /></label>
        <label>Display name <input value={publicName} maxLength={80} onChange={e => setPublicName(e.target.value)} /></label>
      </div>
      <p className="sub">Your journal, notes, question answers, exam results and study history are never posted automatically.</p>
      <GButton variant="primary" disabled={busy} onClick={() => void act(() => joinCommunity(accountId, handle, publicName), "Your profile is now discoverable.")}>Create public profile</GButton>
    </GlassCard>}

    {data && mine && <>
      <div className="community-grid">
        <div className="community-main stack">
          <GlassCard pad className="community-composer">
            <PanelHeader headingLevel={2} title="Share an update" sub="Posting is manual. Others see only this card, never your underlying workspace." />
            <div className="community-choice" role="group" aria-label="Update type">
              <button className={kind === "progress" ? "selected" : ""} type="button" onClick={() => setKind("progress")} aria-pressed={kind === "progress"}><Activity size={16} /> Daily progress</button>
              <button className={kind === "question_set" ? "selected" : ""} type="button" onClick={() => setKind("question_set")} aria-pressed={kind === "question_set"}><Share2 size={16} /> Question Set</button>
            </div>
            {kind === "progress" ? <div className="community-day">
              <label>Study day <input type="date" value={day} max={today} min="2020-01-01" onChange={e => setDay(e.target.value)} /></label>
              <div className="community-activity-summary">
                <div><strong>{progress.minutes}</strong><span>minutes</span></div>
                <div><strong>{progress.cards}</strong><span>cards</span></div>
                <div><strong>{progress.questions}</strong><span>questions logged</span></div>
              </div>
              <p className="sub">Only academic activity recorded in AXOM for the selected day. If you did not log questions, this count may be zero.</p>
            </div> : <div className="community-fields">
              <label>Question Set to celebrate
                <select value={setTitle} onChange={e => setSetTitle(e.target.value)}>
                  <option value="">Choose a set</option>
                  {sets.filter(set => Boolean(set.title?.trim())).slice(0, 200).map(set => <option key={set.id} value={set.title}>{set.title}</option>)}
                </select>
              </label>
              <p className="sub">This posts the title only, not the questions or a private share link. Published Question Sets still require their existing sharing permissions.</p>
            </div>}
            <label className="community-caption">Write a note (optional)
              <textarea value={caption} maxLength={500} rows={3} placeholder="What went well today?" onChange={e => setCaption(e.target.value)} />
            </label>
            <div className="community-publish">
              <label>Who can see this?
                <select value={audience} onChange={e => setAudience(e.target.value as Audience)}>
                  <option value="friends">Accepted friends</option>
                  <option value="community">Community</option>
                </select>
              </label>
              <GButton variant="primary" disabled={busy || (kind === "question_set" && !setTitle) || (kind === "progress" && !day)}
                onClick={() => void act(() => publishCommunityPost(accountId, {
                  kind, visibility: audience, activityDay: day,
                  ...progress, setTitle: kind === "question_set" ? setTitle : undefined, caption,
                }), "Update shared.", true)}><Share2 size={16} /> Publish</GButton>
            </div>
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
                  <Tag tone="neutral">{post.visibility === "friends" ? "Friends" : "Community"}</Tag>
                </div>
                {post.kind === "progress" ? <div className="community-post-feature">
                  <div><Activity size={16}/><b>Daily study</b><small>{post.activity_day}</small></div>
                  <div className="community-totals"><span><b>{post.minutes}</b> min</span><span><b>{post.cards}</b> cards</span><span><b>{post.questions}</b> questions</span></div>
                </div> : <div className="community-post-feature">
                  <div><Share2 size={16}/><b>Question Set</b></div>
                  <h3>{post.set_title}</h3>
                  <small>Title shared by its owner; source content is not included.</small>
                </div>}
                {post.caption && <p className="community-post-caption">{post.caption}</p>}
                <div className="community-post-actions">
                  <GButton size="sm" disabled={busy} aria-pressed={youLiked} onClick={() => void act(() => setReaction(accountId, post.id, !youLiked), youLiked ? "Reaction removed." : "Reaction saved.")}>
                    <Heart size={15} fill={youLiked ? "currentColor" : "none"} /> {reactCounts.get(post.id) ?? 0} {youLiked ? "Liked" : "Like"}
                  </GButton>
                  {post.user_id === accountId && <GhostButton disabled={busy} onClick={() => void act(() => deleteCommunityPost(accountId, post.id), "Post removed.")}><Trash2 size={15} /> Delete</GhostButton>}
                </div>
              </article>;
            })}</div>
          </GlassCard>
        </div>
        <aside className="community-aside stack">
          <GlassCard pad>
            <PanelHeader headingLevel={2} title="Friends leaderboard" sub="Last 7 days, shared activity only." />
            <div className="community-ranking">
              {rankings.length === 0 && <p className="sub">Share a study day to appear. Scores never expose private logs.</p>}
              {rankings.map((rank, idx) => <div key={rank.userId} className="community-rank">
                <div><span className="community-rank-number">{idx + 1}</span><b>{rank.userId === accountId ? "You" : person(rank.userId)}</b><strong>{Math.round(rank.minutes / 6) / 10} h</strong></div>
                <div className="community-rank-track"><i style={{ width: (rank.minutes / maxMinutes) * 100 + "%" }} /></div>
                <small>{rank.days} days shared · {rank.cards} cards · {rank.questions} questions</small>
              </div>)}
            </div>
            <p className="sub"><Trophy size={14} /> Self-shared totals, not independently verified. AXOM Daily Challenges retain separate server-verified standings.</p>
            <a className="ghost-btn" href="#leaderboards">Open Daily Challenges</a>
          </GlassCard>
          <GlassCard pad>
            <PanelHeader headingLevel={2} title="Find friends" sub="Searchable accounts that chose to join Community." />
            {incoming.length > 0 && <div className="community-invites"><h3>Requests for you</h3>
              {incoming.map(connection => <div key={connection.id} className="community-person">
                <span className="community-avatar">{initials(person(connection.requester_id))}</span>
                <span className="grow"><b>{person(connection.requester_id)}</b><small>Wants to connect</small></span>
                <GButton size="sm" disabled={busy} onClick={() => void act(() => acceptFriend(accountId, connection.id), "Friend request accepted.")}><Check size={15} /> Accept</GButton>
                <GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, connection.id), "Request declined.")}>Decline</GhostButton>
              </div>)}
            </div>}
            {people.length === 0 ? <p className="sub">No other discoverable learners yet. Once your friend opts in, you can connect here.</p>
            : <div className="community-people">{people.map((profile: CommunityProfile) => {
              const relation = related(profile.user_id);
              return <div key={profile.user_id} className="community-person">
                <span className="community-avatar">{initials(profile.display_name)}</span>
                <span className="grow"><b>{profile.display_name}</b><small>@{profile.handle}</small></span>
                {relation?.status === "accepted" ? <GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, relation.id), "Friend removed.")}><Users size={14} /> Friends · remove</GhostButton>
                  : relation ? <span className="sub">{relation.requester_id === accountId ? "Request sent" : "Awaiting your response"}</span>
                  : <GButton size="sm" disabled={busy} onClick={() => void act(() => requestFriend(accountId, profile.user_id), "Friend request sent.")}><UserPlus size={14} /> Add</GButton>}
              </div>;
            })}</div>}
            {outgoing.length > 0 && <p className="sub">{outgoing.length} outgoing request{outgoing.length === 1 ? "" : "s"} waiting for acceptance.</p>}
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
                void act(() => leaveCommunity(accountId), "Community profile and shared activity removed.");
            }}>Leave Community</GhostButton>
          </GlassCard>
        </aside>
      </div>
    </>}
  </div>;
}