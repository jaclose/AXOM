import { AccountContentDownloads } from "../bookshelf/AccountContentDownloads";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FilePlus2, ListPlus } from "lucide-react";
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
import { CommunityQuestionSetLibrary } from "./CommunityQuestionSetLibrary";
import { GButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import type { QuestionSet } from "../../lib/library";

const packages: KnownPackage[] = knownBankManifests.map((manifest) => ({ manifest, hasSource: false }));
export function QuestionBankLibrary({ onPractice, onPracticeSet, onOpenBank, onImport, onCreate, heldForReview }: {
  onPractice: (selection: PracticeSelection) => void;
  onPracticeSet?: (set: QuestionSet) => void;
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
  const [catalogOpen, setCatalogOpen] = useState(ready === 0);
  const [catalogTab, setCatalogTab] = useState<"courses" | "shared">("courses");
  const [preparedOpen, setPreparedOpen] = useState(false);
  const [preparedLoaded, setPreparedLoaded] = useState(false);
  const catalogTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const catalogId = useId();
  const catalogChoices = [["courses", "Courses"], ["shared", "Shared sets"]] as const;

  function navigateCatalog(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % catalogChoices.length;
    else if (event.key === "ArrowLeft") next = (index + catalogChoices.length - 1) % catalogChoices.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = catalogChoices.length - 1;
    else return;
    event.preventDefault();
    setCatalogTab(catalogChoices[next][0]);
    catalogTabs.current[next]?.focus();
  }

  const collection = <AcademicLibrary key="collection" title="Your collection" subtitle={localBookCount > 0
    ? `${localBookCount} course ${localBookCount === 1 ? "collection" : "collections"} on this device · ${sets.length} saved ${sets.length === 1 ? "set" : "sets"}.`
    : "Courses and sets you save appear here. Your answers stay in your own workspace."}
    browse={localBookCount === 0 && sets.length === 0
      ? <section aria-label="Question bank library"><p className="qb-local-empty">No saved questions yet. Browse the catalog above or add a PDF, document, image, or question file.</p></section>
      : <AcademicBookshelf label="Question bank library" shelves={shelves}
        renderBook={(book) => <QuestionBankBookContent book={book} onPractice={onPractice} onOpenBank={onOpenBank} />} />} />;

  const catalog = <details key="catalog" className="qb-course-catalog" open={catalogOpen} onToggle={(event) => setCatalogOpen(event.currentTarget.open)}>
    <summary><span><b>Browse Question Bank</b><small>Find course collections and reviewed sets shared with you.</small></span></summary>
    <div className="qb-catalog-tabs" role="tablist" aria-label="Browse Question Bank">
      {catalogChoices.map(([id, label], index) => <button key={id} type="button" role="tab"
        ref={element => { catalogTabs.current[index] = element; }} id={`${catalogId}-${id}-tab`}
        aria-selected={catalogTab === id} aria-controls={`${catalogId}-${id}-panel`} tabIndex={catalogTab === id ? 0 : -1}
        onClick={() => setCatalogTab(id)} onKeyDown={event => navigateCatalog(event, index)}>{label}</button>)}
    </div>
    {catalogChoices.map(([id]) => <div key={id} id={`${catalogId}-${id}-panel`} role="tabpanel"
      aria-labelledby={`${catalogId}-${id}-tab`} hidden={catalogTab !== id} className="qb-catalog-panel">
      {id === "courses" ? <AcademicBankDiscovery /> : catalogTab === "shared" && <CommunityQuestionSetLibrary onPractice={onPracticeSet} />}
    </div>)}
  </details>;

  return <section className="qb-library-workspace" aria-labelledby="qb-library-title">
    <header className="qb-library-intro">
      <div>
        <span className="qb-eyebrow">Course-first practice</span>
        <h2 id="qb-library-title">Choose a course, open a set, start.</h2>
        <p>{ready + heldForReview > 0
          ? `${ready} ready to practice · ${heldForReview} held for answer or source review.`
          : "Start with a course collection, or add material you already trust."}</p>
      </div>
      <div className="qb-library-actions">
        <GButton onClick={onImport}><FilePlus2 size={ICON_SIZE.body} aria-hidden="true" /> Add material</GButton>
        <GButton onClick={onCreate} disabled={ready === 0}><ListPlus size={ICON_SIZE.body} aria-hidden="true" /> Create a quiz</GButton>
      </div>
    </header>
    <AccountContentDownloads />
    {ready > 0 ? [collection, catalog] : [catalog, collection]}
    <details id="prepared-course-library" className="cloud-local-material qb-library-maintenance"
      open={preparedOpen} onToggle={(event) => {
        setPreparedOpen(event.currentTarget.open);
        // Keep a started import mounted if the learner folds away its tools.
        if (event.currentTarget.open) setPreparedLoaded(true);
      }}>
      <summary>Import status and source review</summary>{preparedLoaded && <PreparedLibrary />}
    </details>
  </section>;
}
