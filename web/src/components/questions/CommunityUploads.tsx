import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, BookUp2, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useUi } from "../../lib/uiStore";
import { useStore } from "../../lib/store";
import { questionSetKind, type QuestionSet, type SourceDocument } from "../../lib/library";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import { hasMainExplanation } from "../../lib/questionExplanationCoverage";
import type { QuestionRecord } from "../../lib/questions";
import type { ReviewedFilingTerm } from "../../lib/privateLibrary/types";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { saveCommunityReference } from "../../lib/academicLibrary/communityReference";
import { academicClient, downloadAcademicCourse, isAcademicReviewer, type AcademicCourse } from "../../lib/academicLibrary/client";
import { inspectStoredRevisionExplanations, type ExplanationReviewReceipt } from "../../lib/academicLibrary/explanationReview";
import { prepareSavedSourceUpload } from "../../lib/academicLibrary/savedSourceUpload";
import { uploadAcademicCourse, type AcademicUpload, type AcademicUploadResult } from "../../lib/academicLibrary/upload";
import {
  communityPreview, listCommunityUploads, reviewCommunityUpload, submitCommunityUpload,
  withdrawCommunityUpload, type CommunityPreview, type CommunityUpload,
} from "../../lib/academicLibrary/community";
import { listOwnedAcademicCourses, ownedCourseStatus } from "../../lib/academicLibrary/ownedCourses";
import { AcademicCourseUpload } from "../tracker/AcademicCourseUpload";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";
import { CommunityQuestionSetLibrary } from "./CommunityQuestionSetLibrary";
import { GButton, GlassCard, Tag } from "../ui/primitives";
import { TechnicalDetails } from "../shell/TechnicalDetails";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/community-uploads.css";

const TERMS = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
const EMPTY_SETS: QuestionSet[] = [];
const EMPTY_QUESTIONS: QuestionRecord[] = [];
const EMPTY_DOCUMENTS: SourceDocument[] = [];
type Selected = { accountId: string; collectionId: string; revisionId: string; label: string };
type Page = { accountId: string; search: string; term: string; rows: CommunityUpload[]; more: boolean };
type LocalSource = { document: SourceDocument; questions: QuestionRecord[]; sets: number;
  ready: number; explained: number; revision: string };

function sourceRevision(document: SourceDocument, questions: readonly QuestionRecord[]): string {
  return JSON.stringify([document.checksum, document.fileName, document.sizeBytes,
    document.originalFile?.sha256,
    questions.map(question => [question.id, question.updatedAt]).sort(([left], [right]) => left.localeCompare(right))]);
}

/** Unreviewed community material is discoverable without entering the official
 * catalog. Every download still uses the normal hash-checked installer. */
