import { useEffect, useRef, useState } from "react";
import { BadgeCheck, LibraryBig, RefreshCw, Share2, Square } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { isAcademicReviewer, shareAcademicCourses, type AcademicCourse } from "../../lib/academicLibrary/client";
import { coursesByTerm } from "../../lib/academicLibrary/catalogOrder";
import { inspectStoredRevisionExplanations, type ExplanationReviewReceipt } from "../../lib/academicLibrary/explanationReview";
import { listCommunityUploads, type CommunityCursor } from "../../lib/academicLibrary/community";
import {
  approveAcademicCourses, listOwnedAcademicCourses, ownedCourseStatus, type OwnedCourseStatus,
} from "../../lib/academicLibrary/ownedCourses";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import "../../styles/academic-collection-manager.css";

const STATUS: Record<OwnedCourseStatus, { label: string; tone: "neutral" | "orange" | "green" | "red" | "cyan" }> = {
  private: { label: "Private", tone: "neutral" },
  "awaiting-review": { label: "Awaiting review", tone: "orange" },
  shared: { label: "Shared with everyone", tone: "green" },
  "not-approved": { label: "Not approved", tone: "red" },
  group: { label: "Shared with a group", tone: "cyan" },
};
const SUMMARY_ORDER: OwnedCourseStatus[] = ["private", "awaiting-review", "shared", "not-approved", "group"];
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const COMMUNITY_PAGE_SIZE = 24;
const MAX_COMMUNITY_PAGES = 200;

async function pendingCommunityIds(courses: AcademicCourse[], signal: AbortSignal): Promise<Set<string>> {
  const candidates = new Map(courses.filter(course => course.review_status === "pending")
    .map(course => [course.id, course.current_revision_id]));
  const pending = new Set<string>();
  if (!candidates.size) return pending;
  let after: CommunityCursor | undefined;
  for (let page = 0; page < MAX_COMMUNITY_PAGES; page++) {
    if (signal.aborted) throw new DOMException("Loading your courses was cancelled.", "AbortError");
    const uploads = await listCommunityUploads("", "", after);
    for (const upload of uploads) {
      if (candidates.get(upload.id) === upload.current_revision_id) pending.add(upload.id);
    }
    if (uploads.length < COMMUNITY_PAGE_SIZE || pending.size === candidates.size) return pending;
    const last = uploads[uploads.length - 1];
    after = { submittedAt: last.submitted_at, id: last.id };
  }
  throw new Error("The community review list is too large to check. Refresh your courses later.");
}

/**
 * Every course the account has published, with sharing and, for an academic
 * reviewer, approval of many courses at once. Sharing exposes a course for
 * review; only an approved revision enters the learner catalog.
 */
