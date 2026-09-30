import { useState, type FormEvent } from "react";
import { CalendarDays, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "../../lib/store";
import { daysUntilExam } from "../../lib/examPlan";
import { examUrgency, normalizeExamCountdown, upcomingModuleExams, validExamDate, type ModuleExamDeadline } from "../../lib/examDeadlines";
import { GlassCard, PanelHeader } from "../ui/primitives";
import { Field, Modal, SelectField } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import "../../styles/exam-countdown.css";

export function ExamCountdown() {
  const stepDate = useStore((s) => s.boardPrep.step1?.examDate);
  const rawPreferences = useStore((s) => s.profile.examCountdown);
  const today = useStore((s) => s.activeDayKey);
  const preferences = normalizeExamCountdown(rawPreferences);
  const exams = upcomingModuleExams(preferences.moduleExams, today);
  const [editor, setEditor] = useState<"step1" | "module" | ModuleExamDeadline | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = preferences.moduleExams.filter((exam) => exam.completedAt);
  const savePreferences = (moduleExams: ModuleExamDeadline[]) => useStore.getState().updateProfile({ examCountdown: { ...preferences, moduleExams } });

  function removeExam(exam: ModuleExamDeadline) {
    savePreferences(preferences.moduleExams.filter((item) => item.id !== exam.id));
    pushToast({ title: "Exam removed", body: exam.name, tone: "info", actionLabel: "Undo", onAction: () => {
      const current = normalizeExamCountdown(useStore.getState().profile.examCountdown);
      if (!current.moduleExams.some((item) => item.id === exam.id)) useStore.getState().updateProfile({ examCountdown: { ...current, moduleExams: [...current.moduleExams, exam] } });
    } });
  }

  return <GlassCard pad className="exam-deadlines">
    <PanelHeader title="Exam horizon" sub="The long view. The next deadline." action={<CalendarDays size={18} aria-hidden="true" />} />
    <div className="exam-deadline-split">
      <section className="exam-deadline-step" aria-label="Step 1 countdown" data-urgency={examUrgency(daysUntilExam(stepDate, today), "step1")}>
        <div className="exam-deadline-label">Step 1 <span>{preferences.step1DateKind === "booked" ? "Booked" : "Target date"}</span></div>
        <CountdownValue date={stepDate} today={today} />
        <button className="exam-text-action" type="button" onClick={() => setEditor("step1")}><Pencil size={14} aria-hidden="true" /> {stepDate ? "Edit Step 1 date" : "Set Step 1 date"}</button>
        <a className="exam-text-action" href="#step">Open Step 1 prep</a>
      </section>
      <section className="exam-deadline-modules" aria-label="Module exam countdowns">
        <div className="exam-deadline-label">Module exams <button className="exam-text-action" onClick={() => setEditor("module")} type="button"><Plus size={14} aria-hidden="true" /> Add exam</button></div>
        {exams.length === 0 && <p className="exam-deadline-empty">Add your next module exam. Its date stays beside Step 1.</p>}
        {exams.map((exam, index) => <article key={exam.id} className="exam-deadline-module" data-primary={index === 0} data-urgency={index === 0 ? examUrgency(daysUntilExam(exam.date, today), "module") : "calm"}>
          <div className="exam-module-heading"><b>{exam.name}</b>{exam.priority === "high" && <small>Priority</small>}</div>
          <CountdownValue date={exam.date} today={today} compact={index > 0} />
          <div className="exam-row-actions">
            <button type="button" onClick={() => setEditor(exam)} aria-label={`Edit ${exam.name}`}><Pencil size={15} aria-hidden="true" /></button>
            <button type="button" onClick={() => savePreferences(preferences.moduleExams.map((item) => item.id === exam.id ? { ...item, completedAt: new Date().toISOString() } : item))} aria-label={`Complete ${exam.name}`}><Check size={15} aria-hidden="true" /></button>
            <button type="button" onClick={() => removeExam(exam)} aria-label={`Remove ${exam.name}`}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </article>)}
      </section>
    </div>
    {completed.length > 0 && <>
      <button type="button" className="exam-text-action" aria-expanded={showCompleted} onClick={() => setShowCompleted(!showCompleted)}>{showCompleted ? "Hide" : "Show"} {completed.length} completed exam{completed.length === 1 ? "" : "s"}</button>
      {showCompleted && completed.map((exam) => <div className="exam-completed" key={exam.id}><span>{exam.name}</span><button type="button" className="exam-text-action" onClick={() => savePreferences(preferences.moduleExams.map((item) => item.id === exam.id ? { ...item, completedAt: undefined } : item))}><RotateCcw size={14} aria-hidden="true" /> Reopen</button><button type="button" className="exam-text-action" aria-label={`Remove ${exam.name}`} onClick={() => removeExam(exam)}><Trash2 size={14} aria-hidden="true" /></button></div>)}
    </>}
    {editor && <ExamEditor key={typeof editor === "string" ? editor : editor.id} editor={editor} stepDate={stepDate ?? ""} dateKind={preferences.step1DateKind} onClose={() => setEditor(null)} onSave={(exam, kind) => {
      if (editor === "step1") {
        useStore.getState().updateBoardPrep("step1", { examDate: exam.date || undefined });
        useStore.getState().updateProfile({ examCountdown: { ...preferences, step1DateKind: kind } });
      } else {
        savePreferences([...preferences.moduleExams.filter((item) => item.id !== exam.id), exam]);
      }
      setEditor(null);
    }} />}
  </GlassCard>;
}

function CountdownValue({ date, today, compact = false }: { date?: string; today: string; compact?: boolean }) {
  const days = validExamDate(date) ? daysUntilExam(date, today) : null;
  return <div className={`exam-deadline-value ${compact ? "compact" : ""}`}>
    <div><strong>{days === null ? "—" : days === 0 ? "Today" : Math.abs(days)}</strong>{days !== null && days !== 0 && <span>{Math.abs(days) === 1 ? "day" : "days"} {days < 0 ? "ago" : "remaining"}</span>}</div>
    <time dateTime={date}>{days !== null ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date not set"}</time>
    {days !== null && days < 0 && <small>Date passed · review your plan</small>}
  </div>;
}

function ExamEditor({ editor, stepDate, dateKind, onClose, onSave }: { editor: "step1" | "module" | ModuleExamDeadline; stepDate: string; dateKind: "booked" | "target"; onClose: () => void; onSave: (exam: ModuleExamDeadline, kind: "booked" | "target") => void }) {
  const existing = typeof editor === "object" ? editor : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [date, setDate] = useState(editor === "step1" ? stepDate : existing?.date ?? "");
  const [kind, setKind] = useState(dateKind);
  const [priority, setPriority] = useState<"normal" | "high">(existing?.priority ?? "normal");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if ((!date && editor !== "step1") || (date && !validExamDate(date))) { setError("Choose a valid calendar date."); return; }
    if (editor !== "step1" && !name.trim()) { setError("Give this exam a name."); return; }
    onSave({ id: existing?.id ?? crypto.randomUUID(), name: editor === "step1" ? "Step 1" : name.trim(), date, priority, completedAt: existing?.completedAt }, kind);
  }
  return <Modal title={editor === "step1" ? "Step 1 date" : existing ? "Edit module exam" : "Add module exam"} onClose={onClose}>
    <form className="stack gap16" onSubmit={submit}>
      {editor !== "step1" && <Field label="Exam name" name="exam-name" value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} placeholder="Renal module exam" />}
      <Field label={editor === "step1" ? "Step 1 date" : "Exam date"} name="exam-date" type="date" value={date} required={editor !== "step1"} onChange={(event) => setDate(event.target.value)} />
      {editor === "step1" ? <SelectField label="Date status" value={kind} onChange={(event) => setKind(event.target.value as "booked" | "target")}><option value="target">Target — not booked yet</option><option value="booked">Booked exam</option></SelectField> : <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "high")}><option value="normal">Normal</option><option value="high">High</option></SelectField>}
      {error && <p role="alert">{error}</p>}
      <div className="exam-editor-actions"><button type="button" className="gbtn" onClick={onClose}>Cancel</button><button type="submit" className="gbtn primary">Save date</button></div>
      {editor === "step1" && <p className="muted">This is the same date used in Step 1 prep. Clear it to remove the countdown.</p>}
    </form>
  </Modal>;
}
