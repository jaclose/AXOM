import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, FileText, Images, Play, Search } from "lucide-react";
import { useStore } from "../../lib/store";
import { bankSource, buildCourseQuestionBank } from "../../lib/course-engine/questionBank";
import { canonicalModuleKey } from "../../lib/course-engine/vocabulary";
import type { QuestionRecord } from "../../lib/questions";
import { questionPracticeReadiness, type QuestionPracticeReadiness } from "../../lib/questionFilters";
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
  onReviewQuestionIds?: (ids: string[]) => void;
  onRestoreMissing?: () => void;
  renderSet?: (set: QuestionSet) => ReactNode;
}

interface CollectionReadiness {
  stored: number;
  ready: number;
  reviewSuggested: number;
  unresolved: number;
  missing: number;
}

type ReadinessFilter = "all" | QuestionPracticeReadiness | "missing";

function measureCollection(set: QuestionSet, byId: ReadonlyMap<string, QuestionRecord>): CollectionReadiness {
  const ids = new Set(set.questionIds);
  let stored = 0;
  let ready = 0;
  let reviewSuggested = 0;
  let unresolved = 0;
  for (const id of ids) {
    const question = byId.get(id);
    if (!question) continue;
    stored += 1;
    const state = questionPracticeReadiness(question);
    if (state === "ready") ready += 1;
    else if (state === "review-suggested") reviewSuggested += 1;
    else unresolved += 1;
  }
  return { stored, ready, reviewSuggested, unresolved, missing: ids.size - stored };
}

function courseIdentity(branch: { courseId?: string; course: string }): string {
  return branch.courseId ?? `unassigned:${branch.course}`;
}

function matchesReadiness(metric: CollectionReadiness, filter: ReadinessFilter): boolean {
  return filter === "all" || (filter === "ready" && metric.ready > 0)
    || (filter === "review-suggested" && metric.reviewSuggested > 0)
    || (filter === "unresolved" && metric.unresolved > 0)
    || (filter === "missing" && (metric.missing > 0 || metric.stored === 0));
}

