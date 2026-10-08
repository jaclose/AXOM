// Development-only page that mounts the academic bookshelf on the app's real
// store, so the shelf, the opening and saving can be exercised in a browser
// before anything is wired into Course Tracker or the Question Bank.
// Reached at /harness/bookshelf.html on the dev server. Not in the build.
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AcademicBookshelf } from "../components/bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../components/bookshelf/AcademicLibrary";
import { CourseBookContent, QuestionBankBookContent } from "../components/bookshelf/BookContents";
import { GButton } from "../components/ui/primitives";
import { buildCourseBooks } from "../lib/bookshelf/courseBooks";
import { commitCourseLoad } from "../lib/bookshelf/loadCourse";
import { buildShelves } from "../lib/bookshelf/model";
import { buildQuestionBankBooks, type KnownPackage, type PracticeSelection } from "../lib/bookshelf/questionBankBooks";
import { CURRICULA } from "../lib/curricula";
import type { QuestionSet } from "../lib/library";
import { readManifest } from "../lib/question-content/packageJson";
import type { QuestionRecord } from "../lib/questions";
import { runStorageMigrations } from "../lib/storageMigrations";
import { storeHydration } from "../lib/storeHydration";
import type { TrackerItem } from "../lib/types";
import "../styles/global.css";
import "../styles/components.css";
import "../styles/shell.css";
import "../styles/pages.css";
import "../styles/motion.css";

// The three Term 5 GOER Week 2 manifests, read from the fixtures as they are.
const manifestFiles = import.meta.glob("../../../fixtures/qbank/goer/**/manifest.json", { eager: true, import: "default" });
const knownPackages: KnownPackage[] = Object.values(manifestFiles).flatMap((raw) => {
  const manifest = readManifest(raw, []);
  // A browser page cannot look for the source PDF, so it does not claim to have it.
  return manifest ? [{ manifest, hasSource: false }] : [];
});

type Store = typeof import("../lib/store")["useStore"];

/** Invented rows, written through the store like any other change, so thickness and saving can be seen. */
function inventedSample(useStore: Store): void {
  const now = new Date().toISOString();
  const state = useStore.getState();
  const tracker: TrackerItem[] = [];
  const add = (module: string, term: string, week: number, kind: TrackerItem["kind"], count: number, activity: TrackerItem["activity"]) => {
    for (let index = 1; index <= count; index += 1) {
      tracker.push({ id: `harness-${module}-${week}-${activity}-${index}`, path: `${term}/${module}/Week ${week}`, label: `Invented ${activity} ${index}`, kind, passes: index % 3 === 0 ? 1 : 0, ankiPasses: 0, yield: "none", updated: now, activity });
    }
  };
  for (let week = 1; week <= 6; week += 1) add("ER", "Term 2", week, "Lecture", 9, "lecture");
  for (let week = 1; week <= 6; week += 1) add("ER", "Term 2", week, "DLA", 3, "dla");
  for (let week = 1; week <= 3; week += 1) add("DM", "Term 2", week, "Lecture", 5, "lecture");
  add("DM", "Term 2", 1, "Requirement", 2, "small-group");
  add("NB1", "Term 2", 1, "Lecture", 2, "lecture");
  const question = (id: string, module: string, week: number, setId: string, ready: boolean): QuestionRecord => ({
    id, source: "imported", stem: `Invented question ${id}`, options: [{ key: "A", text: "one" }, { key: "B", text: "two" }], ...(ready ? { correctKey: "B" } : {}),
    status: "unanswered" as QuestionRecord["status"], module, week, setId, tags: [], attempts: [], createdAt: now, updatedAt: now,
  });
  const questions: QuestionRecord[] = [];
  const sets: QuestionSet[] = [];
  const bank = (title: string, module: string, week: number, count: number, unready = 0) => {
    const setId = `harness-set-${sets.length + 1}`;
    const ids = Array.from({ length: count }, (_, index) => `${setId}-q${index + 1}`);
    ids.forEach((id, index) => questions.push(question(id, module, week, setId, index >= unready)));
    sets.push({ id: setId, title, sourceDocumentIds: [], createdAt: now, questionIds: ids, tags: [], aiEnhanced: false, parserWarnings: [], scope: { module, week }, kind: "source" });
  };
  bank("ER Week 1 IMCQ", "ER", 1, 60);
  bank("ER Week 1 practice questions", "ER", 1, 45, 6);
  bank("ER Week 2 ESoft", "ER", 2, 80);
  bank("DM Week 1 IMCQ", "DM", 1, 12);
  useStore.setState({
    tracker: [...state.tracker.filter((item) => !item.id.startsWith("harness-")), ...tracker],
    questions: [...state.questions.filter((item) => !item.id.startsWith("harness-")), ...questions],
    questionSets: [...state.questionSets.filter((item) => !item.id.startsWith("harness-")), ...sets],
  });
}

