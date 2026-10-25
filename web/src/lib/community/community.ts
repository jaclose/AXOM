import { accountOperationClient } from "../account/supabase";
import type { StudyLog } from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { academicAccountScope } from "../academicLibrary/accountScope";

export interface CommunityProfile {
  user_id: string;
  handle: string;
  display_name: string;
  bio: string;
  discoverable: boolean;
}
export interface CommunityConnection {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
}
export interface CommunityPost {
  id: string;
  user_id: string;
  kind: "progress" | "question_set";
  visibility: "private" | "friends" | "community";
  activity_day: string | null;
  minutes: number;
  cards: number;
  questions: number;
  set_title: string | null;
  caption: string;
  created_at: string;
}
export interface CommunityReaction { post_id: string; user_id: string }
export interface CommunitySnapshot {
  profiles: CommunityProfile[];
  connections: CommunityConnection[];
  posts: CommunityPost[];
  reactions: CommunityReaction[];
}

const HANDLE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const errorMessage = "The community could not be reached. Your local work has not changed.";

async function withClient<T>(accountId: string, run: (client: SupabaseClient) => Promise<T>): Promise<T> {
  const guard = academicAccountScope(accountId);
  try {
    guard.assertCurrent();
    const scope = await accountOperationClient();
    guard.assertCurrent();
    if (scope.userId !== accountId) throw new Error("The signed-in account changed. Reopen Community.");
    await scope.assertCurrent();
    const result = await run(scope.client);
    guard.assertCurrent();
    await scope.assertCurrent();
    guard.assertCurrent();
    return result;
  } finally { guard.dispose(); }
}

const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string";
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const bounded = (value: unknown, max: number, check: (item: unknown) => boolean) => Array.isArray(value) && value.length <= max && value.every(check);
export function validCommunitySnapshot(value: unknown): value is CommunitySnapshot {
  return row(value)
    && bounded(value.profiles, 100, item => row(item) && [item.user_id, item.handle, item.display_name, item.bio].every(text) && typeof item.discoverable === "boolean")
    && bounded(value.connections, 150, item => row(item) && [item.id, item.requester_id, item.addressee_id].every(text) && ["pending", "accepted"].includes(String(item.status)))
    && bounded(value.posts, 100, item => row(item) && [item.id, item.user_id, item.caption, item.created_at].every(text)
      && ["progress", "question_set"].includes(String(item.kind)) && ["private", "friends", "community"].includes(String(item.visibility))
      && (item.activity_day === null || text(item.activity_day)) && (item.set_title === null || text(item.set_title))
      && count(item.minutes) && count(item.cards) && count(item.questions))
    && bounded(value.reactions, 2000, item => row(item) && text(item.post_id) && text(item.user_id));
}

/** RLS returns only discoverable people, existing friends and posts visible to the viewer.
 * Personal journals, source files and stored workspaces are never fetched here. */
