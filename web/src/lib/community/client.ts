import { accountOperationClient } from "../account/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { academicAccountScope } from "../academicLibrary/accountScope";

/** The transport is bound to the account that started the operation. Switching
 * away and back still invalidates it; no result can populate a different user. */
export async function withCommunityClient<T>(accountId: string, run: (client: SupabaseClient) => Promise<T>): Promise<T> {
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

export const communityProfileFields = "user_id,handle,display_name,bio,discoverable";
export const communityPostFields = "id,user_id,kind,visibility,activity_day,minutes,cards,questions,set_title,caption,created_at,share_source,revision";
export const communityErrorMessage = "The community could not be reached. Your local work has not changed.";
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === "string";
export const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const boundedRows = (value: unknown, max: number, check: (item: unknown) => boolean): value is unknown[] => Array.isArray(value) && value.length <= max && value.every(check);
export const validCommunityProfile = (item: unknown) => isRecord(item) && [item.user_id, item.handle, item.display_name, item.bio].every(isText) && typeof item.discoverable === "boolean";
export const validCommunityPost = (item: unknown) => isRecord(item) && [item.id, item.user_id, item.caption, item.created_at].every(isText)
  && ["progress", "question_set", "update", "study_invite"].includes(String(item.kind)) && ["private", "friends", "community"].includes(String(item.visibility))
  && (item.activity_day === null || isText(item.activity_day)) && (item.set_title === null || isText(item.set_title))
  && isCount(item.minutes) && isCount(item.cards) && isCount(item.questions)
  && (item.revision === undefined || (isCount(item.revision) && item.revision > 0))
  && (item.share_source === undefined || ["manual", "automatic", "withdrawn"].includes(String(item.share_source)));

export const validCommunityDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
