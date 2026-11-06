import { useEffect, useRef, useState } from "react";
import { BookUp2, ShieldCheck } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import { createQuestionSetShare, type SharedQuestionSetSnapshot } from "../../lib/sharing/questionSetShare";
import { enrichCommunitySnapshotVisualTags } from "../../lib/sharing/communityVisualTags";
import {
  listMyQuestionSetSubmissions, submitQuestionSetToLibrary, withdrawQuestionSetSubmission,
  type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { Modal } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import "../../styles/question-set-library.css";

export function QuestionSetLibrarySubmitDialog({ set, questions, onClose }: {
  set: QuestionSet;
  questions: readonly QuestionRecord[];
  onClose: () => void;
}) {
  const accountId = useAccount(state => state.user?.id);
  const [submission, setSubmission] = useState<LibrarySubmission>();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const [answers, setAnswers] = useState(false);
  const [credit, setCredit] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const snapshotRef = useRef<SharedQuestionSetSnapshot>();
  const byId = new Map(questions.map(question => [question.id, question]));
  const sourceQuestions = set.questionIds.map(id => byId.get(id));
  const unresolved = sourceQuestions.filter(question => !question || questionPracticeReadiness(question) !== "ready").length;
  const withMedia = sourceQuestions.filter(question => question && ((question.attachments?.length ?? 0) > 0
    || (question.content?.assets.length ?? 0) > 0)).length;

  async function refresh() {
    if (!accountId) { setChecking(false); return; }
    const owned = await listMyQuestionSetSubmissions(accountId);
    const found = owned.find(item => item.sourceId === set.id);
    setSubmission(found);
    setChecking(false);
    return found;
  }
  useEffect(() => {
    let alive = true;
    if (!accountId) { setChecking(false); return; }
    void listMyQuestionSetSubmissions(accountId).then(owned => {
      if (alive) { setSubmission(owned.find(item => item.sourceId === set.id)); setChecking(false); }
    }).catch(cause => {
      if (alive) { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }
    });
    return () => { alive = false; };
  }, [accountId, set.id]);

  async function submit() {
    if (!accountId || !rights || !answers || checking || busy || unresolved || withMedia
      || (submission && submission.status !== "rejected")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      snapshotRef.current ??= enrichCommunitySnapshotVisualTags(createQuestionSetShare(set, questions));
      const id = await submitQuestionSetToLibrary(accountId, set.id, snapshotRef.current, credit);
      const result = await refresh();
      if (!result || result.id !== id) throw new Error("The submission could not be read back. Check its status before retrying.");
      setMessage(result?.status === "rejected"
        ? "This version was already rejected. Revise the questions before submitting again."
        : "Submission received. It will appear in search after an academic reviewer approves it.");
    } catch (cause) {
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
    if (!accountId || !submission || busy || !window.confirm(
      "Withdraw this Question Set from the shared library? Already imported copies stay with other learners.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await withdrawQuestionSetSubmission(accountId, submission.id);
      snapshotRef.current = undefined;
      await refresh();
      setMessage("The submission was withdrawn from the library.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Withdrawal could not be confirmed."); }
    finally { setBusy(false); }
  }

  return <Modal title={`Submit ${set.title}`} onClose={busy ? () => {} : onClose}>
    <div className="qsl-submit stack gap12" aria-busy={busy || checking}>
      <p>Offer this Question Set to every signed-in AXOM learner. An academic reviewer checks it before it appears in search.</p>
      <div className="qsl-submit-facts"><BookUp2 size={20} aria-hidden="true" /><b>{set.questionIds.length} questions</b><span>Only question text, choices, answers, explanations, tags and citations are submitted. Your attempts, notes, files and course filing stay private.</span></div>
      {unresolved > 0 && <p role="alert" className="qsl-error">{unresolved} question{unresolved === 1 ? " is" : "s are"} still held for answer or source review. Resolve them before submitting this set.</p>}
      {withMedia > 0 && <p role="alert" className="qsl-error">{withMedia} question{withMedia === 1 ? " uses" : "s use"} an image or media that this library snapshot cannot carry. Keep this set private until media-safe sharing is available.</p>}
      {!accountId && <p role="status">Sign in through Account to submit a set.</p>}
      {checking && <p role="status">Checking your existing submission…</p>}
      {submission && <div className="qsl-submission-status">
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
          <span>I checked every answer against its source and resolved any source-key conflicts.</span></label>
        <GButton variant="primary" disabled={busy || !rights || !answers || unresolved > 0 || withMedia > 0 || Boolean(error && !submission)} onClick={() => void submit()}>
          <ShieldCheck size={16} aria-hidden="true" /> {busy ? "Submitting…" : "Send for review"}
        </GButton>
      </>}
      {error && <p role="alert" className="qsl-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {error && !checking && <GhostButton disabled={busy} onClick={() => { setError(""); setChecking(true); void refresh().catch(cause => { setError(cause instanceof Error ? cause.message : "Your submissions could not be checked."); setChecking(false); }); }}>Retry status check</GhostButton>}
    </div>
  </Modal>;
}
