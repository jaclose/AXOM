import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Heart, LockKeyhole, RefreshCw, Share2, Trophy, UserPlus, Users, EyeOff, Trash2 } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import { useStore } from "../lib/store";
import { isoDate } from "../lib/scoring";
import {
  acceptFriend, dayProgress, deleteCommunityPost, joinCommunity, leaveCommunity, loadCommunity,
  publishCommunityPost, reportCommunityPost, removeFriend, requestFriend, setDiscoverable, setReaction, sharedWeeklyStandings,
  type CommunityConnection, type CommunityProfile, type CommunitySnapshot,
} from "../lib/community/community";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { operatorRole, useAccountIdentity } from "../lib/operator/hostClient";
import "../styles/community.css";

type PostKind = "progress" | "question_set";
type Audience = "private" | "friends" | "community";
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
  const [hostAvailable, setHostAvailable] = useState(false);
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

  useEffect(() => {
    let active = true;
    setHostAvailable(false);
    if (accountId) void operatorRole(accountId).then(role => { if (active) setHostAvailable(Boolean(role)); }).catch(() => {});
    return () => { active = false; };
  }, [accountId]);
  const mine = data?.profiles.find(p => p.user_id === accountId);
  const profiles = useMemo(() => new Map(data?.profiles.map(p => [p.user_id, p]) ?? []), [data]);
  const relationships = useMemo(() => data?.connections ?? [], [data?.connections]);
  const friendIds = useMemo(() => new Set(relationships.filter(c => c.status === "accepted" && accountId).map(c => otherPerson(c, accountId!))), [relationships, accountId]);
  const incoming = relationships.filter(c => c.status === "pending" && c.addressee_id === accountId);
  const outgoing = relationships.filter(c => c.status === "pending" && c.requester_id === accountId);
  const people = (data?.profiles ?? []).filter(p => p.user_id !== accountId && (p.discoverable || friendIds.has(p.user_id))
    && [p.display_name, p.handle].some(value => value.toLowerCase().includes(peopleSearch.trim().toLowerCase())));
  const progress = useMemo(() => dayProgress(logs, day), [logs, day]);
  const rankings = useMemo(() => sharedWeeklyStandings(
    (data?.posts ?? []).filter(post => post.user_id === accountId || friendIds.has(post.user_id)), today
  ), [data, friendIds, today, accountId]);
  const maxMinutes = Math.max(1, ...rankings.map(r => r.minutes));
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
      {hostAvailable && <a className="ghost-btn" href="#host">Host dashboard</a>}
    </div>
    {loading && <p role="status">Loading shared activity…</p>}
    {error && <div role="alert" className="community-error"><p>{error}</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefreshId(value => value + 1)}>Retry Community</GButton></div>}
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
      <p className="sub">Your journal, notes, question answers, exam results and study history are never posted automatically.</p>
      <GButton type="submit" variant="primary" disabled={busy}>{busy ? "Creating profile…" : "Create profile"}</GButton>
      </form>
    </GlassCard>}

    {data && mine && <>
      <div className="community-grid">
        <div className="community-main stack">
          <GlassCard pad className="community-composer">
            <PanelHeader headingLevel={2} title="Share an update" sub="Posting is manual. Others see only this card, never your underlying workspace." />
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
            <label className="community-search">Find someone<input value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)} placeholder="Name or handle" /></label>
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
            {outgoing.length > 0 && <div className="community-invites"><h3>Requests you sent</h3>{outgoing.map(connection => <div className="community-person" key={connection.id}><span className="grow"><b>{person(connection.addressee_id)}</b><small>Waiting for acceptance</small></span><GhostButton disabled={busy} onClick={() => void act(() => removeFriend(accountId, connection.id), "Friend request cancelled.")}>Cancel request</GhostButton></div>)}</div>}
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
