import { Activity, BookOpen, Clock3, MessageCircle, Users } from "lucide-react";
import type { CommunityPost } from "../../lib/community/community";

export const audienceLabel = (value: CommunityPost["visibility"]) => value === "private" ? "Only me" : value === "friends" ? "Friends" : "Community";
export const postKindLabel = (kind: CommunityPost["kind"]) => kind === "progress" ? "Daily study" : kind === "question_set" ? "Question Set" : kind === "study_invite" ? "Study invitation" : "Update";

export function communityDate(value: string, includeTime = false) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined,
    { month: "short", day: "numeric", ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}) }) : "Date unavailable";
}

export function CommunityPostContent({ post }: { post: CommunityPost }) {
  return <>
    {post.kind === "progress" && <div className="community-post-feature">
      <div className="community-post-kind"><Activity size={16} aria-hidden="true" /><b>Daily study</b>
        <time dateTime={post.activity_day ?? undefined}>{post.activity_day ? communityDate(post.activity_day) : ""}</time></div>
      <div className="community-totals">
        <span><Clock3 size={14} aria-hidden="true" /><b>{post.minutes.toLocaleString()}</b> min</span>
        <span><b>{post.cards.toLocaleString()}</b> cards</span>
        <span><b>{post.questions.toLocaleString()}</b> questions</span>
      </div>
      <small>Study log totals. Not independently verified.</small>
    </div>}
    {post.kind === "question_set" && <div className="community-post-feature">
      <div className="community-post-kind"><BookOpen size={16} aria-hidden="true" /><b>Question Set</b></div>
      <h3>{post.set_title}</h3><small>Celebrating a set. Its questions and source files are not included.</small>
    </div>}
    {(post.kind === "update" || post.kind === "study_invite") && <div className={`community-post-kind community-kind-${post.kind}`}>
      {post.kind === "study_invite" ? <Users size={15} aria-hidden="true" /> : <MessageCircle size={15} aria-hidden="true" />}
      <span>{postKindLabel(post.kind)}</span>
    </div>}
    {post.caption && <p className="community-post-caption">{post.caption}</p>}
  </>;
}
