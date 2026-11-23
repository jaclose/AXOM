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
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, min: number, max: number): value is string => typeof value === "string"
  && Array.from(value.trim()).length >= min && Array.from(value).length <= max && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
const invalidPage = (): never => { throw new Error("The daily challenge response is invalid."); };
const invalidStandings = (): never => { throw new Error("Standings could not be refreshed. Your personal answers remain saved."); };

/** Validate the complete server contract before an RPC result reaches the shared QBank UI. */
export function readDailyChallenges(data: unknown): DailyChallenge[] {
  if (!Array.isArray(data) || data.length > 24) return invalidPage();
  const seenChallenges = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalidPage();
    const challenge = item as Record<string, unknown>;
    if (!uuid(challenge.id) || seenChallenges.has(challenge.id)
      || !uuid(challenge.collectionId) || !uuid(challenge.revisionId)
      || !text(challenge.module, 1, 180) || !day(challenge.day)
      || !count(challenge.questionCount) || challenge.questionCount < 1 || challenge.questionCount > 100
      || !Array.isArray(challenge.questions) || challenge.questions.length !== challenge.questionCount) return invalidPage();
    seenChallenges.add(challenge.id);
    const participation = challenge.participation;
    if (participation !== null) {
      if (!participation || typeof participation !== "object" || Array.isArray(participation)) return invalidPage();
      const entry = participation as Record<string, unknown>;
      if (!text(entry.alias, 2, 32) || typeof entry.visible !== "boolean") return invalidPage();
    }
    const seenKeys = new Set<string>();
    for (const item of challenge.questions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return invalidPage();
      const question = item as Record<string, unknown>;
      if (!text(question.key, 3, 400) || !text(question.bankId, 1, 160)
        || !text(question.questionId, 1, 160)
        || question.key !== question.bankId + ":" + question.questionId
        || typeof question.sourceChecksum !== "string"
        || !/^sha256:[a-f0-9]{64}$/.test(question.sourceChecksum)
        || seenKeys.has(question.key)) return invalidPage();
      seenKeys.add(question.key);
    }
  }
  return data as DailyChallenge[];
}

/** Unverified ranks or counts must not be presented as learner achievements. */
export function readDailyStandings(data: unknown): DailyStandings {
  if (!data || typeof data !== "object" || Array.isArray(data)) return invalidStandings();
  const standings = data as Record<string, unknown>;
  if (!Array.isArray(standings.rows) || standings.rows.length > 100
    || !count(standings.participants) || standings.rows.length > standings.participants
    || (standings.yourRank !== null && (!count(standings.yourRank)
      || standings.yourRank < 1 || standings.yourRank > standings.participants))) return invalidStandings();
  let ownRows = 0;
  for (const item of standings.rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalidStandings();
    const row = item as Record<string, unknown>;
    if (!text(row.alias, 2, 32) || !count(row.points) || !count(row.answered) || row.answered > 100
      || row.points > row.answered || !count(row.rank) || row.rank < 1 || row.rank > standings.participants
      || typeof row.you !== "boolean") return invalidStandings();
    if (row.you) {
      ownRows += 1;
      if (ownRows > 1 || row.rank !== standings.yourRank) return invalidStandings();
    }
  }
  return data as DailyStandings;
}

export async function listDailyChallenges(accountId: string): Promise<DailyChallenge[]> {
  const { data,error } = await (await academicClient(accountId)).rpc("academic_daily_challenges");
  if (error) throw new Error("Daily challenges could not be loaded. Retry when connected.");
  return readDailyChallenges(data);
}
export async function challengeStandings(accountId: string, challenge: string): Promise<DailyStandings> {
  const { data,error } = await (await academicClient(accountId)).rpc("academic_challenge_standings",{ challenge });
  if (error) invalidStandings();
  return readDailyStandings(data);
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
