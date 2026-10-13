import { useEffect, useState } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { academicClient, type AcademicCourse } from "../../lib/academicLibrary/client";
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
  useEffect(() => {
    if (!open || !accountId) return;
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
  }, [accountId, open, retry]);
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
  if (!course.owned || !accountId) return null;
  return <details className="course-sharing" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Sharing settings</summary>
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
  </details>;
}
