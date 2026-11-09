import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, RefreshCw } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { isAcademicReviewer } from "../../lib/academicLibrary/client";
import {
  listPendingQuestionSets, loadPendingQuestionSetReviewPreview, reviewQuestionSetSubmission,
  type LibraryQuestionSetPreview, type LibrarySubmission,
} from "../../lib/sharing/questionSetLibrary";
import { GButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import "../../styles/question-set-library.css";

export function QuestionSetLibraryReviewQueue({ accountId }: { accountId: string }) {
  const signedInAccountId = useAccount(state => state.user?.id);
  const accountMatches = signedInAccountId === accountId;
  const [reviewer, setReviewer] = useState(false);
  const [reviewerAccountId, setReviewerAccountId] = useState<string>();
  const [queue, setQueue] = useState<LibrarySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ accountId: string; text: string }>();
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{ accountId: string; value: LibraryQuestionSetPreview }>();
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [page, setPage] = useState(0);
  const [revealedCount, setRevealedCount] = useState(20);
  const requestVersion = useRef(0);
  const pageStatusRef = useRef<HTMLParagraphElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      previousPage.current = page;
      pageStatusRef.current?.focus();
    }
  }, [page]);
  useEffect(() => {
    let alive = true;
    requestVersion.current += 1;
    setLoading(accountMatches); setError(""); setQueue([]); setReviewer(false);
    setReviewerAccountId(undefined); setPreview(undefined); setReason(""); setAttested(false);
    setPage(0); setRevealedCount(20); setBusy(false);
    if (!accountMatches) return () => { alive = false; requestVersion.current += 1; };
    void isAcademicReviewer(accountId).then(async allowed => {
      if (!alive) return;
      setReviewer(allowed);
      setReviewerAccountId(accountId);
      if (allowed) {
        const pending = await listPendingQuestionSets(accountId);
        if (alive) setQueue(pending);
      }
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Review queue unavailable."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; requestVersion.current += 1; };
  }, [accountId, accountMatches, refresh]);

  const canReview = accountMatches && reviewerAccountId === accountId && reviewer && !loading;
  const visiblePreview = accountMatches && preview?.accountId === accountId ? preview.value : undefined;
  const questionCount = visiblePreview?.snapshot.questions.length ?? 0;
  const pageStart = page * 20;
  const pageEnd = Math.min(pageStart + 20, questionCount);
  const allQuestionsShown = Boolean(visiblePreview && revealedCount >= questionCount);
  const allAnswersKeyed = Boolean(visiblePreview?.snapshot.questions.every(question =>
    Boolean(question.correctKey) && question.options.some(option => option.key === question.correctKey)));

  async function open(id: string) {
    if (!canReview || busy) return;
    const version = ++requestVersion.current;
    setBusy(true); setError(""); setMessage(undefined); setPreview(undefined);
    setReason(""); setAttested(false); setPage(0); setRevealedCount(20);
    try {
      const value = await loadPendingQuestionSetReviewPreview(accountId, id);
      if (version === requestVersion.current && useAccount.getState().user?.id === accountId)
        setPreview({ accountId, value });
    } catch (cause) {
      if (version === requestVersion.current && useAccount.getState().user?.id === accountId)
        setError(cause instanceof Error ? cause.message : "This submission could not be opened.");
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  async function decide(approved: boolean) {
    if (!visiblePreview || !canReview || busy || reason.trim().length < 8
      || (approved && (!attested || !allQuestionsShown || !allAnswersKeyed))) return;
    const version = requestVersion.current;
    setBusy(true); setError(""); setMessage(undefined);
    try {
      await reviewQuestionSetSubmission(accountId, visiblePreview, approved, reason);
      if (version !== requestVersion.current || useAccount.getState().user?.id !== accountId) return;
      setPreview(undefined);
      setMessage({ accountId, text: approved ? "Question Set approved for search."
        : "Question Set returned to its contributor with your note." });
      setRefresh(value => value + 1);
    } catch (cause) {
      if (version === requestVersion.current && useAccount.getState().user?.id === accountId) {
        const message = cause instanceof Error ? cause.message : "The review could not be saved.";
        // A changed publication must be inspected and attested again.
        if (/reopen|changed since inspection|changed\. Reopen/i.test(message)) {
          setPreview(undefined); setReason(""); setAttested(false); setPage(0); setRevealedCount(20);
        }
        setError(message);
      }
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  return <GlassCard pad className="qsl-review-queue">
    <PanelHeader headingLevel={2} title="Question Set Library review" sub="Learner submissions appear in search only after academic review."
      action={<GButton size="sm" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Refresh</GButton>} />
    {loading && accountMatches && <p role="status">Checking academic review access…</p>}
    {!loading && accountMatches && !canReview && !error && <p className="sub">This operator account has no academic reviewer permission. Host access alone cannot approve medical content.</p>}
    {canReview && queue.length === 0 && <p className="sub">No learner Question Sets await review.</p>}
    {canReview && queue.map(item => <div className="qsl-review-row" key={item.id}>
      <div><b>{item.title}</b><small>{item.questionCount} questions · {item.credit || "No public credit"} · submitted {new Date(item.createdAt).toLocaleDateString()}</small></div>
      <div><Tag tone="orange">Pending</Tag><GButton size="sm" disabled={busy} onClick={() => void open(item.id)}>Inspect</GButton></div>
    </div>)}
    {accountMatches && message?.accountId === accountId && <p role="status">{message.text}</p>}
    {error && <p role="alert" className="qsl-error">{error}</p>}
    {visiblePreview && <Modal className="qsl-review-modal" title={`Review ${visiblePreview.snapshot.title}`} onClose={busy ? () => {} : () => setPreview(undefined)}>
      <div className="qsl-review-detail stack gap12">
        <p><BookOpenCheck size={17} aria-hidden="true" /> {questionCount} questions. Check source, rights and every answer before approval.</p>
        <p className="qsl-review-rights">Rights notice: {visiblePreview.snapshot.copyrightNotice || "None supplied"}. Verify contributor explanations and choice rationales against their cited sources; AI text is unverified.</p>
        <p ref={pageStatusRef} role="status" tabIndex={-1}>Showing questions {pageStart + 1}–{pageEnd} of {questionCount}. Open every batch before approving.</p>
        <ol key={page} start={pageStart + 1}>{visiblePreview.snapshot.questions.slice(pageStart, pageEnd).map(question => <li key={question.id}>
          <b>{question.stem}</b>
          <ul>{question.options.map(option => <li key={option.key}>{option.key}. {option.text}
            {question.choiceRationales?.[option.key] && <p className="qsl-review-rationale">Rationale: {question.choiceRationales[option.key]}</p>}
          </li>)}</ul>
          <p>Answer: <b>{question.correctKey ?? "Unresolved"}</b></p>
          {question.explanation?.startsWith("AXOM AI-assisted explanation") && <Tag tone="orange">AI-assisted draft · verify against source</Tag>}
          {question.explanation && <p>{question.explanation}</p>}
          <small>Source: {question.citation || "No citation supplied"}</small>
        </li>)}</ol>
        <div className="row wrap gap8">
          {page > 0 && <GButton size="sm" disabled={busy} onClick={() => setPage(value => value - 1)}>Previous 20 questions</GButton>}
          {pageEnd < questionCount && <GButton size="sm" disabled={busy} onClick={() => {
            setPage(value => value + 1);
            setRevealedCount(value => Math.max(value, Math.min(pageEnd + 20, questionCount)));
          }}>Show next 20 questions</GButton>}
        </div>
        {!allAnswersKeyed && <p role="alert" className="qsl-error">One or more answers are unresolved. Return this set for revision.</p>}
        <label className="qsl-field">Review note
          <textarea className="field" value={reason} minLength={8} maxLength={500} rows={3} disabled={busy}
            onChange={event => setReason(event.target.value)} placeholder="Record source, rights or answer checks performed." />
        </label>
        <label className="qsl-check"><input type="checkbox" checked={attested} disabled={busy || !allQuestionsShown || !allAnswersKeyed} onChange={event => setAttested(event.target.checked)} />
          <span>I checked the set's distribution rights and answer evidence. My note records what I checked.</span></label>
        <div className="row wrap gap8">
          <GButton size="sm" variant="primary" disabled={busy || !attested || !allQuestionsShown || !allAnswersKeyed || reason.trim().length < 8} onClick={() => void decide(true)}>Approve for library</GButton>
          <GButton size="sm" disabled={busy || reason.trim().length < 8} onClick={() => void decide(false)}>Return for revision</GButton>
        </div>
        {error && <p role="alert" className="qsl-error">{error}</p>}
      </div>
    </Modal>}
  </GlassCard>;
}
