import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookUp2, ShieldCheck, Sparkles } from "lucide-react";
import { resolveActiveProvider } from "../../lib/ai";
import { draftQuestionExplanation, eligibleForExplanationDraft, questionExplanationFingerprint, type QuestionExplanationDraft } from "../../lib/ai/questionTeaching";
import { planMedicalVisual } from "../../lib/diagrams/publicationHints";
import { useStore } from "../../lib/store";
import { useAccount } from "../../lib/account/accountStore";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import { prepareCurrentCommunityQuestionSetSubmission, sameCommunitySetReviewRevision } from "../../lib/sharing/communitySetPublicationGuard";
import {
  listMyQuestionSetSubmissions, submitQuestionSetToLibrary, withdrawQuestionSetSubmission,
  type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { Modal } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import "../../styles/question-set-library.css";

const AI_EXPLANATION_PREFIX = "AXOM AI-assisted explanation (verify against source): ";

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
  const [submission, setSubmission] = useState<LibrarySubmission>();
  const [checking, setChecking] = useState(true);
  const [statusIdentity, setStatusIdentity] = useState("");
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const [answers, setAnswers] = useState(false);
  const [credit, setCredit] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<QuestionExplanationDraft[]>([]);
  const [generating, setGenerating] = useState(false);
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
  const missingExplanations = sourceQuestions.filter(question => question && !question.explanation?.trim()).length;
  const draftable = useMemo(() => sourceQuestions.filter((question): question is QuestionRecord => Boolean(question)
    && eligibleForExplanationDraft(question!) && !drafts.some(draft => draft.questionId === question!.id)),
  [sourceQuestions, drafts]);
  const visualPlans = sourceQuestions.flatMap(question => {
    if (!question) return [];
    const plan = planMedicalVisual(question);
    return plan.kind === "none" ? [] : [{ id: question.id, ...plan }];
  });

  async function refresh() {
    if (!accountId) { setStatusIdentity(""); setChecking(false); return; }
    const owned = await listMyQuestionSetSubmissions(accountId);
    if (useAccount.getState().user?.id !== accountId) throw new Error("The account changed during submission lookup.");
    const found = owned.find(item => item.sourceId === set.id);
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
    setError("");
    setMessage("");
    if (!accountId) { setChecking(false); return; }
    void listMyQuestionSetSubmissions(accountId).then(owned => {
      if (alive && useAccount.getState().user?.id === accountId) {
        setSubmission(owned.find(item => item.sourceId === set.id));
        setStatusIdentity(`${accountId}:${set.id}`);
        setChecking(false);
      }
    }).catch(cause => {
      if (alive) { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }
    });
    return () => { alive = false; };
  }, [accountId, set.id]);

  useEffect(() => {
    setDrafts([]);
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
    return () => { generationAbort.current?.abort(); };
  }, [accountId, set.id]);

  const generateExplanations = useCallback(async () => {
    if (!provider || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || generating || generationAbort.current || !draftable.length) return;
    const controller = new AbortController();
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
        if (controller.signal.aborted || useAccount.getState().user?.id !== accountId) return;
        const liveInput = currentDraftInput(set, question);
        if (!liveInput) {
          setDrafts([]);
          setGenerationError("The Question Set or answer evidence changed before AI drafting. Reopen it before sending question content.");
          return;
        }
        try {
          const draft = await draftQuestionExplanation(provider, liveInput, controller.signal);
          if (controller.signal.aborted || useAccount.getState().user?.id !== accountId) return;
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
      if (controller.signal.aborted || useAccount.getState().user?.id !== accountId) return;
      setGenerationProgress(next.length
        ? `${next.length} provisional explanations prepared. Inspect them before saving. ${failures ? `${failures} need manual review.` : ""}`
        : "No explanations could be drafted. Review your source or AI settings.");
    } finally {
      if (generationAbort.current === controller) generationAbort.current = null;
      setGenerating(false);
    }
  }, [provider, accountId, set, statusIdentity, generating, draftable]);

  useEffect(() => {
    if (!autoDraft || checking || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || !provider || provider.info.kind === "mock"
      || !draftable.length || (submission && submission.status !== "rejected")
      || autoDraftStarted.current) return;
    // The explicit Community "Review and submit" action authorizes this capped
    // preparation. Re-renders never create additional inference batches.
    autoDraftStarted.current = true;
    void generateExplanations();
  }, [autoDraft, accountId, set.id, statusIdentity, checking, submission, provider, draftable.length, generateExplanations]);

  function saveReviewedDrafts() {
    if (generating || !accountId || statusIdentity !== `${accountId}:${set.id}`
      || !drafts.length || useAccount.getState().user?.id !== accountId) return;
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
      if (!question || questionExplanationFingerprint(question) !== draft.sourceFingerprint
        || !eligibleForExplanationDraft(question) || !set.questionIds.includes(question.id)) {
        setGenerationError("One or more questions changed. Reopen the set to avoid overwriting newer work.");
        return;
      }
    }
    for (const draft of drafts) {
      const question = current.get(draft.questionId);
      const keys = question?.options.map(option => option.key) ?? [];
      if (draft.explanation.trim().length < 40 || draft.explanation.trim().length + AI_EXPLANATION_PREFIX.length > 30_000
        || keys.some(key => (draft.choiceRationales[key] ?? "").trim().length < 10
          || draft.choiceRationales[key].length > 10_000)) {
        setGenerationError("Finish the explanation and every choice rationale before saving.");
        return;
      }
    }
    for (const draft of drafts) {
      bank.updateQuestion(draft.questionId, {
        // Do not silently masquerade AI-authored teaching prose as a source rationale.
        explanation: `${AI_EXPLANATION_PREFIX}${draft.explanation.trim()}`,
        choiceRationales: draft.choiceRationales,
      });
    }
    setDrafts([]);
    setGenerationError("");
    setGenerationProgress("");
    setMessage("Reviewed explanations saved privately. They still require a source check before publication.");
  }

  async function submit() {
    // The rendered account may lag behind the session store during a switch.
    // Never send another account's saved rights and answer attestations.
    if (!accountId || statusIdentity !== `${accountId}:${set.id}`
      || useAccount.getState().user?.id !== accountId || !rights || !answers || checking || busy || generating || drafts.length
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
      const id = await submitQuestionSetToLibrary(accountId, set.id, snapshot, credit);
      // Account-operation RPCs also assert the current session. Avoid an old
      // account's follow-up query/confirmation if it changed while awaiting.
      if (useAccount.getState().user?.id !== accountId) return;
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
    if (!accountId || statusIdentity !== `${accountId}:${set.id}`
      || useAccount.getState().user?.id !== accountId || !submission
      || submission.sourceId !== set.id || checking || busy || generating
      || !window.confirm(
        "Withdraw this Question Set from the shared library? Already imported copies stay with other learners.")) return;
    if (useAccount.getState().user?.id !== accountId) return;

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
      setMessage("The submission was withdrawn from the library.");
    } catch (cause) {
      if (useAccount.getState().user?.id === accountId) {
        setError(cause instanceof Error ? cause.message : "Withdrawal could not be confirmed.");
      }
    }
    finally { setBusy(false); }
  }

  return <Modal title={`Submit ${set.title}`} onClose={busy ? () => {} : () => { generationAbort.current?.abort(); onClose(); }}>
    <div className="qsl-submit stack gap12" aria-busy={busy || checking || generating}>
      <p>Offer this Question Set to every signed-in AXOM learner. An academic reviewer checks it before it appears in search.</p>
      <div className="qsl-submit-facts"><BookUp2 size={20} aria-hidden="true" /><b>{set.questionIds.length} questions</b><span>Only question text, choices, answers, explanations, tags and citations are submitted. Your attempts, notes, files and course filing stay private.</span></div>
      {unresolved > 0 && <p role="alert" className="qsl-error">{unresolved} question{unresolved === 1 ? " is" : "s are"} still held for answer or source review. Resolve them before submitting this set.</p>}
      {withMedia > 0 && <p role="alert" className="qsl-error">{withMedia} question{withMedia === 1 ? " uses" : "s use"} an image or media that this library snapshot cannot carry. Keep this set private until media-safe sharing is available.</p>}
      {missingExplanations > 0 && <div className="qsl-assist stack gap8">
        <b>{missingExplanations} missing explanation{missingExplanations === 1 ? "" : "s"}</b>
        <p>AXOM can draft rationales from your already-reviewed answers. No answer key changes. Model output is provisional until you inspect and save it.</p>
        {provider && provider.info.kind !== "mock" ? <GButton disabled={checking || statusIdentity !== `${accountId}:${set.id}` || generating || busy || draftable.length === 0} onClick={() => void generateExplanations()}>
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
            <textarea rows={4} maxLength={30_000} value={draft.explanation}
              onChange={event => setDrafts(current => current.map(item => item.questionId === draft.questionId
                ? { ...item, explanation: event.target.value } : item))} />
          </label>
          {Object.entries(draft.choiceRationales).map(([key, rationale]) => <label className="qsl-draft-field"
            key={key}>Question {set.questionIds.indexOf(draft.questionId) + 1 || index + 1} choice {key} rationale
            <textarea rows={2} maxLength={10_000} value={rationale}
              onChange={event => setDrafts(current => current.map(item => item.questionId === draft.questionId
                ? { ...item, choiceRationales: { ...item.choiceRationales, [key]: event.target.value } } : item))} />
          </label>)}
        </details>)}
        <GButton disabled={generating || busy} onClick={saveReviewedDrafts}>Save inspected explanations to my QBank</GButton>
        <p className="sub">Check these AI-generated drafts against the actual source. No explanation is saved or published automatically.</p>
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
        <GhostButton disabled={busy} onClick={() => void withdraw()}>Withdraw submission</GhostButton>
      </div>}
      {(!submission || submission.status === "rejected") && accountId && !checking && <>
        <label className="qsl-field">Public credit (optional)
          <input className="field" value={credit} maxLength={80} disabled={busy} onChange={event => setCredit(event.target.value)} placeholder="Name to show beside this set" />
        </label>
        <label className="qsl-check"><input type="checkbox" checked={rights} disabled={busy} onChange={event => setRights(event.target.checked)} />
          <span>I own this content or have permission to distribute every question, answer and explanation.</span></label>
        <label className="qsl-check"><input type="checkbox" checked={answers} disabled={busy} onChange={event => setAnswers(event.target.checked)} />
          <span>I checked every answer against its source, verified every explanation, and resolved source-key conflicts.</span></label>
        <GButton variant="primary" disabled={busy || checking || statusIdentity !== `${accountId}:${set.id}` || generating || drafts.length > 0 || !rights || !answers || unresolved > 0 || withMedia > 0 || missingExplanations > 0 || Boolean(error && !submission)} onClick={() => void submit()}>
          <ShieldCheck size={16} aria-hidden="true" /> {busy ? "Submitting…" : "Send for review"}
        </GButton>
      </>}
      {error && <p role="alert" className="qsl-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {error && !checking && <GhostButton disabled={busy} onClick={() => { setError(""); setChecking(true); void refresh().catch(cause => { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }); }}>Retry status check</GhostButton>}
    </div>
  </Modal>;
}