function Harness({ useStore, flush }: { useStore: Store; flush: () => Promise<void> }) {
  const terms = useStore((state) => state.terms);
  const courses = useStore((state) => state.courses);
  const tracker = useStore((state) => state.tracker);
  const questions = useStore((state) => state.questions);
  const sets = useStore((state) => state.questionSets);
  const [library, setLibrary] = useState<"courses" | "banks">("courses");
  const [log, setLog] = useState("Nothing done yet.");
  const courseBooks = useMemo(() => buildCourseBooks({ terms, courses, tracker, questions, sets, curricula: CURRICULA }), [terms, courses, tracker, questions, sets]);
  const bankBooks = useMemo(() => buildQuestionBankBooks({ terms, courses, sets, questions, packages: knownPackages, curricula: CURRICULA }), [terms, courses, sets, questions]);
  const practise = (selection: PracticeSelection) => setLog(`Practice asked for: ${selection.count} questions from ${selection.setIds.length} set(s), ${selection.module}${selection.week ? ` week ${selection.week}` : ""}.`);
  return (
    <main className="surface-scroll" style={{ minHeight: "100dvh", padding: "clamp(14px, 3vw, 36px)", display: "grid", gap: 20, alignContent: "start" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <strong style={{ fontFamily: "var(--font-display)" }}>Bookshelf harness</strong>
        <GButton size="sm" aria-pressed={library === "courses"} onClick={() => setLibrary("courses")}>Course templates</GButton>
        <GButton size="sm" aria-pressed={library === "banks"} onClick={() => setLibrary("banks")}>Question banks</GButton>
        <GButton size="sm" data-testid="add-sample" onClick={() => { inventedSample(useStore); void flush().then(() => setLog("Invented sample data added and saved on this device.")); }}>Add invented sample data</GButton>
        <span data-testid="harness-log" role="status" style={{ fontSize: 12, color: "var(--text-60)" }}>{log}</span>
      </header>
      {library === "courses" ? (
        <AcademicLibrary
          title="Course library"
          subtitle="Every module of your course map. A book is as thick as the activities it holds."
          onChooseFile={() => setLog("A file picker would open here for a course template.")}
          importHint="Choose a course template file from this device. AXOM shows what it found, week by week, and adds nothing until you confirm."
          recover={<div className="academic-library-plain"><h3>Saved work on this device</h3><p>AXOM looks only at what it saved itself: your workspace on this device and the backups you made. It cannot look through other folders from a browser.</p></div>}
          browse={
            <AcademicBookshelf
              label="Course library"
              shelves={buildShelves(courseBooks)}
              empty={<p>No courses yet.</p>}
              renderBook={(book) => (
                <CourseBookContent
                  book={book}
                  workspace={{ terms, courses }}
                  onLoad={async (chosen) => {
                    const outcome = await commitCourseLoad(chosen);
                    setLog(`Load ${chosen.module}: ${outcome.status}`);
                    return outcome;
                  }}
                  onOpen={(chosen) => setLog(`Course Tracker would open ${chosen.module}.`)}
                  onChooseTemplate={(chosen) => setLog(`A file picker would open for ${chosen.module}.`)}
                />
              )}
            />
          }
        />
      ) : (
        <AcademicLibrary
          title="Question bank library"
          subtitle="A book for each module with questions. A book is as thick as the questions on this device."
          onChooseFile={() => setLog("A file picker would open here for a question file.")}
          browse={
            <AcademicBookshelf
              label="Question bank library"
              shelves={buildShelves(bankBooks)}
              empty={<p>No question banks yet. Import a question file to start one.</p>}
              renderBook={(book) => <QuestionBankBookContent book={book} onPractice={practise} onOpenBank={(chosen, week) => setLog(`Question Bank would open ${chosen.module}${week ? ` week ${week}` : ""}.`)} />}
            />
          }
        />
      )}
    </main>
  );
}

async function start() {
  const root = document.getElementById("root");
  if (!root) return;
  const status = await runStorageMigrations();
  if (!status.ok && status.fromVersion > status.toVersion) {
    root.textContent = status.errorMessage ?? "This workspace was saved by a newer AXOM.";
    return;
  }
  const [{ useStore }, { flushLocalVaultWrites }] = await Promise.all([import("../lib/store"), import("../lib/localVault")]);
  await storeHydration.wait();
  createRoot(root).render(<StrictMode><Harness useStore={useStore} flush={flushLocalVaultWrites} /></StrictMode>);
}

void start();
