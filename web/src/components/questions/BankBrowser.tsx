// ===========================================================================
// Bank Browser (Q2b-3) — a professional question library: composable filters
// (tags, difficulty, state, source, course, attachment/notes), debounced
// search, saved filter presets, live counts, deterministic ordering, durable
// multi-select that survives filtering/pagination/reload (sessionStorage), fast
// bulk tagging, tag management, and one-click creation of an immutable,
// deterministically-ordered question set from the current filter.
// ===========================================================================
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Search, SquareCheck, Square, Tags, ListPlus, Bookmark, X, Save, Pencil, RefreshCw,
} from "lucide-react";
import { useStore } from "../../lib/store";
import {
  filterForMode, MODE_META, QUESTION_CATEGORIES, QUESTION_MAPPING_STATUS_LABEL,
  type QuestionMode, type QuestionRecord, type QuestionDifficulty, type QuestionSource,
} from "../../lib/questions";
import {
  applyQuestionFilter, countActiveFilters, emptyQuestionFilter, normalizeQuestionFilter, questionPracticeReadiness,
  type QuestionFilterCriteria,
} from "../../lib/questionFilters";
import { computeTagCounts, parseTagInput } from "../../lib/questionTags";
import {
  orderQuestions, ORDERING_LABEL, QUESTION_ORDERINGS, makeOrderingSeed, type QuestionOrdering,
} from "../../lib/questionOrdering";
import type { Course } from "../../lib/types";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { CreateQuestionSetDialog } from "./CreateQuestionSetDialog";
import { QuestionTagManager } from "./QuestionTagManager";
import { pushToast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";

const MODES = Object.keys(MODE_META) as QuestionMode[];
const NO_QUESTIONS: QuestionRecord[] = [];
const NO_COURSES: Course[] = [];
const PAGE = 100;
const SELECTION_KEY = "axom.bank.selection.v1";
const DIFFICULTIES: QuestionDifficulty[] = ["easy", "medium", "hard"];
const SOURCE_LABEL: Record<QuestionSource, string> = {
  pasted: "Pasted", screenshot: "Screenshot", image: "Image", pdf: "PDF", imported: "Imported", manual: "Manual", "ai-generated": "AI-generated",
};

function readStoredSelection(): Set<string> {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SELECTION_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    }
  } catch { /* ignore corrupt selection */ }
  return new Set();
}

