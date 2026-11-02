import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Eye, RefreshCw, X } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { downloadAcademicCourse, type AcademicPreview } from "../../lib/academicLibrary/client";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { inspectStoredRevisionExplanations, type ExplanationReviewReceipt } from "../../lib/academicLibrary/explanationReview";
import { canReviewAcademicCourses, decideAcademicReview, listAcademicReviewQueue, previewAcademicReview,
  type ReviewCursor, type ReviewSubmission } from "../../lib/academicLibrary/reviewQueue";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import "../../styles/academic-review-queue.css";

interface QueueError { message: string; reset: boolean; after?: ReviewCursor }
interface PreviewState { submission: ReviewSubmission; loading: boolean; value?: AcademicPreview; error?: string }
const messageFor = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
// Date.parse normalizes timezones but drops PostgreSQL's submillisecond precision.
const submittedTime = (value: string) => BigInt(Date.parse(value)) * 1000n
  + BigInt((value.match(/\.(\d+)/)?.[1] ?? "").slice(3, 6).padEnd(3, "0"));

/** Shared extraction of PR #30's submission rows, with academic-reviewer access
 * and decisions. The Host page can use this same component after integration. */
export function AcademicReviewQueue() {
  const accountId = useAccount(account => account.user?.id);
  return accountId ? <ReviewerQueue key={accountId} accountId={accountId} /> : null;
}

