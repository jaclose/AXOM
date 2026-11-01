import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { saveCommunityReference } from "../../lib/academicLibrary/communityReference";
import { downloadAcademicCourse, isAcademicReviewer, type AcademicCourse } from "../../lib/academicLibrary/client";
import type { AcademicUploadResult } from "../../lib/academicLibrary/upload";
import {
  communityPreview, listCommunityUploads, reviewCommunityUpload, submitCommunityUpload,
  withdrawCommunityUpload, type CommunityPreview, type CommunityUpload,
} from "../../lib/academicLibrary/community";
import { listOwnedAcademicCourses, ownedCourseStatus } from "../../lib/academicLibrary/ownedCourses";
import { AcademicCourseUpload } from "../tracker/AcademicCourseUpload";
import { GButton, GlassCard, Tag } from "../ui/primitives";
import { TechnicalDetails } from "../shell/TechnicalDetails";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/community-uploads.css";

const TERMS = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
type Selected = { accountId: string; collectionId: string; revisionId: string; label: string };
type Page = { accountId: string; search: string; term: string; rows: CommunityUpload[]; more: boolean };

/** Unreviewed community material is discoverable without entering the official
 * catalog. Every download still uses the normal hash-checked installer. */
export function CommunityUploads({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const accountEpoch = useRef(0);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refresh, setRefresh] = useState(0);
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
  const [withdrawId, setWithdrawId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    accountEpoch.current += 1;
    setReviewer(false);
    setSelected(undefined);
    setOwned(undefined);
    setDownloaded(undefined);
    setPreview(undefined);
    setReviewChecked(false);
    setRights(false);
    setProgress(""); setError(""); setBusyId(""); setWithdrawId("");
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (current) setReviewer(value); });
    return () => { current = false; };
  }, [accountId]);

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
    setOwnedBusy(true); setError("");
    try {
      const courses = await listOwnedAcademicCourses(accountId);
      if (active()) setOwned({ accountId, rows: courses });
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "Your private courses could not be loaded.");
    } finally { if (active()) setOwnedBusy(false); }
  }

  function saved(result: AcademicUploadResult) {
    if (!accountId) return;
    setRights(false);
    if (result.status === "active") {
      setSelected({ accountId, collectionId: result.collection_id,
        revisionId: result.revision_id, label: "Your newly saved course" });
      setProgress("The course is saved privately. Confirm your sharing rights to submit this exact revision.");
    } else {
      setProgress("A newer revision is active. Refresh your private courses before submitting it.");
    }
  }

  async function submit() {
    if (!accountId || !choice || !rights || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(choice.collectionId); setError("");
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
    setBusyId(row.id); setError(""); setProgress("Checking and downloading this exact revision…");
    setDownloaded(undefined); setReviewChecked(false);
    try {
      await saveCommunityReference(row.current_revision_id, accountId, undefined, scope.assertCurrent);
      const result = await downloadAcademicCourse(row.current_revision_id, message => { if (active()) setProgress(message); }, scope);
      scope.assertCurrent();
      await saveCommunityReference(row.current_revision_id, accountId, result.questionIds, scope.assertCurrent);
      if (active()) {
        setDownloaded({ accountId, revisionId: row.current_revision_id });
        setProgress(`${result.questionIds.length} questions saved on this device. Questions still awaiting answer or source review remain held.`);
      }
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "This upload could not be downloaded.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function loadPreview(row: CommunityUpload) {
    if (!accountId || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError("");
    try {
      const value = await communityPreview(row.id, row.current_revision_id, accountId);
      scope.assertCurrent();
      if (active()) setPreview({ accountId, revisionId: row.current_revision_id, value });
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The plan preview could not be opened.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  async function review(row: CommunityUpload, approved: boolean) {
    if (!accountId || !reviewer || !reviewChecked || downloaded?.accountId !== accountId
      || downloaded.revisionId !== row.current_revision_id || busyId) return;
    const epoch = accountEpoch.current;
    const active = () => accountEpoch.current === epoch && useAccount.getState().user?.id === accountId;
    const scope = academicAccountScope(accountId);
    setBusyId(row.id); setError("");
    try {
      await reviewCommunityUpload(row.id, row.current_revision_id, approved, accountId);
      scope.assertCurrent();
      if (active()) {
        setDownloaded(undefined); setReviewChecked(false);
        setProgress(approved ? "Approved. This revision is now in the official course catalog."
          : "Review recorded. This upload is no longer in the unreviewed list.");
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
    setBusyId(row.id); setError("");
    try {
      await withdrawCommunityUpload(row.id, row.current_revision_id, accountId);
      scope.assertCurrent();
      if (active()) {
        setWithdrawId(""); setProgress("Removed from Community Uploads. Your private course remains in your account.");
        setRefresh(value => value + 1);
      }
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "The submission could not be withdrawn.");
    } finally { scope.dispose(); if (active()) setBusyId(""); }
  }

  function searchNow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSearch(draftSearch.trim());
  }

  return <section className="community-uploads" aria-label="Community Uploads">
    <header className="community-hero">
      <span className="qb-eyebrow">Shared by learners</span>
      <h2>Community Uploads</h2>
      <p>Explore courses shared by AXOM members. Practice answer-ready questions with an Unreviewed warning. An academic reviewer must approve a course before it enters the official Question Bank.</p>
    </header>

    {!accountId ? <GlassCard pad><h3>Sign in to browse and contribute</h3><p>Community uploads are available to signed-in AXOM accounts.</p></GlassCard> : <>
      <div className="community-layout">
        <div className="community-results">
          <form className="community-search" onSubmit={searchNow}>
            <label>Find an upload<input type="search" value={draftSearch} onChange={event => setDraftSearch(event.target.value)} placeholder="Course or module" /></label>
            <label>Term<select value={term} onChange={event => setTerm(event.target.value)}><option value="">All terms</option>{TERMS.map(value => <option key={value}>{value}</option>)}</select></label>
            <GButton type="submit" disabled={loading}>Search</GButton>
            <GButton type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={ICON_SIZE.body} /> Refresh</GButton>
          </form>
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
              {preview?.accountId === accountId && preview.revisionId === row.current_revision_id && <div className="community-preview">
                <h4>Course plan preview</h4>
                {preview.value.template_text ? <pre>{preview.value.template_text}</pre> : <p>This upload has no weekly plan. Its questions remain available by course.</p>}
              </div>}
              {reviewer && downloaded?.accountId === accountId && downloaded.revisionId === row.current_revision_id && <div className="community-review">
                <label><input type="checkbox" checked={reviewChecked} onChange={event => setReviewChecked(event.target.checked)} /> I inspected this exact revision, its answers, sources and figures.</label>
                <div className="community-actions"><GButton variant="primary" disabled={!reviewChecked || Boolean(busyId)} onClick={() => void review(row, true)}><ShieldCheck size={ICON_SIZE.body} /> Approve for official catalog</GButton>
                  <GButton disabled={!reviewChecked || Boolean(busyId)} onClick={() => void review(row, false)}>Reject</GButton></div>
              </div>}
              <TechnicalDetails label="Revision details"><p>Revision {row.current_revision_id}</p><p>Submitted {new Date(row.submitted_at).toLocaleString()}</p></TechnicalDetails>
            </article>)}
          </div>
          {page?.more && <GButton disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more uploads"}</GButton>}
        </div>

        <aside className="community-contribute">
          <GlassCard pad><UploadCloud size={ICON_SIZE.display} aria-hidden="true" /><h3>Share a course</h3>
            <p>Choose a course folder, save it privately, then submit that version. It stays Unreviewed until an appointed academic reviewer approves it.</p>
            <details><summary>Choose an AXOM course folder or ZIP</summary><AcademicCourseUpload onSaved={saved} /></details>
            <GButton disabled={ownedBusy} onClick={() => void loadPrivate()}>{ownedBusy ? "Loading…" : "Show my private courses"}</GButton>
            {privateCourses && privateCourses.length === 0 && <p>No private courses are ready to submit.</p>}
            {privateCourses?.map(course => <button key={course.id} type="button" className="community-private-choice" onClick={() => {
              setSelected({ accountId, collectionId: course.id, revisionId: course.current_revision_id,
                label: `${course.term} · ${course.module}` }); setRights(false);
            }}><span>{course.term} · {course.module}</span><span>{course.ready_questions} ready · {course.review_questions} held</span></button>)}
            {choice && <fieldset className="community-submit" disabled={Boolean(busyId)}><legend>Submit {choice.label}</legend>
              <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /> I have the right to share this course and its source material with every signed-in AXOM account.</label>
              <GButton variant="primary" disabled={!rights || Boolean(busyId)} onClick={() => void submit()}>Submit as Unreviewed</GButton>
            </fieldset>}
          </GlassCard>
        </aside>
      </div>
      {progress && <p className="community-status" role="status" aria-live="polite">{progress}</p>}
      {error && <p className="community-error" role="alert">{error}</p>}
    </>}
  </section>;
}
