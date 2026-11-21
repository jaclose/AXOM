import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, RefreshCw } from "lucide-react";
import { isAcademicReviewer } from "../../lib/academicLibrary/client";
import {
  listPendingQuestionSets, loadPendingQuestionSetReviewPreview, reviewQuestionSetSubmission,
  type LibraryQuestionSetPreview, type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import "../../styles/question-set-library.css";

export function QuestionSetLibraryReviewQueue({ accountId, refreshSignal = 0, accessSuspended = false, onReviewed }: {
  accountId: string;
  refreshSignal?: number;
  /** Host is rechecking its own privileges. Portaled preview content must close immediately. */
  accessSuspended?: boolean;
  onReviewed?: () => void;
}) {
  const [reviewer, setReviewer] = useState(false);
  const [queue, setQueue] = useState<LibrarySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Inspect is cancellable on permission refresh. A submitted decision is not:
  // keep its duplicate-operation lock until its server request settles.
  const decisionInFlight = useRef(false);
  // React state can stay stale until a batched click commits. Serialize Inspect
  // synchronously so two requests cannot race within the same authorization epoch.
  const inspectInFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<LibraryQuestionSetPreview>();
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [shown, setShown] = useState(20);
  // An Inspect response that started before an account/Host/reviewer refresh
  // must never reopen a privileged body-level modal after reauthorization.
  const previewEpoch = useRef(0);
  // The portaled modal must not restore focus into a hidden, unverified Host
  // subtree when its effect cleans up after an access change.
  const canRestorePreviewFocus = useRef(false);
  canRestorePreviewFocus.current = !accessSuspended && !loading && reviewer;
  useEffect(() => {
    const epoch = ++previewEpoch.current;
    // Superseded requests may settle late; their finally must not unlock a new
    // Inspect started under this epoch.
    inspectInFlight.current = false;
    let alive = true;
    setPreview(undefined); setReason(""); setAttested(false);
    if (!decisionInFlight.current) setBusy(false);
    setLoading(true); setError(""); setQueue([]); setReviewer(false);
    if (accessSuspended) return () => { alive = false; };

    void isAcademicReviewer(accountId).then(async allowed => {
      if (!alive || previewEpoch.current !== epoch) return;
      setReviewer(allowed);
      if (!allowed) { setPreview(undefined); setReason(""); setAttested(false); }
      if (allowed) {
        const items = await listPendingQuestionSets(accountId);
        // Authorization or account may have changed while the queue was loading.
        if (alive && previewEpoch.current === epoch) setQueue(items);
      }
    }).catch(cause => { if (alive && previewEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "Review queue unavailable."); })
      .finally(() => { if (alive && previewEpoch.current === epoch) setLoading(false); });
    return () => { alive = false; };
  }, [accountId, refresh, refreshSignal, accessSuspended]);

  async function open(id: string) {
    if (accessSuspended || loading || !reviewer || busy || inspectInFlight.current
      || decisionInFlight.current) return;
    inspectInFlight.current = true;
    const epoch = previewEpoch.current;
    setBusy(true); setError(""); setMessage(""); setReason(""); setAttested(false); setShown(20);
    try {
      const next = await loadPendingQuestionSetReviewPreview(accountId, id);
      if (previewEpoch.current === epoch) setPreview(next);
    } catch (cause) {
      if (previewEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "This submission could not be opened.");
    } finally {
      // A superseded Inspect request must not unlock a newer review operation.
      if (previewEpoch.current === epoch) {
        inspectInFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function decide(approved: boolean) {
    if (accessSuspended || !preview || !reviewer || loading || busy || decisionInFlight.current
      || reason.trim().length < 8 || !attested) return;
    const epoch = previewEpoch.current;
    decisionInFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await reviewQuestionSetSubmission(accountId, preview, approved, reason);
      // Completion after role/Host reauthorization must not restore an obsolete receipt.
      if (previewEpoch.current !== epoch) return;
      setPreview(undefined);
      setMessage(approved ? "Question Set approved for search." : "Question Set returned to its contributor with your note.");
      // Host refresh also rechecks this queue and reviewer rights. A standalone
      // queue still refreshes itself when no Host callback was supplied.
      if (onReviewed) onReviewed(); else setRefresh(value => value + 1);
    } catch (cause) {
      if (previewEpoch.current !== epoch) return;
      const message = cause instanceof Error ? cause.message : "The review could not be saved.";
      // An obsolete reviewed revision must not remain approvable by the same
      // checkbox. Require a fresh inspection and rights/answer attestation.
      if (/reopen|changed since inspection|changed\. Reopen/i.test(message)) {
        setPreview(undefined); setReason(""); setAttested(false);
      }
      setError(message);
    } finally {
      decisionInFlight.current = false;
      setBusy(false);
    }
  }
  return <GlassCard pad className="qsl-review-queue">
    <PanelHeader headingLevel={2} title="Question Set Library review" sub="Learner submissions appear in search only after academic review."
      action={<GButton size="sm" disabled={accessSuspended || loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Refresh</GButton>} />
    {loading && <p role="status">Checking academic review access…</p>}
    {!loading && !reviewer && !error && <p className="sub">This operator account has no academic reviewer permission. Host access alone cannot approve medical content.</p>}
    {reviewer && !loading && queue.length === 0 && <p className="sub">No learner Question Sets await review.</p>}
    {queue.map(item => <div className="qsl-review-row" key={item.id}>
      <div><b>{item.title}</b><small>{item.questionCount} questions · {item.credit || "No public credit"} · submitted {new Date(item.createdAt).toLocaleDateString()}</small></div>
      <div><Tag tone="orange">Pending</Tag><GButton size="sm" disabled={accessSuspended || loading || !reviewer || busy} onClick={() => void open(item.id)}>Inspect</GButton></div>
    </div>)}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="qsl-error">{error}</p>}
    {!accessSuspended && !loading && reviewer && preview && <Modal title={`Review ${preview.snapshot.title}`}
      shouldRestoreFocus={() => canRestorePreviewFocus.current}
      onClose={busy ? () => {} : () => setPreview(undefined)}>
      <div className="qsl-review-detail stack gap12">
        <p><BookOpenCheck size={17} aria-hidden="true" /> {preview.snapshot.questions.length} questions. The contributor attested to rights and answer review. Check that evidence yourself before approval.</p>
        <ol>{preview.snapshot.questions.slice(0, shown).map(question => <li key={question.id}>
          <b>{question.stem}</b>
          <ul>{question.options.map(option => <li key={option.key}>{option.key}. {option.text}</li>)}</ul>
          <p>Answer: <b>{question.correctKey ?? "Unresolved"}</b></p>
          {question.explanation && <p>{question.explanation}</p>}
          <small>Source: {question.citation || "No citation supplied"}</small>
        </li>)}</ol>
        {shown < preview.snapshot.questions.length && <GhostButton disabled={busy} onClick={() => setShown(value => value + 20)}>Show next 20 questions</GhostButton>}
        <label className="qsl-field">Review note
          <textarea className="field" value={reason} minLength={8} maxLength={500} rows={3} disabled={busy}
            onChange={event => setReason(event.target.value)} placeholder="Record source, rights or answer checks performed." />
        </label>
        <label className="qsl-check"><input type="checkbox" checked={attested} disabled={busy} onChange={event => setAttested(event.target.checked)} />
          <span>I checked the set's distribution rights and answer evidence. My note records what I checked.</span></label>
        <div className="row wrap gap8">
          <GButton size="sm" variant="primary" disabled={busy || loading || !reviewer || !attested || reason.trim().length < 8} onClick={() => void decide(true)}>Approve for library</GButton>
          <GButton size="sm" disabled={busy || loading || !reviewer || !attested || reason.trim().length < 8} onClick={() => void decide(false)}>Return for revision</GButton>
        </div>
        {error && <p role="alert" className="qsl-error">{error}</p>}
      </div>
    </Modal>}
  </GlassCard>;
}