export function AcademicCollectionManager({ onChanged }: { onChanged: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const controller = useRef<AbortController>();
  const [loaded, setLoaded] = useState<{ accountId: string; courses: AcademicCourse[]; communityIds: Set<string> }>();
  const [reviewer, setReviewer] = useState(false);
  const [busy, setBusy] = useState<"loading" | "checking" | "sharing" | "approving">();
  const [rights, setRights] = useState(false);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [audits, setAudits] = useState<Record<string, { receipt?: ExplanationReviewReceipt; error?: string }>>({});

  useEffect(() => {
    let active = true;
    setReviewer(false);
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (active) setReviewer(value); });
    return () => { active = false; };
  }, [accountId]);
  useEffect(() => () => controller.current?.abort(), []);

  const courses = loaded && loaded.accountId === accountId ? loaded.courses : undefined;
  const communityIds = loaded && loaded.accountId === accountId ? loaded.communityIds : new Set<string>();
  const withStatus = (status: OwnedCourseStatus) => courses?.filter(course => !communityIds.has(course.id) && ownedCourseStatus(course) === status) ?? [];
  const privateCourses = withStatus("private");
  const awaiting = withStatus("awaiting-review");
  const complete = (entries: AcademicCourse[]) => entries.every(course => {
    const receipt = audits[course.id]?.receipt;
    return receipt?.revisionId === course.current_revision_id && receipt.readyQuestions > 0 && receipt.missingExplanations === 0;
  });
  const receipts = () => new Map(Object.entries(audits).flatMap(([id, audit]) => audit.receipt ? [[id, audit.receipt] as const] : []));
  const label = (id: string) => {
    const course = courses?.find(entry => entry.id === id);
    return course ? `${course.term} ${course.module}` : "A course";
  };
  const update = (changes: Map<string, Partial<AcademicCourse>>) => setLoaded(current => current && {
    ...current, courses: current.courses.map(course => changes.has(course.id) ? { ...course, ...changes.get(course.id) } : course),
  });

  function start(kind: "loading" | "checking" | "sharing" | "approving") {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(kind); setError(""); setProgress("");
    return abort;
  }
  function finish(abort: AbortController) {
    setBusy(undefined);
    if (controller.current === abort) controller.current = undefined;
  }

  async function load() {
    if (!accountId || busy) return;
    const abort = start("loading");
    setFailures({});
    setAudits({});
    try {
      const owned = await listOwnedAcademicCourses(accountId, abort.signal);
      const pending = await pendingCommunityIds(owned, abort.signal);
      if (abort.signal.aborted) return;
      setLoaded({ accountId, courses: owned, communityIds: pending });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Your courses could not be loaded.");
    } finally { finish(abort); }
  }

  async function checkExplanations() {
    if (!accountId || !reviewer || busy) return;
    const targets = awaiting;
    if (!targets.length) return;
    const scope = academicAccountScope(accountId);
    const abort = start("checking");
    setAudits({});
    setChecked(false);
    let missing = 0;
    let unreadable = 0;
    try {
      for (const [index, course] of targets.entries()) {
        if (abort.signal.aborted) break;
        setProgress(`Checking explanations in ${label(course.id)} · ${index + 1} of ${targets.length}`);
        try {
          const receipt = await inspectStoredRevisionExplanations(course.id, course.current_revision_id, accountId);
          await scope.assertCurrent();
          missing += receipt.missingExplanations;
          setAudits(current => ({ ...current, [course.id]: { receipt } }));
        } catch (cause) {
          unreadable += 1;
          setAudits(current => ({ ...current, [course.id]: { error: cause instanceof Error ? cause.message : "Readback failed." } }));
        }
      }
      setProgress(abort.signal.aborted ? "Explanation check stopped. No approvals were made."
        : `Explanation readback complete: ${plural(missing, "ready question")} without an explanation${unreadable ? `; ${plural(unreadable, "course")} could not be read` : ""}. Review each rationale against its source before attesting.`);
    } finally { scope.dispose(); finish(abort); }
  }

  async function share() {
    if (!accountId || busy || !rights || !privateCourses.length) return;
    const scope = academicAccountScope(accountId);
    const abort = start("sharing");
    const ids = privateCourses.map(course => course.id);
    const changes = new Map<string, Partial<AcademicCourse>>();
    const failed: Record<string, string> = {};
    try {
      for (const [index, id] of ids.entries()) {
        if (abort.signal.aborted) break;
        setProgress(`Sharing ${label(id)} · ${index + 1} of ${ids.length}`);
        const [outcome] = await shareAcademicCourses([id], accountId,
          { assertCurrent: scope.assertCurrent, signal: abort.signal });
        if (!outcome) break;
        if (outcome.shared) changes.set(id, { visibility: "shared", review_status: "pending" as const });
        if (outcome.error) failed[id] = outcome.error;
      }
      update(changes);
      if (changes.size) setChecked(false);
      setFailures(failed);
      const shared = changes.size;
      setProgress(abort.signal.aborted ? `Sharing stopped. ${plural(shared, "course")} shared before stopping.`
        : `${plural(shared, "course")} shared for review. Other accounts can find ${shared === 1 ? "it" : "them"} only after academic approval.`);
      if (shared) onChanged();
    } catch (cause) {
      update(changes);
      setError(cause instanceof Error ? cause.message : "Sharing could not finish. Courses already shared stay shared.");
    } finally { scope.dispose(); finish(abort); }
  }

  async function approveAll() {
    if (!accountId || busy || !reviewer || !checked || !awaiting.length || !complete(awaiting)) return;
    const scope = academicAccountScope(accountId);
    const abort = start("approving");
    const ids = awaiting.map(course => course.id);
    try {
      setProgress(`Approving ${label(ids[0])} · 1 of ${ids.length}`);
      const outcomes = await approveAcademicCourses(ids, accountId, {
        receipts: receipts(), rationaleReviewed: checked,
        assertCurrent: scope.assertCurrent, signal: abort.signal,
        onProgress: done => { if (done < ids.length) setProgress(`Approving ${label(ids[done])} · ${done + 1} of ${ids.length}`); },
      });
      const approved = outcomes.filter(outcome => outcome.approved);
      update(new Map(approved.map(outcome => [outcome.collectionId, { review_status: "approved" as const }])));
      setFailures(Object.fromEntries(outcomes.flatMap(outcome => outcome.error ? [[outcome.collectionId, outcome.error]] : [])));
      setProgress(abort.signal.aborted ? `Approval stopped. ${plural(approved.length, "course")} approved before stopping.`
        : `${plural(approved.length, "course")} approved. Every signed-in AXOM account can now find ${approved.length === 1 ? "it" : "them"}.`);
      if (approved.length) onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval could not finish. Courses already approved stay approved.");
    } finally { scope.dispose(); finish(abort); }
  }

  if (!accountId) return null;
  const counts = SUMMARY_ORDER.flatMap(status => {
    const count = withStatus(status).length;
    return count ? [`${count} ${STATUS[status].label.toLowerCase()}`] : [];
  });
  if (communityIds.size) counts.push(`${plural(communityIds.size, "unreviewed community upload")}`);
  const failed = Object.entries(failures);
  return <section className="academic-manager" aria-label="Your published courses" aria-busy={Boolean(busy)}>
    <div className="academic-manager-heading">
      <LibraryBig size={ICON_SIZE.control} aria-hidden="true" />
      <div><h3>Your published courses</h3>
        <p>See every course you have published and share it for review. An academic reviewer checks the exact revision before approval. Answers, notes and progress are never shared.</p></div>
    </div>
    <div className="academic-manager-actions">
      <GButton disabled={Boolean(busy)} onClick={() => void load()}>
        <RefreshCw size={ICON_SIZE.emphasis} /> {busy === "loading" ? "Loading your courses…" : courses ? "Refresh" : "Show my courses"}
      </GButton>
      {reviewer && courses && awaiting.length > 0 && <GButton disabled={Boolean(busy)} onClick={() => void checkExplanations()}>
        {busy === "checking" ? "Checking explanations…" : "Check stored explanations"}
      </GButton>}
      {(busy === "checking" || busy === "sharing" || busy === "approving") && <GhostButton onClick={() => controller.current?.abort()}><Square size={ICON_SIZE.body} /> Stop</GhostButton>}
    </div>

    {courses && !courses.length && <p>You have not published any courses yet. Publish a prepared library above, then come back here.</p>}
    {courses && courses.length > 0 && <>
      <p className="academic-manager-summary"><b>{plural(courses.length, "course")}</b>: {counts.join(", ")}.</p>
      {communityIds.size > 0 && <p>Review {plural(communityIds.size, "community upload")} in Question Bank → Community Uploads. Community submissions require an exact-revision review.</p>}

      {privateCourses.length > 0 && <fieldset className="academic-manager-step" disabled={Boolean(busy)}>
        <legend>Share private courses for review</legend>
        <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
          <span>I have the right to share this course material with every AXOM account.</span></label>
        <p>Other accounts cannot find these courses until an academic reviewer approves their exact revisions.</p>
        <GButton variant="primary" disabled={Boolean(busy) || !rights} onClick={() => void share()}>
          <Share2 size={ICON_SIZE.emphasis} /> {busy === "sharing" ? "Sharing…" : `Share ${plural(privateCourses.length, "private course")}`}
        </GButton>
      </fieldset>}

      {awaiting.length > 0 && (reviewer ? <fieldset className="academic-manager-step" disabled={Boolean(busy)}>
        <legend>Approve courses awaiting review</legend>
        <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
          <span>I checked every stored explanation against its source for these exact revisions, as well as their answers and images.</span></label>
        {!complete(awaiting) && <p>Check stored explanations first. Every ready question needs one before official approval.</p>}
        <GButton variant="primary" disabled={Boolean(busy) || !checked || !complete(awaiting)} onClick={() => void approveAll()}>
          <BadgeCheck size={ICON_SIZE.emphasis} /> {busy === "approving" ? "Approving…" : `Approve ${plural(awaiting.length, "course")}`}
        </GButton>
      </fieldset> : <p>{plural(awaiting.length, "course")} {awaiting.length === 1 ? "is" : "are"} waiting for an academic reviewer. Other accounts can find {awaiting.length === 1 ? "it" : "them"} once approved.</p>)}

      {failed.length > 0 && <div className="academic-manager-failures" role="alert">
        <p>{plural(failed.length, "course")} need{failed.length === 1 ? "s" : ""} another try:</p>
        <ul>{failed.map(([id, reason]) => <li key={id}><b>{label(id)}</b>: {reason}</li>)}</ul>
      </div>}

      <details className="academic-manager-list">
        <summary>Show all {plural(courses.length, "course")}</summary>
        {coursesByTerm(courses).map(group => <div key={group.term}>
          <h4>{group.term}</h4>
          <ul>{group.courses.map(course => {
            const status = STATUS[ownedCourseStatus(course)];
            return <li key={course.id}>
              <span><b>{course.module}</b>{course.title !== course.module && <small>{course.title}</small>}</span>
              <span className="academic-manager-facts">{plural(course.ready_questions, "ready question")}</span>
              {audits[course.id]?.receipt && <span className="academic-manager-facts">{plural(audits[course.id].receipt!.missingExplanations, "ready question")} without an explanation</span>}
              {audits[course.id]?.error && <span className="academic-manager-facts" role="alert">{audits[course.id].error}</span>}
              <Tag tone={communityIds.has(course.id) ? "orange" : status.tone}>{communityIds.has(course.id) ? "Community upload · Unreviewed" : status.label}</Tag>
            </li>;
          })}</ul>
        </div>)}
      </details>
    </>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