/** A read-only projection of the canonical question sets, never a second collection store. */
export function CourseBankBrowser({ selectedIds = [], onSelectionChange, onPractice, onReviewQuestionIds, onRestoreMissing, renderSet, initialScope }: Props) {
  const { questionSets = [], questions = [], courses, terms } = useStore();
  const branches = useMemo(() => buildCourseQuestionBank(questionSets, questions, courses, terms),
    [questionSets, questions, courses, terms]);
  const questionsById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const readiness = useMemo(() => new Map(questionSets.map((set) => [set.id, measureCollection(set, questionsById)])),
    [questionsById, questionSets]);
  // Metadata is safe to show while browsing. Source thumbnails are not: an
  // imported page may carry the answer, and image bytes may be offline.
  const imageReferences = useMemo(() => new Map(questionSets.map((set) => [set.id,
    [...new Set(set.questionIds)].filter((id) => {
      const question = questionsById.get(id);
      return Boolean(question?.content?.assets.length || question?.attachments?.length);
    }).length,
  ])), [questionsById, questionSets]);

  const [chosen, setChosen] = useState<string>();
  const [termFilter, setTermFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  const [limit, setLimit] = useState(12);
  const [openedSet, setOpenedSet] = useState<string>();

  const termsAvailable = [...new Set(branches.map((branch) => branch.term))];
  const termBranches = termFilter ? branches.filter((branch) => branch.term === termFilter) : branches;
  const courseOptions = [...new Map(termBranches.map((branch) => [courseIdentity(branch), branch.course])).entries()];
  const visibleBranches = courseFilter
    ? termBranches.filter((branch) => courseIdentity(branch) === courseFilter)
    : termBranches;

  const scopedCandidates = initialScope ? visibleBranches.filter((branch) => canonicalModuleKey(branch.module) === canonicalModuleKey(initialScope.module)
    && (!initialScope.courseId || branch.courseId === initialScope.courseId)) : [];
  // Module names repeat across terms. Never silently assign an unqualified
  // Tracker handoff to the first course with the same module name.
  const ambiguousScope = Boolean(initialScope?.module && scopedCandidates.length > 1);
  const scoped = scopedCandidates.length === 1 ? scopedCandidates[0] : undefined;
  const selectedInitial = visibleBranches.flatMap((branch) => branch.weeks)
    .find((week) => week.sets.some((set) => selectedIds.includes(set.id)));
  const initial = ambiguousScope ? undefined : scoped?.weeks.find((week) => week.week === initialScope?.week)
    ?? scoped?.weeks[0] ?? selectedInitial ?? visibleBranches[0]?.weeks[0];
  const active = visibleBranches.flatMap((branch) => branch.weeks)
    .find((week) => week.key === chosen) ?? initial;
  const branch = visibleBranches.find((item) => item.weeks.some((week) => week.key === active?.key));
  const selected = new Set(selectedIds);
  const search = query.trim().toLowerCase();
  const pool = search
    ? visibleBranches.flatMap((module) => module.weeks.flatMap((week) => week.sets.map((set) => ({ module, week, set }))))
    : active && branch ? active.sets.map((set) => ({ module: branch, week: active, set })) : [];
  const matches = pool.filter(({ set, module, week }) => {
    const state = readiness.get(set.id) ?? { stored: 0, ready: 0, reviewSuggested: 0, unresolved: 0, missing: 0 };
    return (!source || bankSource(set) === source)
      && matchesReadiness(state, readinessFilter)
      && (!search || `${set.title} ${set.tags.join(" ")} ${bankSource(set)} ${module.term} ${module.course} ${module.module} ${week.label}`.toLowerCase().includes(search));
  });
  const detail = questionSets.find((set) => set.id === openedSet);
  const availableSources = [...new Set(visibleBranches.flatMap((module) => module.weeks.flatMap((week) => week.sets.map(bankSource))))];
  const weekReadyIds = new Set(matches.flatMap(({ set }) => set.questionIds.filter((id) => {
    const question = questionsById.get(id);
    return question && questionPracticeReadiness(question) === "ready";
  })));

  function toggle(ids: string[]) {
    const next = new Set(selectedIds);
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectionChange?.([...next]);
  }

  if (detail && renderSet) return <section className="course-bank cb-focused" aria-label={detail.title}>
    <GhostButton onClick={() => setOpenedSet(undefined)}><ArrowLeft size={14} aria-hidden="true" /> Back to week</GhostButton>
    {renderSet(detail)}
  </section>;

  return <section className={`course-bank ${onSelectionChange ? "cb-picker" : ""}`} aria-label="Course question bank">
    <div className="cb-searchbar">
      <label className="cb-search"><Search size={16} aria-hidden="true" /><input type="search" name="question-set-search" autoComplete="off" aria-label="Search question sets" placeholder="Find a week, source or set" value={query}
        onChange={(event) => { setQuery(event.target.value); setLimit(12); }} /></label>
      {onSelectionChange && <span className="cb-selection" role="status">{selectedIds.length} selected</span>}
    </div>
    {branches.length > 0 && <div className="qb-academic-filters" role="group" aria-label="Academic question bank filters">
      <label>Term<select aria-label="Filter by term" value={termFilter} onChange={(event) => { setTermFilter(event.target.value); setCourseFilter(""); setChosen(undefined); setLimit(12); }}>
        <option value="">All terms</option>{termsAvailable.map((term) => <option key={term} value={term}>{term}</option>)}
      </select></label>
      <label>Course<select aria-label="Filter by course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setChosen(undefined); setLimit(12); }}>
        <option value="">All courses</option>{courseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Collection type<select aria-label="Filter by collection type" value={source} onChange={(event) => { setSource(event.target.value); setLimit(12); }}>
        <option value="">All types</option>{availableSources.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>Readiness<select aria-label="Filter by readiness" value={readinessFilter} onChange={(event) => { setReadinessFilter(event.target.value as ReadinessFilter); setLimit(12); }}>
        <option value="all">Any readiness</option><option value="ready">Ready for practice</option>
        <option value="review-suggested">Review suggested</option><option value="unresolved">Unresolved</option>
        <option value="missing">Unavailable / missing records</option>
      </select></label>
    </div>}
    {!branches.length ? <div className="cb-empty"><BookOpen size={24} aria-hidden="true" /><h2>Your course questions start here</h2><p>No saved question sets are installed. Browse available course packages or import a question file, then review its answer mappings.</p></div>
    : !visibleBranches.length ? <p className="cb-empty" role="status">No modules match the selected term and course. Change a filter to browse your other courses.</p>
    : <div className="cb-layout">
      <nav className="cb-outline" aria-label="Course outline">
        <p className="cb-outline-label">Course outline</p>
        {visibleBranches.map((item, index) => <div className="cb-branch" key={item.key}>
          {(index === 0 || visibleBranches[index - 1].term !== item.term) && <p className="cb-term">{item.term}</p>}
          {(index === 0 || visibleBranches[index - 1].course !== item.course || visibleBranches[index - 1].term !== item.term) && <p className="cb-course">{item.course}</p>}
          <button className="cb-module" aria-expanded={branch?.key === item.key} onClick={() => { setChosen(item.weeks[0]?.key); setQuery(""); setLimit(12); }}>
            <ChevronRight size={14} aria-hidden="true" className={branch?.key === item.key ? "cb-rotated" : ""} /><b>{item.module}</b><span>{item.weeks.length} weeks</span>
          </button>
          {branch?.key === item.key && <ul>{item.weeks.map((week) => <li key={week.key}><button aria-current={active?.key === week.key ? "true" : undefined}
            aria-label={`${week.label} ${week.questionIds.length}`} aria-description={`${week.ready} of ${week.questionIds.length} ready for practice`}
            onClick={() => { setChosen(week.key); setQuery(""); setLimit(12); }}><span>{week.label}</span><small>{week.ready}/{week.questionIds.length} ready</small></button></li>)}</ul>}
        </div>)}
      </nav>
      <div className="cb-content">
        {ambiguousScope && !chosen && <p className="qb-collection-warning" role="alert">Multiple courses contain {initialScope?.module}. Select the correct course or week before practicing; AXOM has not inferred a course.</p>}
        <header className="cb-week-head">
          <p className="cb-eyebrow">{search ? "Within selected academic scope" : `${branch?.term} / ${branch?.course} / ${branch?.module}`}</p>
          <h2>{search ? "Search results" : active?.label ?? "Select an academic week"}</h2>
          {search ? <p>{matches.length} matching collections</p> : <dl className="cb-week-facts" aria-label="Week question counts">
            <div><dt>Stored questions</dt><dd>{active?.questionIds.length ?? 0}</dd></div>
            <div><dt>Answered</dt><dd>{active?.attempted ?? 0}</dd></div>
            <div className="cb-ready-fact"><dt>Ready to practice</dt><dd>{active?.ready ?? 0}</dd></div>
          </dl>}
          {!search && active && <div className="cb-week-actions">
            {onPractice && <GButton variant="primary" aria-label="Practice week" aria-description={`${weekReadyIds.size} unique ready questions`} disabled={!weekReadyIds.size} onClick={() => onPractice(matches.filter(({ set }) => (readiness.get(set.id)?.ready ?? 0) > 0).map(({ set }) => set))}><Play size={14} aria-hidden="true" /> Practice week · {weekReadyIds.size} ready</GButton>}
            {onSelectionChange && <GhostButton onClick={() => toggle(active.sets.map((set) => set.id))}>{active.sets.every((set) => selected.has(set.id)) ? "Remove week" : "Add week"}</GhostButton>}
            {onSelectionChange && branch && branch.weeks.length > 1 && <GhostButton onClick={() => toggle(branch.weeks.flatMap((week) => week.sets.map((set) => set.id)))}>Toggle module</GhostButton>}
          </div>}
        </header>
        <div className="cb-list-heading"><span>{search ? "Matching collections" : "Collections"}</span><span>{matches.length} shown in scope</span></div>
        <div className="cb-set-list">
          {matches.slice(0, limit).map(({ set, module, week }) => {
            const state = readiness.get(set.id) ?? { stored: 0, ready: 0, reviewSuggested: 0, unresolved: 0, missing: 0 };
            const images = imageReferences.get(set.id) ?? 0;
            return <article className="cb-set-row" data-ready={state.ready > 0} key={set.id}>
              {onSelectionChange && <input type="checkbox" aria-label={`Include ${set.title}`} checked={selected.has(set.id)} onChange={() => toggle([set.id])} />}
              <div className="cb-set-mark" aria-hidden="true">{images ? <Images size={ICON_SIZE.control} /> : <FileText size={ICON_SIZE.control} />}</div>
              <div className="cb-set-copy"><span className="cb-set-kicker"><span className={`cb-source ${set.kind === "generated" ? "cb-generated" : ""}`}>{bankSource(set)}</span>{images > 0 && <span className="cb-image-count">{images} with image references</span>}</span>
                {renderSet ? <button className="cb-set-title" onClick={() => setOpenedSet(set.id)}>{set.title}<ArrowUpRight size={14} aria-hidden="true" /></button> : <b>{set.title}</b>}
                <small>{search ? `${module.module} / ${week.label} · ` : ""}{state.stored} stored · {state.ready} ready{state.reviewSuggested ? ` · ${state.reviewSuggested} review suggested` : ""}{state.unresolved ? ` · ${state.unresolved} unresolved` : ""}{state.missing ? ` · ${state.missing} missing` : ""}</small>
                {state.ready === 0 && <small className="qb-collection-warning" role="status">
                  {state.unresolved > 0 ? "Resolve the missing or conflicting answer evidence before practice."
                    : state.reviewSuggested > 0 ? "Review the imported answer evidence before practice."
                    : state.missing > 0 ? "Question records are unavailable on this device; restore or re-import this source."
                    : "This collection has no saved questions available for practice."}
                </small>}
              </div>
              {onPractice && <GhostButton className="cb-practice-set" aria-label={`Practice ${set.title}`} disabled={!state.ready} onClick={() => onPractice([set])}><Play size={ICON_SIZE.body} aria-hidden="true" /><span>Practice</span></GhostButton>}
              {!onSelectionChange && (state.reviewSuggested > 0 || state.unresolved > 0 || state.missing > 0) && (
                <div className="qb-collection-recovery" aria-label={`Resolve ${set.title}`}>
                  {state.reviewSuggested > 0 && onReviewQuestionIds && <GhostButton
                    aria-label={`Review suggested mappings for ${set.title}`}
                    onClick={() => onReviewQuestionIds([...new Set(set.questionIds.filter((id) => {
                      const candidate = questionsById.get(id);
                      return candidate && questionPracticeReadiness(candidate) === "review-suggested";
                    }))])}>Review suggested · {state.reviewSuggested}</GhostButton>}
                  {state.unresolved > 0 && onReviewQuestionIds && <GhostButton
                    aria-label={`Resolve unresolved questions for ${set.title}`}
                    onClick={() => onReviewQuestionIds([...new Set(set.questionIds.filter((id) => {
                      const candidate = questionsById.get(id);
                      return candidate && questionPracticeReadiness(candidate) === "unresolved";
                    }))])}>Resolve unresolved · {state.unresolved}</GhostButton>}
                  {state.missing > 0 && onRestoreMissing && <GhostButton
                    aria-label={`Import missing source for ${set.title}`}
                    onClick={onRestoreMissing}>Import missing source</GhostButton>}
                </div>
              )}
            </article>;
          })}
          {!matches.length && <p className="cb-empty" role="status">{ambiguousScope && !chosen ? "Choose the correct course in the outline or filters to resolve the ambiguous module." : "No collections match this week or the active filters. Try another type, readiness, or search."}</p>}
        </div>
        {matches.length > limit && <GhostButton onClick={() => setLimit((value) => value + 12)}>Show 12 more ({matches.length - limit} remaining)</GhostButton>}
      </div>
    </div>}
  </section>;
}
