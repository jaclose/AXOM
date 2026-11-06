import type { SupabaseClient } from "@supabase/supabase-js";
import { withCommunityClient as withClient, communityProfileFields as profileFields, communityPostFields as postFields,
  communityErrorMessage as errorMessage, isRecord as row, isText as text, isCount as count,
  boundedRows as bounded, validCommunityProfile as validProfile, validCommunityPost as validPost, validCommunityDay as dayKey } from "./client";
import { readCommunityPreferences, saveCommunityPreferences } from "./preferences";
import { readOwnProgressDay } from "./progressSync";
export { readCommunityPreferences, saveCommunityPreferences, readShareMode, saveShareMode } from "./preferences";
export type { CommunityPreferences } from "./preferences";
export { syncSharedProgress, CommunityProfileMissingError, CommunityProgressConflictError } from "./progressSync";
export type { DailyTotals, ShareSyncAction, ProgressSyncOptions } from "./progressSync";
export { loadCommunityProfile, updateCommunityProfile, editCommunityPost, loadCommunityComments,
  publishCommunityComment, editCommunityComment, deleteCommunityComment } from "./conversations";
export type { CommunityComment, CommunityProfileSnapshot } from "./conversations";

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
  kind: "progress" | "question_set" | "update" | "study_invite";
  visibility: "private" | "friends" | "community";
  activity_day: string | null;
  minutes: number;
  cards: number;
  questions: number;
  set_title: string | null;
  caption: string;
  created_at: string;
  share_source?: "manual" | "automatic" | "withdrawn";
  revision?: number;
}
export interface CommunityReaction { post_id: string; user_id: string }
export interface CommunitySnapshot {
  profiles: CommunityProfile[];
  connections: CommunityConnection[];
  posts: CommunityPost[];
  reactions: CommunityReaction[];
  directoryError?: string;
  connectionsError?: string;
}

const HANDLE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const connectionFields = "id,requester_id,addressee_id,status";
const connectionPageSize = 150;
const maxConnections = 1000;

export function validCommunitySnapshot(value: unknown): value is CommunitySnapshot {
  return row(value)
    && bounded(value.profiles, maxConnections + 101, item => row(item) && [item.user_id, item.handle, item.display_name, item.bio].every(text) && typeof item.discoverable === "boolean")
    && bounded(value.connections, maxConnections, item => row(item) && [item.id, item.requester_id, item.addressee_id].every(text) && ["pending", "accepted"].includes(String(item.status)))
    && bounded(value.posts, 100, validPost)
    && bounded(value.reactions, 2000, item => row(item) && text(item.post_id) && text(item.user_id))
    && (value.directoryError === undefined || text(value.directoryError))
    && (value.connectionsError === undefined || text(value.connectionsError));
}

async function loadConnections(client: SupabaseClient): Promise<CommunityConnection[]> {
  const all: CommunityConnection[] = [];
  for (let offset = 0; offset <= maxConnections; offset += connectionPageSize) {
    const { data, error } = await client.from("social_connections").select(connectionFields)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + connectionPageSize - 1);
    if (error || !Array.isArray(data)) throw new Error("Friend connections could not be loaded. Refresh before managing friends.");
    all.push(...data as CommunityConnection[]);
    if (all.length > maxConnections) throw new Error("Your friend list is too large to show safely. Contact AXOM support before managing friends.");
    if (data.length < connectionPageSize) return all;
  }
  throw new Error("Your friend list is too large to show safely. Contact AXOM support before managing friends.");
}

async function loadConnectedProfiles(client: SupabaseClient, connections: CommunityConnection[], accountId: string): Promise<CommunityProfile[]> {
  const ids = [...new Set(connections.flatMap(connection => [connection.requester_id, connection.addressee_id]))]
    .filter(id => id !== accountId);
  const profiles: CommunityProfile[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await client.from("social_profiles").select(profileFields).in("user_id", ids.slice(offset, offset + 100)).limit(100);
    if (error || !Array.isArray(data)) throw new Error("Friend profiles could not be loaded. Refresh before managing friends.");
    profiles.push(...data as CommunityProfile[]);
  }
  return profiles;
}

