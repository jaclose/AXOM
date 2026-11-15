import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, RefreshCw } from "lucide-react";
import { isAcademicReviewer } from "../../lib/academicLibrary/client";
import { hasExplanationProse } from "../../lib/questionExplanationCoverage";
import {
  listPendingQuestionSets, loadPendingQuestionSetReviewPreview, reviewQuestionSetSubmission,
  type LibraryQuestionSetPreview, type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import "../../styles/question-set-library.css";

// A reviewer queue contains source questions and answer keys. React's keyed
// boundary drops the old account's preview before effects run after a switch.
// Permission checks remain server-side; this prevents client-side disclosure.
export function QuestionSetLibraryReviewQueue({ accountId }: { accountId: string }) {
  return <AccountScopedReviewQueue key={accountId} accountId={accountId} />;
}

// Summary is computed from the complete immutable pending snapshot, not only
// the first displayed batch. Gaps are review prompts, not medical or rights approval.
function reviewEvidenceInventory(preview: LibraryQuestionSetPreview) {
  return preview.snapshot.questions.reduce((total, question) => {
    const rationales = Object.entries(question.choiceRationales ?? {});
    const lacksChoiceRationale = question.options.some(option =>
      !rationales.some(([key, value]) =>
        key.trim().toUpperCase() === option.key.trim().toUpperCase() && !!value?.trim()));
    const hasAiDraft = question.explanation?.startsWith("AXOM AI-assisted explanation")
      || rationales.some(([, value]) => value?.startsWith("AXOM AI-assisted rationale"));
    if (!question.correctKey?.trim()) total.missingKeys++;
    if (!question.citation?.trim()) total.missingCitations++;
    if (!hasExplanationProse(question.explanation)) total.missingExplanations++;
    if (lacksChoiceRationale) total.missingChoiceRationales++;
    if (hasAiDraft) total.aiAssistedQuestions++;
    return total;
  }, { missingKeys: 0, missingCitations: 0, missingExplanations: 0,
    missingChoiceRationales: 0, aiAssistedQuestions: 0 });
}

function AccountScopedReviewQueue({ accountId }: { accountId: string }) {
  const [reviewer, setReviewer] = useState(false);
  const [queue, setQueue] = useState<LibrarySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<LibraryQuestionSetPreview>();
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [shown, setShown] = useState(20);
  // An inspection response must not outlive an explicit refresh or newer selection.
  // This client guard complements the revision check enforced by PostgreSQL.
  const attention = preview ? reviewEvidenceInventory(preview) : undefined;
  // This is a reviewer-facing preflight, not proof of clinical correctness or
  // rights. Older pending sets without key/source evidence must be revised.
  const approvalBlockedByEvidence = !!attention && (
    attention.missingKeys > 0 || attention.missingCitations > 0 || attention.missingExplanations > 0);
  const previewEpoch = useRef(0);
  useEffect(() => {
    ++previewEpoch.current;
    let alive = true;
    setLoading(true); setError(""); setQueue([]); setReviewer(false);
    setPreview(undefined); setReason(""); setAttested(false);
    void isAcademicReviewer(accountId).then(async allowed => {
      if (!alive) return;
      setReviewer(allowed);
      if (allowed) {
        const pending = await listPendingQuestionSets(accountId);
        if (alive) setQueue(pending);
      }
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Review queue unavailable."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ++previewEpoch.current; };
  }, [accountId, refresh]);

  function refreshQueue(outcome = "") {
    ++previewEpoch.current; // Invalidate an in-flight Inspect request synchronously.
    // The next permission check runs in an effect, after React may paint.
    // Drop previously authorized rows *now*, not only in that effect.
    setReviewer(false); setQueue([]); setLoading(true);
    setPreview(undefined); setReason(""); setAttested(false); setShown(20);
    setError(""); setMessage(outcome); setBusy(false);
    setRefresh(value => value + 1);
  }

  async function open(id: string) {
    // A stale row or synthetic click cannot inspect while access is rechecked.
    if (!reviewer || loading || busy || !queue.some(item => item.id === id)) return;
    const epoch = ++previewEpoch.current;
    setBusy(true); setPreview(undefined); setError(""); setMessage(""); setReason(""); setAttested(false); setShown(20);
    try {
      const inspected = await loadPendingQuestionSetReviewPreview(accountId, id);
      if (epoch === previewEpoch.current) setPreview(inspected);
    } catch (cause) {
      if (epoch === previewEpoch.current)
        setError(cause instanceof Error ? cause.message : "This submission could not be opened.");
    } finally {
      if (epoch === previewEpoch.current) setBusy(false);
    }
  }
  async function decide(approved: boolean) {
    if (!preview || busy || reason.trim().length < 8 || (approved && (!attested || shown < preview.snapshot.questions.length || approvalBlockedByEvidence))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await reviewQuestionSetSubmission(accountId, preview, approved, reason);
      // Retain the completed decision through the automatic permission recheck.
      // An explicit Refresh still clears old results, and an account switch remounts this queue.
      refreshQueue(approved ? "Question Set approved for search." : "Question Set returned to its contributor with your note.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The review could not be saved.";
      // An obsolete reviewed revision must not remain approvable by the same
      // checkbox. Require a fresh inspection and rights/answer attestation.
      if (/reopen|changed since inspection|changed\. Reopen/i.test(message)) {
        setPreview(undefined); setReason(""); setAttested(false);
      }
      setError(message);
    } finally { setBusy(false); }
  }
  return <GlassCard pad className="qsl-review-queue">
    <PanelHeader headingLevel={2} title="Question Set Library review" sub="Learner submissions appear in search only after academic review."
      action={<GButton size="sm" disabled={loading || (busy && !!preview)} onClick={() => refreshQueue()}><RefreshCw size={16} aria-hidden="true" /> Refresh</GButton>} />
    {loading && <p role="status">Checking academic review access…</p>}
    {!loading && !reviewer && !error && <p className="sub">This operator account has no academic reviewer permission. Host access alone cannot approve medical content.</p>}
    {reviewer && !loading && queue.length === 0 && <p className="sub">No learner Question Sets await review.</p>}
    {reviewer && !loading && queue.map(item => <div className="qsl-review-row" key={item.id}>
      <div><b>{item.title}</b><small>{item.questionCount} questions · {item.credit || "No public credit"} · submitted {new Date(item.createdAt).toLocaleDateString()}</small></div>
      <div><Tag tone="orange">Pending</Tag><GButton size="sm" disabled={busy} onClick={() => void open(item.id)}>Inspect</GButton></div>
    </div>)}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="qsl-error">{error}</p>}
    {reviewer && !loading && preview && <Modal title={`Review ${preview.snapshot.title}`} onClose={busy ? () => {} : () => setPreview(undefined)}>
      <div className="qsl-review-detail stack gap12">
        <p><BookOpenCheck size={17} aria-hidden="true" /> {preview.snapshot.questions.length} questions. The contributor attested to rights and answer review. Check that evidence yourself before approval.</p>
        <p><b>Recorded publication rights notice:</b> {preview.snapshot.copyrightNotice || "No rights notice supplied"}</p>
        <p className="sub">The contributor's notice and attestation are not independently verified redistribution permission. Check original-source and third-party image rights before approving.</p>
        {attention && <p className={approvalBlockedByEvidence ? "qsl-preview-ai-warning" : "sub"} data-testid="qsl-review-evidence-inventory">
          Evidence inventory across all {preview.snapshot.questions.length} questions:
          {" "}{attention.missingKeys} without recorded answer keys;
          {" "}{attention.missingCitations} without source citations;
          {" "}{attention.missingExplanations} without explanation prose;
          {" "}{attention.missingChoiceRationales} lacking at least one choice rationale;
          {" "}{attention.aiAssistedQuestions} containing AI-assisted teaching.
          These flags prompt independent source review, not verified answer keys or image rights.
          {approvalBlockedByEvidence && " Approval is blocked until every question records an answer key, a source citation and explanation prose. Return this set for revision."}
        </p>}
        <ol>{preview.snapshot.questions.slice(0, shown).map(question => <li key={question.id}>
          <b>{question.stem}</b>
          <ul>{question.options.map(option => {
            // The stored rationales are keyed by answer choice, not list
            // position. Inspect own entries only; never infer missing text.
            const rationale = Object.entries(question.choiceRationales ?? {})
              .find(([key]) => key.trim().toUpperCase() === option.key.trim().toUpperCase())?.[1];
            return <li key={option.key}>
              {option.key}. {option.text}
              {rationale
                ? <p><b>Recorded choice rationale:</b> {rationale}
                  {rationale.startsWith("AXOM AI-assisted rationale")
                    && <small className="qsl-preview-ai-warning"> AI-assisted rationale: independently verify the source claim.</small>}
                </p>
                : <p className="sub">No choice-specific rationale recorded. Verify this choice against the source.</p>}
            </li>;
          })}</ul>
          <p>Answer: <b>{question.correctKey ?? "Unresolved"}</b></p>
          {question.explanation?.startsWith("AXOM AI-assisted explanation")
            && <p className="qsl-preview-ai-warning">AI-assisted explanation: source and medical claims require independent review.</p>}
          {question.explanation ? <p>{question.explanation}</p>
            : <p className="sub">No teaching explanation recorded. Return this submission for revision before approval.</p>}
          <small>Source: {question.citation || "No citation supplied. Check the original source before approval."}</small>
        </li>)}</ol>
        {shown < preview.snapshot.questions.length && <GhostButton disabled={busy} onClick={() => setShown(value => Math.min(value + 20, preview.snapshot.questions.length))}>Show next 20 questions</GhostButton>}
        <p className="sub">{Math.min(shown, preview.snapshot.questions.length)} of {preview.snapshot.questions.length} questions displayed for inspection. Approval requires displaying the full set and checking its rights and answer evidence. A documented rejection does not require an affirmative attestation.</p>
        <label className="qsl-field">Review note
          <textarea className="field" value={reason} minLength={8} maxLength={500} rows={3} disabled={busy}
            onChange={event => setReason(event.target.value)} placeholder="Record source, rights or answer checks performed." />
        </label>
        <label className="qsl-check"><input type="checkbox" checked={attested} disabled={busy || shown < preview.snapshot.questions.length || approvalBlockedByEvidence} onChange={event => setAttested(event.target.checked)} />
          <span>I checked the set's distribution rights and answer evidence for every question. My note records what I checked.</span></label>
        <div className="row wrap gap8">
          <GButton size="sm" variant="primary" disabled={busy || !attested || shown < preview.snapshot.questions.length || approvalBlockedByEvidence || reason.trim().length < 8} onClick={() => void decide(true)}>Approve for library</GButton>
          <GButton size="sm" disabled={busy || reason.trim().length < 8} onClick={() => void decide(false)}>Return for revision</GButton>
        </div>
        {error && <p role="alert" className="qsl-error">{error}</p>}
      </div>
    </Modal>}
  </GlassCard>;
}
