import { useEffect, useRef, useState } from "react";
import { BadgeCheck, LibraryBig, RefreshCw, Share2, Square } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { isAcademicReviewer, shareAcademicCourses, type AcademicCourse } from "../../lib/academicLibrary/client";
import { coursesByTerm } from "../../lib/academicLibrary/catalogOrder";
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

/**
 * Every course the account has published, with sharing and, for an academic
 * reviewer, approval of many courses at once. The server still enforces both:
 * sharing alone keeps a course private until a reviewer approves it.
 */
export function AcademicCollectionManager({ onChanged }: { onChanged: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const controller = useRef<AbortController>();
  const [loaded, setLoaded] = useState<{ accountId: string; courses: AcademicCourse[] }>();
  const [reviewer, setReviewer] = useState(false);
  const [busy, setBusy] = useState<"loading" | "sharing" | "approving">();
  const [rights, setRights] = useState(false);
  const [approveOnShare, setApproveOnShare] = useState(false);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setReviewer(false);
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (active) setReviewer(value); });
    return () => { active = false; };
  }, [accountId]);
  useEffect(() => () => controller.current?.abort(), []);

  const courses = loaded && loaded.accountId === accountId ? loaded.courses : undefined;
  const withStatus = (status: OwnedCourseStatus) => courses?.filter(course => ownedCourseStatus(course) === status) ?? [];
  const privateCourses = withStatus("private");
  const awaiting = withStatus("awaiting-review");
  const label = (id: string) => {
    const course = courses?.find(entry => entry.id === id);
    return course ? `${course.term} ${course.module}` : "A course";
  };
  const update = (changes: Map<string, Partial<AcademicCourse>>) => setLoaded(current => current && {
    ...current, courses: current.courses.map(course => changes.has(course.id) ? { ...course, ...changes.get(course.id) } : course),
  });

  function start(kind: "loading" | "sharing" | "approving") {
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
    try {
      const owned = await listOwnedAcademicCourses(accountId, abort.signal);
      setLoaded({ accountId, courses: owned });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Your courses could not be loaded.");
    } finally { finish(abort); }
  }

  async function share() {
    if (!accountId || busy || !rights || !privateCourses.length) return;
    const scope = academicAccountScope(accountId);
    const abort = start("sharing");
    const ids = privateCourses.map(course => course.id);
    const approve = approveOnShare && reviewer;
    const changes = new Map<string, Partial<AcademicCourse>>();
    const failed: Record<string, string> = {};
    try {
      for (const [index, id] of ids.entries()) {
        if (abort.signal.aborted) break;
        setProgress(`Sharing ${label(id)} · ${index + 1} of ${ids.length}`);
        const [outcome] = await shareAcademicCourses([id], accountId, { approve, assertCurrent: scope.assertCurrent, signal: abort.signal });
        if (!outcome) break;
        if (outcome.shared) changes.set(id, { visibility: "shared", ...(outcome.approved ? { review_status: "approved" as const } : {}) });
        if (outcome.error) failed[id] = outcome.error;
      }
      update(changes);
      setFailures(failed);
      const shared = changes.size;
      setProgress(abort.signal.aborted ? `Sharing stopped. ${plural(shared, "course")} shared before stopping.`
        : approve && !Object.keys(failed).length ? `${plural(shared, "course")} shared and approved. Every signed-in AXOM account can now find ${shared === 1 ? "it" : "them"}.`
          : `${plural(shared, "course")} shared.${approve ? "" : " Shared courses stay private until an academic reviewer approves them."}`);
      if (shared) onChanged();
    } catch (cause) {
      update(changes);
      setError(cause instanceof Error ? cause.message : "Sharing could not finish. Courses already shared stay shared.");
    } finally { scope.dispose(); finish(abort); }
  }

  async function approveAll() {
    if (!accountId || busy || !reviewer || !checked || !awaiting.length) return;
    const scope = academicAccountScope(accountId);
    const abort = start("approving");
    const ids = awaiting.map(course => course.id);
    try {
      setProgress(`Approving ${label(ids[0])} · 1 of ${ids.length}`);
      const outcomes = await approveAcademicCourses(ids, accountId, {
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
  const failed = Object.entries(failures);
  return <section className="academic-manager" aria-label="Your published courses" aria-busy={Boolean(busy)}>
    <div className="academic-manager-heading">
      <LibraryBig size={ICON_SIZE.control} aria-hidden="true" />
      <div><h3>Your published courses</h3>
        <p>See every course you have published, then share or approve them together. Answers, notes and progress are never shared.</p></div>
    </div>
    <div className="academic-manager-actions">
      <GButton disabled={Boolean(busy)} onClick={() => void load()}>
        <RefreshCw size={ICON_SIZE.emphasis} /> {busy === "loading" ? "Loading your courses…" : courses ? "Refresh" : "Show my courses"}
      </GButton>
      {(busy === "sharing" || busy === "approving") && <GhostButton onClick={() => controller.current?.abort()}><Square size={ICON_SIZE.body} /> Stop</GhostButton>}
    </div>

    {courses && !courses.length && <p>You have not published any courses yet. Publish a prepared library above, then come back here.</p>}
    {courses && courses.length > 0 && <>
      <p className="academic-manager-summary"><b>{plural(courses.length, "course")}</b>: {counts.join(", ")}.</p>

      {privateCourses.length > 0 && <fieldset className="academic-manager-step" disabled={Boolean(busy)}>
        <legend>Share private courses</legend>
        <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
          <span>I have the right to share this course material with every AXOM account.</span></label>
        {reviewer && <label><input type="checkbox" checked={approveOnShare} onChange={event => setApproveOnShare(event.target.checked)} />
          <span>Approve them now. You are an academic reviewer.</span></label>}
        <GButton variant="primary" disabled={Boolean(busy) || !rights} onClick={() => void share()}>
          <Share2 size={ICON_SIZE.emphasis} /> {busy === "sharing" ? "Sharing…" : `Share ${plural(privateCourses.length, "private course")}`}
        </GButton>
      </fieldset>}

      {awaiting.length > 0 && (reviewer ? <fieldset className="academic-manager-step" disabled={Boolean(busy)}>
        <legend>Approve courses awaiting review</legend>
        <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
          <span>I checked these courses, their answers and images, and they can be shared with every signed-in account.</span></label>
        <GButton variant="primary" disabled={Boolean(busy) || !checked} onClick={() => void approveAll()}>
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
              <Tag tone={status.tone}>{status.label}</Tag>
            </li>;
          })}</ul>
        </div>)}
      </details>
    </>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