export function CommunityUploads({ onOpenLibrary, onPracticeSet }: { onOpenLibrary: () => void; onPracticeSet?: (set: QuestionSet) => void }) {
  const accountId = useAccount(state => state.user?.id);
  const accountPhase = useAccount(state => state.phase);
  const questionSets = useStore(state => state.questionSets ?? EMPTY_SETS);
  const questions = useStore(state => state.questions ?? EMPTY_QUESTIONS);
  const documents = useStore(state => state.documents ?? EMPTY_DOCUMENTS);
  const accountEpoch = useRef(0);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState("");
  const [submittingQuestionSetId, setSubmittingQuestionSetId] = useState("");
  const [browseQuestionSets, setBrowseQuestionSets] = useState(false);
  const [page, setPage] = useState<Page>();
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [reviewer, setReviewer] = useState(false);
  const [owned, setOwned] = useState<{ accountId: string; rows: AcademicCourse[] }>();
  const [ownedBusy, setOwnedBusy] = useState(false);
  const [selected, setSelected] = useState<Selected>();
  const [rights, setRights] = useState(false);
  const [downloaded, setDownloaded] = useState<{ accountId: string; revisionId: string }>();
  const [preview, setPreview] = useState<{ accountId: string; revisionId: string; value: CommunityPreview }>();
  const [reviewChecked, setReviewChecked] = useState(false);
  const [reviewReceipt, setReviewReceipt] = useState<ExplanationReviewReceipt>();
  const [withdrawId, setWithdrawId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [feedbackLocation, setFeedbackLocation] = useState("");
  const listFeedbackRef = useRef<HTMLDivElement>(null);
  const focusListFeedback = useRef(false);
  const [localSourceId, setLocalSourceId] = useState("");
  const [localTerm, setLocalTerm] = useState<ReviewedFilingTerm | "">("");
  const [localModule, setLocalModule] = useState("");
  const [localFilingConfirmed, setLocalFilingConfirmed] = useState(false);
  const [localRights, setLocalRights] = useState(false);
  const [localPrepared, setLocalPrepared] = useState<{ accountId: string; sourceId: string; revision: string; upload: AcademicUpload }>();

  const localSources = useMemo((): LocalSource[] => {
    const byDocument = new Map<string, number>();
    for (const set of questionSets) {
      if (questionSetKind(set) !== "source" || set.sourceDocumentIds.length !== 1) continue;
      const id = set.sourceDocumentIds[0];
      byDocument.set(id, (byDocument.get(id) ?? 0) + 1);
    }
    const questionsByDocument = new Map<string, QuestionRecord[]>();
    for (const question of questions) {
      if (!question.sourceDocumentId) continue;
      const members = questionsByDocument.get(question.sourceDocumentId) ?? [];
      members.push(question);
      questionsByDocument.set(question.sourceDocumentId, members);
    }
    return documents.flatMap(document => {
      const sets = byDocument.get(document.id);
      if (!sets || !document.checksum || !document.originalFile) return [];
      const members = questionsByDocument.get(document.id) ?? [];
      if (!members.length) return [];
      return [{ document, questions: members, sets,
        ready: members.filter(question => questionPracticeReadiness(question) === "ready").length,
        explained: members.filter(hasMainExplanation).length,
        revision: sourceRevision(document, members) }];
    });
  }, [questionSets, questions, documents]);
  const localSource = localSources.find(source => source.document.id === localSourceId);
  const availableQuestionSets = useMemo(() => questionSets.filter(set => Array.isArray(set.questionIds) && set.questionIds.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title)), [questionSets]);
  const submittingQuestionSet = availableQuestionSets.find(set => set.id === submittingQuestionSetId);
  const preparedSource = localPrepared && localPrepared.accountId === accountId && localPrepared.sourceId === localSourceId
    && localPrepared.revision === localSource?.revision ? localPrepared : undefined;

  useEffect(() => {
    let current = true;
    accountEpoch.current += 1;
    focusListFeedback.current = false;
    setReviewer(false);
    setSelected(undefined);
    setOwned(undefined);
    setDownloaded(undefined);
    setPreview(undefined);
    setReviewChecked(false);
    setReviewReceipt(undefined);
    setRights(false);
    setLocalSourceId(""); setLocalTerm(""); setLocalModule("");
    setSelectedQuestionSetId(""); setSubmittingQuestionSetId(""); setBrowseQuestionSets(false);
    setLocalFilingConfirmed(false); setLocalRights(false); setLocalPrepared(undefined);
    setProgress(""); setError(""); setFeedbackLocation(""); setBusyId(""); setWithdrawId("");
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (current) setReviewer(value); });
    return () => { current = false; };
  }, [accountId]);

  useEffect(() => {
    if (!focusListFeedback.current || feedbackLocation !== "list" || (!progress && !error)) return;
    listFeedbackRef.current?.focus();
    focusListFeedback.current = false;
  }, [feedbackLocation, progress, error]);

  useEffect(() => {
    let current = true;
    setPage(undefined);
    setListError("");
    if (!accountId) return () => { current = false; };
    setLoading(true);
    void listCommunityUploads(search, term).then(rows => {
      if (current) setPage({ accountId, search, term, rows, more: rows.length === 24 });
    }, cause => {
      if (current) setListError(cause instanceof Error ? cause.message : "Community uploads could not be loaded.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [accountId, search, term, refresh]);

  const rows = page && page.accountId === accountId ? page.rows : [];
  const choice = selected?.accountId === accountId ? selected : undefined;
  const privateCourses = owned && owned.accountId === accountId
    ? owned.rows.filter(course => ownedCourseStatus(course) === "private") : undefined;

  async function loadMore() {
    if (!accountId || !page?.more || loading || page.accountId !== accountId
      || page.search !== search || page.term !== term) return;
    const last = page.rows.at(-1);
    if (!last) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    setLoading(true); setListError("");
    try {
      const next = await listCommunityUploads(search, term, { submittedAt: last.submitted_at, id: last.id });
      if (!active()) return;
      setPage(current => current?.accountId === accountId && current.search === search && current.term === term
        ? { accountId, search, term, rows: [...current.rows, ...next], more: next.length === 24 } : current);
    } catch (cause) {
      if (active()) setListError(cause instanceof Error ? cause.message : "More uploads could not be loaded.");
    } finally { if (active()) setLoading(false); }
  }

  async function loadPrivate() {
    if (!accountId || ownedBusy) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    setOwnedBusy(true); setError(""); setProgress(""); setFeedbackLocation("owned");
    try {
      const courses = await listOwnedAcademicCourses(accountId);
      if (active()) setOwned({ accountId, rows: courses });
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "Your private courses could not be loaded.");
    } finally { if (active()) setOwnedBusy(false); }
  }

  function saved(result: AcademicUploadResult) {
    if (!accountId) return;
    setFeedbackLocation("package"); setError("");
    setRights(false);
    if (result.status === "active") {
      setSelected({ accountId, collectionId: result.collection_id,
        revisionId: result.revision_id, label: "Your newly saved course" });
      setProgress("The course is saved privately. Confirm your sharing rights to submit this exact revision.");
    } else {
      setProgress("A newer revision is active. Refresh your private courses before submitting it.");
    }
  }

  async function checkLocalSource() {
    if (!accountId || !localSource || !localTerm || !localModule.trim() || !localFilingConfirmed || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId("local-source"); setError(""); setFeedbackLocation("local"); setLocalPrepared(undefined);
    setProgress("Checking every saved question, its source, answer, explanation and images on this device…");
    try {
      const upload = await prepareSavedSourceUpload(localSource.document, localSource.questions,
        { term: localTerm, module: localModule.trim() }, scope.assertCurrent);
      scope.assertCurrent();
      const workspace = useStore.getState();
      const currentDocument = (workspace.documents ?? EMPTY_DOCUMENTS).find(document => document.id === localSourceId);
      const current = (workspace.questions ?? EMPTY_QUESTIONS).filter(question => question.sourceDocumentId === localSourceId);
      const revision = currentDocument ? sourceRevision(currentDocument, current) : "";
      if (revision !== localSource.revision) throw new Error("This saved set changed during checking. Check it again before sharing.");
      if (active()) {
        setLocalPrepared({ accountId, sourceId: localSourceId, revision, upload });
        setProgress("Source, answers, explanations and figures checked. Confirm your sharing rights before sending this exact version.");
      }
    } catch (cause) {
      if (active()) { setProgress(""); setError(cause instanceof Error ? cause.message : "This saved source could not be checked."); }
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function shareLocalSource() {
    if (!accountId || !preparedSource || !localRights || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId("local-source"); setError(""); setFeedbackLocation("local");
    let savedRevision: AcademicUploadResult | undefined;
    try {
      setProgress("Saving this source privately and checking the stored revision…");
      savedRevision = await uploadAcademicCourse(await academicClient(accountId), accountId,
        preparedSource.upload, scope.assertCurrent, message => { if (active()) setProgress(message); });
      scope.assertCurrent();
      if (savedRevision.status !== "active") {
        if (active()) setProgress("A newer private revision is active. Refresh your private courses before submitting it.");
        return;
      }
      if (active()) {
        setSelected({ accountId, collectionId: savedRevision.collection_id,
          revisionId: savedRevision.revision_id, label: `${preparedSource.upload.metadata.term} · ${preparedSource.upload.metadata.module}` });
        setRights(true);
        setProgress("Private save verified. Submitting this exact revision as Unreviewed…");
      }
      await submitCommunityUpload(savedRevision.collection_id, savedRevision.revision_id, accountId, true);
      scope.assertCurrent();
      if (active()) {
        setSelected(undefined); setRights(false); setLocalRights(false); setLocalPrepared(undefined);
        setProgress("Shared in Community Uploads as Unreviewed. An academic reviewer must check it before official approval.");
        setRefresh(value => value + 1);
      }
    } catch (cause) {
      if (active()) {
        setError(cause instanceof Error ? cause.message : "This saved source could not be shared.");
        setProgress(savedRevision?.status === "active"
          ? "The private save succeeded. Use Submit as Unreviewed below to retry community sharing." : "");
      }
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function submit() {
    if (!accountId || !choice || !rights || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(choice.collectionId); setError(""); setProgress(""); setFeedbackLocation("submit");
    try {
      await submitCommunityUpload(choice.collectionId, choice.revisionId, accountId, rights);
      scope.assertCurrent();
      if (active()) {
        setSelected(undefined); setRights(false);
        setProgress("Submitted to Community Uploads as Unreviewed. An academic reviewer must approve this exact revision before it enters the official catalog.");
        setRefresh(value => value + 1);
      }
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The course could not be submitted.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function download(row: CommunityUpload) {
    if (!accountId || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError(""); setFeedbackLocation(row.id); setProgress("Checking and downloading this exact revision…");
    setDownloaded(undefined); setReviewChecked(false); setReviewReceipt(undefined);
    try {
      await saveCommunityReference(row.current_revision_id, accountId, undefined, scope.assertCurrent);
      const result = await downloadAcademicCourse(row.current_revision_id, message => { if (active()) setProgress(message); }, scope);
      scope.assertCurrent();
      await saveCommunityReference(row.current_revision_id, accountId, result.questionIds, scope.assertCurrent);
      let receipt: ExplanationReviewReceipt | undefined;
      if (reviewer) {
        try { receipt = await inspectStoredRevisionExplanations(row.id, row.current_revision_id, accountId); }
        catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : "Explanation readback failed."); }
      }
      if (active()) {
        setDownloaded({ accountId, revisionId: row.current_revision_id });
        setReviewReceipt(receipt);
        setProgress(`${result.questionIds.length} questions saved on this device. Questions still awaiting answer or source review remain held.`);
      }
    } catch (cause) {
      if (active()) { setProgress(""); setError(cause instanceof Error ? cause.message : "This upload could not be downloaded."); }
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function loadPreview(row: CommunityUpload) {
    if (!accountId || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError(""); setProgress(""); setFeedbackLocation(row.id);
    try {
      const value = await communityPreview(row.id, row.current_revision_id, accountId);
      scope.assertCurrent();
      if (active()) setPreview({ accountId, revisionId: row.current_revision_id, value });
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The plan preview could not be opened.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function review(row: CommunityUpload, approved: boolean) {
    if (!accountId || !reviewer || !reviewChecked || (approved && (!reviewReceipt || reviewReceipt.missingExplanations > 0 || reviewReceipt.readyQuestions === 0))
      || downloaded?.accountId !== accountId
      || downloaded.revisionId !== row.current_revision_id || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError(""); setProgress(""); setFeedbackLocation(row.id);
    try {
      await reviewCommunityUpload(row.id, row.current_revision_id, approved, accountId, reviewReceipt, reviewChecked);
      scope.assertCurrent();
      if (active()) {
        setDownloaded(undefined); setReviewChecked(false); setReviewReceipt(undefined);
        setProgress(approved ? "Approved. This revision is now in the official course catalog."
          : "Review recorded. This upload is no longer in the unreviewed list.");
        focusListFeedback.current = true; setFeedbackLocation("list");
        setRefresh(value => value + 1);
      }
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The review could not be saved.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function withdraw(row: CommunityUpload) {
    if (!accountId || !row.owned || busyId) return;
    if (withdrawId !== row.id) { setWithdrawId(row.id); return; }
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError(""); setProgress(""); setFeedbackLocation(row.id);
    try {
      await withdrawCommunityUpload(row.id, row.current_revision_id, accountId);
      scope.assertCurrent();
      if (active()) {
        setWithdrawId(""); setProgress("Removed from Community Uploads. Your private course remains in your account.");
        focusListFeedback.current = true; setFeedbackLocation("list");
        setRefresh(value => value + 1);
      }
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The submission could not be withdrawn.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  function searchNow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSearch(draftSearch.trim());
  }

  function feedback(location: string) {
    if (feedbackLocation !== location || (!progress && !error)) return null;
    return <div className="community-feedback" ref={location === "list" ? listFeedbackRef : undefined} tabIndex={-1}>
      {progress && <p className="community-status" role="status" aria-live="polite">{progress}</p>}
      {error && <p className="community-error" role="alert">{error}</p>}
    </div>;
  }

  return <section className="community-uploads" aria-label="Community Uploads">
    <header className="community-hero">
      <span className="qb-eyebrow">Shared by learners</span>
      <h2>Community Uploads</h2>
      <p>Discover standalone Question Sets and courses shared by learners. Question Sets enter search only after academic review; community courses remain visibly Unreviewed until approved.</p>
    </header>

    {!accountId ? accountPhase === "loading" ? <GlassCard pad><p role="status">Checking your account…</p></GlassCard>
      : accountPhase === "unconfigured" ? <GlassCard pad><h3>Course exchange is unavailable here</h3><p>This build has no account service. Your personal practice is still available in Question Bank.</p><a className="gbtn sm" href="#questions">Open Question Bank <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></a></GlassCard>
      : <GlassCard pad><h3>Sign in to browse and contribute</h3><p>Community uploads are available to signed-in AXOM accounts.</p><GButton onClick={() => useUi.getState().requestSettings("account")}>Open account settings</GButton></GlassCard> : <>
      <div className="community-layout">
        <div className="community-results">
          <div className="community-qbank-discovery">
            <GButton size="sm" onClick={() => setBrowseQuestionSets(value => !value)}>
              <BookUp2 size={ICON_SIZE.body} aria-hidden="true" /> {browseQuestionSets ? "Hide approved Question Sets" : "Browse approved Question Sets"}
            </GButton>
            {browseQuestionSets && <CommunityQuestionSetLibrary onPractice={onPracticeSet} />}
          </div>
          <form className="community-search" onSubmit={searchNow}>
            <label>Find an upload<input type="search" value={draftSearch} onChange={event => setDraftSearch(event.target.value)} placeholder="Course or module" /></label>
            <label>Term<select value={term} onChange={event => setTerm(event.target.value)}><option value="">All terms</option>{TERMS.map(value => <option key={value}>{value}</option>)}</select></label>
            <GButton type="submit" disabled={loading}>Search</GButton>
            <GButton type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={ICON_SIZE.body} /> Refresh</GButton>
          </form>
          {feedback("list")}
          {loading && !page && <p role="status">Loading community uploads…</p>}
          {listError && <p role="alert">{listError}</p>}
          {!loading && !listError && page && rows.length === 0 && <GlassCard pad><h3>No unreviewed uploads here yet</h3><p>Try another term or search, or share a prepared course below.</p></GlassCard>}
          <div className="community-list">
            {rows.map(row => <article key={row.id} className="community-card">
              <div className="community-card-head"><span className="community-term">{row.term}</span><Tag tone="orange">Unreviewed</Tag></div>
              <h3>{row.module}</h3><p>{row.title}</p>
              <p className="community-facts">{row.ready_questions} ready · {row.review_questions} held for review</p>
              <p className="community-warning">Community material has not been approved by an AXOM reviewer. Check its sources before relying on it.</p>
              <div className="community-actions">
                <GButton disabled={Boolean(busyId)} onClick={() => void loadPreview(row)}>Preview course</GButton>
                <GButton disabled={Boolean(busyId)} onClick={() => void download(row)}><BookOpen size={ICON_SIZE.body} /> {busyId === row.id ? "Checking…" : "Download to practice"}</GButton>
                {downloaded?.accountId === accountId && downloaded.revisionId === row.current_revision_id && <GButton onClick={onOpenLibrary}>Open saved questions <ArrowUpRight size={ICON_SIZE.body} /></GButton>}
                {row.owned && <GButton disabled={Boolean(busyId)} onClick={() => void withdraw(row)}>{withdrawId === row.id ? "Confirm withdraw" : "Withdraw"}</GButton>}
                {withdrawId === row.id && <GButton onClick={() => setWithdrawId("")}>Cancel</GButton>}
              </div>
              {feedback(row.id)}
              {preview?.accountId === accountId && preview.revisionId === row.current_revision_id && <div className="community-preview">
                <h4>Course plan preview</h4>
                {preview.value.template_text ? <pre>{preview.value.template_text}</pre> : <p>This upload has no weekly plan. Its questions remain available by course.</p>}
              </div>}
              {reviewer && downloaded?.accountId === accountId && downloaded.revisionId === row.current_revision_id && <div className="community-review">
                {reviewReceipt && <p role="status">{reviewReceipt.explainedReadyQuestions} of {reviewReceipt.readyQuestions} ready questions have an explanation in this stored revision. {reviewReceipt.missingExplanations} missing. Review the rationale against its source.</p>}
                {!reviewReceipt && <p>Explanation readback is required before official approval. Download this revision again to retry.</p>}
                <label><input type="checkbox" checked={reviewChecked} onChange={event => setReviewChecked(event.target.checked)} /> I inspected this exact revision, its answers, sources, figures and explanation quality.</label>
                <div className="community-actions"><GButton variant="primary" disabled={!reviewChecked || !reviewReceipt || reviewReceipt.missingExplanations > 0 || reviewReceipt.readyQuestions === 0 || Boolean(busyId)} onClick={() => void review(row, true)}><ShieldCheck size={ICON_SIZE.body} /> Approve for official catalog</GButton>
                  <GButton disabled={!reviewChecked || Boolean(busyId)} onClick={() => void review(row, false)}>Reject</GButton></div>
              </div>}
              <TechnicalDetails label="Revision details"><p>Revision {row.current_revision_id}</p><p>Submitted {new Date(row.submitted_at).toLocaleString()}</p></TechnicalDetails>
            </article>)}
          </div>
          {page?.more && <GButton disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more uploads"}</GButton>}
        </div>

        <aside className="community-contribute">
          <GlassCard pad className="community-qbank-publish">
            <BookUp2 size={ICON_SIZE.display} aria-hidden="true" />
            <h3>Share a Question Set</h3>
            <p>Publish a standalone QBank set, without a course or module. AXOM can prepare missing explanations for your review.</p>
            {availableQuestionSets.length ? <div className="community-qbank-picker">
              <label htmlFor="community-qbank-choice">My Question Set
                <select id="community-qbank-choice" value={selectedQuestionSetId}
                  onChange={event => setSelectedQuestionSetId(event.target.value)}>
                  <option value="">Choose a saved set</option>
                  {availableQuestionSets.map(set => <option key={set.id} value={set.id}>
                    {set.title} · {set.questionIds.length} questions
                  </option>)}
                </select>
              </label>
              <GButton variant="primary" disabled={!selectedQuestionSetId}
                onClick={() => setSubmittingQuestionSetId(selectedQuestionSetId)}>Review and submit set</GButton>
            </div> : <p>No saved Question Sets yet. <a href="#questions">Create one in Question Bank</a>, then return to publish it.</p>}
            <p className="sub">Only reviewed, text-only questions with explanations can enter this library. Personal attempts and files remain private.</p>
          </GlassCard>
          <GlassCard pad><UploadCloud size={ICON_SIZE.display} aria-hidden="true" /><h3>Share a course</h3>
            <p>Share a saved source from your Question Bank. AXOM checks its questions and figures, saves a private copy, then lists it here as Unreviewed.</p>
            <fieldset className="community-local-upload" disabled={busyId === "local-source"}>
              <legend>Share saved questions</legend>
              {localSources.length === 0 ? <p>No saved source with its original file is ready here yet. Import and review a PDF or Word file in Add first.</p> : <>
                <label>Saved source
                  <select value={localSourceId} onChange={event => {
                    const next = localSources.find(source => source.document.id === event.target.value);
                    setLocalSourceId(event.target.value); setLocalTerm("");
                    setLocalModule(next?.questions[0]?.module ?? "");
                    setLocalFilingConfirmed(false); setLocalRights(false); setLocalPrepared(undefined);
                  }}>
                    <option value="">Choose a source</option>
                    {localSources.map(source => <option key={source.document.id} value={source.document.id}>
                      {source.document.title} · {source.questions.length} questions
                    </option>)}
                  </select>
                </label>
                {localSource && <>
                  <p role="status">This includes all {localSource.questions.length} questions from {localSource.sets} saved {localSource.sets === 1 ? "set" : "sets"} linked to this source. {localSource.ready} have reviewed answer mappings; {localSource.explained} have explanations.</p>
                  {localSource.ready !== localSource.questions.length || localSource.explained !== localSource.questions.length
                    ? <p className="community-local-warning">Finish the missing answer reviews and explanations in your Question Bank before sharing this source.</p> : null}
                  <label>Term confirmed from the source
                    <select value={localTerm} onChange={event => {
                      setLocalTerm(event.target.value as ReviewedFilingTerm | "");
                      setLocalFilingConfirmed(false); setLocalRights(false); setLocalPrepared(undefined);
                    }}>
                      <option value="">Choose the term</option>
                      {TERMS.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label>Module confirmed from the source
                    <input type="text" maxLength={80} autoComplete="off" value={localModule} onChange={event => {
                      setLocalModule(event.target.value); setLocalFilingConfirmed(false);
                      setLocalRights(false); setLocalPrepared(undefined);
                    }} placeholder="e.g. GOER" />
                  </label>
                  <label className="community-local-check"><input type="checkbox" checked={localFilingConfirmed}
                    onChange={event => { setLocalFilingConfirmed(event.target.checked); setLocalRights(false); setLocalPrepared(undefined); }} />
                    I checked this source's term, module, answers and explanations against the original. Its weeks will not be guessed.</label>
                  <GButton disabled={Boolean(busyId) || !localTerm || !localModule.trim() || !localFilingConfirmed
                    || localSource.ready !== localSource.questions.length || localSource.explained !== localSource.questions.length}
                    onClick={() => void checkLocalSource()}>{busyId === "local-source" ? "Checking…" : "Check saved source"}</GButton>
                  {localPrepared?.accountId === accountId && localPrepared.sourceId === localSourceId && !preparedSource
                    && <p className="community-local-warning">These saved questions changed after the check. Check this source again before sharing.</p>}
                  {preparedSource && <div className="community-local-ready">
                    <Tag tone="green">Ready to share</Tag>
                    <p>{preparedSource.upload.metadata.ready_questions} questions · {preparedSource.upload.metadata.term} · {preparedSource.upload.metadata.module}</p>
                    <p>The original source and verified figures are included. This exact version will stay Unreviewed until an academic reviewer approves it.</p>
                    <label className="community-local-check"><input type="checkbox" checked={localRights} onChange={event => setLocalRights(event.target.checked)} />
                      I have the right to share these questions, explanations, images and source with every signed-in AXOM account.</label>
                    <GButton variant="primary" disabled={!localRights || Boolean(busyId)} onClick={() => void shareLocalSource()}>Save and share as Unreviewed</GButton>
                  </div>}
                </>}
              </>}
            </fieldset>
            {feedback("local")}
            <details className="community-package-upload"><summary>Choose an AXOM course folder or ZIP</summary>
              <AcademicCourseUpload onSaved={saved} />
            </details>
            {feedback("package")}
            <GButton disabled={ownedBusy} onClick={() => void loadPrivate()}>{ownedBusy ? "Loading…" : "Show my private courses"}</GButton>
            {feedback("owned")}
            {privateCourses && privateCourses.length === 0 && <p>No private courses are ready to submit.</p>}
            {privateCourses?.map(course => <button key={course.id} type="button" className="community-private-choice" onClick={() => {
              setSelected({ accountId, collectionId: course.id, revisionId: course.current_revision_id,
                label: `${course.term} · ${course.module}` }); setRights(false);
            }}><span>{course.term} · {course.module}</span><span>{course.ready_questions} ready · {course.review_questions} held</span></button>)}
            {choice && <fieldset className="community-submit" disabled={Boolean(busyId)}><legend>Submit {choice.label}</legend>
              <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /> I have the right to share this course and its source material with every signed-in AXOM account.</label>
              <GButton variant="primary" disabled={!rights || Boolean(busyId)} onClick={() => void submit()}>Submit as Unreviewed</GButton>
            </fieldset>}
            {feedback("submit")}
          </GlassCard>
        </aside>
      </div>
      {submittingQuestionSet && <QuestionSetLibrarySubmitDialog key={submittingQuestionSet.id}
        set={submittingQuestionSet} questions={questions} autoDraft onClose={() => setSubmittingQuestionSetId("")} />}
    </>}
  </section>;
}
