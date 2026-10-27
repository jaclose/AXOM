import { useEffect, useState } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { academicClient, isAcademicReviewer, reviewAcademicCourse, type AcademicCourse } from "../../lib/academicLibrary/client";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { GButton } from "../ui/primitives";

/** Sharing changes access to the canonical collection, never a learner backup. */
export function AcademicSharing({ course, onSaved }: { course: AcademicCourse; onSaved: () => void }) {
  const accountId = useAccount(account => account.user?.id);
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState(course.visibility);
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reviewer, setReviewer] = useState(false);
  useEffect(() => {
    let active = true;
    setReviewer(false);
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (active) setReviewer(value); });
    return () => { active = false; };
  }, [accountId]);
  useEffect(() => {
    if (!open || !accountId || !course.owned) return;
    let cancelled = false;
    setLoading(true); setError("");
    void academicClient(accountId).then(client => client.from("academic_groups").select("id,name").order("name").limit(100))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw new Error("Your groups could not be loaded. You can still keep this course private or choose the shared collection.");
        setGroups(data ?? []);
      }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Sharing settings are unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, open, retry, course.owned]);
  async function save() {
    if (!accountId || busy || (visibility === "group" && !groupId)) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError(""); setMessage("");
    try {
      const client = await academicClient(accountId);
      scope.assertCurrent();
      const result = await client.rpc("academic_set_visibility", { collection: course.id, visibility, group_id: visibility === "group" ? groupId : null });
      scope.assertCurrent();
      if (result.error) throw new Error("Could not confirm the sharing change. Refresh the course to check access, or retry the same choice.");
      setMessage(visibility === "private" ? "Course is private. Other learners cannot discover or download it now."
        : course.review_status === "approved" ? "Sharing saved. Approved course material is available to the selected audience."
          : "Sharing requested. This revision remains private until an academic reviewer approves it.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Access could not be updated."); }
    finally { scope.dispose(); setBusy(false); }
  }
  if (!accountId || (!course.owned && !reviewer)) return null;
  return <details className="course-sharing" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{course.owned ? "Sharing settings" : "Academic review"}</summary>
    {course.owned && <>
    <p>Share the course plan, questions and source files. Personal answers, notes and progress stay private.</p>
    <div className="course-sharing-fields">
      <label>Who can discover this course?
        <select value={visibility} disabled={busy} onChange={event => { setVisibility(event.target.value as AcademicCourse["visibility"]); setMessage(""); }}>
          <option value="private">Only me</option>
          <option value="shared">Shared academic collection</option>
          <option value="group" disabled={!groups.length && course.visibility !== "group"}>My group or cohort</option>
        </select>
      </label>
      {visibility === "group" && <label>Group or cohort
        <select value={groupId} disabled={busy || loading} onChange={event => setGroupId(event.target.value)}>
          <option value="">{loading ? "Loading your groups…" : "Choose a group"}</option>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>}
      <GButton onClick={() => void save()} disabled={busy || (visibility === "group" && !groupId)}>{busy ? "Saving access…" : "Save sharing choice"}</GButton>
    </div>
    {course.review_status !== "approved" && <p>Sharing requires academic review. Choosing an audience does not approve this material.</p>}
    {visibility === "private" && <p>Existing downloads and learners’ saved progress are retained on their devices.</p>}
    {message && <p role="status">{message}</p>}
    {error && <div role="alert"><p>{error}</p><GButton onClick={() => setRetry(value => value + 1)}>Retry settings</GButton></div>}
    </>}
    {reviewer && <AcademicReview course={course} accountId={accountId} onSaved={onSaved} />}
  </details>;
}

/** Approval applies to the course's current revision. A newer upload waits for review again. */
function AcademicReview({ course, accountId, onSaved }: { course: AcademicCourse; accountId: string; onSaved: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function review(approved: boolean) {
    if (busy || (approved && !checked)) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError(""); setMessage("");
    try {
      await reviewAcademicCourse(course.id, approved, accountId);
      scope.assertCurrent();
      setMessage(!approved ? "Approval withdrawn. Other accounts can no longer discover or download this version."
        : course.visibility === "private" ? "Approved. The course stays private until its owner chooses an audience."
          : course.visibility === "group" ? "Approved for its group." : "Approved. Every signed-in AXOM account can now find this course.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The review could not be saved."); }
    finally { scope.dispose(); setBusy(false); }
  }
  const status = course.review_status === "approved" ? "Approved" : course.review_status === "rejected" ? "Not approved" : "Waiting for review";
  return <div className="course-review" role="group" aria-label="Academic review">
    <p><b>Review status: {status}.</b> {course.visibility === "private" ? "Its owner keeps it private." : course.visibility === "group" ? "Its owner shares it with a group." : "Its owner shares it with every signed-in account."}</p>
    <label className="course-review-check"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />
      <span>I checked this course, its answers and images, and it can be shared with its audience.</span></label>
    <div className="course-sharing-fields">
      <GButton disabled={busy || !checked} onClick={() => void review(true)}>{busy ? "Saving review…" : "Approve this version"}</GButton>
      <GButton disabled={busy || course.review_status === "rejected"} onClick={() => void review(false)}>Withdraw approval</GButton>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
