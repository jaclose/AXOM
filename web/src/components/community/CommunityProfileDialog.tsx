import { useEffect, useMemo, useState } from "react";
import { Flame, Pencil, RefreshCw, UserRound } from "lucide-react";
import { loadCommunityProfile, type CommunityPost, type CommunityProfile } from "../../lib/community/community";
import { progressBoard, formatBoardValue } from "../../lib/community/progressBoard";
import { isoDate } from "../../lib/scoring";
import { GButton, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { CommunityAvatar } from "./CommunityIdentity";
import { audienceLabel, CommunityPostContent, communityDate } from "./CommunityPostContent";

export function CommunityProfileDialog({ accountId, userId, onClose, onEdit, connectionAction, refreshKey = 0 }: {
  accountId: string; userId: string; onClose: () => void; onEdit: () => void; connectionAction?: React.ReactNode; refreshKey?: number;
}) {
  const [result, setResult] = useState<{ profile: CommunityProfile | null; posts: CommunityPost[] }>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(12);
  const today = isoDate(new Date());

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setResult(undefined);
    void loadCommunityProfile(accountId, userId).then(value => { if (active) setResult(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "This profile could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, userId, refresh, refreshKey]);

  const row = useMemo(() => result ? progressBoard(result.posts, {
    today, me: userId, friendIds: new Set<string>(), scope: "friends", metric: "minutes", periodDays: 30,
  }).find(item => item.userId === userId) : undefined, [result, today, userId]);
  const profile = result?.profile;
  const visiblePosts = result?.posts.slice(0, visibleCount) ?? [];

  return <Modal title={profile ? `${profile.display_name}'s profile` : "Community profile"} onClose={onClose}
    className="community-dialog community-profile-dialog" bodyClassName="community-dialog-body">
    {loading && <div className="community-loading" role="status"><UserRound size={24} aria-hidden="true" /><p>Opening profile…</p></div>}
    {error && <div role="alert" className="community-error"><p>{error}</p>
      <GButton size="sm" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Retry profile</GButton></div>}
    {result && !profile && <div className="community-empty"><UserRound size={24} aria-hidden="true" />
      <h3>This profile is unavailable</h3><p>The learner may have left Community or changed who can find them.</p></div>}
    {profile && <>
      <div className="community-profile-heading"><CommunityAvatar name={profile.display_name} large />
        <div><h2>{profile.display_name}</h2><p>@{profile.handle}</p></div>
        {userId === accountId ? <GButton size="sm" onClick={onEdit}><Pencil size={14} aria-hidden="true" /> Edit profile</GButton> : connectionAction}
      </div>
      {profile.bio && <p className="community-profile-bio">{profile.bio}</p>}
      <section className="community-profile-study" aria-label="Shared study in the last 30 days">
        <div className="community-section-heading"><h3>Shared study</h3><span>Last 30 days</span></div>
        {row ? <>
          <dl className="community-profile-stats">
            <div><dt>Study time</dt><dd>{formatBoardValue(row.minutes, "minutes")}</dd></div>
            <div><dt>Questions</dt><dd>{row.questions.toLocaleString()}</dd></div>
            <div><dt>Cards</dt><dd>{row.cards.toLocaleString()}</dd></div>
          </dl>
          <p className="community-profile-streak"><Flame size={17} aria-hidden="true" />
            <strong>{row.streak >= 30 ? "30+" : row.streak}-day shared streak</strong>
            <span>{row.days} {row.days === 1 ? "day" : "days"} shared in this period</span>
          </p>
          <p className="sub">Only days shared with you are counted. Private study and days outside this window are not included.</p>
        </> : <p className="sub">No shared study totals in this period. Everyone can take part without sharing their progress.</p>}
      </section>
      <section className="community-profile-activity" aria-label="Recent visible activity">
        <div className="community-section-heading"><h3>Recent activity</h3><span>Visible to you</span></div>
        {visiblePosts.length ? visiblePosts.map(post => <article className="community-profile-post" key={post.id}>
          <div className="community-profile-post-meta"><time dateTime={post.created_at}>{communityDate(post.created_at)}</time><Tag tone="neutral">{audienceLabel(post.visibility)}</Tag></div>
          <CommunityPostContent post={post} />
        </article>) : <p className="sub">No posts to show yet.</p>}
        {result && result.posts.length > visiblePosts.length && <div className="community-profile-more">
          <p className="sub">Showing {visiblePosts.length} recent posts. Shared study totals include the full 30-day window available to you.</p>
          <GButton size="sm" onClick={() => setVisibleCount(value => value + 12)}>Show more activity</GButton>
        </div>}
      </section>
    </>}
  </Modal>;
}
