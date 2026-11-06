import { useEffect, useId, useState } from "react";
import { Check, Flag, Heart, MessageCircle, Pencil, Trash2 } from "lucide-react";
import {
  deleteCommunityPost, editCommunityPost, reportCommunityPost, setReaction,
  type CommunityPost, type CommunityProfile,
} from "../../lib/community/community";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { CommunityPersonButton } from "./CommunityIdentity";
import { audienceLabel, communityDate, CommunityPostContent } from "./CommunityPostContent";
import { CommunityThread } from "./CommunityThread";
import type { CommunityDraftCache } from "./communityDraftCache";

export function CommunityPostCard({ accountId, post, profile, liked, reactionCount, canParticipate, refreshKey = 0, draftCache, onChanged, onOpenProfile }: {
  accountId: string; post: CommunityPost; profile?: CommunityProfile; liked: boolean; reactionCount: number;
  canParticipate: boolean; refreshKey?: number; draftCache?: CommunityDraftCache; onChanged: (message: string) => void; onOpenProfile: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [threadOpen, setThreadOpen] = useState(() => Boolean(draftCache?.replies.get(post.id)?.draft || draftCache?.replies.get(post.id)?.editing));
  const [editing, setEditing] = useState(draftCache?.posts.get(post.id)?.editing ?? false);
  const [caption, setCaption] = useState(draftCache?.posts.get(post.id)?.caption ?? post.caption);
  const [audience, setAudience] = useState(draftCache?.posts.get(post.id)?.audience ?? post.visibility);
  const [expectedRevision, setExpectedRevision] = useState(draftCache?.posts.get(post.id)?.expectedRevision ?? post.revision);
  const [removing, setRemoving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<"spam" | "harassment" | "copyright" | "inaccurate" | "other">("other");
  const threadId = useId();
  const own = post.user_id === accountId;

  useEffect(() => {
    if (!draftCache) return;
    if (editing) draftCache.posts.set(post.id, { editing, caption, audience, expectedRevision });
    else draftCache.posts.delete(post.id);
  }, [draftCache, post.id, editing, caption, audience, expectedRevision]);

  async function mutate(effect: () => Promise<void>, success: string, after?: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { await effect(); after?.(); onChanged(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This action could not be confirmed. Please try again."); }
    finally { setBusy(false); }
  }

  return <article className={`community-post${post.kind === "study_invite" ? " community-post-invitation" : ""}`}
    aria-label={`${profile?.display_name ?? "Learner"}'s ${post.kind === "progress" ? "daily progress" : post.kind === "study_invite" ? "study invitation" : "post"}`}>
    <div className="community-post-head">
      <CommunityPersonButton profile={profile} name={own ? "You" : "Learner"} onClick={() => onOpenProfile(post.user_id)} />
      <div className="community-post-meta"><Tag tone="neutral">{audienceLabel(post.visibility)}</Tag>
        <time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>{communityDate(post.created_at, true)}</time></div>
    </div>
    {editing ? <form className="community-post-edit" onSubmit={event => {
      event.preventDefault(); void mutate(() => editCommunityPost(accountId, post.id, { caption, visibility: audience, expectedRevision }), "Your post is updated.", () => setEditing(false));
    }}>
      <label>Edit your post<textarea value={caption} maxLength={500} rows={4} disabled={busy}
        required={post.kind === "update" || post.kind === "study_invite"} onChange={event => setCaption(event.target.value)} /></label>
      <label>Who can see this?<select value={audience} disabled={busy} onChange={event => setAudience(event.target.value as CommunityPost["visibility"])}>
        <option value="private">Only me</option><option value="friends">Accepted friends</option><option value="community">Community</option>
      </select></label>
      {post.kind === "progress" && <p className="sub">Saving makes this a manually managed daily post. Use Daily progress in the composer to update its totals.</p>}
      <div className="community-form-actions"><GhostButton type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel edit</GhostButton>
        <GButton type="submit" size="sm" variant="primary" disabled={busy || ((post.kind === "update" || post.kind === "study_invite") && !caption.trim())}>
          <Check size={14} aria-hidden="true" /> {busy ? "Saving…" : "Save changes"}</GButton></div>
    </form> : <CommunityPostContent post={post} />}
    <div className="community-post-actions">
      <GButton size="sm" className="community-kudos" disabled={busy || !canParticipate} aria-pressed={liked}
        title={!canParticipate ? "Create a community profile to give kudos" : undefined}
        onClick={() => void mutate(() => setReaction(accountId, post.id, !liked), liked ? "Kudos removed." : "Kudos sent.")}>
        <Heart size={15} fill={liked ? "currentColor" : "none"} aria-hidden="true" /> {reactionCount.toLocaleString()} {liked ? "Kudos given" : "Kudos"}
      </GButton>
      <GhostButton aria-expanded={threadOpen} aria-controls={threadId} onClick={() => setThreadOpen(value => !value)}>
        <MessageCircle size={15} aria-hidden="true" /> {threadOpen ? "Hide replies" : "Replies"}
      </GhostButton>
      <div className="community-post-owner-actions">
        {own ? <>
          <GhostButton disabled={busy} onClick={() => { setCaption(post.caption); setAudience(post.visibility); setExpectedRevision(post.revision); setEditing(value => !value); setRemoving(false); }} aria-label="Edit post">
            <Pencil size={15} aria-hidden="true" /><span>Edit</span>
          </GhostButton>
          <GhostButton disabled={busy} onClick={() => { setRemoving(value => !value); setEditing(false); }} aria-label="Delete post">
            <Trash2 size={15} aria-hidden="true" /><span>Delete</span>
          </GhostButton>
        </> : <GhostButton disabled={busy || !canParticipate} onClick={() => setReporting(value => !value)} aria-label="Report post"><Flag size={14} aria-hidden="true" /><span>Report</span></GhostButton>}
      </div>
    </div>
    {removing && <div className="community-confirm" role="group" aria-label="Confirm post removal">
      <p>Remove this post and its replies? Your private study records stay intact.</p>
      <GButton size="sm" variant="danger" disabled={busy} onClick={() => void mutate(() => deleteCommunityPost(accountId, post.id), "Your post is removed.", () => {
        draftCache?.posts.delete(post.id); draftCache?.replies.delete(post.id);
      })}>Remove my post</GButton>
      <GhostButton disabled={busy} onClick={() => setRemoving(false)}>Keep post</GhostButton>
    </div>}
    {reporting && <form className="community-report-form" onSubmit={event => {
      event.preventDefault(); void mutate(() => reportCommunityPost(accountId, post.id, reason), "Your report was sent for review.", () => setReporting(false));
    }}>
      <label>Reason for reporting<select value={reason} disabled={busy} onChange={event => setReason(event.target.value as typeof reason)}>
        <option value="other">Other concern</option><option value="spam">Spam</option><option value="harassment">Harassment</option>
        <option value="copyright">Copyright concern</option><option value="inaccurate">Misleading study content</option>
      </select></label>
      <GButton type="submit" size="sm" disabled={busy}>Send report</GButton><GhostButton type="button" disabled={busy} onClick={() => setReporting(false)}>Cancel</GhostButton>
    </form>}
    {error && <p role="alert" className="community-error">{error}</p>}
    {threadOpen && <div id={threadId}><CommunityThread accountId={accountId} postId={post.id} canReply={canParticipate} refreshKey={refreshKey} draftCache={draftCache} onOpenProfile={onOpenProfile} /></div>}
  </article>;
}
