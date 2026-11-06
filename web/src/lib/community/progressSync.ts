import type { SupabaseClient } from "@supabase/supabase-js";
import { isCount, isRecord, isText, validCommunityDay, withCommunityClient } from "./client";
import { readCommunityPreferences } from "./preferences";
import type { DayTotals, ShareMode } from "./progressBoard";
import { isoDate } from "../scoring";

export interface DailyTotals extends DayTotals { day: string }
export type ShareSyncAction = "inserted" | "updated" | "unchanged" | "kept-private" | "skipped";
export class CommunityProfileMissingError extends Error { override name = "CommunityProfileMissingError"; }
export class CommunityProgressConflictError extends Error { override name = "CommunityProgressConflictError"; }
export interface ProgressSyncOptions { signal?: AbortSignal; consentRevision?: number }
type OwnDay = DayTotals & { id: string; revision: number; visibility: string; share_source: string };
const syncError = "Your daily totals could not be shared right now. Your study records are unchanged.";
const confirmedRevisions = new Map<string, number>();
const signature = (entry: DayTotals) => `${entry.minutes}/${entry.cards}/${entry.questions}`;

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Community sharing cancelled.", "AbortError");
}

export async function readOwnProgressDay(client: SupabaseClient, accountId: string, day: string): Promise<OwnDay | null> {
  const { data, error } = await client.from("social_posts").select("id,visibility,minutes,cards,questions,share_source,revision")
    .eq("user_id", accountId).eq("kind", "progress").eq("activity_day", day).limit(1);
  if (error || !Array.isArray(data) || data.length > 1) throw new Error(syncError);
  const item: unknown = data[0];
  if (item === undefined) return null;
  if (!isRecord(item) || !isText(item.id) || !["private", "friends", "community"].includes(String(item.visibility))
    || ![item.minutes, item.cards, item.questions, item.revision].every(isCount) || Number(item.revision) < 1
    || !["manual", "automatic", "withdrawn"].includes(String(item.share_source))) throw new Error(syncError);
  return item as unknown as OwnDay;
}

/** An existing day's revision is adopted only when this device's totals already
 * agree. A stale device cannot infer that its lower (or higher) totals are newer.
 * Subsequent local corrections compare-and-swap that confirmed revision. The
 * explicit progress composer is the resolution path for divergent devices. */
export async function syncSharedProgress(accountId: string, mode: Exclude<ShareMode, "off">, entries: readonly DailyTotals[], options: ProgressSyncOptions = {}): Promise<Array<{ day: string; action: ShareSyncAction }>> {
  if (mode !== "friends" && mode !== "community") throw new Error("Automatic sharing is off.");
  if (entries.length > 7 || !entries.every(entry => validCommunityDay(entry.day) && entry.day >= "2020-01-01"
    && [entry.minutes, entry.cards, entry.questions].every(isCount) && entry.minutes <= 1440 && entry.cards <= 20000 && entry.questions <= 20000))
    throw new Error("The recorded study totals are outside the supported limits.");
  assertNotAborted(options.signal);
  const preferences = await readCommunityPreferences(accountId);
  if (preferences.shareMode !== mode || (options.consentRevision !== undefined && options.consentRevision !== preferences.revision))
    throw new Error("Your sharing choice changed. Refresh sharing in Account settings.");
  assertNotAborted(options.signal);
  const localToday = isoDate(new Date());
  return withCommunityClient(accountId, async client => {
    const outcomes: Array<{ day: string; action: ShareSyncAction }> = [];
    for (const entry of entries) {
      assertNotAborted(options.signal);
      if (entry.day > localToday) { outcomes.push({ day: entry.day, action: "skipped" }); continue; }
      const key = `${accountId}:${entry.day}`;
      const current = await readOwnProgressDay(client, accountId, entry.day);
      assertNotAborted(options.signal);
      if (current && current.share_source !== "automatic") {
        confirmedRevisions.delete(key);
        outcomes.push({ day: entry.day, action: "kept-private" });
        continue;
      }
      if (current && signature(current) === signature(entry)) confirmedRevisions.set(key, current.revision);
      const expectedRevision = confirmedRevisions.get(key) ?? (current ? null : 0);
      let request = client.rpc("axom_sync_community_day", {
        p_day: entry.day, p_minutes: entry.minutes, p_cards: entry.cards, p_questions: entry.questions,
        p_consent_revision: preferences.revision, p_expected_revision: expectedRevision,
      });
      if (options.signal) request = request.abortSignal(options.signal);
      const { data, error } = await request;
      assertNotAborted(options.signal);
      if (error?.code === "PT412") throw new CommunityProfileMissingError("Create your Community profile before sharing daily totals.");
      if (error?.code === "PT409") throw new Error("Your sharing choice changed. Refresh sharing in Account settings.");
      if (error || !isRecord(data) || !isCount(data.revision)) throw new Error(syncError);
      if (data.action === "conflict") throw new CommunityProgressConflictError(
        `The shared totals for ${entry.day} differ from this device. In Community, publish Daily progress for that day to choose this device's totals.`,
      );
      if (!["inserted", "updated", "unchanged", "kept-private", "skipped"].includes(String(data.action))) throw new Error(syncError);
      if (data.revision > 0 && ["inserted", "updated", "unchanged"].includes(String(data.action))) confirmedRevisions.set(key, data.revision);
      outcomes.push({ day: entry.day, action: data.action as ShareSyncAction });
    }
    return outcomes;
  });
}

export function resetCommunityProgressRevisionsForTests() { confirmedRevisions.clear(); }
