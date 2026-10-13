import { academicClient } from "./client";
import { questionMappingStatus, type QuestionRecord } from "../questions";
export interface ChallengeQuestion { key: string; bankId: string; questionId: string; sourceChecksum: string }
export interface DailyChallenge {
  id: string; collectionId: string; revisionId: string; module: string; day: string; questionCount: number;
  questions: ChallengeQuestion[]; participation: { alias: string; visible: boolean } | null;
}
export interface DailyStandings {
  rows: Array<{ alias: string; points: number; answered: number; rank: number; you: boolean }>;
  yourRank: number | null; participants: number;
}
export async function listDailyChallenges(accountId: string): Promise<DailyChallenge[]> {
  const { data,error } = await (await academicClient(accountId)).rpc("academic_daily_challenges");
  if (error) throw new Error("Daily challenges could not be loaded. Retry when connected.");
  if (!Array.isArray(data) || data.length > 24 || data.some(item => !item || typeof item.id !== "string" || typeof item.module !== "string"
    || !Array.isArray(item.questions) || item.questions.length !== item.questionCount || item.questionCount < 1 || item.questionCount > 100
    || item.questions.some((q: ChallengeQuestion) => !q || ![q.key,q.bankId,q.questionId,q.sourceChecksum].every(v => typeof v === "string")))) throw new Error("The daily challenge response is invalid.");
  return data;
}
export async function challengeStandings(accountId: string, challenge: string): Promise<DailyStandings> {
  const { data,error } = await (await academicClient(accountId)).rpc("academic_challenge_standings",{ challenge });
  if (error || !data || !Array.isArray(data.rows) || data.rows.length > 100) throw new Error("Standings could not be refreshed. Your personal answers remain saved.");
  return data;
}
export async function joinChallenge(accountId: string, challenge: string, alias: string, visible: boolean): Promise<void> {
  const { error } = await (await academicClient(accountId)).rpc("academic_join_challenge",{ challenge,display_alias:alias,participate:visible });
  if (error) throw new Error("Participation could not be confirmed. Check your connection and retry.");
}
/** Exact version identity; never expand an incomplete challenge to all questions. */
export function matchChallengeQuestions(challenge: DailyChallenge, questions: readonly QuestionRecord[]): Map<string,string> {
  const ids = new Map<string,string>();
  for (const expected of challenge.questions) {
    // Older canonical imports inherited bankId from their manifest without
    // copying it to each question. Exact source hash + source question ID is a
    // safe legacy match only when it identifies one local record.
    const candidates = questions.filter(q => !q.ai?.generated && q.content?.id === expected.questionId
      && (!q.content.bankId || q.content.bankId === expected.bankId)
      && q.content.provenance.sourceChecksum === expected.sourceChecksum && questionMappingStatus(q) === "ready");
    if (candidates.length === 1) ids.set(candidates[0].id,expected.key);
  }
  if (ids.size !== challenge.questionCount) throw new Error("Load this course revision from Course Library before starting its daily challenge.");
  return ids;
}
