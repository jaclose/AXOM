import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../lib/localVault";
import { GlassCard, GButton } from "../components/ui/primitives";
import { pushToast } from "../lib/toast";
import { SGU_CURRICULUM } from "../lib/curricula";
import {
  applyCurriculumTemplateInstallation,
  curriculumInstallationSignature,
  previewCurriculumTemplateInstallation,
} from "../lib/course-engine/bulkCourseInstall";

/**
 * One bulk action over the SAME saved course templates that the existing
 * Course Library manages. The source files are never fetched, redistributed,
 * or sent to a new service. Preview and human consent precede one local write.
 */
export function BulkCurriculumTemplateInstall() {
  const documents = useStore((state) => state.documents);
  const tracker = useStore((state) => state.tracker);
  const terms = useStore((state) => state.terms);
  const courses = useStore((state) => state.courses);
  const [placement, setPlacement] = useState<"unassigned" | "provisional">("unassigned");
  const [provisionalConfirmed, setProvisionalConfirmed] = useState(false);
  const [includeOutline, setIncludeOutline] = useState(false);
  const [showModules, setShowModules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const preview = useMemo(() => previewCurriculumTemplateInstallation(SGU_CURRICULUM, documents, {
    terms, courses, tracker,
  }, placement, includeOutline), [documents, terms, courses, tracker, placement, includeOutline]);

  // The learner can set up empty Term 1–5 course/module navigation BEFORE
  // obtaining any private source templates. This must never create a single
  // imaginary lecture, week, answer or source file.
  const hasSources = preview.activeSourceFiles > 0;
  const pending = preview.create + preview.update;
  const consentRequired = placement === "provisional" && preview.provisionalWeeks > 0;
  const canApply = !busy && (pending > 0 || preview.missingOutlineModules > 0)
    && (!consentRequired || provisionalConfirmed);
  const resetMessage = () => { setMessage(""); setError(""); };

  async function apply() {
    if (!canApply) return;
    setBusy(true);
    resetMessage();
    let changed = false;
    try {
      // Preview data can change because the learner studied an item or an
      // importer saved a newer source. Re-read once before the write, and
      // refuse if the complete identity/update plan has changed.
      const state = useStore.getState();
      const current = previewCurriculumTemplateInstallation(SGU_CURRICULUM, state.documents, {
        terms: state.terms, courses: state.courses, tracker: state.tracker,
      }, placement, includeOutline);
      if (curriculumInstallationSignature(current) !== curriculumInstallationSignature(preview)) {
        throw new Error("The workspace or source versions changed. Review the refreshed preview before applying.");
      }
      if (current.create + current.update + current.missingOutlineModules === 0) {
        setMessage("Nothing new to install; your saved curriculum activities are already represented.");
        return;
      }
      const result = applyCurriculumTemplateInstallation(state, current);
      const checkpoint = getVaultWriteCheckpoint();
      useStore.setState(() => ({
        terms: result.terms, courses: result.courses, tracker: result.tracker,
      }));
      changed = true;
      await flushLocalVaultWrites();
      assertVaultWritesSince(checkpoint);
      const outcome = `${result.createdRows} new activities and ${result.revisedRows} existing labels/paths saved on this device.`
        + (includeOutline ? ` ${result.newTerms} missing terms, ${result.newCourses} courses and ${result.newModules} module shells added without inventing activities.` : "");
      setMessage(`${outcome} ${current.reviewRequired} ambiguous items remain held for review; existing study passes and notes are unchanged. This is not a cloud upload.`);
      pushToast({ title: "Curriculum activities saved locally", body: outcome, tone: "success" });
    } catch (cause) {
      setError(`${changed ? "The change is in local memory but was not confirmed durable." : "Installation was not applied."} ${cause instanceof Error ? cause.message : "Review the source plan and try again."}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <GlassCard pad className="tracker-bulk-course-template">
      <details>
        <summary>
          <b>{hasSources ? "Install saved curriculum activities" : "Set up SGU course outline"}</b>
          <span className="sub">{preview.activeSourceFiles} source templates · {preview.sourceActivities} known activities · {pending} to add/update</span>
        </summary>
        {hasSources
          ? <p className="sub">These are private templates already saved in your AXOM workspace. AXOM maps them to the existing SGU term/course/module outline, never creates unknown lectures, and never overwrites study passes, notes or attendance.</p>
          : <p className="sub">No academic activity templates are saved on this device. You can still add the five-term SGU course/module outline as empty navigation containers. This will not create lectures, assessments, week schedules, study completions or questions. Import approved sources separately when available.</p>}
        <div className="tracker-bulk-template-stats">
          <span><b>{preview.modules.length}</b> uniquely matched modules</span>
          <span><b>{preview.sourceStatedWeeks}</b> activity lines with a source-stated week</span>
          <span><b>{preview.unassignedWeeks}</b> activities without a confirmed week in this preview</span>
          <span><b>{preview.create}</b> additions · <b>{preview.update}</b> safe revisions</span>
          <span><b>{preview.reviewRequired}</b> require identity review</span>
        </div>
        {hasSources && <fieldset className="tracker-bulk-week-options" disabled={busy}>
          <legend>Week placement policy</legend>
          <label>
            <input type="radio" name="bulk-week-placement" checked={placement === "unassigned"}
              onChange={() => { setPlacement("unassigned"); setProvisionalConfirmed(false); resetMessage(); }} />
            <span>Keep activities without source-stated weeks under <b>Unscheduled</b> (recommended)</span>
          </label>
          <label>
            <input type="radio" name="bulk-week-placement" checked={placement === "provisional"}
              onChange={() => { setPlacement("provisional"); setProvisionalConfirmed(false); resetMessage(); }} />
            <span>Use <b>provisional</b> grouping/spacing from source templates, always labeled inferred</span>
          </label>
        </fieldset>}
        <label className="tracker-bulk-outline">
          <input type="checkbox" checked={includeOutline} disabled={busy}
            onChange={(event) => { setIncludeOutline(event.target.checked); resetMessage(); }} />
          <span>Also create the missing <b>Term 1–5 course/module outline shells</b> from AXOM's embedded catalog. This outline uses older <b>PPM 500/501</b> labels (official Fall 2025+ SGU catalog: <b>PCM 500/501</b>) and <b>NMI</b> where the current catalog says <b>MI</b>; review course identities before syncing or sharing. These are empty structural shells, with no invented lectures, dates or question banks.</span>
        </label>
        {includeOutline && <p className="sub">{preview.missingOutlineModules} school-outline module containers are not yet represented in your workspace. These are structural containers, not verified academic activity schedules.</p>}
        {consentRequired && <label className="tracker-bulk-confirm">
          <input type="checkbox" checked={provisionalConfirmed} disabled={busy}
            onChange={(event) => setProvisionalConfirmed(event.target.checked)} />
          <span>I reviewed the {preview.provisionalWeeks} provisional placements. They are <b>not</b> official SGU teaching weeks, and I can change them later.</span>
        </label>}
        {preview.issues.length > 0 && <div className="tracker-bulk-issues" role="note">
          <b>{preview.issues.length} source/module groups held for review</b>
          <ul>{preview.issues.map((issue) => <li key={issue.sourceModule}>
            {issue.sourceModule} ({issue.sourceFiles} files): {issue.reason}
          </li>)}</ul>
        </div>}
        <div className="tracker-bulk-actions">
          <GButton size="tiny" disabled={!preview.modules.length}
            onClick={() => setShowModules(!showModules)} aria-expanded={showModules}>
            {showModules ? "Hide module review" : `Review ${preview.modules.length} modules`}
          </GButton>
          <GButton size="sm" disabled={!canApply} onClick={() => { void apply(); }}>
            {busy ? "Saving locally…" : pending
              ? `Install ${preview.create} and revise ${preview.update}${includeOutline ? ` + outline` : ""}`
              : preview.missingOutlineModules ? `Add ${preview.missingOutlineModules} outline modules` : "Already represented"}
          </GButton>
        </div>
        {showModules && <div className="tracker-bulk-module-list" aria-label="Source-by-module installation review">
          {preview.modules.map((module) => <div key={module.path} className="tracker-bulk-module-row">
            <b>{module.path}</b>
            <small>{module.sourceFiles} current source files · {module.sourceActivities} activities · {module.explicitWeeks} stated weeks · {module.unassignedWeeks} unassigned · {module.reconcile.create.length} add · {module.reconcile.update.length} revise
              {module.reconcile.review?.length ? ` · ${module.reconcile.review.length} identity conflicts held` : ""}
            </small>
          </div>)}
        </div>}
        {message && <p role="status" className="sub">{message}</p>}
        {error && <p role="alert" className="sub">{error}</p>}
        <p className="sub">Changes are stored in this device's existing AXOM workspace, not automatically published to other students or synchronized to a verified cloud account. Official curriculum completeness remains unknown where source schedules are missing.</p>
      </details>
    </GlassCard>
  );
}
