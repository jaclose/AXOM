import { accountOperationClient, loadSupabase } from "../account/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { academicAccountScope } from "../academicLibrary/accountScope";
import { SHARE_MODE_KEY, shareModeFrom, type DayTotals, type ShareMode } from "./progressBoard";

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
  directoryError?: string;
  connectionsError?: string;
}

const HANDLE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const errorMessage = "The community could not be reached. Your local work has not changed.";
const profileFields = "user_id,handle,display_name,bio,discoverable";
const connectionFields = "id,requester_id,addressee_id,status";
const connectionPageSize = 150;
const maxConnections = 1000;

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
    && bounded(value.profiles, maxConnections + 101, item => row(item) && [item.user_id, item.handle, item.display_name, item.bio].every(text) && typeof item.discoverable === "boolean")
    && bounded(value.connections, maxConnections, item => row(item) && [item.id, item.requester_id, item.addressee_id].every(text) && ["pending", "accepted"].includes(String(item.status)))
    && bounded(value.posts, 100, item => row(item) && [item.id, item.user_id, item.caption, item.created_at].every(text)
      && ["progress", "question_set"].includes(String(item.kind)) && ["private", "friends", "community"].includes(String(item.visibility))
      && (item.activity_day === null || text(item.activity_day)) && (item.set_title === null || text(item.set_title))
      && count(item.minutes) && count(item.cards) && count(item.questions))
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
    client.from("social_posts").select("id,user_id,kind,visibility,activity_day,minutes,cards,questions,set_title,caption,created_at").order("created_at", { ascending: false }).limit(100),
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

export async function joinCommunity(accountId: string, handle: string, displayName: string, bio = "", discoverable = false): Promise<void> {
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE.test(normalized)) throw new Error("Choose a handle of 3 to 30 lowercase letters, digits or underscores.");
  if (!displayName.trim() || displayName.trim().length > 80 || bio.length > 240) throw new Error("Check your name and bio.");
  return withClient(accountId, async client => {
  const { error } = await client.from("social_profiles").insert({
    user_id: accountId, handle: normalized, display_name: displayName.trim(), bio: bio.trim(),
    discoverable, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.code === "23505" ? "That handle is taken or your profile already exists. Refresh Community before trying again." : errorMessage);
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

export { dayProgress } from "./progressBoard";

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

const postFields = "id,user_id,kind,visibility,activity_day,minutes,cards,questions,set_title,caption,created_at";
const maxBoardPosts = 2000;
const boardError = "Leaderboards could not be loaded. Your study records are unchanged.";
const syncError = "Your daily totals could not be shared right now. Your study records are unchanged.";
const validProfile = (item: unknown) => row(item) && [item.user_id, item.handle, item.display_name, item.bio].every(text) && typeof item.discoverable === "boolean";
const validPost = (item: unknown) => row(item) && [item.id, item.user_id, item.caption, item.created_at].every(text)
  && ["progress", "question_set"].includes(String(item.kind)) && ["private", "friends", "community"].includes(String(item.visibility))
  && (item.activity_day === null || text(item.activity_day)) && (item.set_title === null || text(item.set_title))
  && count(item.minutes) && count(item.cards) && count(item.questions);
const dayKey = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));

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
      client.from("social_posts").select(postFields).eq("kind", "progress").neq("visibility", "private").gte("activity_day", fromDay)
        .order("activity_day", { ascending: false }).order("id", { ascending: true }).limit(maxBoardPosts),
    ]);
    if (own.error || shared.error || !bounded(own.data, 1, validProfile) || !bounded(shared.data, maxBoardPosts, validPost)) throw new Error(boardError);
    let friendIds: string[] = [];
    let connectionsError: string | undefined;
    try {
      friendIds = (await loadConnections(client)).filter(connection => connection.status === "accepted")
        .map(connection => connection.requester_id === accountId ? connection.addressee_id : connection.requester_id);
    } catch (cause) {
      connectionsError = cause instanceof Error ? cause.message : "Friend connections could not be loaded. Refresh before comparing friends.";
    }
    const posts = shared.data as CommunityPost[];
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

/** The sharing choice lives on the account, so every signed-in device agrees. The
 * stored session carries it and is renewed with every token, so app start costs no
 * request; `fresh` asks the server, catching a change made on another device. */
export async function readShareMode(accountId: string, options: { fresh?: boolean } = {}): Promise<ShareMode> {
  const shared = await loadSupabase();
  if (!shared) return "off";
  if (!options.fresh) {
    const { data: { session } } = await shared.auth.getSession();
    if (!session) throw new Error("Your sharing choice could not be checked. Sign in again.");
    if (session.user.id !== accountId) throw new Error("The signed-in account changed. Reopen Community.");
    return shareModeFrom(session.user.user_metadata);
  }
  const { data, error } = await shared.auth.getUser();
  if (error || !data.user) throw new Error("Your sharing choice could not be checked. Retry when connected.");
  if (data.user.id !== accountId) throw new Error("The signed-in account changed. Reopen Community.");
  return shareModeFrom(data.user.user_metadata);
}

