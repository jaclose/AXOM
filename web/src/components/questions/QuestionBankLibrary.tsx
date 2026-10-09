import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { bankSource } from "../../lib/course-engine/questionBank";
import { buildShelves } from "../../lib/bookshelf/model";
import { buildQuestionBankBooks, type PracticeSelection, type QuestionBankBook, type KnownPackage } from "../../lib/bookshelf/questionBankBooks";
import { AcademicBookshelf } from "../bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../bookshelf/AcademicLibrary";
import { QuestionBankBookContent } from "../bookshelf/BookContents";
import biostats from "../../../../fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json";
import endocrine from "../../../../fixtures/qbank/goer/t5/week-02/endocrine-pathophysiology/manifest.json";
import pharma from "../../../../fixtures/qbank/goer/t5/week-02/pharmacodynamics-pk/manifest.json";

// These public manifests contain metadata only. A browser cannot infer that the
// source file on another checkout is available in this device's workspace.
const packages: KnownPackage[] = [biostats, endocrine, pharma].map((manifest) => ({ manifest, hasSource: false }));

export function QuestionBankLibrary({ onPractice, onOpenBank, onImport, onCreate }: {
  onPractice: (selection: PracticeSelection) => void;
  onOpenBank: (book: QuestionBankBook, week?: number) => void;
  onImport: () => void;
  onCreate: () => void;
}) {
  const s = useStore();
  const shelves = useMemo(() => buildShelves(buildQuestionBankBooks({ terms: s.terms, courses: s.courses,
    sets: s.questionSets ?? [], questions: s.questions ?? [], packages, curricula: CURRICULA, sourceOf: bankSource })),
  [s.terms, s.courses, s.questionSets, s.questions]);
  return <AcademicLibrary title="Course question banks" subtitle="A book for each module. Your questions, filed by week."
    onChooseFile={onImport} onCreate={onCreate} createHint="Build a reusable practice block from your saved questions."
    browse={<AcademicBookshelf label="Question bank library" shelves={shelves}
      renderBook={(book) => <QuestionBankBookContent book={book} onPractice={onPractice} onOpenBank={onOpenBank} />} />} />;
}
