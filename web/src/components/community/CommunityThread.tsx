import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, Pencil, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  deleteCommunityComment, editCommunityComment, loadCommunityComments, publishCommunityComment,
  type CommunityComment,
} from "../../lib/community/community";
import { GButton, GhostButton } from "../ui/primitives";
import { CommunityPersonButton } from "./CommunityIdentity";
import { communityDate } from "./CommunityPostContent";
import type { CommunityDraftCache } from "./communityDraftCache";

export function CommunityThread({ accountId, postId, canReply, refreshKey = 0, draftCache, onOpenProfile }: {
  accountId: string; postId: string; canReply: boolean; refreshKey?: number; draftCache?: CommunityDraftCache; onOpenProfile: (id: string) => void;
}) {
  const [comments, setComments] = useState<CommunityComment[]>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState(draftCache?.replies.get(postId)?.draft ?? "");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | undefined>(draftCache?.replies.get(postId)?.editing);
  const [editBody, setEditBody] = useState(draftCache?.replies.get(postId)?.editBody ?? "");
  const [editUpdatedAt, setEditUpdatedAt] = useState<string | undefined>(draftCache?.replies.get(postId)?.editUpdatedAt);
  const [removing, setRemoving] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestEpoch = useRef(0);

  useEffect(() => {
    if (!draftCache) return;
    if (draft || editing) draftCache.replies.set(postId, { draft, editing, editBody, editUpdatedAt });
    else draftCache.replies.delete(postId);
  }, [draftCache, postId, draft, editing, editBody, editUpdatedAt]);

  useEffect(() => {
    let active = true;
    requestEpoch.current += 1;
    setLoading(true); setError("");
    setLoadingMore(false);
    void loadCommunityComments(accountId, postId).then(value => { if (active) { setComments(value); setHasMore(value.length === 100); } })
      .catch(cause => { if (active) { setComments(undefined); setError(cause instanceof Error ? cause.message : "Replies could not be loaded."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; requestEpoch.current += 1; };
  }, [accountId, postId, refresh, refreshKey]);

  async function loadMore() {
    if (!comments || loading || loadingMore) return;
    const epoch = requestEpoch.current;
    setLoadingMore(true); setError("");
    try {
      const next = await loadCommunityComments(accountId, postId, comments.length);
      if (epoch !== requestEpoch.current) return;
      setComments(current => [...new Map([...(current ?? []), ...next].map(comment => [comment.id, comment])).values()]);
      setHasMore(next.length === 100);
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        setComments(undefined); setHasMore(false);
        setError(cause instanceof Error ? cause.message : "More replies could not be loaded.");
      }
    } finally { if (epoch === requestEpoch.current) setLoadingMore(false); }
  }

  async function mutate(effect: () => Promise<void>, success: string, after: () => void) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await effect(); after(); setMessage(success); setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your reply could not be saved. Your draft is still here."); }
    finally { setBusy(false); }
  }

  return <section className="community-thread" aria-label="Post replies">
    <div className="community-section-heading"><h3><CornerDownRight size={15} aria-hidden="true" /> Replies{comments ? ` · ${comments.length}` : ""}</h3>
      <GhostButton disabled={busy || loading} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh replies"><RefreshCw size={14} aria-hidden="true" /></GhostButton></div>
    {loading && !comments && <p role="status" className="sub">Loading replies…</p>}
    {error && <div role="alert" className="community-error"><p>{error}</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>Retry replies</GButton></div>}
    {comments?.length === 0 && <p className="sub">Start the conversation. A thoughtful reply can make someone’s day.</p>}
    {comments && comments.length > 0 && <ol className="community-replies">
      {comments.map(comment => <li key={comment.id} className="community-reply">
        <div className="community-reply-heading"><CommunityPersonButton profile={comment.author} name={comment.user_id === accountId ? "You" : "Learner"}
          onClick={() => onOpenProfile(comment.user_id)} /><time dateTime={comment.created_at}>{communityDate(comment.created_at, true)}</time></div>
        {editing === comment.id ? <form className="community-reply-edit" onSubmit={event => {
          event.preventDefault(); void mutate(() => editCommunityComment(accountId, comment.id, editBody, editUpdatedAt), "Your reply is updated.", () => setEditing(undefined));
        }}>
          <label>Edit your reply<textarea value={editBody} maxLength={500} rows={3} required disabled={busy} onChange={event => setEditBody(event.target.value)} /></label>
          <div className="community-form-actions"><GhostButton type="button" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</GhostButton>
            <GButton type="submit" size="sm" disabled={busy || !editBody.trim()}><Check size={14} aria-hidden="true" /> Save reply</GButton></div>
        </form> : <p className="community-reply-body">{comment.body}</p>}
        {comment.user_id === accountId && editing !== comment.id && <div className="community-reply-actions">
          <GhostButton disabled={busy} onClick={() => { setEditing(comment.id); setEditBody(comment.body); setEditUpdatedAt(comment.updated_at); setRemoving(undefined); }}><Pencil size={13} aria-hidden="true" /> Edit reply</GhostButton>
          <GhostButton disabled={busy} onClick={() => setRemoving(removing === comment.id ? undefined : comment.id)}><Trash2 size={13} aria-hidden="true" /> Delete reply</GhostButton>
        </div>}
        {removing === comment.id && <div className="community-confirm" role="group" aria-label="Confirm reply removal"><p>Remove your reply?</p>
          <GButton size="sm" variant="danger" disabled={busy} onClick={() => void mutate(() => deleteCommunityComment(accountId, comment.id), "Your reply is removed.", () => setRemoving(undefined))}>Remove reply</GButton>
          <GhostButton disabled={busy} onClick={() => setRemoving(undefined)}>Keep reply</GhostButton></div>}
      </li>)}
    </ol>}
    {hasMore && comments && <GButton size="sm" disabled={loading || loadingMore || busy} onClick={() => void loadMore()}>
      {loadingMore ? "Loading more replies…" : "Load more replies"}</GButton>}
    {canReply ? <form className="community-reply-composer" onSubmit={event => {
      event.preventDefault(); if (draft.trim()) void mutate(() => publishCommunityComment(accountId, postId, draft), "Your reply is posted.", () => setDraft(""));
    }}>
      <label>Write a reply<textarea value={draft} maxLength={500} rows={2} required disabled={busy} placeholder="Add to the conversation…" onChange={event => setDraft(event.target.value)} /></label>
      <div className="community-form-actions"><span className="sub">{draft.length}/500 · Same audience as this post</span>
        <GButton type="submit" size="sm" disabled={busy || !draft.trim()}><Send size={14} aria-hidden="true" /> {busy ? "Saving…" : "Post reply"}</GButton></div>
    </form> : <p className="sub">Create your community profile to join the conversation.</p>}
    {message && <p role="status" className="sub">{message}</p>}
  </section>;
}
