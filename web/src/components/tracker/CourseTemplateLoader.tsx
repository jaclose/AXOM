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
import { courseTemplateFamily, prepareCourseTemplate } from "../../lib/course-engine/templateLibrary";
import { SavedCourseTemplates } from "./SavedCourseTemplates";
import { pushToast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";
import { Field, Modal, SelectField, TextAreaField } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";

interface ModuleSetup {
  termId: string;
  firstWeek: string;
  excludedWeeks?: string[];
  excludedActivities?: CourseActivity[];
}

interface ModulePreview {
  key: string;
  plan: CourseTemplatePlan;
  changes: TemplateReconciliation;
  counts: Array<[CourseActivity, number]>;
  weeks: Array<[string, number]>;
  selected: number;
}

const EXAMPLE = "FTM 1 - Lectures + DLAs:\n\nFTM Lecture 01 Histology of the Cell [Lecture]\nDLA 01 Membrane Structure [DLA]";

export function CourseTemplateLoader({ onClose, defaultTermId }: { onClose: () => void; defaultTermId?: string }) {
  const s = useStore();
  const [sections, setSections] = useState<CourseTemplateSection[]>([]);
  const [pasted, setPasted] = useState("");
  const [setup, setSetup] = useState<Record<string, ModuleSetup>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(true);

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
      const identity = courseTemplateFamily;
      const incoming = new Set(readable.map(identity));
      return [...current.filter((section) => !incoming.has(identity(section))), ...readable];
    });
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      await saveTemplates(await Promise.all([...files].map(async (file) => ({ text: await file.text(), name: file.name }))));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read. Choose it again.");
    } finally { setBusy(false); }
  }

  async function saveTemplates(inputs: Array<{ text: string; name: string }>) {
    setBusy(true);
    setError("");
    try {
      // Validate the entire selection before changing the vault. Reimports retain
      // the saved version metadata and also retry any earlier failed vault write.
      const documents = await Promise.all(inputs.map(({ text, name }) => prepareCourseTemplate(text, name)));
      const checkpoint = getVaultWriteCheckpoint();
      for (const document of documents) s.addDocument(s.documents.find((entry) => entry.id === document.id) ?? document);
      await flushLocalVaultWrites();
      assertVaultWritesSince(checkpoint);
      add(documents.map((document) => parseCourseTemplate(document.rawText, document.fileName)));
      setLibraryOpen(false);
      setPasted("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Templates could not be saved. Keep your files and try again.");
    } finally { setBusy(false); }
  }

  /** The term a module's course already sits in, so the usual case needs no choice. */
  function knownTerm(module: string, stated?: string): string {
    if (stated) return s.terms.find((item) => item.name.toLowerCase() === stated.toLowerCase())?.id ?? `source-term:${stated}`;
    const course = s.courses.find((item) => item.modules.some((entry) => moduleKey(entry.name) === moduleKey(module)));
    return defaultTermId ?? course?.termId ?? "";
  }

  const previews = useMemo<ModulePreview[]>(() => {
    const byModule = new Map<string, CourseTemplateSection[]>();
    for (const section of sections) {
      const key = `${section.term ?? ""}|${moduleKey(section.module)}`;
      byModule.set(key, [...(byModule.get(key) ?? []), section]);
    }
    return [...byModule.entries()].map(([key, group]) => {
      const chosen = setup[key] ?? { termId: knownTerm(group[0].module, group[0].term), firstWeek: "1" };
      const term = chosen.termId.startsWith("source-term:") ? chosen.termId.slice(12) : s.terms.find((item) => item.id === chosen.termId)?.name ?? "";
      const plan = planCourseTemplate(group, { term, firstWeek: Number(chosen.firstWeek) || 1 });
      const counts = new Map<CourseActivity, number>();
      const weeks = new Map<string, number>();
      for (const item of plan.items) {
        counts.set(item.activity, (counts.get(item.activity) ?? 0) + 1);
        const week = String(item.week ?? "unscheduled");
        weeks.set(week, (weeks.get(week) ?? 0) + 1);
      }
      // Filter only after planning so week inference and stable activity IDs do
      // not change when the learner selects a subset.
      const items = plan.items.filter((item) => !chosen.excludedWeeks?.includes(String(item.week ?? "unscheduled")) && !chosen.excludedActivities?.includes(item.activity));
      return { key, plan, selected: items.length, changes: reconcileCourseTemplate({ ...plan, items }, s.tracker), counts: [...counts.entries()], weeks: [...weeks.entries()].sort(([a], [b]) => Number(a) - Number(b)) };
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
        [preview.key]: { ...(existing ?? { termId: knownTerm(preview.plan.module, preview.plan.term), firstWeek: "1" }), ...patch },
      };
    });
  }

  async function apply() {
    setBusy(true);
    setError("");
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
      setError(error instanceof Error ? error.message : "Keep AXOM open and try again.");
      pushToast({ title: "Template could not be saved", body: error instanceof Error ? error.message : "Keep AXOM open and try again.", tone: "warn" });
    } finally { setBusy(false); }
  }

  return (
    <Modal
      title="Load a course template"
      className="course-template-modal"
      onClose={onClose}
      footer={<>
        <GButton onClick={onClose}>Cancel</GButton>
        <GButton variant="primary" disabled={busy || adding + updating === 0} onClick={() => void apply()}>
          {adding + updating === 0 ? "Nothing to add" : `Add ${adding} item${adding === 1 ? "" : "s"}${updating ? ` and update ${updating}` : ""}`}
        </GButton>
      </>}
    >
      <div className="stack" style={{ gap: 14 }}>
        {error && <p role="alert">{error}</p>}
        <details open={libraryOpen} onToggle={(event) => setLibraryOpen(event.currentTarget.open)}>
          <summary>Browse saved templates</summary>
          <SavedCourseTemplates documents={s.documents} onUse={(document) => {
            add([parseCourseTemplate(document.rawText, document.fileName)]); setLibraryOpen(false);
          }} />
        </details>
        <p className="sub" style={{ margin: 0 }}>
          Choose a saved version or import a text template. Preview its weeks before loading; existing study progress stays.
        </p>
        <div className="row wrap gap8">
          <label className="gbtn sm">
            <Upload size={ICON_SIZE.body} aria-hidden="true" /> {busy ? "Reading…" : "Choose template files"}
            <input type="file" accept=".txt,text/plain" multiple hidden disabled={busy} aria-label="Choose course template files"
              onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />
          </label>
          {sections.length > 0 && <GhostButton disabled={busy} onClick={() => { setSections([]); setSetup({}); }}>Clear</GhostButton>}
        </div>
        <details>
          <summary className="sub" style={{ cursor: "pointer" }}>Or paste a template</summary>
          <div className="stack gap6" style={{ marginTop: 8 }}>
            <TextAreaField label="Template text" rows={6} value={pasted} placeholder={EXAMPLE}
              onChange={(event) => setPasted(event.target.value)} />
            <div><GButton size="sm" disabled={busy || !pasted.trim()} onClick={() => void saveTemplates([{ text: pasted, name: "Pasted template.txt" }])}>Save and preview</GButton></div>
          </div>
        </details>
        <details className="sub">
          <summary>Template file format</summary>
          <p>Start with the module name, then list one activity per line with its kind in brackets. Leave a blank line between groups. Use a heading such as “Week 2:” to state the week.</p>
        </details>

        {previews.map((preview) => {
          const chosen = setup[preview.key] ?? { termId: knownTerm(preview.plan.module, preview.plan.term), firstWeek: "1" };
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
                  {chosen.termId.startsWith("source-term:") && <option value={chosen.termId}>{chosen.termId.slice(12)} (from template)</option>}
                  {s.terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                </SelectField>
                <Field label={`${preview.plan.module} starts in week`} type="number" inputMode="numeric" min={1} max={60}
                  value={chosen.firstWeek} onChange={(event) => patchSetup(preview, { firstWeek: event.target.value, excludedWeeks: [] })} />
              </div>
              <fieldset className="template-selection">
                <legend>Weeks to load</legend>
                {preview.weeks.map(([week, count]) => <label key={week}>
                  <input type="checkbox" checked={!chosen.excludedWeeks?.includes(week)} onChange={(event) => patchSetup(preview, {
                    excludedWeeks: event.target.checked ? (chosen.excludedWeeks ?? []).filter((value) => value !== week) : [...(chosen.excludedWeeks ?? []), week],
                  })} /> {week === "unscheduled" ? "Unscheduled" : `Week ${week}`} <span className="sub">({count})</span>
                </label>)}
              </fieldset>
              <fieldset className="template-selection">
                <legend>Activities to load</legend>
                {preview.counts.map(([activity, count]) => <label key={activity}>
                  <input type="checkbox" checked={!chosen.excludedActivities?.includes(activity)} onChange={(event) => patchSetup(preview, {
                    excludedActivities: event.target.checked ? (chosen.excludedActivities ?? []).filter((value) => value !== activity) : [...(chosen.excludedActivities ?? []), activity],
                  })} /> {countActivity(activity, count)}
                </label>)}
              </fieldset>
              <p className="sub" role="status">{preview.selected} of {preview.plan.items.length} activities selected.</p>
              <p className="sub" style={{ margin: 0 }}>
                {preview.changes.create.length} new
                {preview.changes.update.length ? `, ${preview.changes.update.length} to update` : ""}
                {preview.changes.unchanged ? `, ${preview.changes.unchanged} already in your tracker` : ""}.
              </p>
              {preview.changes.create.length + preview.changes.update.length > 0 && <details>
                <summary>Review additions and changes</summary>
                <ul className="sub">
                  {preview.changes.create.map((item) => <li key={item.templateKey}>Add: {item.label} · {item.path}</li>)}
                  {preview.changes.update.map((item) => <li key={item.id}>Update: {s.tracker.find((row) => row.id === item.id)?.label} → {item.label} · {item.path}. Study progress stays.</li>)}
                </ul>
              </details>}
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
