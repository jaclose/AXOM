import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { buildCourseBooks, type CourseBook } from "../../lib/bookshelf/courseBooks";
import { buildShelves } from "../../lib/bookshelf/model";
import { commitCourseLoad } from "../../lib/bookshelf/loadCourse";
import { AcademicBookshelf } from "../bookshelf/AcademicBookshelf";
import { AcademicLibrary } from "../bookshelf/AcademicLibrary";
import { CourseBookContent } from "../bookshelf/BookContents";
import { Modal } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import { savedCourseTemplates } from "../../lib/course-engine/templateLibrary";

export function CourseLibrary({ onClose, onTemplate, onOpen, onCreate }: {
  onClose: () => void;
  onTemplate: (book?: CourseBook) => void;
  onOpen: (book: CourseBook) => void;
  onCreate: () => void;
}) {
  const s = useStore();
  const [error, setError] = useState("");
  const shelves = useMemo(() => buildShelves(buildCourseBooks({ terms: s.terms, courses: s.courses,
    tracker: s.tracker, questions: s.questions, sets: s.questionSets, curricula: CURRICULA })),
  [s.terms, s.courses, s.tracker, s.questions, s.questionSets]);
  async function chooseTemplate(book: CourseBook) {
    const result = await commitCourseLoad(book);
    if (result.status === "failed") { setError(result.message); return; }
    onTemplate(book);
  }
  return <Modal title="Course library" onClose={onClose} className="course-library-modal">
    {error && <p role="alert">{error}</p>}
    <div className="row wrap gap8" style={{ marginBottom: 14 }}>
      <GButton onClick={() => onTemplate()}>Saved templates ({savedCourseTemplates(s.documents).length})</GButton>
      <span className="sub">Choose versions, weeks and activities.</span>
    </div>
    <AcademicLibrary title="Your academic bookshelf" subtitle="Open a module to see its weeks. Add a template to fill them."
      onChooseFile={() => onTemplate()} onCreate={onCreate}
      createHint="Add your own course or module, then fill it with activities."
      importHint="Choose your lecture and activity templates. Review the weekly plan before saving."
      browse={<AcademicBookshelf label="Course library" shelves={shelves}
        renderBook={(book) => <CourseBookContent book={book} workspace={s} onLoad={commitCourseLoad}
          onOpen={onOpen} onChooseTemplate={() => void chooseTemplate(book)} />} />} />
  </Modal>;
}