export async function saveShareMode(accountId: string, mode: ShareMode): Promise<void> {
  if (mode !== "off" && mode !== "friends" && mode !== "community") throw new Error("Choose who sees your daily totals.");
  const shared = await loadSupabase();
  if (!shared) throw new Error("Accounts aren’t configured in this build.");
  const { data: { session } } = await shared.auth.getSession();
  if (session?.user.id !== accountId) throw new Error("The signed-in account changed. Reopen Community.");
  const { data, error } = await shared.auth.updateUser({ data: { [SHARE_MODE_KEY]: mode } });
  if (error || data.user?.id !== accountId || shareModeFrom(data.user.user_metadata) !== mode) {
    throw new Error("Your sharing choice could not be saved. Nothing new was shared.");
  }
}

export interface DailyTotals extends DayTotals { day: string }
export type ShareSyncAction = "inserted" | "updated" | "unchanged" | "kept-private" | "skipped";
/** Thrown when automatic sharing runs for an account that has no Community profile. */
export class CommunityProfileMissingError extends Error { override name = "CommunityProfileMissingError"; }
type OwnDay = { id: string; visibility: CommunityPost["visibility"]; minutes: number; cards: number; questions: number };

async function readOwnDay(client: SupabaseClient, accountId: string, day: string): Promise<OwnDay | null> {
  const { data, error } = await client.from("social_posts").select("id,visibility,minutes,cards,questions")
    .eq("user_id", accountId).eq("kind", "progress").eq("activity_day", day).limit(1);
  if (error || !Array.isArray(data) || data.length > 1) throw new Error(syncError);
  const item: unknown = data[0];
  if (item === undefined) return null;
  if (!row(item) || !text(item.id) || !["private", "friends", "community"].includes(String(item.visibility))
    || ![item.minutes, item.cards, item.questions].every(count)) throw new Error(syncError);
  return item as OwnDay;
}

/** Keeps the learner's automatic daily posts current. A figure never drops below a
 * larger one another device already shared, and a day posted as "Only me" is never
 * widened. Days after today's UTC date wait, because the server would refuse them. */
export async function syncSharedProgress(accountId: string, mode: Exclude<ShareMode, "off">, entries: readonly DailyTotals[]): Promise<Array<{ day: string; action: ShareSyncAction }>> {
  if (mode !== "friends" && mode !== "community") throw new Error("Automatic sharing is off.");
  if (entries.length > 7 || !entries.every(entry => dayKey(entry.day) && entry.day >= "2020-01-01" && [entry.minutes, entry.cards, entry.questions].every(count)
    && entry.minutes <= 1440 && entry.cards <= 20000 && entry.questions <= 20000)) throw new Error("The recorded study totals are outside the supported limits.");
  const utcToday = new Date().toISOString().slice(0, 10);
  return withClient(accountId, async client => {
    const outcomes: Array<{ day: string; action: ShareSyncAction }> = [];
    for (const entry of entries) {
      if (entry.day > utcToday) { outcomes.push({ day: entry.day, action: "skipped" }); continue; }
      let current = await readOwnDay(client, accountId, entry.day);
      if (!current) {
        if (!entry.minutes && !entry.cards && !entry.questions) { outcomes.push({ day: entry.day, action: "skipped" }); continue; }
        const { error } = await client.from("social_posts").insert({
          user_id: accountId, kind: "progress", visibility: mode, activity_day: entry.day,
          minutes: entry.minutes, cards: entry.cards, questions: entry.questions, set_title: null, caption: "",
        });
        if (!error) { outcomes.push({ day: entry.day, action: "inserted" }); continue; }
        if (error.code === "23503") throw new CommunityProfileMissingError("Join Community before sharing your daily totals.");
        if (error.code !== "23505") throw new Error(syncError);
        current = await readOwnDay(client, accountId, entry.day);
        if (!current) throw new Error(syncError);
      }
      if (current.visibility === "private") { outcomes.push({ day: entry.day, action: "kept-private" }); continue; }
      const next = {
        minutes: Math.max(current.minutes, entry.minutes), cards: Math.max(current.cards, entry.cards),
        questions: Math.max(current.questions, entry.questions), visibility: mode,
      };
      if (next.minutes === current.minutes && next.cards === current.cards && next.questions === current.questions && current.visibility === mode) {
        outcomes.push({ day: entry.day, action: "unchanged" });
        continue;
      }
      const updated = await client.from("social_posts").update(next).eq("id", current.id).eq("user_id", accountId).select("id");
      if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) throw new Error(syncError);
      outcomes.push({ day: entry.day, action: "updated" });
    }
    return outcomes;
  });
}
