import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionRecord } from "../questions";
import { preflightQuestionMedia, requiredMediaIdentity, requiredQuestionMedia,
  type MediaPreflightResult, type MediaProgress } from "./mediaPreflight";

export type MediaGateState =
  | { phase: "idle" }
  | { phase: "checking"; progress: MediaProgress }
  | { phase: "blocked"; result: MediaPreflightResult };

/** One media-verification coordinator shared by native and exam-simulator
 * launches. It has no store, database or independent academic identity. */
export function useMediaGate() {
  const verified = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<MediaGateState>({ phase: "idle" });

  const isReadyIdentity = useCallback((identity: string) => !identity || verified.current.has(identity), []);
  const isReady = useCallback((questions: readonly QuestionRecord[]) =>
    isReadyIdentity(requiredMediaIdentity(questions)), [isReadyIdentity]);

  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    verified.current.clear();
    setState({ phase: "idle" });
  }, []);

  const verify = useCallback((
    questions: readonly QuestionRecord[],
    onReady: () => void,
    { fresh = false }: { fresh?: boolean } = {},
  ) => {
    const identity = requiredMediaIdentity(questions);
    // Each NEW session must read the current bytes, even if identical
    // metadata passed during an earlier block in this mounted QBank page.
    // The cached proof is only valid for the session currently in progress.
    if (fresh) verified.current.delete(identity);
    if (!identity || (!fresh && verified.current.has(identity))) {
      setState({ phase: "idle" });
      onReady();
      return;
    }
    controller.current?.abort();
    const current = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    const total = questions.reduce((sum, question) => sum + requiredQuestionMedia(question).length, 0);
    setState({ phase: "checking", progress: { total, checked: 0, available: 0, blocked: 0 } });
    void preflightQuestionMedia(questions, {
      signal: request.signal,
      onProgress: (progress) => {
        if (generation.current === current && !request.signal.aborted) setState({ phase: "checking", progress });
      },
    }).then((result) => {
      if (request.signal.aborted || generation.current !== current) return;
      controller.current = null;
      if (result.cancelled || result.issues.length) {
        setState({ phase: "blocked", result });
        return;
      }
      verified.current.add(identity);
      setState({ phase: "idle" });
      onReady();
    }).catch(() => {
      if (request.signal.aborted || generation.current !== current) return;
      controller.current = null;
      setState({ phase: "blocked", result: {
        total, available: 0, decoded: 0, hashesVerified: 0,
        issues: questions.length ? [{ questionId: questions[0].id, assetId: "media-loader", code: "lookup-failed" }] : [],
        blockedQuestionIds: questions.map((question) => question.id), cancelled: false,
      } });
    });
  }, []);

  useEffect(() => () => { generation.current += 1; controller.current?.abort(); }, []);
  return { state, isReady, isReadyIdentity, verify, cancel };
}
