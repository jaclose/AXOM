import { useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, X, ExternalLink } from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, GhostButton, Tag, EmptyState } from "../components/ui/primitives";
import { Modal, Field, SelectField } from "../components/ui/Modal";
import type { Course } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";
import type { StudyMethodId } from "../lib/studyPreferences";

export function CoursesPage() {
  const s = useStore();
  const [editing, setEditing] = useState<Course | "new" | null>(null);
  const [newTerm, setNewTerm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(s.courses[0]?.id ?? null);

  return (
    <>
      {/* Term-grouped course cards */}
      {s.terms.map((term) => {
        const courses = s.courses.filter((c) => c.termId === term.id);
        return (
          <div key={term.id} className="stack gap12">
            <div className="term-head">
              <span className="term-name">{term.name}</span>
              <Tag tone="neutral">{courses.length} courses</Tag>
              <div className="right row gap6">
                <GhostButton title="Rename term"
                  onClick={() => {
                    const name = prompt("Rename term", term.name);
                    if (name) s.renameTerm(term.id, name);
                  }}><Pencil size={ICON_SIZE.body} /></GhostButton>
                <GhostButton className="danger" title="Delete term + its courses"
                  onClick={() => confirm(`Delete "${term.name}" and its ${courses.length} courses?`) && s.removeTerm(term.id)}>
                  <Trash2 size={ICON_SIZE.body} /></GhostButton>
              </div>
            </div>

            <div className="grid grid-courses">
              {courses.map((c) => (
                <GlassCard key={c.id} pad hoverable className="course-card">
                  <div className="card-hover-tools">
                    <GhostButton title="Edit" onClick={() => setEditing(c)}><Pencil size={ICON_SIZE.body} /></GhostButton>
                    <GhostButton className="danger" title="Delete"
                      onClick={() => {
                        if (!confirm(`Delete ${c.code}? This removes the course shell. You can also clear its tracker rows in the next prompt.`)) return;
                        if (confirm(`Also delete tracker rows under ${term.name}/${c.code}?`)) s.removeTrackerScope(`${term.name}/${c.code}`);
                        s.removeCourse(c.id);
                      }}><Trash2 size={ICON_SIZE.body} /></GhostButton>
                  </div>
                  <Tag>{term.name}</Tag>
                  <div className="cc-code">{c.code}</div>
                  {c.name && <div className="cc-name">{c.name}</div>}
                  <div className="cc-files">{c.files} files · {c.modules.length} modules</div>
                  <div className="cc-actions">
                    {c.link
                      ? <a className="gbtn sm" href={c.link} target="_blank" rel="noreferrer">Open <ExternalLink size={ICON_SIZE.body} /></a>
                      : <GButton size="sm" onClick={() => setEditing(c)}>Open</GButton>}
                  </div>
                </GlassCard>
              ))}
              <div className="add-tile" onClick={() => setEditing("new")}>
                <Plus size={ICON_SIZE.emphasis} /> Add course
              </div>
            </div>
          </div>
        );
      })}

      <div className="add-tile" onClick={() => setNewTerm(true)}>
        <Plus size={ICON_SIZE.emphasis} /> Add term
      </div>

      {/* Course Modules accordion */}
      <GlassCard pad={false}>
        <div className="panel-head" style={{ padding: "16px 18px 0" }}>
          <div>
            <div className="panel-title">Course Modules</div>
            <div className="panel-sub">Expand a course to manage its modules</div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          {s.courses.length === 0 && <div style={{ padding: 24 }}><EmptyState title="No courses yet" hint="Add a course above to get started." /></div>}
          {s.courses.map((c) => {
            const open = expanded === c.id;
            const courseTerm = s.terms.find((t) => t.id === c.termId);
            const courseTermName = courseTerm?.name ?? "Term";
            return (
              <div key={c.id}>
                <button className="acc-row" onClick={() => setExpanded(open ? null : c.id)}>
                  {open ? <ChevronDown size={ICON_SIZE.emphasis} /> : <ChevronRight size={ICON_SIZE.emphasis} />}
                  <span className="acc-title">{c.code}</span>
                  <Tag tone="neutral">{c.modules.length}</Tag>
                </button>
                {open && (
                  <div className="acc-body">
                    {c.modules.map((m) => (
                      <span className="chip" key={m.id}>
                        {m.name}
                        <button className="chip-x" title="Rename module"
                          onClick={() => {
                            const name = prompt("Rename module", m.name);
                            if (name?.trim()) {
                              const oldScope = `${courseTermName}/${c.code}/${m.name}`;
                              const nextName = name.trim();
                              s.renameModule(c.id, m.id, nextName);
                              s.renameTrackerScope(oldScope, `${courseTermName}/${c.code}/${nextName}`);
                            }
                          }}>
                          <Pencil size={ICON_SIZE.microInline} />
                        </button>
                        <button className="chip-x" onClick={() => {
                          if (!confirm(`Delete module "${m.name}" from ${c.code}?`)) return;
                          if (confirm(`Also delete tracker rows under ${courseTermName}/${c.code}/${m.name}?`)) {
                            s.removeTrackerScope(`${courseTermName}/${c.code}/${m.name}`);
                          }
                          s.removeModule(c.id, m.id);
                        }}><X size={ICON_SIZE.microInline} /></button>
                      </span>
                    ))}
                    <button className="chip" style={{ borderStyle: "dashed", color: "var(--cyan)" }}
                      onClick={() => { const n = prompt(`Add module to ${c.code}`); if (n) s.addModule(c.id, n); }}>
                      <Plus size={ICON_SIZE.microInline} /> Add module
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {editing && (
        <CourseEditor
          course={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {newTerm && <TermEditor onClose={() => setNewTerm(false)} />}
    </>
  );
}

function CourseEditor({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const s = useStore();
  const [code, setCode] = useState(course?.code ?? "");
  const [name, setName] = useState(course?.name ?? "");
  const [termId, setTermId] = useState(course?.termId ?? s.terms[0]?.id ?? "");
  const [files, setFiles] = useState(String(course?.files ?? 0));
  const [link, setLink] = useState(course?.link ?? "");
  const [customWorkflow, setCustomWorkflow] = useState(Boolean(course?.studyPlanOverride));
  const [passes, setPasses] = useState(course?.studyPlanOverride?.lecturePasses ?? 2);
  const [reviewDays, setReviewDays] = useState(course?.studyPlanOverride?.reviewAfterDays ?? 3);
  const [methods, setMethods] = useState(() => new Set((course?.studyPlanOverride?.methods ?? []).filter((method) => method.enabled).map((method) => method.id)));

  function save() {
    if (!code.trim() || !termId) return;
    const methodOptions: StudyMethodId[] = ["lecture-passes", "practice-questions", "anki", "notes", "teach-aloud", "external-resource"];
    const payload = { code: code.trim(), name: name.trim(), termId, files: Number(files) || 0, link: link.trim() || undefined, studyPlanOverride: customWorkflow ? { lecturePasses: passes, reviewAfterDays: reviewDays, methods: methodOptions.map((id) => ({ id, enabled: methods.has(id) })) } : undefined };
    if (course) {
      const oldTerm = s.terms.find((t) => t.id === course.termId);
      const newTerm = s.terms.find((t) => t.id === termId);
      s.updateCourse(course.id, payload);
      if (oldTerm && newTerm && (oldTerm.id !== newTerm.id || course.code !== payload.code)) {
        s.renameTrackerScope(`${oldTerm.name}/${course.code}`, `${newTerm.name}/${payload.code}`);
      }
    }
    else s.addCourse(payload);
    onClose();
  }

  return (
    <Modal title={course ? "Edit course" : "Add course"} onClose={onClose}
      footer={<><GButton onClick={onClose}>Cancel</GButton><GButton variant="primary" onClick={save}>Save</GButton></>}>
      <Field label="Course code" placeholder="01 BPM 500" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      <Field label="Full name (optional)" placeholder="Basic Principles of Medicine" value={name} onChange={(e) => setName(e.target.value)} />
      <SelectField label="Term" value={termId} onChange={(e) => setTermId(e.target.value)}>
        {s.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <Field label="Files" type="number" value={files} onChange={(e) => setFiles(e.target.value)} />
      <Field label="Open link (optional)" placeholder="https://… or leave blank" value={link} onChange={(e) => setLink(e.target.value)} />
      <label className="early-feature-row"><input type="checkbox" checked={customWorkflow} onChange={(event) => setCustomWorkflow(event.target.checked)}/><span><b>Customize this course</b><small>Otherwise this course uses your normal study workflow.</small></span></label>
      {customWorkflow && <><div className="settings-target-grid"><Field label="Lecture passes" type="number" min={1} max={6} value={passes} onChange={(event) => setPasses(Number(event.target.value))}/><Field label="Review after (days)" type="number" min={1} max={14} value={reviewDays} onChange={(event) => setReviewDays(Number(event.target.value))}/></div><div className="row wrap gap8" aria-label="Course study methods">{([ ["lecture-passes", "Lecture passes"], ["practice-questions", "Practice questions"], ["anki", "Anki"], ["notes", "Notes"], ["teach-aloud", "Teach aloud"], ["external-resource", "External resources"] ] as Array<[StudyMethodId,string]>).map(([id,label]) => <button key={id} type="button" className={`filter-pill ${methods.has(id) ? "on" : ""}`} aria-pressed={methods.has(id)} onClick={() => setMethods((current) => { const next=new Set(current); if(next.has(id))next.delete(id);else next.add(id);return next; })}>{label}</button>)}</div></>}
    </Modal>
  );
}

function TermEditor({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState("");
  return (
    <Modal title="Add term" onClose={onClose}
      footer={<><GButton onClick={onClose}>Cancel</GButton>
        <GButton variant="primary" onClick={() => { if (name.trim()) { s.addTerm(name.trim()); onClose(); } }}>Add</GButton></>}>
      <Field label="Term name" placeholder="Term 3" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
    </Modal>
  );
}
