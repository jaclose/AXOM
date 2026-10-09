import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, Play, Search } from "lucide-react";
import { useStore } from "../../lib/store";
import { bankSource, buildCourseQuestionBank } from "../../lib/course-engine/questionBank";
import type { QuestionSet } from "../../lib/library";
import { GButton, GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/course-bank.css";

export interface BankLocation { module: string; week?: number; courseId?: string }

interface Props {
  initialScope?: BankLocation;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onPractice?: (sets: QuestionSet[]) => void;
  renderSet?: (set: QuestionSet) => ReactNode;
}

/** The same bounded source navigator serves the library and the block picker. */
export function CourseBankBrowser({ selectedIds = [], onSelectionChange, onPractice, renderSet, initialScope }: Props) {
  const { questionSets = [], questions = [], courses, terms } = useStore();
  const branches = useMemo(() => buildCourseQuestionBank(questionSets, questions, courses, terms), [questionSets, questions, courses, terms]);
  const [chosen, setChosen] = useState<string>();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(12);
  const [openedSet, setOpenedSet] = useState<string>();
  const scoped = branches.find((branch) => branch.module === initialScope?.module && (!initialScope.courseId || branch.courseId === initialScope.courseId));
  const initial = scoped?.weeks.find((week) => week.week === initialScope?.week) ?? scoped?.weeks[0] ?? branches.flatMap((branch) => branch.weeks).find((week) => week.sets.some((set) => selectedIds.includes(set.id)))
    ?? branches[0]?.weeks[0];
  const active = branches.flatMap((branch) => branch.weeks).find((week) => week.key === chosen) ?? initial;
  const branch = branches.find((item) => item.weeks.some((week) => week.key === active?.key));
  const selected = new Set(selectedIds);
  const search = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = search ? branches.flatMap((module) => module.weeks.flatMap((week) => week.sets.map((set) => ({ module, week, set }))))
      : active && branch ? active.sets.map((set) => ({ module: branch, week: active, set })) : [];
    return pool.filter(({ set, module, week }) => (!source || bankSource(set) === source)
      && (!search || `${set.title} ${set.tags.join(" ")} ${module.term} ${module.course} ${module.module} ${week.label}`.toLowerCase().includes(search)));
  }, [search, branches, active, branch, source]);
  const detail = questionSets.find((set) => set.id === openedSet);
  const availableSources = [...new Set((search ? questionSets : active?.sets ?? []).map(bankSource))];

  function toggle(ids: string[]) {
    const next = new Set(selectedIds);
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectionChange?.([...next]);
  }

  if (detail && renderSet) return <section className="course-bank cb-focused" aria-label={detail.title}>
    <GhostButton onClick={() => setOpenedSet(undefined)}><ArrowLeft size={14} /> Back to week</GhostButton>
    {renderSet(detail)}
  </section>;

  return <section className={`course-bank ${onSelectionChange ? "cb-picker" : ""}`} aria-label="Course question bank">
    <div className="cb-searchbar">
      <label className="cb-search"><Search size={16} /><input type="search" aria-label="Search question sets" placeholder="Find a week, source or set" value={query}
        onChange={(event) => { setQuery(event.target.value); setLimit(12); }} /></label>
      {onSelectionChange && <span className="cb-selection" role="status">{selectedIds.length} selected</span>}
    </div>
    {!branches.length ? <div className="cb-empty"><BookOpen size={24} /><h2>Your course questions start here</h2><p>Import a question file. AXOM will suggest its module and week for you to review.</p></div> :
    <div className="cb-layout">
      <nav className="cb-outline" aria-label="Course outline">
        {branches.map((item, index) => <div className="cb-branch" key={item.key}>
          {(index === 0 || branches[index - 1].term !== item.term) && <p className="cb-term">{item.term}</p>}
          {(index === 0 || branches[index - 1].course !== item.course || branches[index - 1].term !== item.term) && <p className="cb-course">{item.course}</p>}
          <button className="cb-module" aria-expanded={branch?.key === item.key} onClick={() => { setChosen(item.weeks[0]?.key); setQuery(""); setSource(""); setLimit(12); }}>
            <ChevronRight size={14} className={branch?.key === item.key ? "cb-rotated" : ""} /><b>{item.module}</b><span>{item.weeks.length}</span>
          </button>
          {branch?.key === item.key && <ul>{item.weeks.map((week) => <li key={week.key}><button aria-current={active?.key === week.key ? "true" : undefined}
            onClick={() => { setChosen(week.key); setQuery(""); setSource(""); setLimit(12); }}><span>{week.label}</span><small>{week.questionIds.length}</small></button></li>)}</ul>}
        </div>)}
      </nav>
      <div className="cb-content">
        <header className="cb-week-head">
          <p className="cb-eyebrow">{search ? "Across your question bank" : `${branch?.term} / ${branch?.module}`}</p>
          <h2>{search ? "Search results" : active?.label}</h2>
          <p>{search ? `${matches.length} matching sets` : `${active?.questionIds.length ?? 0} questions · ${active?.attempted ?? 0} answered · ${active?.ready ?? 0} ready to practice`}</p>
          {!search && active && <div className="cb-week-actions">
            {onPractice && <GButton variant="primary" disabled={!active.ready || !matches.length} onClick={() => onPractice(matches.map((match) => match.set))}><Play size={14} /> Practice week</GButton>}
            {onSelectionChange && <GhostButton onClick={() => toggle(active.sets.map((set) => set.id))}>{active.sets.every((set) => selected.has(set.id)) ? "Remove week" : "Add week"}</GhostButton>}
            {onSelectionChange && branch && branch.weeks.length > 1 && <GhostButton onClick={() => toggle(branch.weeks.flatMap((week) => week.sets.map((set) => set.id)))}>Toggle module</GhostButton>}
          </div>}
        </header>
        <div className="cb-list-heading"><span>{search ? "Matching sources" : "Sources"}</span><select aria-label="Source type" value={source} onChange={(event) => { setSource(event.target.value); setLimit(12); }}>
          <option value="">All sources</option>{availableSources.map((name) => <option key={name}>{name}</option>)}
        </select></div>
        <div className="cb-set-list">
          {matches.slice(0, limit).map(({ set, module, week }) => <article className="cb-set-row" key={set.id}>
            {onSelectionChange && <input type="checkbox" aria-label={`Include ${set.title}`} checked={selected.has(set.id)} onChange={() => toggle([set.id])} />}
            <div className="cb-set-copy"><span className={`cb-source ${set.kind === "generated" ? "cb-generated" : ""}`}>{bankSource(set)}</span>
              {renderSet ? <button className="cb-set-title" onClick={() => setOpenedSet(set.id)}>{set.title}<ArrowUpRight size={14} /></button> : <b>{set.title}</b>}
              <small>{search ? `${module.module} / ${week.label} · ` : ""}{set.questionIds.length} {set.questionIds.length === 1 ? "question" : "questions"}</small>
            </div>
            {onPractice && <GhostButton aria-label={`Practice ${set.title}`} onClick={() => onPractice([set])}><Play size={ICON_SIZE.body} /><span>Practice</span></GhostButton>}
          </article>)}
          {!matches.length && <p className="cb-empty" role="status">No sets match. Try another source or a shorter search.</p>}
        </div>
        {matches.length > limit && <GhostButton onClick={() => setLimit((value) => value + 12)}>Show 12 more ({matches.length - limit} remaining)</GhostButton>}
      </div>
    </div>}
  </section>;
}
