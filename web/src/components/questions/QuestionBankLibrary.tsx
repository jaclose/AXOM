import { AccountContentDownloads } from "../bookshelf/AccountContentDownloads";
import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { bankSource } from "../../lib/course-engine/questionBank";
import { buildShelves } from "../../lib/bookshelf/model";
import { buildQuestionBankBooks, type PracticeSelection, type QuestionBankBook, type KnownPackage } from "../../lib/bookshelf/questionBankBooks";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import { AcademicBookshelf } from "../bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../bookshelf/AcademicLibrary";
import { QuestionBankBookContent } from "../bookshelf/BookContents";
import { knownBankManifests } from "../../lib/question-content/knownBanks";
import { PreparedLibrary } from "../bookshelf/PreparedLibrary";
import { AcademicBankDiscovery } from "../bookshelf/AcademicBankDiscovery";

const packages: KnownPackage[] = knownBankManifests.map((manifest) => ({ manifest, hasSource: false }));
export function QuestionBankLibrary({ onPractice, onOpenBank, onImport, onCreate, heldForReview }: {
  onPractice: (selection: PracticeSelection) => void;
  onOpenBank: (book: QuestionBankBook, week?: number) => void;
  onImport: () => void;
  onCreate: () => void;
  heldForReview: number;
}) {
  const s = useStore();
  const questions = useMemo(() => s.questions ?? [], [s.questions]);
  const sets = useMemo(() => s.questionSets ?? [], [s.questionSets]);
  const shelves = useMemo(() => buildShelves(buildQuestionBankBooks({ terms: s.terms, courses: s.courses,
    sets, questions, packages, curricula: CURRICULA, sourceOf: bankSource })),
  [s.terms, s.courses, sets, questions]);
  const ready = useMemo(() => questions.filter((question) => questionPracticeReadiness(question) === "ready").length, [questions]);
  const localBookCount = shelves.reduce((count, shelf) => count + shelf.books.filter((book) => book.count > 0).length, 0);
  const [catalogOpen, setCatalogOpen] = useState(questions.length === 0 && sets.length === 0);

  return <section className="qb-library-workspace" aria-labelledby="qb-library-title">
    <header className="qb-library-intro">
      <div>
        <span className="qb-eyebrow">Course-first practice</span>
        <h2 id="qb-library-title">Choose a course, open a set, start.</h2>
        <p>{ready + heldForReview > 0
          ? `${ready} ready to practice · ${heldForReview} held for answer or source review.`
          : "Start with a course collection, or add material you already trust."}</p>
      </div>
      <ol className="qb-study-route" aria-label="How to start a practice set">
        <li><span>1</span><b>Course</b></li>
        <li><span>2</span><b>Question set</b></li>
        <li><span>3</span><b>Practice</b></li>
      </ol>
    </header>
    <AccountContentDownloads />
    <AcademicLibrary title="Your collection" subtitle={`${localBookCount} course ${localBookCount === 1 ? "collection" : "collections"} on this device · ${sets.length} saved ${sets.length === 1 ? "set" : "sets"}.`}
      onChooseFile={onImport} onCreate={onCreate} createHint="Build a reusable practice block from your saved questions."
      browse={<AcademicBookshelf label="Question bank library" shelves={shelves}
        renderBook={(book) => <QuestionBankBookContent book={book} onPractice={onPractice} onOpenBank={onOpenBank} />} />} />
    <details className="qb-course-catalog" open={catalogOpen} onToggle={(event) => setCatalogOpen(event.currentTarget.open)}>
      <summary>
        <span><b>Browse the course catalog</b><small>Find server-provided courses and load the weeks you need.</small></span>
      </summary>
      <AcademicBankDiscovery />
    </details>
    <details className="cloud-local-material qb-library-maintenance"><summary>Import status and source review</summary><PreparedLibrary /></details>
  </section>;
}
