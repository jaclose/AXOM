import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { buildCourseBooks, type CourseBook } from "../../lib/bookshelf/courseBooks";
import { buildShelves } from "../../lib/bookshelf/model";
import { loadPreparedCourse, withPreparedCourses } from "../../lib/bookshelf/preparedCourses";
import { PreparedLibrary } from "../bookshelf/PreparedLibrary";
import { SharedAcademicLibrary } from "../bookshelf/SharedAcademicLibrary";
import { AcademicBookshelf } from "../bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../bookshelf/AcademicLibrary";
import { CourseBookContent } from "../bookshelf/BookContents";
import { Modal } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import { savedCourseTemplates } from "../../lib/course-engine/templateLibrary";
import { buildQuestionBankBooks } from "../../lib/bookshelf/questionBankBooks";
import { moduleKey } from "../../lib/course-engine/vocabulary";

export function CourseLibrary({ onClose, onTemplate, onOpen, onCreate }: {
  onClose: () => void;
  onTemplate: (book?: CourseBook) => void;
  onOpen: (book: CourseBook) => void;
  onCreate: () => void;
}) {
  const s = useStore();
  const shelves = useMemo(() => buildShelves(withPreparedCourses(buildCourseBooks({ terms: s.terms, courses: s.courses,
    tracker: s.tracker, questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), s.documents, s.tracker)),
  [s.terms, s.courses, s.tracker, s.questions, s.questionSets, s.documents]);
  const banks = useMemo(() => buildQuestionBankBooks({ terms: s.terms, courses: s.courses,
    questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), [s.terms, s.courses, s.questions, s.questionSets]);
  const templates = savedCourseTemplates(s.documents);
  return <Modal title="Course library" onClose={onClose} className="course-library-modal">
    <SharedAcademicLibrary mode="courses" onOpenCourse={onOpen} />
    <details className="personal-academic-library" open={templates.length > 0}>
      <summary>My saved courses and custom templates</summary>
      <div className="row wrap gap8" style={{ marginBottom: 14 }}>
        <GButton onClick={() => onTemplate()}>Saved templates ({templates.length})</GButton>
        <span className="sub">Choose versions, weeks and activities.</span>
      </div>
      <AcademicLibrary title="Your saved courses" subtitle="Downloaded and personal templates remain available here."
        onChooseFile={() => onTemplate()} onCreate={onCreate}
        createHint="Add your own course or module, then fill it with activities."
        importHint="Add custom lecture and activity templates."
        browse={<AcademicBookshelf label="Course library" shelves={shelves}
          renderBook={(book) => <CourseBookContent book={book} workspace={s} onLoad={loadPreparedCourse}
            questionBank={banks.find(bank => moduleKey(bank.module) === moduleKey(book.module) && bank.term === book.term)}
            onOpen={onOpen} onChooseTemplate={() => onTemplate(book)} />} />} />
      <details><summary>Transfer an existing private collection</summary><PreparedLibrary /></details>
    </details>
  </Modal>;
}