/** Search only opt-in profiles. RLS remains the final visibility boundary. */
export async function searchCommunityProfiles(accountId: string, query: string): Promise<CommunityProfile[]> {
  const term = query.trim().slice(0, 80);
  if (term.length < 2) return [];
  const escaped = term.replace(/[\\%_]/g, character => `\\${character}`);
  return withClient(accountId, async client => {
    const [handles, names] = await Promise.all([
      client.from("social_profiles").select(profileFields).eq("discoverable", true).ilike("handle", `%${escaped}%`).order("handle").limit(25),
      client.from("social_profiles").select(profileFields).eq("discoverable", true).ilike("display_name", `%${escaped}%`).order("handle").limit(25),
    ]);
    if (handles.error || names.error || !Array.isArray(handles.data) || !Array.isArray(names.data)) throw new Error("Learner search is unavailable. Retry when connected.");
    const found = [...new Map([...handles.data, ...names.data].map(profile => [profile.user_id, profile as CommunityProfile])).values()]
      .filter(profile => profile.discoverable && profile.user_id !== accountId).sort((a, b) => a.handle.localeCompare(b.handle));
    if (!bounded(found, 50, item => row(item) && [item.user_id, item.handle, item.display_name, item.bio].every(text) && typeof item.discoverable === "boolean"))
      throw new Error("Learner search returned incomplete data. Retry search.");
    return found;
  });
}

/** RLS returns only discoverable people, existing friends and posts visible to the viewer.
 * Personal journals, source files and stored workspaces are never fetched here. */
export async function loadCommunity(accountId: string): Promise<CommunitySnapshot> {
  return withClient(accountId, async client => {
  const [ownProfile, directory, posts] = await Promise.all([
    client.from("social_profiles").select(profileFields).eq("user_id", accountId).limit(1),
    client.from("social_profiles").select(profileFields).order("handle").limit(100),
    client.from("social_posts").select(postFields).order("created_at", { ascending: false }).limit(100),
  ]);
  if (ownProfile.error || !Array.isArray(ownProfile.data) || posts.error) throw new Error(errorMessage);
  let connections: CommunityConnection[] = [];
  let connectionsError: string | undefined;
  try {
    connections = await loadConnections(client);
  } catch (cause) {
    connectionsError = cause instanceof Error ? cause.message : "Friend connections could not be loaded. Refresh before managing friends.";
  }
  let connectedProfiles: CommunityProfile[] = [];
  if (!connectionsError) {
    try { connectedProfiles = await loadConnectedProfiles(client, connections, accountId); }
    catch (cause) {
      connectionsError = cause instanceof Error ? cause.message : "Friend profiles could not be loaded. Refresh before managing friends.";
      connections = [];
    }
  }
  const postRows = posts.data ?? [];
  if (!Array.isArray(postRows) || postRows.some(item => !row(item) || !text(item.id))) throw new Error("Community returned incomplete activity. Refresh before continuing.");
  let reactions: CommunityReaction[] = [];
  if (postRows.length) {
    const response = await client.from("social_reactions").select("post_id,user_id").in("post_id", postRows.map(post => post.id)).limit(2000);
    if (response.error) throw new Error(errorMessage);
    reactions = (response.data ?? []) as CommunityReaction[];
  }
  const snapshot = {
    profiles: [...new Map([...(directory.error || !Array.isArray(directory.data) ? [] : directory.data), ...connectedProfiles, ...ownProfile.data]
      .map(profile => [profile.user_id, profile as CommunityProfile])).values()],
    connections,
    posts: postRows as CommunityPost[],
    reactions,
    directoryError: directory.error || !Array.isArray(directory.data) ? "The learner directory could not be loaded. Search or refresh when connected." : undefined,
    connectionsError,
  };
  if (!validCommunitySnapshot(snapshot)) throw new Error("Community returned incomplete data. Refresh before continuing.");
  return snapshot;
  });
}