export async function loadCommunity(accountId: string): Promise<CommunitySnapshot> {
  return withClient(accountId, async client => {
  const [profiles, connections, posts] = await Promise.all([
    client.from("social_profiles").select("user_id,handle,display_name,bio,discoverable").order("handle").limit(100),
    client.from("social_connections").select("id,requester_id,addressee_id,status").order("created_at", { ascending: false }).limit(150),
    client.from("social_posts").select("id,user_id,kind,visibility,activity_day,minutes,cards,questions,set_title,caption,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  if (profiles.error || connections.error || posts.error) throw new Error(errorMessage);
  const postRows = posts.data ?? [];
  if (!Array.isArray(postRows) || postRows.some(item => !row(item) || !text(item.id))) throw new Error("Community returned incomplete activity. Refresh before continuing.");
  let reactions: CommunityReaction[] = [];
  if (postRows.length) {
    const response = await client.from("social_reactions").select("post_id,user_id").in("post_id", postRows.map(post => post.id)).limit(2000);
    if (response.error) throw new Error(errorMessage);
    reactions = (response.data ?? []) as CommunityReaction[];
  }
  const snapshot = {
    profiles: (profiles.data ?? []) as CommunityProfile[],
    connections: (connections.data ?? []) as CommunityConnection[],
    posts: postRows as CommunityPost[],
    reactions,
  };
  if (!validCommunitySnapshot(snapshot)) throw new Error("Community returned incomplete data. Refresh before continuing.");
  return snapshot;
  });
}

export async function joinCommunity(accountId: string, handle: string, displayName: string, bio = "", discoverable = false): Promise<void> {
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE.test(normalized)) throw new Error("Choose a handle of 3 to 30 lowercase letters, digits or underscores.");
  if (!displayName.trim() || displayName.trim().length > 80 || bio.length > 240) throw new Error("Check your name and bio.");
  return withClient(accountId, async client => {
  const { error } = await client.from("social_profiles").upsert({
    user_id: accountId, handle: normalized, display_name: displayName.trim(), bio: bio.trim(),
    discoverable, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw new Error(error.code === "23505" ? "This handle is taken. Choose another." : errorMessage);
  });
}

export async function setDiscoverable(accountId: string, discoverable: boolean): Promise<void> {
  return withClient(accountId, async client => {
    const { data, error } = await client.from("social_profiles").update({ discoverable, updated_at: new Date().toISOString() }).eq("user_id", accountId).select("user_id");
    if (error || data?.length !== 1) throw new Error("Your privacy choice could not be confirmed. Refresh before retrying.");
  });
}
export async function leaveCommunity(accountId: string): Promise<void> {
  return withClient(accountId, async client => {
  const { error } = await client.from("social_profiles").delete().eq("user_id", accountId);
  if (error) throw new Error(errorMessage);
  });
}
export async function requestFriend(accountId: string, otherId: string): Promise<void> {
  if (otherId === accountId) return;
  return withClient(accountId, async client => {
  const { error } = await client.from("social_connections").insert({ requester_id: accountId, addressee_id: otherId, status: "pending" });
  if (error) throw new Error(error.code === "23505" ? "A request or friendship already exists." : errorMessage);
  });
}
export async function acceptFriend(accountId: string, connectionId: string): Promise<void> {
  return withClient(accountId, async client => {
  const { data, error } = await client.from("social_connections")
    .update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", connectionId).eq("addressee_id", accountId).eq("status", "pending").select("id");
  if (error || data?.length !== 1) throw new Error("This request is no longer available.");
  });
}
export async function removeFriend(accountId: string, connectionId: string): Promise<void> {
  return withClient(accountId, async client => {
  const { error } = await client.from("social_connections").delete().eq("id", connectionId);
  if (error) throw new Error(errorMessage);
  });
}
export async function publishCommunityPost(accountId: string, post: {
  kind: CommunityPost["kind"]; visibility: CommunityPost["visibility"];
  activityDay?: string; minutes?: number; cards?: number; questions?: number;
  setTitle?: string; caption: string;
}): Promise<void> {
  if (post.caption.length > 500 || (post.setTitle?.length ?? 0) > 160) throw new Error("This update is too long.");
  if (!["private", "friends", "community"].includes(post.visibility)) throw new Error("Choose who can see this update.");
  if (post.kind === "progress" && (!post.activityDay || !/^\d{4}-\d{2}-\d{2}$/.test(post.activityDay)
    || !Number.isFinite(Date.parse(`${post.activityDay}T12:00:00Z`)))) throw new Error("Choose a valid study day.");
  if (post.kind === "question_set" && !post.setTitle?.trim()) throw new Error("Choose a Question Set title.");
  if (![post.minutes ?? 0, post.cards ?? 0, post.questions ?? 0].every(count)
    || (post.minutes ?? 0) > 1440 || (post.cards ?? 0) > 20000 || (post.questions ?? 0) > 20000) throw new Error("The recorded study totals are outside the supported limits.");
  return withClient(accountId, async client => {
  const { error } = await client.from("social_posts").insert({
    user_id: accountId, kind: post.kind, visibility: post.visibility,
    activity_day: post.kind === "progress" ? post.activityDay : null,
    minutes: post.kind === "progress" ? post.minutes ?? 0 : 0,
    cards: post.kind === "progress" ? post.cards ?? 0 : 0,
    questions: post.kind === "progress" ? post.questions ?? 0 : 0,
    set_title: post.kind === "question_set" ? post.setTitle?.trim() : null,
    caption: post.caption.trim(),
  });
  if (error) throw new Error(error.code === "23505" ? "You already saved progress for this day. Remove the earlier post before publishing another." : errorMessage);
  });
}
export async function deleteCommunityPost(accountId: string, postId: string): Promise<void> {
  return withClient(accountId, async client => {
  const { error } = await client.from("social_posts").delete().eq("id", postId).eq("user_id", accountId);
  if (error) throw new Error(errorMessage);
  });
}
export async function setReaction(accountId: string, postId: string, liked: boolean): Promise<void> {
  return withClient(accountId, async client => {
  const response = liked
    ? await client.from("social_reactions").insert({ user_id: accountId, post_id: postId })
    : await client.from("social_reactions").delete().eq("user_id", accountId).eq("post_id", postId);
  if (response.error && !(liked && response.error.code === "23505")) throw new Error(errorMessage);
  });
}

export async function reportCommunityPost(accountId: string, postId: string,
  reason: "spam" | "harassment" | "copyright" | "inaccurate" | "other"): Promise<void> {
  return withClient(accountId, async client => {
  const { error } = await client.from("social_post_reports").insert({
    post_id: postId, reporter_id: accountId, reason,
  });
  if (error) throw new Error(error.code === "23505" ? "You have already reported this post." : errorMessage);
  });
}

/** Shares only a per-day aggregate and only after the learner explicitly publishes.
 * Duplicate log IDs are ignored as in the existing personal leaderboard. */
export function dayProgress(logs: readonly StudyLog[], dayKey: string): { minutes: number; cards: number; questions: number } {
  const ids = new Set<string>();
  let minutes = 0, cards = 0, questions = 0;
  for (const log of logs) {
    if (log.dayKey !== dayKey || log.academic === false || ids.has(log.id)) continue;
    ids.add(log.id);
    if (Number.isFinite(log.minutes)) minutes += Math.max(0, log.minutes);
    if (Number.isFinite(log.cards)) cards += Math.max(0, log.cards);
    if (log.quantityKind === "questions" && Number.isFinite(log.quantity)) questions += Math.max(0, log.quantity ?? 0);
  }
  return { minutes: Math.min(1440, Math.round(minutes)), cards: Math.min(20000, Math.round(cards)), questions: Math.min(20000, Math.round(questions)) };
}

/** Compare only activity people chose to share, never private device totals. */
export function sharedWeeklyStandings(posts: readonly CommunityPost[], today: string): Array<{ userId: string; minutes: number; cards: number; questions: number; days: number }> {
  const threshold = new Date(today + "T12:00:00");
  threshold.setDate(threshold.getDate() - 6);
  const after = [threshold.getFullYear(),String(threshold.getMonth()+1).padStart(2,"0"),String(threshold.getDate()).padStart(2,"0")].join("-");
  const byUser = new Map<string, { userId: string; minutes: number; cards: number; questions: number; days: number }>();
  const seen = new Set<string>();
  for (const post of posts) {
    if (post.visibility === "private" || post.kind !== "progress" || !post.activity_day || post.activity_day < after || post.activity_day > today) continue;
    const dayIdentity = `${post.user_id}:${post.activity_day}`;
    if (seen.has(dayIdentity)) continue;
    seen.add(dayIdentity);
    const current = byUser.get(post.user_id) ?? { userId: post.user_id, minutes: 0, cards: 0, questions: 0, days: 0 };
    current.minutes += post.minutes;
    current.cards += post.cards;
    current.questions += post.questions;
    current.days += 1;
    byUser.set(post.user_id, current);
  }
  return [...byUser.values()].sort((a,b) => b.minutes-a.minutes || b.questions-a.questions || b.cards-a.cards || a.userId.localeCompare(b.userId));
}
