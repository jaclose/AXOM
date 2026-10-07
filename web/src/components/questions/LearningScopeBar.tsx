import { useMemo } from "react";
import { Focus, Layers3 } from "lucide-react";
import { useStore } from "../../lib/store";
import { useDecodeState, saveDecode } from "../../lib/decodeWorkspace";
import { scopeLabel, sortDecodeWeeks } from "../../lib/decode";
import type { LearningScope } from "../../lib/decodeTypes";
import { pushToast } from "../../lib/toast";

export function LearningScopeBar() {
  const s = useStore();
  const decode = useDecodeState();
  const { scope } = decode;
  const modules = useMemo(() => [...new Set([
    ...s.courses.filter((course) => !scope.termId || course.termId === scope.termId).flatMap((course) => course.modules.map((module) => module.name)),
    ...decode.assignments.filter((a) => !scope.termId || a.termId === scope.termId).map((a) => a.module),
    ...(s.questions ?? []).map((q) => q.module ?? ""),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [s.courses, s.questions, scope.termId, decode.assignments]);
  const weeks = sortDecodeWeeks([...new Set(decode.assignments.filter((a) => !scope.module || a.module === scope.module).map((a) => a.week).filter((w): w is string => Boolean(w)))]);
  const lectures = [...new Set(decode.assignments.filter((a) => (!scope.module || a.module === scope.module) && (!scope.week || a.week === scope.week)).map((a) => a.lecture).filter((v): v is string => Boolean(v)))].sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
  function change(next: LearningScope) {
    void saveDecode({ scope: next }).catch((error: unknown) => pushToast({ title: "Focus could not be saved", body: error instanceof Error ? error.message : "Try again.", tone: "error" }));
  }
  return <section className="decode-scope" aria-label="Shared learning scope">
    <div className="decode-scope-heading"><Focus size={17} /><strong>{scopeLabel(scope, s.courses, s.terms)}</strong>
      <button type="button" className="decode-link" onClick={() => change({ cumulative: true })}><Layers3 size={14} /> All modules</button></div>
    <div className="decode-scope-fields">
      <label>Term<select value={scope.termId ?? ""} onChange={(e) => change({ termId: e.target.value || undefined })}><option value="">All terms</option>{s.terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
      <label>Module<select value={scope.module ?? ""} onChange={(e) => change({ termId: scope.termId, module: e.target.value || undefined })}><option value="">All modules</option>{modules.map((module) => <option key={module}>{module}</option>)}</select></label>
      <label>Week<select value={scope.week ?? ""} onChange={(e) => change({ ...scope, week: e.target.value || undefined, lecture: undefined })}><option value="">All weeks</option>{weeks.map((week) => <option key={week}>{week}</option>)}</select></label>
      <label>Lecture<select value={scope.lecture ?? ""} onChange={(e) => change({ ...scope, lecture: e.target.value || undefined })}><option value="">All lectures</option>{lectures.map((lecture) => <option key={lecture}>{lecture}</option>)}</select></label>
      <label>Question set<select value={scope.setId ?? ""} onChange={(e) => change({ ...scope, setId: e.target.value || undefined })}><option value="">All sources</option>{(s.questionSets ?? []).map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}</select></label>
    </div>
  </section>;
}