function ReviewerQueue({ accountId }: { accountId: string }) {
  const queueId = useId();
  const [reviewer, setReviewer] = useState<boolean>();
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<ReviewCursor>();
  const [error, setError] = useState<QueueError>();
  const [preview, setPreview] = useState<PreviewState>();
  const [deciding, setDeciding] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadedRevision, setDownloadedRevision] = useState<string>();
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [receipt, setReceipt] = useState<ExplanationReviewReceipt>();
  const [rationaleReviewed, setRationaleReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const listGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const listing = useRef(false);
  const decision = useRef(false);
  const receivedIds = useRef(new Set<string>());

  const loadPage = useCallback(async (reset: boolean, after?: ReviewCursor) => {
    if (listing.current || decision.current) return;
    listing.current = true;
    const generation = ++listGeneration.current;
    const current = () => mounted.current && generation === listGeneration.current;
    setLoading(true); setError(undefined);
    if (reset) {
      receivedIds.current.clear();
      setReviewer(undefined); setSubmissions([]); setCursor(undefined); setMore(false);
      setPreview(undefined); setReceipt(undefined); setRationaleReviewed(false);
      setDownloadedRevision(undefined); setDownloadMessage(""); setDownloadError("");
      setNotice(""); previewGeneration.current += 1;
    }
    let permitted = false;
    try {
      permitted = await canReviewAcademicCourses(accountId);
      if (!current()) return;
      setReviewer(permitted);
      if (!permitted) { setSubmissions([]); setPreview(undefined); setReceipt(undefined);
        setDownloadedRevision(undefined); setDownloadMessage(""); setDownloadError("");
        setRationaleReviewed(false); setMore(false); previewGeneration.current += 1; return; }
      const page = await listAcademicReviewQueue(accountId, after);
      if (!current()) return;
      const last = page.at(-1);
      let previous = after;
      const advancing = page.every(item => {
        if (previous) {
          const before = submittedTime(previous.submittedAt), next = submittedTime(item.submitted_at);
          if (next < before || (next === before && item.id.toLowerCase() <= previous.id.toLowerCase())) return false;
        }
        previous = { submittedAt: item.submitted_at, id: item.id };
        return true;
      });
      if (!advancing || page.some(item => receivedIds.current.has(item.id)) || new Set(page.map(item => item.id)).size !== page.length) {
        throw new Error("Submissions changed while loading. Refresh the review queue before continuing.");
      }
      for (const item of page) receivedIds.current.add(item.id);
      setSubmissions(existing => reset ? page : [...existing, ...page.filter(item => !existing.some(saved => saved.id === item.id))]);
      // Keep the server page boundary even if its last submission is approved
      // and removed locally before the next page is requested.
      setCursor(last ? { submittedAt: last.submitted_at, id: last.id } : undefined);
      setMore(page.length === 24);
    } catch (cause) {
      if (!current()) return;
      if (!permitted) setReviewer(false);
      setError({ message: messageFor(cause, "Submissions could not be loaded. Try again when connected."), reset, after });
    } finally {
      if (current()) { listing.current = false; setLoading(false); }
    }
  }, [accountId]);

  useEffect(() => {
    mounted.current = true;
    void loadPage(true);
    return () => {
      mounted.current = false; listing.current = false;
      listGeneration.current += 1; previewGeneration.current += 1;
    };
  }, [loadPage]);

  async function openPreview(submission: ReviewSubmission) {
    if (decision.current || inspecting || downloading) return;
    const generation = ++previewGeneration.current;
    setReceipt(undefined); setRationaleReviewed(false);
    setDownloadedRevision(undefined); setDownloadMessage(""); setDownloadError("");
    setPreview({ submission, loading: true }); setNotice("");
    try {
      const value = await previewAcademicReview(submission, accountId);
      if (!mounted.current || generation !== previewGeneration.current) return;
      if (value.id !== submission.current_revision_id || value.collection_id !== submission.id)
        throw new Error("This submission changed. Refresh the review queue before deciding.");
      setPreview({ submission, loading: false, value });
    } catch (cause) {
      if (mounted.current && generation === previewGeneration.current)
        setPreview({ submission, loading: false, error: messageFor(cause, "The preview could not be opened. Try again when connected.") });
    }
  }

  function closePreview() {
    if (decision.current || inspecting || downloading) return;
    previewGeneration.current += 1;
    setPreview(undefined); setReceipt(undefined); setRationaleReviewed(false);
    setDownloadedRevision(undefined); setDownloadMessage(""); setDownloadError("");
  }

  async function downloadReviewCopy(submission: ReviewSubmission) {
    if (decision.current || downloading || !preview?.value
      || preview.submission.id !== submission.id) return;
    const generation = previewGeneration.current;
    const scope = academicAccountScope(accountId);
    setDownloading(true); setDownloadError(""); setDownloadMessage("Checking and downloading this exact revision…");
    setDownloadedRevision(undefined); setReceipt(undefined); setRationaleReviewed(false);
    try {
      const result = await downloadAcademicCourse(submission.current_revision_id,
        message => { if (mounted.current && generation === previewGeneration.current) setDownloadMessage(message); }, scope);
      scope.assertCurrent();
      if (!mounted.current || generation !== previewGeneration.current) return;
      setDownloadedRevision(submission.current_revision_id);
      setDownloadMessage(`${result.questionIds.length} questions saved on this device. Open Question Bank to inspect answers and images. ${result.bindings.originals?.length
        ? "Check the included source documents against every rationale."
        : "No original source files were included; obtain them separately before attesting."}`);
    } catch (cause) {
      if (mounted.current && generation === previewGeneration.current) {
        setDownloadMessage("");
        setDownloadError(messageFor(cause, "The review copy could not be downloaded. Retry when connected."));
      }
    } finally {
      scope.dispose();
      if (mounted.current) setDownloading(false);
    }
  }

  async function checkExplanations(submission: ReviewSubmission) {
    if (decision.current || inspecting || downloadedRevision !== submission.current_revision_id || !preview?.value
      || preview.submission.id !== submission.id) return;
    const generation = previewGeneration.current;
    setInspecting(true); setReceipt(undefined); setRationaleReviewed(false);
    try {
      const result = await inspectStoredRevisionExplanations(submission.id, submission.current_revision_id, accountId);
      if (!mounted.current || generation !== previewGeneration.current) return;
      if (result.collectionId !== submission.id || result.revisionId !== submission.current_revision_id
        || result.readyQuestions !== submission.ready_questions) {
        throw new Error("This submission changed. Refresh the queue and inspect its latest revision.");
      }
      setReceipt(result);
    } catch (cause) {
      if (mounted.current && generation === previewGeneration.current)
        setPreview({ submission, loading: false, error: messageFor(cause, "The stored explanations could not be checked.") });
    } finally {
      if (mounted.current) setInspecting(false);
    }
  }

  async function decide(approved: boolean) {
    if (decision.current || inspecting || downloading || listing.current || !preview?.value || preview.loading || preview.error
      || (approved && (!receipt || !rationaleReviewed || receipt.missingExplanations !== 0
        || receipt.readyQuestions === 0 || downloadedRevision !== preview.submission.current_revision_id))) return;
    decision.current = true; setDeciding(true); setNotice("");
    const { submission } = preview;
    const nextId = submissions[submissions.findIndex(item => item.id === submission.id) + 1]?.id;
    const generation = previewGeneration.current;
    try {
      await decideAcademicReview(submission, approved, accountId, receipt, rationaleReviewed);
      if (!mounted.current || generation !== previewGeneration.current) return;
      setSubmissions(existing => existing.filter(item => item.id !== submission.id));
      setPreview(undefined); setReceipt(undefined); setRationaleReviewed(false);
      setDownloadedRevision(undefined); setDownloadMessage(""); setDownloadError(""); previewGeneration.current += 1;
      setNotice(`${approved ? "Approved" : "Rejected"}: ${submission.title}.`);
      window.setTimeout(() => {
        if (!mounted.current) return;
        const queue = document.getElementById(queueId);
        const next = [...(queue?.querySelectorAll<HTMLButtonElement>("[data-review-preview]") ?? [])]
          .find(button => button.dataset.reviewPreview === nextId);
        (next ?? queue?.querySelector<HTMLButtonElement>("[data-review-refresh]"))?.focus();
      }, 0);
    } catch (cause) {
      if (mounted.current && generation === previewGeneration.current)
        setPreview({ submission, loading: false, error: messageFor(cause, "The review could not be saved. Refresh the queue and try again.") });
    } finally {
      decision.current = false;
      if (mounted.current) setDeciding(false);
    }
  }

  if (!reviewer && !error) return null;
  return <GlassCard id={queueId} className="academic-review-queue" role="region" aria-label="Submitted QBank review">
    <PanelHeader title="Submitted QBank review" headingLevel={2} sub="Shared courses waiting for academic review."
      action={<GButton size="sm" data-review-refresh disabled={loading || deciding || downloading || inspecting} onClick={() => void loadPage(true)}><RefreshCw size={ICON_SIZE.body} /> Refresh review queue</GButton>} />
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">{submissions.length ? "Loading more submissions…" : "Loading submissions…"}</p>}
    {error && <div className="academic-review-error" role="alert"><p>{error.message}</p><GButton size="sm" disabled={loading} onClick={() => void loadPage(error.reset, error.after)}>Retry submissions</GButton></div>}
    {!loading && !error && !submissions.length && <p role="status">No shared courses are waiting for review.</p>}
    <div className="academic-review-list">
      {submissions.map(submission => {
        const active = preview?.submission.id === submission.id && preview.submission.current_revision_id === submission.current_revision_id ? preview : undefined;
        const previewId = `academic-review-preview-${submission.id}`;
        return <article className="academic-review-row" key={`${submission.id}:${submission.current_revision_id}`} aria-label={submission.title}>
          <div className="academic-review-row-summary">
            <div className="academic-review-description"><h3>{submission.title}</h3><p>{submission.term} · {submission.module}</p>
              <p>Submitted by {submission.owner_display_name}</p><p>Submitted <time dateTime={submission.submitted_at}>{new Date(submission.submitted_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</time></p>
            </div>
            <div className="academic-review-row-actions"><Tag tone="gold">Pending</Tag><p>{submission.ready_questions} ready · {submission.review_questions} awaiting review</p>
              <GButton size="sm" data-review-preview={submission.id} aria-expanded={Boolean(active)} aria-controls={active ? previewId : undefined} disabled={deciding || downloading || inspecting} onClick={() => active ? closePreview() : void openPreview(submission)}><Eye size={ICON_SIZE.body} /> {active ? "Close preview" : "Open preview"}</GButton>
            </div>
          </div>
          {active && <div id={previewId} className="academic-review-preview" role="group" aria-label={`Preview ${submission.title}`}>
            {active.loading && <p role="status">Opening the submitted preview…</p>}
            {active.error && <div role="alert"><p>{active.error}</p><GButton size="sm" disabled={deciding} onClick={() => void openPreview(submission)}>Retry preview</GButton></div>}
            {active.value && <>
              <h4>Submitted plan</h4>
              {active.value.template_text.trim() ? <pre tabIndex={0} aria-label="Submitted course plan">{active.value.template_text}</pre> : <p>No weekly plan was submitted for this question collection.</p>}
              <p className="academic-review-preview-note">This plan and its counts are a starting point. Approval requires inspecting the exact stored copy and checking answers, images and explanations against their sources.</p>
              <GButton size="sm" disabled={downloading || deciding} onClick={() => void downloadReviewCopy(submission)}>
                {downloading ? "Downloading review copy…" : downloadedRevision === submission.current_revision_id ? "Download review copy again" : "Download review copy"}
              </GButton>
              {downloadMessage && <p role="status" className="academic-review-coverage">{downloadMessage} {downloadedRevision === submission.current_revision_id && <a href="#questions">Open Question Bank</a>}</p>}
              {downloadError && <p role="alert" className="academic-review-coverage">{downloadError}</p>}
              <GButton size="sm" disabled={inspecting || deciding || downloadedRevision !== submission.current_revision_id} onClick={() => void checkExplanations(submission)}>
                {inspecting ? "Checking stored explanations…" : "Check stored explanations"}
              </GButton>
              {receipt && <p role="status" className="academic-review-coverage">{receipt.explainedReadyQuestions} of {receipt.readyQuestions} ready questions have an explanation in this stored revision. {receipt.missingExplanations} missing. Presence does not verify accuracy.</p>}
              <label className="academic-review-attestation"><input type="checkbox" checked={rationaleReviewed} disabled={inspecting || deciding || !receipt}
                onChange={event => setRationaleReviewed(event.target.checked)} />
                <span>I reviewed every ready answer, image and explanation against its source for this exact revision.</span></label>
              <div className="academic-review-decisions"><GButton size="sm" variant="primary"
                disabled={deciding || inspecting || downloading || loading || downloadedRevision !== submission.current_revision_id
                  || !receipt || !rationaleReviewed || receipt.missingExplanations !== 0 || receipt.readyQuestions === 0}
                onClick={() => void decide(true)}><Check size={ICON_SIZE.body} /> {deciding ? "Saving review…" : "Approve this revision"}</GButton>
                <GButton size="sm" disabled={deciding || inspecting || loading} onClick={() => void decide(false)}><X size={ICON_SIZE.body} /> Reject</GButton></div>
            </>}
          </div>}
        </article>;
      })}
    </div>
    {more && <GButton className="academic-review-more" size="sm" disabled={loading || deciding} onClick={() => void loadPage(false, cursor)}><ChevronDown size={ICON_SIZE.body} /> Load more submissions</GButton>}
  </GlassCard>;
}
