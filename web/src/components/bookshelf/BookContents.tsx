// What is inside an open book. Two kinds: a course (modules, weeks, the
// activities of each week) and a question bank (weeks, the sets filed under
// each, what can be practised). Both show what the workspace really holds and
// change nothing until the learner presses the one button that does.
import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, FolderInput, Play } from "lucide-react";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import { planCourseLoad, type SaveOutcome } from "../../lib/bookshelf/loadCourse";
import { COLLECTION_STATUS_LABEL, practiceSelection, type PracticeSelection, type QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { ICON_SIZE } from "../../lib/iconSize";
import type { Course, Term } from "../../lib/types";
import { GButton } from "../ui/primitives";

export function BookPages({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="book-pages">
      <section className="book-page" aria-label="Overview">{left}</section>
      <section className="book-page" aria-label="Contents">{right}</section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="book-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const SAVE_TEXT: Record<SaveOutcome["status"], string> = {
  "saved-on-device": "Saved on this device. A backup or sync is a separate step and has not been run.",
  "nothing-to-save": "Already in your Course Tracker. Nothing was changed.",
  failed: "",
};

export interface CourseBookContentProps {
  book: CourseBook;
  /** The workspace as it is now, to say exactly what loading would add. */
  workspace: { terms: readonly Term[]; courses: readonly Course[] };
  /** Writes the book's module into Course Tracker. Resolves once it is on the device, or says why not. */
  onLoad: (book: CourseBook) => Promise<SaveOutcome>;
  /** Opens the module in Course Tracker, when it is there. */
  onOpen?: (book: CourseBook) => void;
  /** Lets the learner pick a course template file to fill the module. */
  onChooseTemplate?: (book: CourseBook) => void;
}

export function CourseBookContent({ book, workspace, onLoad, onOpen, onChooseTemplate }: CourseBookContentProps) {
  const plan = useMemo(() => planCourseLoad(workspace, book), [workspace, book]);
  const [outcome, setOutcome] = useState<SaveOutcome | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    setSaving(true);
    setOutcome(await onLoad(book));
    setSaving(false);
  };
  const total = book.weeks.reduce((sum, week) => sum + week.total, 0) + book.unfiled;
  return (
    <BookPages
      left={
        <>
          <h3>Course</h3>
          <dl className="book-facts">
            <Fact label="Module" value={book.module} />
            <Fact label="Term" value={book.term} />
            <Fact label="Weeks" value={book.weeks.length} />
            <Fact label="Activities" value={total} />
          </dl>
          {book.courseCode && <p>{book.courseCode}{book.courseName ? `: ${book.courseName}` : ""}</p>}
          {total > 0
            ? <p>{book.done} of {total} done so far. Opening this book changes nothing.</p>
            : <p className="book-note" data-tone="plain">{book.origin === "curriculum" ? "This module is in the school's course map. Nothing is loaded for it yet, so the book is empty." : "This module is in your Course Tracker with no activities yet."}</p>}
          <p className="book-note" data-tone={plan.alreadyPresent ? "plain" : undefined}>{plan.summary}</p>
          <div className="book-actions">
            {!plan.alreadyPresent && (
              <GButton variant="primary" onClick={load} disabled={saving} data-testid="load-course">
                <FolderInput size={ICON_SIZE.emphasis} aria-hidden="true" /> {saving ? "Saving" : "Load course"}
              </GButton>
            )}
            {plan.alreadyPresent && onOpen && (
              <GButton variant="primary" onClick={() => onOpen(book)}><BookOpen size={ICON_SIZE.emphasis} aria-hidden="true" /> Open in Course Tracker</GButton>
            )}
            {onChooseTemplate && <GButton onClick={() => onChooseTemplate(book)}>Choose a template file</GButton>}
          </div>
          <p role="status" aria-live="polite" className={outcome ? "book-note" : undefined} data-tone={outcome?.status === "failed" ? "bad" : outcome ? "good" : undefined} style={{ marginTop: 12 }}>
            {outcome?.status === "failed" ? `Not saved. ${outcome.message}` : outcome ? SAVE_TEXT[outcome.status] : ""}
          </p>
        </>
      }
      right={
        <>
          <h3>Weeks</h3>
          {book.weeks.length === 0 && <p>No weeks yet. A course template file adds the lectures, DLAs, small groups and question sets of each week.</p>}
          <ul className="book-list">
            {book.weeks.map((week) => (
              <li key={week.week} className="book-row">
                <div className="book-row-main">
                  <span className="book-row-text">
                    <span className="book-row-title">Week {week.week}</span>
                    <span className="book-row-meta">{week.activities.map((activity) => activity.label).join(", ") || "Nothing filed"}</span>
                  </span>
                  <span className="book-status">{week.done} of {week.total} done</span>
                </div>
                {week.items.length > 0 && (
                  <details>
                    <summary>Show what is in week {week.week}</summary>
                    <ul>
                      {week.items.slice(0, 40).map((item) => <li key={item.id}>{item.kind}: {item.label}</li>)}
                      {week.items.length > 40 && <li>and {week.items.length - 40} more</li>}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {book.unfiled > 0 && <p className="book-note" data-tone="plain">{book.unfiled} more {book.unfiled === 1 ? "row is" : "rows are"} filed under this module but under no week.</p>}
        </>
      }
    />
  );
}

export interface QuestionBankBookContentProps {
  book: QuestionBankBook;
  /** Starts a practice block from the chosen sets. */
  onPractice?: (selection: PracticeSelection) => void;
  /** Opens the module's bank in the Question Bank. */
  onOpenBank?: (book: QuestionBankBook, week?: number) => void;
}

export function QuestionBankBookContent({ book, onPractice, onOpenBank }: QuestionBankBookContentProps) {
  const [weekIndex, setWeekIndex] = useState(0);
  const week = book.weeks[Math.min(weekIndex, book.weeks.length - 1)];
  const practisable = useMemo(() => (week?.collections ?? []).filter((collection) => collection.setId && collection.ready > 0), [week]);
  const [chosen, setChosen] = useState<readonly string[] | undefined>(undefined);
  const chosenIds = chosen ?? practisable.map((collection) => collection.id);
  const readyChosen = new Set(practisable.filter((collection) => chosenIds.includes(collection.id)).flatMap((collection) => collection.readyQuestionIds ?? [])).size;
  const [wanted, setWanted] = useState(20);
  const selection = week ? practiceSelection(book, week, chosenIds, wanted) : undefined;
  const waiting = book.weeks.flatMap((entry) => entry.collections).filter((collection) => collection.questions === 0);
  return (
    <BookPages
      left={
        <>
          <h3>Question bank</h3>
          <dl className="book-facts">
            <Fact label="Questions" value={book.count} />
            <Fact label="Ready to practise" value={book.ready} />
            <Fact label="Answered" value={book.attempted} />
            <Fact label="Weeks" value={book.weeks.filter((entry) => entry.week !== undefined).length} />
          </dl>
          <p>{[book.term, book.courseCode, book.module].filter(Boolean).join(" · ")}</p>
          {waiting.length > 0 && (
            <p className="book-note" data-tone="plain">
              {waiting.length} {waiting.length === 1 ? "bank is" : "banks are"} known for this module and not on this device yet. {waiting.length === 1 ? "It adds" : "They add"} nothing to the count above until {waiting.length === 1 ? "it is" : "they are"} imported and checked.
            </p>
          )}
          <p className="book-note" data-tone="plain">Pictures of imported questions are stored on this device. Sync carries the questions, not the picture files.</p>
        </>
      }
      right={
        week ? (
          <>
            <h3>Weeks</h3>
            <div className="book-segments" role="group" aria-label="Week">
              {book.weeks.map((entry, index) => (
                <button key={entry.label} type="button" className="book-segment" aria-pressed={index === weekIndex} onClick={() => { setWeekIndex(index); setChosen(undefined); }}>
                  {entry.label} · {entry.questions}
                </button>
              ))}
            </div>
            <ul className="book-list">
              {week.collections.map((collection) => {
                const selectable = Boolean(collection.setId && collection.ready > 0);
                return (
                  <li key={collection.id} className="book-row">
                    <label className="book-row-main">
                      <input
                        type="checkbox"
                        checked={selectable && chosenIds.includes(collection.id)}
                        disabled={!selectable}
                        onChange={(event) => setChosen(event.target.checked ? [...chosenIds, collection.id] : chosenIds.filter((id) => id !== collection.id))}
                        aria-label={`Practise from ${collection.title}`}
                      />
                      <span className="book-row-text">
                        <span className="book-row-title">{collection.title}</span>
                        <span className="book-row-meta">
                          {collection.source} · {collection.questions} {collection.questions === 1 ? "question" : "questions"}{collection.questions > 0 ? `, ${collection.ready} ready` : ""}
                          {collection.declared ? ` · package: ${collection.declared.questions} questions, ${collection.declared.tables} tables, ${collection.declared.images} images` : ""}
                        </span>
                        {collection.note && <span className="book-row-meta">{collection.note}</span>}
                      </span>
                      <span className="book-status" data-status={collection.status}>{COLLECTION_STATUS_LABEL[collection.status]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="book-actions">
              <label className="book-count">
                Questions
                <input type="number" min={1} max={Math.max(1, readyChosen)} value={Math.min(wanted, Math.max(1, readyChosen))} onChange={(event) => setWanted(Number(event.target.value))} disabled={readyChosen === 0} />
                <span>of {readyChosen} ready</span>
              </label>
              {onPractice && (
                <GButton variant="primary" disabled={!selection || selection.count === 0} onClick={() => selection && onPractice(selection)} data-testid="start-practice">
                  <Play size={ICON_SIZE.emphasis} aria-hidden="true" /> Start practice
                </GButton>
              )}
              {onOpenBank && <GButton onClick={() => onOpenBank(book, week.week)}>Open bank</GButton>}
            </div>
            {readyChosen === 0 && <p className="book-note" data-tone="plain" style={{ marginTop: 12 }}>Nothing in this week can be practised yet.</p>}
          </>
        ) : <p>No questions are filed under this module yet.</p>
      }
    />
  );
}
