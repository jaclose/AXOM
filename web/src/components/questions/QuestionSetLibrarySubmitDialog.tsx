import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookUp2, ShieldCheck, Sparkles } from "lucide-react";
import { resolveActiveProvider } from "../../lib/ai";
import { draftQuestionExplanation, eligibleForExplanationDraft, questionExplanationFingerprint, type QuestionExplanationDraft } from "../../lib/ai/questionTeaching";
import { planMedicalVisual } from "../../lib/diagrams/publicationHints";
import { useStore } from "../../lib/store";
import { useAccount } from "../../lib/account/accountStore";
import { STORAGE_KEYS } from "../../lib/brand";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint, localVaultStorage } from "../../lib/localVault";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import { hasMainExplanation } from "../../lib/questionExplanationCoverage";
import { prepareCurrentCommunityQuestionSetSubmission, sameCommunitySetReviewRevision } from "../../lib/sharing/communitySetPublicationGuard";
import { mergeReviewedCommunityKeywords } from "../../lib/sharing/communityReviewedKeywords";
import {
  listMyQuestionSetSubmissions, submitQuestionSetToLibrary, withdrawQuestionSetSubmission,
  type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { Modal } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import "../../styles/question-set-library.css";

const AI_EXPLANATION_PREFIX = "AXOM AI-assisted explanation (verify against source): ";
const AI_RATIONALE_PREFIX = "AXOM AI-assisted rationale (verify against source): ";

/** A reviewed key may be revoked or its containing set refiled while the
 * publisher remains open. Check before transmitting private question text to
 * any AI provider, not only when persisting the generated draft afterward. */
function currentDraftInput(openedSet: QuestionSet, openedQuestion: QuestionRecord): QuestionRecord | null {
  const workspace = useStore.getState();
  const liveSet = (workspace.questionSets ?? []).find(item => item.id === openedSet.id);
  if (!sameCommunitySetReviewRevision(openedSet, liveSet) || !openedSet.questionIds.includes(openedQuestion.id)) return null;
  const liveQuestion = (workspace.questions ?? []).find(item => item.id === openedQuestion.id);
  return liveQuestion && eligibleForExplanationDraft(liveQuestion)
    && questionExplanationFingerprint(liveQuestion) === questionExplanationFingerprint(openedQuestion)
    ? liveQuestion : null;
}

export function QuestionSetLibrarySubmitDialog({ set, questions, onClose, autoDraft = false }: {
  set: QuestionSet;
  questions: readonly QuestionRecord[];
  onClose: () => void;
  /** Only for an explicit Community publish action when configured AI is real. */
  autoDraft?: boolean;
}) {
  const accountId = useAccount(state => state.user?.id);
  // The identity that opened this modal owns its private draft and rights
  // authorization. A→B→A can occur without a React render of B.
  const openingAccount = useRef(accountId);
  const sessionRevoked = useRef(false);
  const [sessionInvalidated, setSessionInvalidated] = useState(false);
  const sessionActive = !sessionRevoked.current && !sessionInvalidated && accountId === openingAccount.current;
  const [submission, setSubmission] = useState<LibrarySubmission>();
  const [checking, setChecking] = useState(true);
  const [statusIdentity, setStatusIdentity] = useState("");
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const [answers, setAnswers] = useState(false);
  // Keep the identity of the learner who actually made these attestations.
  // Account-store changes may render before the reset effect has committed.
  const [attestationAccount, setAttestationAccount] = useState(accountId);
  const attestationsForAccount = Boolean(sessionActive && accountId && attestationAccount === accountId
    && useAccount.getState().user?.id === accountId);
  const [credit, setCredit] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<QuestionExplanationDraft[]>([]);
  const [keywordEdits, setKeywordEdits] = useState<Record<string, string>>({});
  const [approvedKeywordIds, setApprovedKeywordIds] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const draftSaveOperation = useRef<object | null>(null);
  // A failed durable save may already be visible in memory. Only our exact
  // optimistic revision is eligible for retry; never overwrite a later edit.
  const draftSaveRevisions = useRef(new Map<string, { source: string; applied: string }>());
  const [generationProgress, setGenerationProgress] = useState("");
  const [generationError, setGenerationError] = useState("");
  const generationAbort = useRef<AbortController | null>(null);
  const autoDraftStarted = useRef(false);
  const autoDraftAccount = useRef(accountId);
  const autoDraftAccountChanged = useRef(false);
  const provider = useMemo(() => resolveActiveProvider(), []);
  const sourceQuestions = useMemo(() => {
    const byId = new Map(questions.map(question => [question.id, question]));
    return set.questionIds.map(id => byId.get(id));
  }, [questions, set.questionIds]);
  const unresolved = sourceQuestions.filter(question => !question || questionPracticeReadiness(question) !== "ready").length;
  const withMedia = sourceQuestions.filter(question => question && ((question.attachments?.length ?? 0) > 0
    || (question.content?.assets.length ?? 0) > 0)).length;
  const missingExplanations = sourceQuestions.filter(question => question && !hasMainExplanation(question)).length;
  const draftable = useMemo(() => sourceQuestions.filter((question): question is QuestionRecord => Boolean(question)
    && eligibleForExplanationDraft(question!) && !drafts.some(draft => draft.questionId === question!.id)),
  [sourceQuestions, drafts]);
  const visualPlans = sourceQuestions.flatMap(question => {
    if (!question) return [];
    const plan = planMedicalVisual(question);
    return plan.kind === "none" ? [] : [{ id: question.id, ...plan }];
  });

  // Observe the entire lifetime of the review, including the idle period
  // after AI results arrive and after an account has checked attestations.
  // Once revoked, reopening a fresh modal is the only authorization path.
  useEffect(() => {
    const revoke = (nextAccount?: string) => {
      if (sessionRevoked.current || nextAccount === openingAccount.current) return;
      sessionRevoked.current = true;
      generationAbort.current?.abort();
      setDrafts([]);
      setKeywordEdits({});
      setApprovedKeywordIds({});
      setGenerationProgress("");
      setRights(false);
      setAnswers(false);
      setCredit("");
      setSessionInvalidated(true);
    };
    const unsubscribe = useAccount.subscribe(state => revoke(state.user?.id));
    revoke(useAccount.getState().user?.id);
    return unsubscribe;
  }, []);

  async function refresh() {
    if (sessionRevoked.current) throw new Error("The account session changed. Reopen the set to review or publish it.");
    if (!accountId) { setStatusIdentity(""); setChecking(false); return; }
    const owned = await listMyQuestionSetSubmissions(accountId);
    if (sessionRevoked.current || useAccount.getState().user?.id !== accountId) throw new Error("The account changed during submission lookup.");
    const found = owned.find(item => item.sourceId === set.id);
    // A withdrawal RPC can succeed even if its immediate status readback
    // fails. When a later authenticated lookup confirms that the previously
    // displayed publication is gone, revoke its old source/rights grants
    // before enabling another submission. Do not revoke on a failed lookup
    // or when the original listing is still present.
    if (!found && submission?.sourceId === set.id && statusIdentity === `${accountId}:${set.id}`) {
      setRights(false);
      setAnswers(false);
    }
    setSubmission(found);
    setStatusIdentity(`${accountId}:${set.id}`);
    setChecking(false);
    return found;
  }
  useEffect(() => {
    let alive = true;
    // A status result from the previous account must never unlock another
    // account's AI processing, publication, or existing-submission controls.
    setChecking(true);
    setSubmission(undefined);
    setStatusIdentity("");
    // Account-specific publishing attestations must never follow another
    // learner across a session switch, even when this modal stays mounted.
    setRights(false);
    setAnswers(false);
    setCredit("");
    setAttestationAccount(accountId);
    setError("");
    setMessage("");
    if (!accountId) { setChecking(false); return; }
    void listMyQuestionSetSubmissions(accountId).then(owned => {
      if (alive && !sessionRevoked.current && useAccount.getState().user?.id === accountId) {
        setSubmission(owned.find(item => item.sourceId === set.id));
        setStatusIdentity(`${accountId}:${set.id}`);
        setChecking(false);
      }
    }).catch(cause => {
      if (alive && !sessionRevoked.current) { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }
    });
    return () => { alive = false; };
  }, [accountId, set.id]);

  useEffect(() => {
    setDrafts([]);
    setKeywordEdits({});
    setApprovedKeywordIds({});
    setSavingDrafts(false);
    draftSaveRevisions.current.clear();
    // Auto-drafting is authorized by an explicit publish action for the
    // account that opened it. Signing out or switching accounts revokes that
    // one-time permission; manually reopening the review is required.
    if (autoDraftAccount.current && accountId !== autoDraftAccount.current) {
      autoDraftAccountChanged.current = true;
    } else if (!autoDraftAccount.current && accountId) {
      autoDraftAccount.current = accountId;
    }
    autoDraftStarted.current = autoDraftAccountChanged.current;
    setGenerationProgress("");
    setGenerationError("");
    return () => { generationAbort.current?.abort(); draftSaveOperation.current = null; };
  }, [accountId, set.id]);

  const generateExplanations = useCallback(async () => {
    if (!provider || !sessionActive || sessionRevoked.current || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || generating || generationAbort.current || draftSaveOperation.current || !draftable.length) return;
    const controller = new AbortController();
    // An A→B→A account round trip can happen before React renders the
    // intermediate account. Revocation must observe every store transition,
    // not just compare the final account ID after the provider responds.
    let accountRevoked = false;
    const stopWatchingAccount = useAccount.subscribe(state => {
      if (state.user?.id !== accountId) {
        accountRevoked = true;
        controller.abort();
        setDrafts([]);
        setGenerationProgress("");
        setGenerationError("The account changed during AI drafting. Reopen this set before preparing explanations.");
      }
    });
    generationAbort.current = controller;
    setGenerating(true);
    setGenerationError("");
    setGenerationProgress("");
    const next: QuestionExplanationDraft[] = [];
    let failures = 0;
    try {
      // Each user-requested batch is bounded, so provider quotas and failures do not
      // trigger an uncontrolled upload of an entire private Question Bank.
      const batch = draftable.slice(0, 12);
      for (const question of batch) {
        if (controller.signal.aborted || accountRevoked || useAccount.getState().user?.id !== accountId) return;
        const liveInput = currentDraftInput(set, question);
        if (!liveInput) {
          setDrafts([]);
          setGenerationError("The Question Set or answer evidence changed before AI drafting. Reopen it before sending question content.");
          return;
        }
        try {
          const draft = await draftQuestionExplanation(provider, liveInput, controller.signal);
          if (controller.signal.aborted || accountRevoked || useAccount.getState().user?.id !== accountId) return;
          const stillCurrent = currentDraftInput(set, question);
          if (!stillCurrent || questionExplanationFingerprint(stillCurrent) !== draft.sourceFingerprint) {
            setDrafts([]);
            setGenerationError("The Question Set or answer evidence changed during AI drafting. Discarded outdated proposals; reopen the set.");
            return;
          }
          next.push(draft);
          setDrafts(previous => previous.some(item => item.questionId === draft.questionId)
            ? previous : [...previous, draft]);
          setGenerationProgress(`Prepared ${next.length} of ${batch.length} draft explanations…`);
        } catch (cause) {
          if (controller.signal.aborted) return;
          failures += 1;
          if (!next.length) setGenerationError(cause instanceof Error ? cause.message : "The AI provider could not draft this explanation.");
        }
      }
      if (controller.signal.aborted || accountRevoked || useAccount.getState().user?.id !== accountId) return;
      setGenerationProgress(next.length
        ? `${next.length} provisional explanations prepared. Inspect them before saving. ${failures ? `${failures} need manual review.` : ""}`
        : "No explanations could be drafted. Review your source or AI settings.");
    } finally {
      stopWatchingAccount();
      if (generationAbort.current === controller) generationAbort.current = null;
      setGenerating(false);
    }
  }, [provider, accountId, set, statusIdentity, generating, draftable, sessionActive]);

  useEffect(() => {
    if (!autoDraft || !sessionActive || sessionRevoked.current || checking || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || !provider || provider.info.kind === "mock"
      || !draftable.length || (submission && submission.status !== "rejected")
      || autoDraftStarted.current) return;
    // The explicit Community "Review and submit" action authorizes this capped
    // preparation. Re-renders never create additional inference batches.
    autoDraftStarted.current = true;
    void generateExplanations();
  }, [autoDraft, accountId, set.id, statusIdentity, checking, submission, provider, draftable.length, generateExplanations, sessionActive]);

  async function saveReviewedDrafts() {
    if (!sessionActive || sessionRevoked.current || generating || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || draftSaveOperation.current || !drafts.length || useAccount.getState().user?.id !== accountId) return;
    const bank = useStore.getState();
    // The fingerprint protects individual question evidence; the live set also
    // needs checking. An import, refile or removal can change membership and
    // ownership context without touching any question's updatedAt.
    const liveSet = (bank.questionSets ?? []).find(item => item.id === set.id);
    if (!sameCommunitySetReviewRevision(set, liveSet)) {
      setGenerationError("The Question Set changed during explanation review. Reopen it before saving drafts.");
      return;
    }
    const current = new Map((bank.questions ?? []).map(question => [question.id, question]));
    for (const draft of drafts) {
      const question = current.get(draft.questionId);
      const previousSave = draftSaveRevisions.current.get(draft.questionId);
      const fingerprint = question && questionExplanationFingerprint(question);
      const original = question && fingerprint === draft.sourceFingerprint && eligibleForExplanationDraft(question);
      const ownRetry = previousSave?.source === draft.sourceFingerprint && fingerprint === previousSave.applied;
      if (!question || (!original && !ownRetry) || !set.questionIds.includes(question.id)) {
        setGenerationError("One or more questions changed. Reopen the set to avoid overwriting newer work.");
        return;
      }
    }
    for (const draft of drafts) {
      const question = current.get(draft.questionId);
      const keys = question?.options.map(option => option.key) ?? [];
      if (draft.explanation.trim().length < 40 || draft.explanation.trim().length + AI_EXPLANATION_PREFIX.length > 30_000
        || keys.some(key => (draft.choiceRationales[key] ?? "").trim().length < 10
          || draft.choiceRationales[key].trim().length + AI_RATIONALE_PREFIX.length > 10_000)) {
        setGenerationError("Finish the explanation and every choice rationale before saving.");
        return;
      }
    }
    // Keywords are model-suggested, not source evidence. An explicit per-item
    // opt-in and editable review are required before changing source tags.
    // Validate the entire batch before writing even the first explanation.
    const reviewedTags = new Map<string, string[]>();
    for (const draft of drafts) {
      if (!approvedKeywordIds[draft.questionId]) continue;
      const question = current.get(draft.questionId);
      if (!question) return;
      try {
        reviewedTags.set(draft.questionId, mergeReviewedCommunityKeywords(
          question.tags, keywordEdits[draft.questionId] ?? draft.keywords.join(", ")));
      } catch (cause) {
        setGenerationError(cause instanceof Error ? cause.message : "Review suggested keywords before saving.");
        return;
      }
    }
    const operation = {};
    draftSaveOperation.current = operation;
    let accountChanged = false;
    const unsubscribe = useAccount.subscribe(state => { if (state.user?.id !== accountId) accountChanged = true; });
    const stillCurrent = () => !accountChanged && !sessionRevoked.current && draftSaveOperation.current === operation && useAccount.getState().user?.id === accountId;
    setSavingDrafts(true);
    setGenerationError("");
    setMessage("");
    const checkpoint = getVaultWriteCheckpoint();
    try {
      for (const draft of drafts) {
        if (!stillCurrent()) return;
        const patch = {
          // Teaching prose remains visibly model-assisted after sharing/import.
          explanation: `${AI_EXPLANATION_PREFIX}${draft.explanation.trim()}`,
          choiceRationales: Object.fromEntries(Object.entries(draft.choiceRationales)
            .map(([key, rationale]) => [key, `${AI_RATIONALE_PREFIX}${rationale.trim()}`])),
          ...(reviewedTags.has(draft.questionId) ? { tags: reviewedTags.get(draft.questionId)! } : {}),
        };
        bank.updateQuestion(draft.questionId, patch);
        const applied = useStore.getState().questions?.find(question => question.id === draft.questionId);
        if (!applied || applied.explanation !== patch.explanation
          || (reviewedTags.has(draft.questionId) && JSON.stringify(applied.tags) !== JSON.stringify(reviewedTags.get(draft.questionId)))
          || Object.entries(patch.choiceRationales).some(([key, rationale]) => applied.choiceRationales?.[key] !== rationale)) {
          throw new Error("A question could not be updated. Reopen the set before saving.");
        }
        draftSaveRevisions.current.set(draft.questionId, {
          source: draft.sourceFingerprint, applied: questionExplanationFingerprint(applied),
        });
      }
      const expected = new Map(draftSaveRevisions.current);
      await flushLocalVaultWrites();
      if (!stillCurrent()) return;
      assertVaultWritesSince(checkpoint);
      const raw = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
      if (!stillCurrent()) return;
      const stored = raw ? JSON.parse(raw) as { state?: { questions?: QuestionRecord[]; questionSets?: QuestionSet[] } } : null;
      const live = useStore.getState();
      if (!sameCommunitySetReviewRevision(set, live.questionSets?.find(item => item.id === set.id))
        || !sameCommunitySetReviewRevision(set, stored?.state?.questionSets?.find(item => item.id === set.id))
        || drafts.some(draft => {
          const revision = expected.get(draft.questionId)?.applied;
          const persisted = stored?.state?.questions?.find(question => question.id === draft.questionId);
          const currentQuestion = live.questions?.find(question => question.id === draft.questionId);
          return !revision || !persisted || !currentQuestion
            || questionExplanationFingerprint(persisted) !== revision
            || questionExplanationFingerprint(currentQuestion) !== revision;
        })) {
        throw new Error("The saved explanations could not be verified, or the questions changed during saving.");
      }
      setDrafts([]);
      setKeywordEdits({});
      setApprovedKeywordIds({});
      draftSaveRevisions.current.clear();
      setGenerationProgress("");
      setMessage("Reviewed explanations saved privately. They still require a source check before publication.");
    } catch (cause) {
      if (stillCurrent()) setGenerationError(`${cause instanceof Error ? cause.message : "The local save could not be confirmed."} Your drafts are still here. Retry when storage is available; reopen the set if its questions changed.`);
    } finally {
      unsubscribe();
      if (draftSaveOperation.current === operation) {
        draftSaveOperation.current = null;
        setSavingDrafts(false);
      }
    }
  }

  async function submit() {
    // The rendered account may lag behind the session store during a switch.
    // Never send another account's saved rights and answer attestations.
    if (!sessionActive || sessionRevoked.current || !accountId || statusIdentity !== `${accountId}:${set.id}`
      // Render-time attestation checks are not sufficient: the auth store can
      // switch synchronously before React rerenders the old click handler.
      || useAccount.getState().user?.id !== accountId
      || !attestationsForAccount || !rights || !answers || checking || busy || generating || draftSaveOperation.current || drafts.length
      || unresolved || withMedia || missingExplanations
      || (submission && submission.status !== "rejected")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      // Bind the publisher's attestations to the exact latest local set, including
      // source-review evidence not carried in the privacy-stripped public snapshot.
      const live = useStore.getState();
      const snapshot = prepareCurrentCommunityQuestionSetSubmission({
        openedSet: set, openedQuestions: questions,
        liveSets: live.questionSets ?? [], liveQuestions: live.questions ?? [],
      });
      const id = await submitQuestionSetToLibrary(accountId, set.id, snapshot, credit, {
        rightsConfirmed: rights, answersConfirmed: answers,
      });
      // Account-operation RPCs also assert the current session. Avoid an old
      // account's follow-up query/confirmation if it changed while awaiting.
      if (sessionRevoked.current || useAccount.getState().user?.id !== accountId) return;
      const result = await refresh();
      if (!result || result.id !== id) throw new Error("The submission could not be read back. Check its status before retrying.");
      setMessage(result?.status === "rejected"
        ? "This version was already rejected. Revise the questions before submitting again."
        : "Submission received. It will appear in search after an academic reviewer approves it.");
    } catch (cause) {
      if (useAccount.getState().user?.id !== accountId) return;
      setError(cause instanceof Error ? cause.message : "The submission could not be confirmed. Your local set is unchanged.");
      try {
        const recovered = await refresh();
        if (recovered?.status === "pending" || recovered?.status === "approved") {
          setError("");
          setMessage("Your submission is in the library review queue.");
        }
      } catch { /* The original error remains visible. */ }
    } finally { setBusy(false); }
  }

  async function withdraw() {
    // An account switch can happen while a submission is displayed or even
    // during the native confirmation prompt. Never act on another account's
    // cached submission (the server's RLS is still the final authority).
    if (!sessionActive || sessionRevoked.current || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || useAccount.getState().user?.id !== accountId || !submission
      || submission.sourceId !== set.id || checking || busy || generating || draftSaveOperation.current
      || !window.confirm(
        "Withdraw this Question Set from the shared library? Already imported copies stay with other learners.")) return;
    if (sessionRevoked.current || useAccount.getState().user?.id !== accountId) return;

    const withdrawingId = submission.id;
    setBusy(true); setError(""); setMessage("");
    try {
      await withdrawQuestionSetSubmission(accountId, withdrawingId);
      const remaining = await refresh();
      // An RPC returning without error does not establish that the record was
      // removed. Do not show a false success while the same submission remains.
      if (remaining?.id === withdrawingId) {
        throw new Error("Withdrawal could not be confirmed. The submission is still listed; check its status before retrying.");
      }
      // Withdrawal ends the old publication authorization. Even when the
      // local questions are identical, a new submission requires the owner
      // to attest distribution rights and source-checked answers again.
      setRights(false);
      setAnswers(false);
      setMessage("The submission was withdrawn from the library.");
    } catch (cause) {
      if (useAccount.getState().user?.id === accountId) {
        setError(cause instanceof Error ? cause.message : "Withdrawal could not be confirmed.");
      }
    }
    finally { setBusy(false); }
  }

  return <Modal title={`Submit ${set.title}`} onClose={busy || savingDrafts ? () => {} : () => { generationAbort.current?.abort(); onClose(); }}>
    <div className="qsl-submit stack gap12" aria-busy={busy || checking || generating || savingDrafts}>
      <p>Offer this Question Set to every signed-in AXOM learner. An academic reviewer checks it before it appears in search.</p>
      {sessionInvalidated && <p role="alert" className="qsl-error">The account session changed while this review was open. Close and reopen the Question Set to draft, save, submit, or withdraw safely.</p>}
      <div className="qsl-submit-facts"><BookUp2 size={20} aria-hidden="true" /><b>{set.questionIds.length} questions</b><span>Only question text, choices, answers, explanations, tags and citations are submitted. Your attempts, notes, files and course filing stay private.</span></div>
      {unresolved > 0 && <p role="alert" className="qsl-error">{unresolved} question{unresolved === 1 ? " is" : "s are"} still held for answer or source review. Resolve them before submitting this set.</p>}
      {withMedia > 0 && <p role="alert" className="qsl-error">{withMedia} question{withMedia === 1 ? " uses" : "s use"} an image or media that this library snapshot cannot carry. Keep this set private until media-safe sharing is available.</p>}
      {missingExplanations > 0 && <div className="qsl-assist stack gap8">
        <b>{missingExplanations} missing explanation{missingExplanations === 1 ? "" : "s"}</b>
        <p>AXOM can draft rationales from your already-reviewed answers. No answer key changes. Model output is provisional until you inspect and save it.</p>
        {provider && provider.info.kind !== "mock" ? <GButton disabled={!sessionActive || checking || statusIdentity !== `${accountId}:${set.id}` || generating || savingDrafts || busy || draftable.length === 0} onClick={() => void generateExplanations()}>
          <Sparkles size={16} aria-hidden="true" /> {generating ? "Drafting explanations…" : `Draft explanations (${Math.min(draftable.length, 12)} at a time)`}
        </GButton> : <p>Enable AXOM Cloud AI or a local model in Settings to draft explanations, or write them in Question Bank.</p>}
        {generating && <GhostButton onClick={() => generationAbort.current?.abort()}>Cancel drafting</GhostButton>}
      </div>}
      {generationProgress && <p role="status">{generationProgress}</p>}
      {generationError && <p role="alert" className="qsl-error">{generationError}</p>}
      {drafts.length > 0 && <div className="qsl-assist stack gap8" aria-label="Generated explanation drafts">
        <b>{drafts.length} AI draft{drafts.length === 1 ? "" : "s"} to inspect</b>
        {drafts.map((draft, index) => <details key={draft.questionId}>
          <summary>Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} · Review explanation and choices</summary>
          <p className="qsl-draft-stem">{sourceQuestions.find(question => question?.id === draft.questionId)?.stem}</p>
          <ul className="qsl-draft-options">{sourceQuestions.find(question => question?.id === draft.questionId)?.options.map(option =>
            <li key={option.key}>{option.key}. {option.text}</li>)}</ul>
          <label className="qsl-draft-field">Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} explanation
            <textarea rows={4} maxLength={30_000} value={draft.explanation} disabled={savingDrafts}
              onChange={event => setDrafts(current => current.map(item => item.questionId === draft.questionId
                ? { ...item, explanation: event.target.value } : item))} />
          </label>
          {Object.entries(draft.choiceRationales).map(([key, rationale]) => <label className="qsl-draft-field"
            key={key}>Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} choice {key} rationale
            <textarea rows={2} maxLength={10_000} value={rationale} disabled={savingDrafts}
              onChange={event => setDrafts(current => current.map(item => item.questionId === draft.questionId
                ? { ...item, choiceRationales: { ...item.choiceRationales, [key]: event.target.value } } : item))} />
          </label>)}
          <label className="qsl-draft-field">Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} suggested keywords
            <input className="field" maxLength={640} disabled={savingDrafts}
              value={keywordEdits[draft.questionId] ?? draft.keywords.join(", ")}
              onChange={event => setKeywordEdits(previous => ({ ...previous, [draft.questionId]: event.target.value }))} />
          </label>
          <label className="qsl-check"><input type="checkbox" disabled={savingDrafts}
            checked={Boolean(approvedKeywordIds[draft.questionId])}
            onChange={event => setApprovedKeywordIds(previous => ({ ...previous, [draft.questionId]: event.target.checked }))} />
            <span>Include inspected keywords for Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} (optional; does not verify the source).</span>
          </label>
        </details>)}
        <GButton disabled={!sessionActive || generating || busy || savingDrafts} onClick={() => void saveReviewedDrafts()}>{savingDrafts ? "Saving explanations…" : "Save inspected explanations to my QBank"}</GButton>
        <p className="sub">Check all AI-generated explanations against the actual source. Keywords are unverified suggestions, editable and off by default. No explanation or keyword is saved or published automatically.</p>
      </div>}
      {visualPlans.length > 0 && <details className="qsl-visual-hints">
        <summary>Visual keywords for future AXOM diagrams ({visualPlans.length})</summary>
        <p>Text-only requests, not generated images. Medical and usage-rights review remain required.</p>
        <ul>{visualPlans.slice(0, 15).map(plan => <li key={plan.id}>
          Question {set.questionIds.indexOf(plan.id) + 1}: {plan.kind.replaceAll("-", " ")} · {plan.keywords.join(", ") || "topic context"}
        </li>)}</ul>
      </details>}
      {!accountId && <p role="status">Sign in through Account to submit a set.</p>}
      {checking && <p role="status">Checking your existing submission…</p>}
      {submission && statusIdentity === `${accountId}:${set.id}` && useAccount.getState().user?.id === accountId && <div className="qsl-submission-status">
        <Tag tone={submission.status === "approved" ? "gold" : submission.status === "rejected" ? "orange" : "neutral"}>{submission.status}</Tag>
        <p>{submission.status === "approved" ? "This set is searchable now." : submission.status === "pending"
          ? "This set is waiting for academic review." : "This set needs a revision before it can be listed."}</p>
        {submission.reviewNote && <p className="sub">Reviewer note: {submission.reviewNote}</p>}
        <GhostButton disabled={busy || !sessionActive} onClick={() => void withdraw()}>Withdraw submission</GhostButton>
      </div>}
      {(!submission || submission.status === "rejected") && accountId && !checking && <>
        <label className="qsl-field">Public credit (optional)
          <input className="field" value={attestationsForAccount ? credit : ""} maxLength={80} disabled={busy || !attestationsForAccount} onChange={event => setCredit(event.target.value)} placeholder="Name to show beside this set" />
        </label>
        <label className="qsl-check"><input type="checkbox" checked={attestationsForAccount && rights} disabled={busy || !attestationsForAccount} onChange={event => setRights(event.target.checked)} />
          <span>I own this content or have permission to distribute every question, answer and explanation.</span></label>
        <label className="qsl-check"><input type="checkbox" checked={attestationsForAccount && answers} disabled={busy || !attestationsForAccount} onChange={event => setAnswers(event.target.checked)} />
          <span>I checked every answer against its source, verified every explanation, and resolved source-key conflicts.</span></label>
        <GButton variant="primary" disabled={!sessionActive || busy || checking || statusIdentity !== `${accountId}:${set.id}` || !attestationsForAccount || generating || drafts.length > 0 || !rights || !answers || unresolved > 0 || withMedia > 0 || missingExplanations > 0 || Boolean(error && !submission)} onClick={() => void submit()}>
          <ShieldCheck size={16} aria-hidden="true" /> {busy ? "Submitting…" : "Send for review"}
        </GButton>
      </>}
      {error && <p role="alert" className="qsl-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {error && !checking && <GhostButton disabled={busy} onClick={() => { setError(""); setChecking(true); void refresh().catch(cause => { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }); }}>Retry status check</GhostButton>}
    </div>
  </Modal>;
}
