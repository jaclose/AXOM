import { STUDY_METHOD_OPTIONS, type PracticeTiming, type StudyMethodId, type StudyWorkflowPreferences } from "../../lib/studyPreferences";

export function StudyMethodFollowUps({ workflow, onChange }: { workflow: StudyWorkflowPreferences; onChange: (value: StudyWorkflowPreferences) => void }) {
  function update(id: StudyMethodId, patch: { usage?: string; timing?: PracticeTiming }) {
    onChange({ ...workflow, configured: true, methods: workflow.methods?.map(method => method.id === id ? { ...method, ...patch } : method) });
  }
  return <div className="stack gap12">{workflow.methods?.filter(method => method.enabled).map(method => {
    const label = STUDY_METHOD_OPTIONS.find(option => option.id === method.id)?.label ?? method.id;
    return <details key={method.id} className="onboarding-disclosure">
      <summary>How do you use {label}?</summary>
      <label className="stack gap6"><span>When do you use {label}?</span><select className="field" value={method.timing ?? ""} onChange={event => update(method.id, { timing: event.target.value ? event.target.value as PracticeTiming : undefined })}>
        <option value="">No preference</option><option value="before">Before learning</option><option value="after-first-pass">After the first pass</option><option value="after-learning">After learning</option><option value="near-exam">Near an exam</option><option value="ongoing">Throughout the course</option>
      </select></label>
      <label className="stack gap6"><span>Your {label} approach (optional)</span><textarea className="field" rows={3} value={method.usage ?? ""} onChange={event => update(method.id, { usage: event.target.value })} /></label>
    </details>;
  })}</div>;
}
