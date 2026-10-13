import { academicClient } from "./client";
import { academicAccountScope } from "./accountScope";
import { useStore } from "../store";
import { flushLocalVaultWrites, assertVaultWritesSince, getVaultWriteCheckpoint } from "../localVault";
import { sha256 } from "../compressedText";
import type { DailyChallenge } from "./challenges";

/** Observe completed canonical quiz sessions. No parallel attempt store, no
 * replay of historical/offline activity on sign-in, and no client total score. */
export function observeChallengeRun(accountId: string, challenge: DailyChallenge, mapping: Map<string,string>, startedAt: string,
  report: (message: string) => void, refreshed: () => void): () => void {
  const scope = academicAccountScope(accountId);
  const seen = new Set(useStore.getState().quizSessions.map(session => session.id));
  let disposed = false;
  const unsubscribe = useStore.subscribe(state => {
    for (const session of state.quizSessions) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      if (session.startedAt < startedAt || session.questionIds.length !== mapping.size || session.questionIds.some(id => !mapping.has(id))) continue;
      const checkpoint = getVaultWriteCheckpoint();
      void (async () => {
        try {
          report("Checking daily answers with the server…");
          // Zustand persistence enqueues its write after store subscribers.
          await Promise.resolve();
          await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint); scope.assertCurrent();
          const client = await academicClient(accountId);
          let accepted = 0;
          for (const answer of session.answers) {
            if (!answer.answerKey) continue;
            if (disposed) return;
            scope.assertCurrent();
            const key = mapping.get(answer.questionId)!;
            const hash = await sha256(new TextEncoder().encode(JSON.stringify(["daily-attempt-v1",accountId,challenge.id,session.id,key])));
            const event = `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
            const { data,error } = await client.rpc("academic_submit_challenge",{ challenge:challenge.id,question_key:key,answer_key:answer.answerKey,
              assisted:session.mode!=="exam",event_id:event });
            scope.assertCurrent();
            if (error) throw new Error("Your answers are saved personally. The daily score could not be confirmed; refresh standings when connected. Offline answers are not added later automatically.");
            if (data?.accepted) accepted++;
          }
          if (!disposed) { report(`${accepted} answers checked by the server. Repeated questions earn no additional points.`); refreshed(); }
        } catch (cause) { if (!disposed) report(cause instanceof Error ? cause.message : "Personal answers are saved. Daily verification is unavailable."); }
      })();
    }
  });
  return () => { disposed = true; unsubscribe(); scope.dispose(); };
}
