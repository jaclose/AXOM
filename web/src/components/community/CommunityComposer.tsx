import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, LockKeyhole, MessageCircle, Send, Users } from "lucide-react";
import { dayProgress, publishCommunityPost, type CommunityPost, type CommunityProfile } from "../../lib/community/community";
import { useStore } from "../../lib/store";
import { isoDate } from "../../lib/scoring";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import { CommunityAvatar } from "./CommunityIdentity";

const TYPES = [
  { id: "update", label: "Update", Icon: MessageCircle },
  { id: "study_invite", label: "Study together", Icon: Users },
  { id: "progress", label: "Daily progress", Icon: Activity },
  { id: "question_set", label: "Question Set", Icon: BookOpen },
] as const;

export interface CommunityComposerDraft {
  kind: CommunityPost["kind"]; audience: CommunityPost["visibility"]; day: string; caption: string; setId: string;
}

export function CommunityComposer({ accountId, profile, posts, onPublished, progressReview = 0, initialDraft, onDraftChange }: {
  accountId: string; profile: CommunityProfile; posts: CommunityPost[]; onPublished: (message: string) => void; progressReview?: number;
  initialDraft?: CommunityComposerDraft; onDraftChange?: (draft: CommunityComposerDraft) => void;
}) {
  const logs = useStore(state => state.logs);
  const sets = useStore(state => state.questionSets);
  const today = isoDate(new Date());
  // Privacy is explicit for every post, independent of automatic daily sharing.
  const [kind, setKind] = useState<CommunityPost["kind"]>(initialDraft?.kind ?? "update");
  const [audience, setAudience] = useState<CommunityPost["visibility"]>(initialDraft?.audience ?? "private");
  const [day, setDay] = useState(initialDraft?.day ?? today);
  const [caption, setCaption] = useState(initialDraft?.caption ?? "");
  const [setId, setSetId] = useState(initialDraft?.setId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const studyDayRef = useRef<HTMLInputElement>(null);
  const progress = useMemo(() => dayProgress(logs, day), [logs, day]);
  const selectedSet = sets.find(set => set.id === setId);
  const existingDay = kind === "progress" ? posts.find(post => post.user_id === accountId && post.kind === "progress" && post.activity_day === day) : undefined;
  const needsCaption = kind === "update" || kind === "study_invite";
  const valid = (!needsCaption || Boolean(caption.trim())) && (kind !== "progress" || Boolean(day))
    && (kind !== "question_set" || Boolean(selectedSet?.title?.trim()));

  useEffect(() => { if (progressReview > 0) setKind("progress"); }, [progressReview]);
  useEffect(() => { if (progressReview > 0 && kind === "progress") studyDayRef.current?.focus(); }, [progressReview, kind]);
  // The account-keyed page retains this draft through a failed feed refresh.
  // It never enters localStorage, a backup or another account's component tree.
  useEffect(() => { onDraftChange?.({ kind, audience, day, caption, setId }); }, [kind, audience, day, caption, setId, onDraftChange]);

  async function publish() {
    if (saving || !valid) return;
    setSaving(true); setError("");
    try {
      await publishCommunityPost(accountId, {
        kind, visibility: audience, caption,
        ...(kind === "progress" ? { activityDay: day, ...progress, expectedRevision: existingDay?.revision } : {}),
        ...(kind === "question_set" ? { setTitle: selectedSet!.title } : {}),
      });
      setCaption(""); setAudience("private");
      onPublished(audience === "private" ? "Your post is saved for only you." : existingDay ? "Your daily post is updated." : "Your post is shared.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your post could not be confirmed. Your draft is still here.");
    } finally { setSaving(false); }
  }

  return <GlassCard pad className="community-composer">
    <div className="community-composer-heading"><CommunityAvatar name={profile.display_name} />
      <PanelHeader headingLevel={2} title="Share an update" sub="A small win, a good question, or an invitation to study." /></div>
    <form onSubmit={event => { event.preventDefault(); void publish(); }}>
      <div className="community-choice" role="group" aria-label="Update type">
        {TYPES.map(({ id, label, Icon }) => <button key={id} type="button" className={kind === id ? "selected" : ""}
          aria-pressed={kind === id} disabled={saving} onClick={() => { setKind(id); setError(""); }}>
          <Icon size={15} aria-hidden="true" />{label}
        </button>)}
      </div>
      {kind === "progress" && <div className="community-day">
        <label>Study day <input ref={studyDayRef} type="date" value={day} max={today} min="2020-01-01" required disabled={saving}
          onChange={event => setDay(event.target.value)} /></label>
        <dl className="community-activity-summary">
          <div><dt>Minutes</dt><dd>{progress.minutes.toLocaleString()}</dd></div>
          <div><dt>Cards</dt><dd>{progress.cards.toLocaleString()}</dd></div>
          <div><dt>Questions logged</dt><dd>{progress.questions.toLocaleString()}</dd></div>
        </dl>
        <p className="sub">Academic activity you recorded in AXOM for this day. Only these totals and your note are included.</p>
        {existingDay && <p className="community-inline-note">You already have a post for this day. Publishing replaces its totals, note and audience with the choices here.</p>}
      </div>}
      {kind === "question_set" && <div className="community-set-picker">
        <label>Question Set to celebrate
          <select value={setId} required disabled={saving} onChange={event => setSetId(event.target.value)}>
            <option value="">Choose a set</option>
            {sets.filter(set => Boolean(set.title?.trim())).map(set => <option key={set.id} value={set.id}>{set.title}</option>)}
          </select>
        </label>
        <p className="sub">Shares the title only. The questions, files and private links stay in your workspace.</p>
        {!sets.some(set => Boolean(set.title?.trim())) && <a className="community-text-link" href="#questions">Create a set in Question Bank</a>}
      </div>}
      <label className="community-caption">{kind === "study_invite" ? "Your study invitation" : needsCaption ? "Your update" : "Write a note (optional)"}
        <textarea name="caption" value={caption} maxLength={500} rows={3} required={needsCaption} disabled={saving}
          placeholder={kind === "study_invite" ? "What are you studying, when are you starting, and how can others join?" : "What would you like to share with your circle?"}
          onChange={event => setCaption(event.target.value)} />
      </label>
      <div className="community-caption-foot"><span>{kind === "study_invite" ? "People can reply to plan a session with you." : "Your words appear exactly as you write them."}</span>
        <span>{caption.length}/500</span></div>
      <div className="community-publish">
        <label>Who can see this?
          <select value={audience} disabled={saving} onChange={event => setAudience(event.target.value as CommunityPost["visibility"])}>
            <option value="private">Only me</option><option value="friends">Accepted friends</option><option value="community">Community</option>
          </select>
        </label>
        <GButton type="submit" variant="primary" disabled={saving || !valid}><Send size={15} aria-hidden="true" />
          {saving ? "Publishing…" : existingDay ? "Update day" : audience === "private" ? "Save post" : "Publish"}
        </GButton>
      </div>
      {audience === "community" && !profile.discoverable && <p className="community-inline-note">Your profile is hidden from discovery. This post reaches your friends; make your profile discoverable in account settings to reach Community.</p>}
      <p className="community-composer-privacy"><LockKeyhole size={13} aria-hidden="true" /> Only me is the default for every post. Your notes, answers and sources stay private.</p>
      {error && <p role="alert" className="community-error">{error}</p>}
    </form>
  </GlassCard>;
}
