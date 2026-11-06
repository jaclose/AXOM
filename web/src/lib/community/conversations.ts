import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityPost, CommunityProfile } from "./community";
import { addDays } from "./progressBoard";
import { isoDate } from "../scoring";
import {
  boundedRows, communityErrorMessage, communityPostFields, communityProfileFields, isRecord, isText,
  validCommunityPost, validCommunityProfile, withCommunityClient,
} from "./client";

export interface CommunityProfileSnapshot { profile: CommunityProfile | null; posts: CommunityPost[] }
export interface CommunityComment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at?: string;
  author?: Pick<CommunityProfile, "user_id" | "handle" | "display_name">;
}
const HANDLE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const postUnavailable = "This post is no longer available to you. Refresh Community.";

export async function updateCommunityProfile(accountId: string, profile: { handle: string; displayName: string; bio: string }): Promise<void> {
  const handle = profile.handle.trim().toLowerCase();
  const name = profile.displayName.trim();
  if (!HANDLE.test(handle)) throw new Error("Choose a handle of 3 to 30 lowercase letters, digits or underscores.");
  if (!name || name.length > 80 || profile.bio.length > 240) throw new Error("Use a name up to 80 characters and a bio up to 240 characters.");
  return withCommunityClient(accountId, async client => {
    const { data, error } = await client.from("social_profiles").update({ handle, display_name: name, bio: profile.bio.trim() })
      .eq("user_id", accountId).select("user_id");
    if (error?.code === "23505") throw new Error("That handle is already in use. Choose another one.");
    if (error || data?.length !== 1) throw new Error("Your profile could not be saved. Refresh before retrying.");
  });
}

/** Explicitly shared daily rows are loaded independently of the recent feed, so
 * a busy author cannot lose this month's stats behind 100 discussion posts. */
