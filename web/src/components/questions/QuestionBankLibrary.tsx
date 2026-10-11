import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { bankSource } from "../../lib/course-engine/questionBank";
import { buildShelves } from "../../lib/bookshelf/model";
import { buildQuestionBankBooks, type PracticeSelection, type QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { AcademicBookshelf } from "../bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../bookshelf/AcademicLibrary";
import { QuestionBankBookContent } from "../bookshelf/BookContents";
import { PreparedLibrary } from "../bookshelf/PreparedLibrary";
import { SharedAcademicLibrary } from "../bookshelf/SharedAcademicLibrary";

export function QuestionBankLibrary({ onPractice, onOpenBank, onImport, onCreate }: {
  onPractice: (selection: PracticeSelection) => void;
  onOpenBank: (book: QuestionBankBook, week?: number) => void;
  onImport: () => void;
  onCreate: () => void;
}) {
  const s = useStore();
  const shelves = useMemo(() => buildShelves(buildQuestionBankBooks({ terms: s.terms, courses: s.courses,
    sets: s.questionSets ?? [], questions: s.questions ?? [], curricula: CURRICULA, sourceOf: bankSource })),
  [s.terms, s.courses, s.questionSets, s.questions]);
  return <><SharedAcademicLibrary mode="questions" onPractice={onPractice} />
    <details className="personal-academic-library" open={s.questionSets.length > 0}>
      <summary>My saved questions and custom imports ({s.questionSets.length} sets)</summary>
      <AcademicLibrary title="Your saved question banks" subtitle="Your own sets and downloaded practice stay here, with their private review history."
        onChooseFile={onImport} onCreate={onCreate} createHint="Build a reusable practice block from your saved questions."
        browse={<AcademicBookshelf label="Question bank library" shelves={shelves}
          renderBook={(book) => <QuestionBankBookContent book={book} onPractice={onPractice} onOpenBank={onOpenBank} />} />} />
      <details><summary>Transfer an existing private collection</summary><PreparedLibrary /></details>
    </details></>;
}
