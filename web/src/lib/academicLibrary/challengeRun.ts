import { academicClient } from "./client";
import { academicAccountScope } from "./accountScope";
import { useStore } from "../store";
import { localVaultStorage, flushLocalVaultWrites, assertVaultWritesSince, getVaultWriteCheckpoint } from "../localVault";
import { STORAGE_KEYS } from "../brand";
import { sha256 } from "../compressedText";
import type { QuizSession } from "../quiz";
import type { DailyChallenge } from "./challenges";

/** A durable reference to the existing quiz, never another answer/progress store. */
export interface ChallengeRunIntent {
  version: 1; accountId: string; challengeId: string; revisionId: string; day: string;
  sessionId: string; startedAt: string; keys: Array<[string, string]>;
}
const intentKey = (account: string, challenge: string) => `axom.dailyChallenge.intent.v1:${encodeURIComponent(account)}:${encodeURIComponent(challenge)}`;

async function withChallengeLock<T>(accountId: string, challengeId: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("This browser cannot safely coordinate daily challenge saves. Open AXOM in a current browser using HTTPS; your personal work is preserved.");
  return navigator.locks.request(intentKey(accountId, challengeId), run);
}

export async function readChallengeRun(accountId: string, challengeId: string): Promise<ChallengeRunIntent | undefined> {
  const raw = await localVaultStorage.getItem(intentKey(accountId, challengeId));
  if (!raw) return;
  const value = JSON.parse(raw) as ChallengeRunIntent;
  if (!value || value.version !== 1 || value.accountId !== accountId || value.challengeId !== challengeId
    || typeof value.sessionId !== "string" || !value.sessionId || value.sessionId.length > 200
    || typeof value.revisionId !== "string" || typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)
    || !Number.isFinite(Date.parse(value.startedAt)) || !Array.isArray(value.keys) || !value.keys.length || value.keys.length > 100
    || value.keys.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(key => typeof key !== "string" || !key || key.length > 500))
    || new Set(value.keys.map(pair => pair[0])).size !== value.keys.length
    || new Set(value.keys.map(pair => pair[1])).size !== value.keys.length) throw new Error("The saved challenge reference could not be read. Your personal quiz remains preserved.");
  return value;
}

export async function prepareChallengeRun(accountId: string, challenge: DailyChallenge, mapping: Map<string, string>): Promise<ChallengeRunIntent> {
  const scope = academicAccountScope(accountId);
  try {
    return await withChallengeLock(accountId, challenge.id, async () => {
      scope.assertCurrent();
      if (await readChallengeRun(accountId, challenge.id)) throw new Error("Resume or verify this saved challenge before starting another.");
      scope.assertCurrent();
      const intent: ChallengeRunIntent = { version: 1, accountId, challengeId: challenge.id, revisionId: challenge.revisionId, day: challenge.day,
        sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(), keys: [...mapping] };
      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(intentKey(accountId, challenge.id), JSON.stringify(intent));
      await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint); scope.assertCurrent();
      return intent;
    });
  } finally { scope.dispose(); }
}

/** Only an explicit live completion or learner retry enters this path. Refresh,
 * sign-in and reconnect never promote an unverified/offline quiz automatically. */
export async function verifyChallengeRun(intent: ChallengeRunIntent, cancelled = () => false): Promise<number> {
  const scope = academicAccountScope(intent.accountId);
  const assertCurrent = () => { scope.assertCurrent(); if (cancelled()) throw new Error("Verification paused. Your saved challenge can be retried."); };
  try {
    assertCurrent();
    // Zustand subscribers run before persistence enqueues the canonical session.
    await Promise.resolve(); await flushLocalVaultWrites(); assertCurrent();
    const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    const persisted = raw ? JSON.parse(raw) as { state?: { quizSessions?: QuizSession[] } } : undefined;
    const sessions = persisted?.state?.quizSessions;
    const session = Array.isArray(sessions) ? sessions.find(item => item.id === intent.sessionId) : undefined;
    const mapping = new Map(intent.keys);
    if (!session || session.questionIds.length !== mapping.size || session.questionIds.some(id => !mapping.has(id))
      || session.answers.some(answer => !mapping.has(answer.questionId))) throw new Error("Finish saving this quiz before verifying its daily answers. Your personal work is preserved.");
    const saved = await readChallengeRun(intent.accountId, intent.challengeId);
    if (!saved || saved.sessionId !== intent.sessionId) throw new Error("This saved challenge changed. Reopen today's standings before retrying.");
    assertCurrent();
    const client = await academicClient(intent.accountId);
    let checked = 0;
    for (const answer of session.answers) {
      if (!answer.answerKey) continue;
      assertCurrent();
      const key = mapping.get(answer.questionId)!;
      const hash = await sha256(new TextEncoder().encode(JSON.stringify(["daily-attempt-v1", intent.accountId, intent.challengeId, session.id, key])));
      const event = `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const { data, error } = await client.rpc("academic_submit_challenge", { challenge: intent.challengeId, question_key: key, answer_key: answer.answerKey,
        assisted: session.mode !== "exam", event_id: event });
      assertCurrent();
      if (error || !(data?.accepted === true || data?.reason === "already-attempted")) throw new Error("Your personal answers are saved. Daily verification is incomplete. Retry verification when connected; new points require the same UTC day and active participation.");
      checked++;
    }
    // Never retire another tab's newer run. Lost acknowledgements safely replay
    // the same event ids against the server's existing idempotency constraints.
    await withChallengeLock(intent.accountId, intent.challengeId, async () => {
      if ((await readChallengeRun(intent.accountId, intent.challengeId))?.sessionId === intent.sessionId) {
        assertCurrent(); const checkpoint = getVaultWriteCheckpoint();
        await localVaultStorage.removeItem(intentKey(intent.accountId, intent.challengeId));
        await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
      }
    });
    return checked;
  } finally { scope.dispose(); }
}

export function observeChallengeRun(intent: ChallengeRunIntent, report: (message: string) => void, refreshed: () => void, settled: () => void, busy: (value: boolean) => void): () => void {
  // A completed quiz found after reload requires an explicit retry, not replay.
  let seen = useStore.getState().quizSessions.some(session => session.id === intent.sessionId);
  let disposed = false;
  const unsubscribe = useStore.subscribe(state => {
    if (seen || !state.quizSessions.some(session => session.id === intent.sessionId)) return;
    seen = true;
    busy(true); report("Checking daily answers with the server…");
    void verifyChallengeRun(intent, () => disposed).then(checked => {
      if (!disposed) { busy(false); report(`${checked} answers checked by the server. Repeated questions earn no additional points.`); refreshed(); settled(); }
    }).catch(cause => { if (!disposed) { busy(false); report(cause instanceof Error ? cause.message : "Your personal answers are saved. Retry daily verification when connected."); } });
  });
  return () => { disposed = true; unsubscribe(); };
}
