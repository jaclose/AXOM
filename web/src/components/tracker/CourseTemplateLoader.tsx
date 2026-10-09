// ===========================================================================
// Load a course template into the tracker. The learner picks their template
// files (or pastes one); AXOM lays each module out week by week, says which
// weeks the template stated and which it worked out, and adds only what the
// tracker does not already have. Rows the learner has studied keep their
// progress: a re-load updates titles and places, never passes.
// ===========================================================================
import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../../lib/localVault";
import { useStore } from "../../lib/store";
import { countActivity, type CourseActivity } from "../../lib/course-engine/activity";
import {
  WEEK_BASIS_NOTE, parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate,
  type CourseTemplatePlan, type CourseTemplateSection, type TemplateReconciliation,
} from "../../lib/course-engine/templateParse";
import { moduleKey } from "../../lib/course-engine/vocabulary";
import { pushToast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";
import { Field, Modal, SelectField, TextAreaField } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";

interface ModuleSetup {
  termId: string;
  firstWeek: string;
}

interface ModulePreview {
  key: string;
  plan: CourseTemplatePlan;
  changes: TemplateReconciliation;
  counts: Array<[CourseActivity, number]>;
}

const EXAMPLE = "FTM 1 - Lectures + DLAs:\n\nFTM Lecture 01 Histology of the Cell [Lecture]\nDLA 01 Membrane Structure [DLA]";

export function CourseTemplateLoader({ onClose, defaultTermId }: { onClose: () => void; defaultTermId?: string }) {
  const s = useStore();
  const [sections, setSections] = useState<CourseTemplateSection[]>([]);
  const [pasted, setPasted] = useState("");
  const [setup, setSetup] = useState<Record<string, ModuleSetup>>({});
  const [busy, setBusy] = useState(false);

  function add(next: CourseTemplateSection[]) {
    const readable = next.filter((section) => section.module && section.items.length > 0);
    const unreadable = next.length - readable.length;
    if (unreadable > 0) {
      pushToast({
        title: unreadable === 1 ? "One file was not a template" : `${unreadable} files were not templates`,
        body: "A template starts with the module's name and lists one item per line with its kind in brackets.",
        tone: "warn",
      });
    }
    // The same section loaded twice replaces itself instead of doubling the module.
    setSections((current) => {
      const identity = (section: CourseTemplateSection) => `${moduleKey(section.module)}|${section.title.toLowerCase()}`;
      const incoming = new Set(readable.map(identity));
      return [...current.filter((section) => !incoming.has(identity(section))), ...readable];
    });
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const parsed = await Promise.all([...files].map(async (file) => parseCourseTemplate(await file.text(), file.name)));
      add(parsed);
    } finally {
      setBusy(false);
    }
  }

  /** The term a module's course already sits in, so the usual case needs no choice. */
  function knownTerm(module: string): string {
    const course = s.courses.find((item) => item.modules.some((entry) => moduleKey(entry.name) === moduleKey(module)));
    return defaultTermId ?? course?.termId ?? "";
  }

  const previews = useMemo<ModulePreview[]>(() => {
    const byModule = new Map<string, CourseTemplateSection[]>();
    for (const section of sections) byModule.set(moduleKey(section.module), [...(byModule.get(moduleKey(section.module)) ?? []), section]);
    return [...byModule.entries()].map(([key, group]) => {
      const chosen = setup[key] ?? { termId: knownTerm(group[0].module), firstWeek: "1" };
      const term = s.terms.find((item) => item.id === chosen.termId)?.name;
      const plan = planCourseTemplate(group, { term, firstWeek: Number(chosen.firstWeek) || 1 });
      const counts = new Map<CourseActivity, number>();
      for (const item of plan.items) counts.set(item.activity, (counts.get(item.activity) ?? 0) + 1);
      return { key, plan, changes: reconcileCourseTemplate(plan, s.tracker), counts: [...counts.entries()] };
    });
    // knownTerm reads s.courses; listing it keeps the memo honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, setup, s.courses, s.terms, s.tracker, defaultTermId]);

  const adding = previews.reduce((total, preview) => total + preview.changes.create.length, 0);
  const updating = previews.reduce((total, preview) => total + preview.changes.update.length, 0);

  function patchSetup(preview: ModulePreview, patch: Partial<ModuleSetup>) {
    setSetup((current) => {
      const existing: ModuleSetup | undefined = current[preview.key];
      return {
        ...current,
        [preview.key]: { ...(existing ?? { termId: knownTerm(preview.plan.module), firstWeek: "1" }), ...patch },
      };
    });
  }

  async function apply() {
    setBusy(true);
    const checkpoint = getVaultWriteCheckpoint();
    try {
      const rows = previews.flatMap((preview) => preview.changes.create.map((item) => ({
        path: item.path,
        label: item.label,
        kind: item.kind,
        passes: 0,
        ankiPasses: 0,
        yield: "none" as const,
        activity: item.activity,
        templateKey: item.templateKey,
        weekSource: item.weekSource,
      })));
      if (rows.length) s.bulkAddTrackerItems(rows);
      for (const preview of previews) {
        for (const change of preview.changes.update) s.updateTrackerItem(change.id, { path: change.path, label: change.label, weekSource: change.weekSource });
      }
      await flushLocalVaultWrites();
      assertVaultWritesSince(checkpoint);
      pushToast({
        title: "Course template loaded",
        body: `${rows.length} item${rows.length === 1 ? "" : "s"} added${updating ? `, ${updating} brought up to date` : ""}. Progress on existing items is unchanged.`,
        tone: "success",
      });
      onClose();
    } catch (error) {
      pushToast({ title: "Template could not be saved", body: error instanceof Error ? error.message : "Keep AXOM open and try again.", tone: "warn" });
    } finally { setBusy(false); }
  }

  return (
    <Modal
      title="Load a course template"
      onClose={onClose}
      footer={<>
        <GButton onClick={onClose}>Cancel</GButton>
        <GButton variant="primary" disabled={busy || adding + updating === 0} onClick={() => void apply()}>
          {adding + updating === 0 ? "Nothing to add" : `Add ${adding} item${adding === 1 ? "" : "s"}${updating ? ` and update ${updating}` : ""}`}
        </GButton>
      </>}
    >
      <div className="stack" style={{ gap: 14 }}>
        <p className="sub" style={{ margin: 0 }}>
          A template is a plain text list: the module on the first line, then one item per line with its kind in brackets.
          Leave a blank line between groups. AXOM lays the module out week by week.
        </p>
        <div className="row wrap gap8">
          <label className="gbtn sm">
            <Upload size={ICON_SIZE.body} aria-hidden="true" /> {busy ? "Reading…" : "Choose template files"}
            <input type="file" accept=".txt,text/plain" multiple hidden aria-label="Choose course template files"
              onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />
          </label>
          {sections.length > 0 && <GhostButton onClick={() => { setSections([]); setSetup({}); }}>Clear</GhostButton>}
        </div>
        <details>
          <summary className="sub" style={{ cursor: "pointer" }}>Or paste a template</summary>
          <div className="stack gap6" style={{ marginTop: 8 }}>
            <TextAreaField label="Template text" rows={6} value={pasted} placeholder={EXAMPLE}
              onChange={(event) => setPasted(event.target.value)} />
            <div><GButton size="sm" disabled={!pasted.trim()} onClick={() => { add([parseCourseTemplate(pasted, "Pasted template")]); setPasted(""); }}>Read it</GButton></div>
          </div>
        </details>

        {previews.map((preview) => {
          const chosen = setup[preview.key] ?? { termId: knownTerm(preview.plan.module), firstWeek: "1" };
          const worked = preview.plan.items.filter((item) => item.weekBasis === "spread").length;
          const unscheduled = preview.plan.items.filter((item) => item.weekBasis === "unknown").length;
          return (
            <section key={preview.key} className="template-module" aria-label={`Template for ${preview.plan.module}`}>
              <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <b>{preview.plan.module}</b>
                <span className="sub">
                  {preview.plan.weekCount ? `${preview.plan.weekCount} week${preview.plan.weekCount === 1 ? "" : "s"} · ` : ""}
                  {preview.plan.items.length} items
                </span>
              </div>
              <div className="row wrap gap6">
                {preview.counts.map(([activity, count]) => <Tag key={activity} tone="neutral">{countActivity(activity, count)}</Tag>)}
              </div>
              <div className="grid grid-2">
                <SelectField label={`Term for ${preview.plan.module}`} value={chosen.termId}
                  onChange={(event) => patchSetup(preview, { termId: event.target.value })}>
                  <option value="">No term</option>
                  {s.terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                </SelectField>
                <Field label={`${preview.plan.module} starts in week`} type="number" inputMode="numeric" min={1} max={60}
                  value={chosen.firstWeek} onChange={(event) => patchSetup(preview, { firstWeek: event.target.value })} />
              </div>
              <p className="sub" style={{ margin: 0 }}>
                {preview.changes.create.length} new
                {preview.changes.update.length ? `, ${preview.changes.update.length} to update` : ""}
                {preview.changes.unchanged ? `, ${preview.changes.unchanged} already in your tracker` : ""}.
              </p>
              {worked > 0 && <p className="sub template-note" role="note">{worked} items: {WEEK_BASIS_NOTE.spread} To state them, add a line such as "Week 2:" above each week in the template.</p>}
              {unscheduled > 0 && <p className="sub template-note" role="note">{unscheduled} items: {WEEK_BASIS_NOTE.unknown} They go under "Unscheduled".</p>}
              {preview.plan.problems.length > 0 && (
                <ul className="sub template-note" aria-label={`Lines AXOM could not read in ${preview.plan.module}`}>
                  {preview.plan.problems.slice(0, 5).map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
