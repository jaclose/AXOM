import { accountOperationClient } from "./account/supabase";

export interface JournalExperienceFeedbackInput {
  rating: number;
  liked: string;
  wantMore: string;
  missing: string;
  painPoints: string;
  comment: string;
}

export interface JournalExperienceFeedback extends JournalExperienceFeedbackInput {
  id: string;
  createdAt: string;
}

const limits = { liked: 1000, wantMore: 1000, missing: 1000, painPoints: 1000, comment: 2000 } as const;
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function validateJournalExperienceFeedback(input: JournalExperienceFeedbackInput): JournalExperienceFeedbackInput {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new Error("Choose a rating from 1 to 5.");
  // Project exactly the approved feedback fields. Spreading an otherwise valid
  // runtime object can retain unrelated notebook text or private metadata.
  const cleaned: JournalExperienceFeedbackInput = {
    rating: input.rating,
    liked: "",
    wantMore: "",
    missing: "",
    painPoints: "",
    comment: "",
  };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (typeof input[key] !== "string" || input[key].length > limits[key])
      throw new Error(`Keep ${key === "painPoints" ? "pain points" : key === "wantMore" ? "what you want more of" : key} under ${limits[key]} characters.`);
    cleaned[key] = input[key].trim();
  }
  return cleaned;
}

export async function submitJournalFeedback(accountId: string, input: JournalExperienceFeedbackInput): Promise<string> {
  const feedback = validateJournalExperienceFeedback(input);
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen feedback and try again.");
  await operation.assertCurrent();
  const { data, error } = await operation.client.rpc("submit_journal_experience_feedback", {
    p_rating: feedback.rating,
    p_liked: feedback.liked,
    p_want_more: feedback.wantMore,
    p_missing: feedback.missing,
    p_pain_points: feedback.painPoints,
    p_comment: feedback.comment,
  });
  if (error || !uuid(data)) throw new Error(error?.message ?? "Feedback could not be saved. Try again.");
  await operation.assertCurrent();
  return data;
}

export async function listJournalFeedback(accountId: string): Promise<JournalExperienceFeedback[]> {
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen feedback and try again.");
  await operation.assertCurrent();
  const { data, error } = await operation.client.from("journal_experience_feedback")
    .select("id,rating,liked,want_more,missing,pain_points,comment,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error || !Array.isArray(data)) throw new Error("Journal feedback could not be loaded.");
  await operation.assertCurrent();
  return data.map((row) => {
    if (!uuid(row.id) || !Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
      || Object.values({ liked: row.liked, wantMore: row.want_more, missing: row.missing,
        painPoints: row.pain_points, comment: row.comment }).some((value) => typeof value !== "string"))
      throw new Error("Journal feedback contained an invalid record.");
    return { id: row.id, rating: row.rating, liked: row.liked, wantMore: row.want_more,
      missing: row.missing, painPoints: row.pain_points, comment: row.comment, createdAt: row.created_at };
  });
}