export function BankBrowser({
  onOpen,
  initialMode = "all",
  questionIds,
}: {
  onOpen: (q: QuestionRecord) => void;
  initialMode?: QuestionMode | "all";
  questionIds?: readonly string[];
}) {
  const s = useStore();
  const allQuestions = s.questions ?? NO_QUESTIONS;
  const courses = s.courses ?? NO_COURSES;
  const savedFilters = s.savedQuestionFilters ?? [];

  const questions = useMemo(() => {
    if (!questionIds) return allQuestions;
    const allowed = new Set(questionIds);
    return allQuestions.filter((question) => allowed.has(question.id));
  }, [allQuestions, questionIds]);

  const [mode, setMode] = useState<QuestionMode | "all">(initialMode);
  const [criteria, setCriteria] = useState<QuestionFilterCriteria>(() => emptyQuestionFilter());
  const [searchInput, setSearchInput] = useState("");
  const [ordering, setOrdering] = useState<QuestionOrdering>("import");
  const [seed, setSeed] = useState(() => makeOrderingSeed());
  const [selected, setSelected] = useState<Set<string>>(readStoredSelection);
  const [limit, setLimit] = useState(PAGE);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkTagOp, setBulkTagOp] = useState<"add" | "remove" | "replace">("add");
  const [bulkCategory, setBulkCategory] = useState("");
  const [showTagManager, setShowTagManager] = useState(false);
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Debounce free-text search into the criteria so typing never re-scans per key.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setCriteria((prev) => {
        const next = searchInput.trim();
        if ((prev.search ?? "") === next) return prev;
        const copy = { ...prev };
        if (next) copy.search = next; else delete copy.search;
        return copy;
      });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Prune stale ids (restored or mid-session deletions) so counts never overstate.
  useEffect(() => {
    const ids = new Set(allQuestions.map((question) => question.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allQuestions]);

  // Selection survives reload within the tab (kept out of localStorage/workspace).
  useEffect(() => {
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...selected])); } catch { /* quota/full — non-fatal */ }
  }, [selected]);

  const tagCounts = useMemo(() => computeTagCounts(questions), [questions]);
  const presentSources = useMemo(() => {
    const set = new Set<QuestionSource>();
    for (const question of questions) set.add(question.source);
    return [...set].sort();
  }, [questions]);
  const presentCourses = useMemo(() => {
    const ids = new Set<string>();
    for (const question of questions) if (question.courseId) ids.add(question.courseId);
    return courses.filter((course) => ids.has(course.id));
  }, [questions, courses]);

  // Mode-pill counts are one memoized pass over the bank, not 11 per render.
  const modeCounts = useMemo(() => new Map(MODES.map((m) => [m, filterForMode(questions, m).length])), [questions]);
  const modeScoped = useMemo(() => (mode === "all" ? questions : filterForMode(questions, mode)), [questions, mode]);
  const filtered = useMemo(() => applyQuestionFilter(modeScoped, criteria), [modeScoped, criteria]);
  const ordered = useMemo(() => orderQuestions(filtered, ordering, seed), [filtered, ordering, seed]);
  const visible = ordered.slice(0, limit);
  const activeFilters = countActiveFilters(criteria);

  // Reset pagination when the result set is redefined.
  useEffect(() => { setLimit(PAGE); }, [criteria, mode, ordering, seed]);

  const allVisibleSelected = visible.length > 0 && visible.every((q) => selected.has(q.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set([...prev].filter((id) => !visible.some((q) => q.id === id)));
      const next = new Set(prev);
      for (const q of visible) next.add(q.id);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected(new Set(ordered.map((q) => q.id)));
  }
  function clearSelection() { setSelected(new Set()); }

  // --- criteria mutators ------------------------------------------------------
  function patchCriteria(patch: (draft: QuestionFilterCriteria) => void) {
    setActivePresetId(null);
    setCriteria((prev) => {
      const draft = { ...prev };
      patch(draft);
      return draft;
    });
  }
  function toggleTag(tag: string) {
    patchCriteria((draft) => {
      const current = new Set(draft.tags ?? []);
      if (current.has(tag)) current.delete(tag); else current.add(tag);
      if (current.size) { draft.tags = [...current]; draft.tagMatch = draft.tagMatch ?? "all"; }
      else { delete draft.tags; delete draft.tagMatch; }
    });
  }
  function toggleDifficulty(value: QuestionDifficulty) {
    patchCriteria((draft) => {
      const current = new Set(draft.difficulty ?? []);
      if (current.has(value)) current.delete(value); else current.add(value);
      if (current.size) draft.difficulty = [...current]; else delete draft.difficulty;
    });
  }
  function toggleBool(key: "bookmarked" | "incorrect" | "reviewDue" | "hasAttachment" | "hasNotes") {
    patchCriteria((draft) => { if (draft[key]) delete draft[key]; else draft[key] = true; });
  }
  function setAnswered(value: "any" | "answered" | "unanswered") {
    patchCriteria((draft) => {
      if (value === "any") delete draft.answered;
      else draft.answered = value === "answered";
    });
  }
  function clearAllFilters() {
    setActivePresetId(null);
    setCriteria(emptyQuestionFilter());
    setSearchInput("");
  }

  // Flush the debounced search box into the criteria so saved presets / created
  // sets never lag a keystroke behind what the count line showed.
  function resolveCriteria(): QuestionFilterCriteria {
    const next = searchInput.trim();
    if ((criteria.search ?? "") === next) return criteria;
    const copy = { ...criteria };
    if (next) copy.search = next; else delete copy.search;
    return copy;
  }

  function applyPreset(id: string) {
    const preset = savedFilters.find((filter) => filter.id === id);
    if (!preset) return;
    const normalized = normalizeQuestionFilter(preset.criteria);
    setCriteria(normalized);
    setSearchInput(normalized.search ?? "");
    if (preset.ordering) setOrdering(preset.ordering);
    setActivePresetId(id);
  }
  function saveCurrentFilter() {
    if (activeFilters === 0) return;
    const name = typeof window !== "undefined" ? window.prompt("Name this filter preset:") : "Saved filter";
    if (!name || !name.trim()) return;
    const id = s.addSavedQuestionFilter({ name: name.trim(), criteria: resolveCriteria(), ordering });
    setActivePresetId(id);
    pushToast({ title: `Saved "${name.trim()}"`, tone: "success" });
  }
  function renamePreset(id: string, current: string) {
    const name = typeof window !== "undefined" ? window.prompt("Rename filter preset:", current) : null;
    if (!name || !name.trim()) return;
    s.updateSavedQuestionFilter(id, { name: name.trim() });
  }
  function updateActivePreset() {
    if (!activePresetId) return;
    s.updateSavedQuestionFilter(activePresetId, { criteria: resolveCriteria(), ordering });
    pushToast({ title: "Preset updated", tone: "success" });
  }

  // --- bulk tagging -----------------------------------------------------------
  function applyBulkTags() {
    const ids = [...selected];
    const tags = parseTagInput(bulkTagInput);
    if (!ids.length || !tags.length) return;
    if (bulkTagOp === "add") s.bulkTagQuestions(ids, { add: tags });
    else if (bulkTagOp === "remove") s.bulkTagQuestions(ids, { remove: tags });
    else s.bulkTagQuestions(ids, { replace: tags });
    pushToast({ title: `${bulkTagOp === "add" ? "Tagged" : bulkTagOp === "remove" ? "Untagged" : "Retagged"} ${ids.length} question${ids.length === 1 ? "" : "s"}`, tone: "success" });
    setBulkTagInput("");
  }
  function clearBulkTags() {
    const ids = [...selected];
    if (!ids.length) return;
    s.bulkTagQuestions(ids, { clear: true });
    pushToast({ title: `Cleared tags on ${ids.length} question${ids.length === 1 ? "" : "s"}`, tone: "success" });
  }
  function applyBulkCategory() {
    const ids = [...selected];
    if (!ids.length || !bulkCategory) return;
    s.bulkUpdateQuestions(ids, { category: bulkCategory });
    pushToast({ title: `Set category on ${ids.length} question${ids.length === 1 ? "" : "s"}`, tone: "success" });
    setBulkCategory("");
  }

  function createSet(input: { title: string; ordering: QuestionOrdering; seed: string }) {
    // Snapshot exactly the on-screen pool: restrict to the mode/questionIds-scoped
    // ids and record the (search-flushed) criteria for provenance.
    const effective = resolveCriteria();
    const scopeIds = modeScoped.map((q) => q.id);
    const count = applyQuestionFilter(modeScoped, effective).length;
    s.createQuestionSetFromFilter({ title: input.title, criteria: effective, ordering: input.ordering, seed: input.seed, scopeIds });
    setShowCreateSet(false);
    pushToast({ title: `Created "${input.title}" (${count})`, tone: "success" });
  }

  const totalLabel = questions.length.toLocaleString();
  const filteredLabel = filtered.length.toLocaleString();

  return (
    <GlassCard>
      <PanelHeader
        title="Question library"
        sub={mode === "mapping-review"
          ? "Review unresolved and suggested answer mappings. Open a question to confirm its correct answer."
          : "Filter, organize with tags, and snapshot deterministic study sets."}
        action={
          <div className="row" style={{ gap: 6 }}>
            <GhostButton onClick={() => setShowTagManager(true)}><Tags size={ICON_SIZE.body} /> Manage tags</GhostButton>
            <GButton size="sm" variant="primary" disabled={filtered.length === 0} onClick={() => setShowCreateSet(true)}>
              <ListPlus size={ICON_SIZE.body} /> Create set
            </GButton>
          </div>
        }
      />

      {/* Live counts — always obvious what you are about to study. */}
      <div className="qb-count-line" role="status" aria-live="polite">
        <span><b>{totalLabel}</b> question{questions.length === 1 ? "" : "s"}</span>
        <span aria-hidden="true">→</span>
        <span className="qb-count-filtered"><b>{filteredLabel}</b> filtered</span>
        {activeFilters > 0 && <button className="qb-count-clear" onClick={clearAllFilters}>Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}</button>}
      </div>

      {/* Saved presets */}
      {(savedFilters.length > 0 || activeFilters > 0) && (
        <div className="qb-preset-bar" aria-label="Saved filter presets">
          {savedFilters.map((preset) => (
            <span key={preset.id} className={`qb-preset ${activePresetId === preset.id ? "on" : ""}`}>
              <button className="qb-preset-apply" onClick={() => applyPreset(preset.id)} aria-pressed={activePresetId === preset.id}>{preset.name}</button>
              <button className="qb-preset-icon" aria-label={`Rename preset ${preset.name}`} onClick={() => renamePreset(preset.id, preset.name)}><Pencil size={ICON_SIZE.microInline} /></button>
              <button className="qb-preset-icon" aria-label={`Delete preset ${preset.name}`} onClick={() => s.removeSavedQuestionFilter(preset.id)}><X size={ICON_SIZE.microInline} /></button>
            </span>
          ))}
          {activePresetId && <GhostButton onClick={updateActivePreset}><RefreshCw size={ICON_SIZE.microInline} /> Update</GhostButton>}
          {activeFilters > 0 && <GhostButton onClick={saveCurrentFilter}><Save size={ICON_SIZE.microInline} /> Save filter</GhostButton>}
        </div>
      )}

      {/* Search + ordering */}
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div className="row grow" style={{ gap: 6, minWidth: 220 }}>
          <Search size={ICON_SIZE.body} className="dim" />
          <input className="field grow" placeholder="Search stems, options, tags, notes, source…" aria-label="Search question bank"
            value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setActivePresetId(null); }} />
          {searchInput && <GhostButton className="icon-only" aria-label="Clear search" onClick={() => setSearchInput("")}><X size={ICON_SIZE.body} /></GhostButton>}
        </div>
        <label className="row" style={{ gap: 6 }}>
          <span className="field-label" style={{ whiteSpace: "nowrap" }}>Order</span>
          <select className="field" style={{ width: "auto" }} aria-label="Order questions by" value={ordering} onChange={(e) => { setOrdering(e.target.value as QuestionOrdering); setActivePresetId(null); }}>
            {QUESTION_ORDERINGS.map((option) => <option key={option} value={option}>{ORDERING_LABEL[option]}</option>)}
          </select>
        </label>
        {ordering === "random" && (
          <GhostButton onClick={() => setSeed(makeOrderingSeed())} aria-label="Reshuffle with a new seed"><RefreshCw size={ICON_SIZE.body} /> Reshuffle</GhostButton>
        )}
      </div>

      {/* Facet toggles */}
      <div className="qb-facets" aria-label="Filters">
        <div className="qb-facet-group" role="group" aria-label="State">
          <FacetChip label="Unanswered" active={criteria.answered === false} onClick={() => setAnswered(criteria.answered === false ? "any" : "unanswered")} />
          <FacetChip label="Answered" active={criteria.answered === true} onClick={() => setAnswered(criteria.answered === true ? "any" : "answered")} />
          <FacetChip label="Incorrect" active={!!criteria.incorrect} onClick={() => toggleBool("incorrect")} />
          <FacetChip label="Bookmarked" icon={<Bookmark size={ICON_SIZE.microInline} />} active={!!criteria.bookmarked} onClick={() => toggleBool("bookmarked")} />
          <FacetChip label="Review due" active={!!criteria.reviewDue} onClick={() => toggleBool("reviewDue")} />
          <FacetChip label="Has image" active={!!criteria.hasAttachment} onClick={() => toggleBool("hasAttachment")} />
          <FacetChip label="Has notes" active={!!criteria.hasNotes} onClick={() => toggleBool("hasNotes")} />
        </div>
        <div className="qb-facet-group" role="group" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <FacetChip key={d} label={d} active={!!criteria.difficulty?.includes(d)} onClick={() => toggleDifficulty(d)} />
          ))}
        </div>
        <div className="qb-facet-group" style={{ gap: 6 }}>
          {presentSources.length > 0 && (
            <select className="field" style={{ width: "auto" }} aria-label="Filter by source"
              value={criteria.sources?.[0] ?? ""} onChange={(e) => patchCriteria((d) => { if (e.target.value) d.sources = [e.target.value as QuestionSource]; else delete d.sources; })}>
              <option value="">Any source</option>
              {presentSources.map((source) => <option key={source} value={source}>{SOURCE_LABEL[source]}</option>)}
            </select>
          )}
          <select className="field" style={{ width: "auto" }} aria-label="Filter by answer readiness"
            value={criteria.readiness ?? ""} onChange={(e) => patchCriteria((draft) => { if (e.target.value) draft.readiness = e.target.value as NonNullable<QuestionFilterCriteria["readiness"]>; else delete draft.readiness; })}>
            <option value="">Any answer readiness</option>
            <option value="ready">Ready for practice</option>
            <option value="review">Review required</option>
            <option value="review-suggested">Suggested evidence review</option>
            <option value="unresolved">Missing / unresolved evidence</option>
          </select>
          {presentCourses.length > 0 && (
            <select className="field" style={{ width: "auto" }} aria-label="Filter by course"
              value={criteria.courseId ?? ""} onChange={(e) => patchCriteria((d) => { if (e.target.value) d.courseId = e.target.value; else delete d.courseId; })}>
              <option value="">Any course</option>
              {presentCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Tag chips */}
      {tagCounts.length > 0 && (
        <div className="qb-tag-filter" role="group" aria-label="Filter by tags">
          {(criteria.tags?.length ?? 0) > 1 && (
            <button className="qb-tagmatch" onClick={() => patchCriteria((d) => { d.tagMatch = d.tagMatch === "any" ? "all" : "any"; })}>
              match {criteria.tagMatch === "any" ? "ANY" : "ALL"}
            </button>
          )}
          {tagCounts.slice(0, 40).map((entry) => {
            const on = criteria.tags?.includes(entry.tag) ?? false;
            return (
              <button key={entry.tag} className={`qb-tag-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleTag(entry.tag)}>
                {entry.tag} <span className="qb-tag-chip-count">{entry.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mode pills (mapping review + attempt-state coarse filters) */}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "10px 0 12px" }}>
        <button className={`filter-pill ${mode === "all" ? "on" : ""}`} onClick={() => setMode("all")}>All ({questions.length})</button>
        {MODES.map((m) => {
          const meta = MODE_META[m];
          const count = modeCounts.get(m) ?? 0;
          return (
            <button key={m} className={`filter-pill ${mode === m ? "on" : ""}`} disabled={!meta.ready} title={meta.note}
              onClick={() => meta.ready && setMode(m)}>
              {meta.label}{meta.ready ? ` (${count})` : " · soon"}
            </button>
          );
        })}
      </div>

      {/* Selection + bulk toolbar */}
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <GhostButton onClick={selectVisible}>
          {allVisibleSelected ? <SquareCheck size={ICON_SIZE.body} /> : <Square size={ICON_SIZE.body} />} {allVisibleSelected ? "Deselect shown" : "Select shown"}
        </GhostButton>
        {ordered.length > visible.length && <GhostButton onClick={selectAllFiltered}>Select all {filteredLabel}</GhostButton>}
      </div>

      {selected.size > 0 && (
        <div className="qb-bulk-toolbar" role="region" aria-label={`Bulk actions for ${selected.size} selected questions`}>
          <span className="qb-bulk-count" role="status" aria-live="polite"><SquareCheck size={ICON_SIZE.microInline} /> {selected.size} selected</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <select className="field" style={{ width: "auto" }} aria-label="Tag operation" value={bulkTagOp} onChange={(e) => setBulkTagOp(e.target.value as typeof bulkTagOp)}>
              <option value="add">Add tags</option>
              <option value="remove">Remove tags</option>
              <option value="replace">Replace tags</option>
            </select>
            <input className="field" style={{ minWidth: 180 }} placeholder="tags (comma-separated)" aria-label="Tags to apply"
              value={bulkTagInput} onChange={(e) => setBulkTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyBulkTags(); }} />
            <GButton size="sm" variant="primary" disabled={!bulkTagInput.trim()} onClick={applyBulkTags}>Apply</GButton>
            <GhostButton onClick={clearBulkTags}>Clear tags</GhostButton>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <select className="field" style={{ width: "auto" }} aria-label="Set category" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
              <option value="">Set category…</option>
              {QUESTION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <GButton size="sm" disabled={!bulkCategory} onClick={applyBulkCategory}>Set</GButton>
            <GhostButton onClick={clearSelection}>Deselect all</GhostButton>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={questions.length === 0 ? "No questions yet" : "Nothing matches"}
          hint={questions.length === 0
            ? "Import questions in the Import Center — misses become review items and repair cards."
            : "Adjust the search or filters, or clear them to see the whole bank."}
        />
      ) : (
        <div className="stack gap6">
          {visible.map((q, rowIndex) => (
            <div key={q.id} className={`question-row ${selected.has(q.id) ? "selected" : ""}`}>
              <button
                className="qrow-check"
                aria-label={`${selected.has(q.id) ? "Deselect" : "Select"} question ${rowIndex + 1}: ${questionSelectionLabel(q.stem)}`}
                aria-pressed={selected.has(q.id)}
                onClick={() => toggle(q.id)}
              >
                {selected.has(q.id) ? <SquareCheck size={ICON_SIZE.body} /> : <Square size={ICON_SIZE.body} className="dim" />}
              </button>
              <button className="grow truncate qrow-open" onClick={() => onOpen(q)}>{q.stem}</button>
              {q.tags.slice(0, 3).map((tag) => <Tag key={tag} tone="neutral">{tag}</Tag>)}
              {(() => {
                const mappingStatus = questionPracticeReadiness(q);
                return mappingStatus === "ready"
                  ? null
                  : <Tag tone={mappingStatus === "unresolved" ? "red" : "orange"}>{QUESTION_MAPPING_STATUS_LABEL[mappingStatus]}</Tag>;
              })()}
              {q.marked && <Tag tone="purple">marked</Tag>}
              {q.difficulty && <Tag tone="neutral">{q.difficulty}</Tag>}
              <Tag tone={q.status === "correct" ? "green" : q.status === "incorrect" ? "red" : q.status === "unseen" ? "cyan" : "orange"}>
                {q.status}
              </Tag>
            </div>
          ))}
          {ordered.length > visible.length && (
            <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 4 }}>
              <span className="sub">Showing {visible.length.toLocaleString()} of {filteredLabel}.</span>
              <GhostButton onClick={() => setLimit((prev) => prev + PAGE)}>Show more</GhostButton>
            </div>
          )}
        </div>
      )}

      {/* Tag ops are bank-wide, so counts must be bank-wide too (not mode/id-scoped). */}
      {showTagManager && <QuestionTagManager questions={allQuestions} onClose={() => setShowTagManager(false)} />}
      {showCreateSet && (
        <CreateQuestionSetDialog
          count={filtered.length}
          defaultOrdering={ordering}
          defaultSeed={seed}
          onCreate={createSet}
          onClose={() => setShowCreateSet(false)}
        />
      )}
    </GlassCard>
  );
}

function FacetChip({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button type="button" className={`qb-facet-chip ${active ? "on" : ""}`} aria-pressed={active} onClick={onClick}>
      {icon}{label}
    </button>
  );
}

function questionSelectionLabel(stem: string): string {
  const clean = stem.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}