export async function loadCommunityProfile(accountId: string, userId: string): Promise<CommunityProfileSnapshot> {
  return withCommunityClient(accountId, async client => {
    const { data: profiles, error } = await client.from("social_profiles").select(communityProfileFields).eq("user_id", userId).limit(1);
    if (error || !boundedRows(profiles, 1, validCommunityProfile)) throw new Error("This profile could not be loaded. Try again when connected.");
    if (!profiles.length) return { profile: null, posts: [] };
    const [recent, progress] = await Promise.all([
      client.from("social_posts").select(communityPostFields).eq("user_id", userId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100),
      client.from("social_posts").select(communityPostFields).eq("user_id", userId).eq("kind", "progress")
        .gte("activity_day", addDays(isoDate(new Date()), -29)).order("activity_day", { ascending: false }).limit(31),
    ]);
    if (recent.error || progress.error || !boundedRows(recent.data, 100, validCommunityPost) || !boundedRows(progress.data, 31, validCommunityPost))
      throw new Error("This profile's shared activity could not be loaded. Refresh before comparing progress.");
    const posts = [...new Map([...recent.data, ...progress.data].map(value => {
      const post = value as CommunityPost;
      return [post.id, post] as const;
    })).values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return { profile: profiles[0] as CommunityProfile, posts };
  });
}

export async function editCommunityPost(accountId: string, postId: string, patch: {
  caption: string; visibility: CommunityPost["visibility"]; expectedRevision?: number;
}): Promise<void> {
  if (patch.caption.length > 500 || !["private", "friends", "community"].includes(patch.visibility)) throw new Error("Check your note and audience before saving.");
  return withCommunityClient(accountId, async client => {
    const current = await client.from("social_posts").select("id,kind,revision").eq("id", postId).eq("user_id", accountId).limit(1);
    if (current.error || current.data?.length !== 1) throw new Error(postUnavailable);
    if (["update", "study_invite"].includes(current.data[0].kind) && !patch.caption.trim()) throw new Error("Write something before saving this post.");
    const { data, error } = await client.from("social_posts").update({ caption: patch.caption.trim(), visibility: patch.visibility })
      .eq("id", postId).eq("user_id", accountId).eq("revision", patch.expectedRevision ?? current.data[0].revision).select("id");
    if (error) throw new Error(communityErrorMessage);
    if (data?.length !== 1) throw new Error("This post changed on another device. Refresh before editing again.");
  });
}

async function requireVisiblePost(client: SupabaseClient, postId: string) {
  const { data, error } = await client.from("social_posts").select("id").eq("id", postId).limit(1);
  if (error || data?.length !== 1) throw new Error(postUnavailable);
}

const validComment = (item: unknown) => isRecord(item) && [item.id, item.post_id, item.user_id, item.body, item.created_at].every(isText)
  && String(item.body).trim().length > 0 && String(item.body).length <= 500
  && (item.updated_at === undefined || isText(item.updated_at));

export async function loadCommunityComments(accountId: string, postId: string, offset = 0): Promise<CommunityComment[]> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Choose a valid conversation page.");
  return withCommunityClient(accountId, async client => {
    await requireVisiblePost(client, postId);
    const { data, error } = await client.from("social_comments").select("id,post_id,user_id,body,created_at,updated_at")
      .eq("post_id", postId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 99);
    if (error || !boundedRows(data, 100, validComment)) throw new Error("Replies could not be loaded. Try again when connected.");
    // Re-check after the reply query. An unfriend or withdrawal during loading
    // must not produce a successful-looking empty conversation.
    await requireVisiblePost(client, postId);
    if (!data.length) return [];
    const comments = data as CommunityComment[];
    const ids = [...new Set(comments.map(comment => comment.user_id))];
    const authors = await client.from("social_profiles").select(communityProfileFields).in("user_id", ids).limit(100);
    if (authors.error || !boundedRows(authors.data, 100, validCommunityProfile)) throw new Error("Reply authors could not be loaded. Try again when connected.");
    const profiles = new Map((authors.data as CommunityProfile[]).map(profile => [profile.user_id, profile]));
    return comments.map(comment => {
      const author = profiles.get(comment.user_id);
      return { ...comment, ...(author ? { author: { user_id: author.user_id, handle: author.handle, display_name: author.display_name } } : {}) };
    });
  });
}

function commentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || body.length > 500) throw new Error("Write a reply of 1 to 500 characters.");
  return trimmed;
}

export async function publishCommunityComment(accountId: string, postId: string, body: string): Promise<void> {
  const value = commentBody(body);
  return withCommunityClient(accountId, async client => {
    const { error } = await client.from("social_comments").insert({ user_id: accountId, post_id: postId, body: value });
    if (error) throw new Error("Your reply could not be posted. The post may have been removed or its audience changed.");
  });
}

export async function editCommunityComment(accountId: string, commentId: string, body: string, expectedUpdatedAt?: string): Promise<void> {
  const value = commentBody(body);
  return withCommunityClient(accountId, async client => {
    let updatedAt = expectedUpdatedAt;
    if (!updatedAt) {
      const current = await client.from("social_comments").select("updated_at").eq("id", commentId).eq("user_id", accountId).limit(1);
      if (current.error || current.data?.length !== 1 || !isText(current.data[0].updated_at)) throw new Error("Your reply is no longer available. Refresh the conversation.");
      updatedAt = current.data[0].updated_at;
    }
    const { data, error } = await client.from("social_comments").update({ body: value }).eq("id", commentId).eq("user_id", accountId)
      .eq("updated_at", updatedAt).select("id");
    if (error) throw new Error("Your reply could not be changed. Refresh the conversation.");
    if (data?.length !== 1) throw new Error("This reply changed on another device or is no longer available. Refresh before editing again.");
  });
}

export async function deleteCommunityComment(accountId: string, commentId: string): Promise<void> {
  return withCommunityClient(accountId, async client => {
    const { error } = await client.from("social_comments").delete().eq("id", commentId);
    if (error) throw new Error("The reply could not be removed. Refresh the conversation.");
  });
}