export async function joinCommunity(accountId: string, handle: string, displayName: string, bio = "", discoverable?: boolean): Promise<void> {
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE.test(normalized)) throw new Error("Choose a handle of 3 to 30 lowercase letters, digits or underscores.");
  if (!displayName.trim() || displayName.trim().length > 80 || bio.length > 240) throw new Error("Check your name and bio.");
  // The legacy optional choice remains an explicit save, never a default. The
  // atomic create operation reads the latest server preference under its lock.
  if (discoverable !== undefined) {
    const preferences = await readCommunityPreferences(accountId);
    await saveCommunityPreferences(accountId, { discoverable, shareMode: preferences.shareMode });
  }
  return withClient(accountId, async client => {
  const { error } = await client.rpc("axom_create_community_profile", {
    p_handle: normalized, p_display_name: displayName.trim(), p_bio: bio.trim(),
  });
  if (error) throw new Error(error.code === "23505" ? "That handle is taken or your profile already exists. Refresh Community before trying again." : errorMessage);
  });
}

export async function setDiscoverable(accountId: string, discoverable: boolean): Promise<void> {
  const preferences = await readCommunityPreferences(accountId);
  await saveCommunityPreferences(accountId, { discoverable, shareMode: preferences.shareMode });
}
export async function leaveCommunity(accountId: string): Promise<void> {
  return withClient(accountId, async client => {
    const { error } = await client.rpc("axom_leave_community");
    if (error) throw new Error("Your Community profile could not be removed. Retry before assuming sharing has stopped.");
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
  setTitle?: string; caption: string; expectedRevision?: number;
}): Promise<void> {
  if (post.caption.length > 500 || (post.setTitle?.length ?? 0) > 160) throw new Error("This update is too long.");
  if (!["private", "friends", "community"].includes(post.visibility)) throw new Error("Choose who can see this update.");
  if (!["progress", "question_set", "update", "study_invite"].includes(post.kind)) throw new Error("Choose a valid update type.");
  if (post.kind === "progress" && !dayKey(post.activityDay)) throw new Error("Choose a valid study day.");
  if ((post.kind === "update" || post.kind === "study_invite") && !post.caption.trim()) throw new Error("Write something before posting.");
  if (post.kind === "question_set" && !post.setTitle?.trim()) throw new Error("Choose a Question Set title.");
  if (![post.minutes ?? 0, post.cards ?? 0, post.questions ?? 0].every(count)
    || (post.minutes ?? 0) > 1440 || (post.cards ?? 0) > 20000 || (post.questions ?? 0) > 20000) throw new Error("The recorded study totals are outside the supported limits.");
  return withClient(accountId, async client => {
  if (post.kind === "progress") {
    const current = await readOwnProgressDay(client, accountId, post.activityDay!);
    const { error } = await client.rpc("axom_publish_community_day", {
      p_day: post.activityDay, p_minutes: post.minutes ?? 0, p_cards: post.cards ?? 0, p_questions: post.questions ?? 0,
      p_caption: post.caption.trim(), p_visibility: post.visibility, p_expected_revision: post.expectedRevision ?? current?.revision ?? 0,
    });
    if (error) throw new Error(error.code === "PT409" ? "This day changed on another device. Refresh before posting again." : errorMessage);
    return;
  }
  const { error } = await client.from("social_posts").insert({
    user_id: accountId, kind: post.kind, visibility: post.visibility,
    activity_day: null, minutes: 0, cards: 0, questions: 0,
    set_title: post.kind === "question_set" ? post.setTitle?.trim() : null,
    caption: post.caption.trim(),
  });
  if (error) throw new Error(errorMessage);
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

export { dayProgress } from "./progressBoard";

/** Compare only activity people chose to share, never private device totals. */
export function sharedWeeklyStandings(posts: readonly CommunityPost[], today: string): Array<{ userId: string; minutes: number; cards: number; questions: number; days: number }> {
  const threshold = new Date(today + "T12:00:00");
  threshold.setDate(threshold.getDate() - 6);
  const after = [threshold.getFullYear(),String(threshold.getMonth()+1).padStart(2,"0"),String(threshold.getDate()).padStart(2,"0")].join("-");
  const byUser = new Map<string, { userId: string; minutes: number; cards: number; questions: number; days: number }>();
  const seen = new Set<string>();
  for (const post of posts) {
    if (post.visibility === "private" || post.kind !== "progress" || !post.activity_day || post.activity_day < after || post.activity_day > today
      || (post.minutes === 0 && post.cards === 0 && post.questions === 0)) continue;
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

const maxBoardPosts = 10000;
const boardPageSize = 500;
const boardError = "Leaderboards could not be loaded. Your study records are unchanged.";

export interface ProgressBoardData {
  me: CommunityProfile | null;
  friendIds: string[];
  profiles: CommunityProfile[];
  posts: CommunityPost[];
  connectionsError?: string;
}

/** Shared daily totals since `fromDay`. RLS decides what this viewer may read:
 * their own shared days, accepted friends' shared days and days posted to
 * Community by discoverable learners. Private days are never requested. */
export async function loadProgressBoard(accountId: string, fromDay: string): Promise<ProgressBoardData> {
  if (!dayKey(fromDay)) throw new Error("Choose a valid leaderboard period.");
  return withClient(accountId, async client => {
    const [own, shared] = await Promise.all([
      client.from("social_profiles").select(profileFields).eq("user_id", accountId).limit(1),
      loadAllBoardPosts(client, fromDay),
    ]);
    if (own.error || !bounded(own.data, 1, validProfile)) throw new Error(boardError);
    let friendIds: string[] = [];
    let connectionsError: string | undefined;
    try {
      friendIds = (await loadConnections(client)).filter(connection => connection.status === "accepted")
        .map(connection => connection.requester_id === accountId ? connection.addressee_id : connection.requester_id);
    } catch (cause) {
      connectionsError = cause instanceof Error ? cause.message : "Friend connections could not be loaded. Refresh before comparing friends.";
    }
    const posts = shared;
    const profiles = [...own.data as CommunityProfile[]];
    const authors = [...new Set(posts.map(post => post.user_id))].filter(id => id !== accountId);
    for (let offset = 0; offset < authors.length; offset += 100) {
      const { data, error } = await client.from("social_profiles").select(profileFields).in("user_id", authors.slice(offset, offset + 100)).limit(100);
      if (error || !bounded(data, 100, validProfile)) throw new Error(boardError);
      profiles.push(...data as CommunityProfile[]);
    }
    return { me: (own.data as CommunityProfile[])[0] ?? null, friendIds, profiles, posts, connectionsError };
  });
}


/** Read every page before ranking. Immutable UUID keysets prevent an earlier
 * deletion from shifting an unread learner past an offset. A service bound is
 * explicit; a partial board must never look like a complete ranking. */
async function loadAllBoardPosts(client: SupabaseClient, fromDay: string): Promise<CommunityPost[]> {
  const posts: CommunityPost[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page <= maxBoardPosts / boardPageSize; page++) {
    let query = client.from("social_posts").select(postFields).eq("kind", "progress").neq("visibility", "private").gte("activity_day", fromDay)
      .order("id", { ascending: true }).limit(boardPageSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error || !bounded(data, boardPageSize, validPost)) throw new Error(boardError);
    for (const post of data as CommunityPost[]) {
      if ((cursor && post.id <= cursor) || seen.has(post.id)) throw new Error("Shared activity changed while loading. Refresh the leaderboard.");
      seen.add(post.id);
      posts.push(post);
      cursor = post.id;
    }
    if (posts.length > maxBoardPosts) throw new Error("There is too much shared activity to rank safely here. Try again after the community service is updated.");
    if (data.length < boardPageSize) return posts;
  }
  throw new Error(boardError);
}
