import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import type { QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { canonicalModuleKey, moduleKey } from "../../lib/course-engine/vocabulary";

/** Different spellings of a term are the same academic scope, not different owners. */
const termKey = (value: string): string => {
  const match = value.trim().match(/^(?:term|t)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : moduleKey(value);
};

const sameModuleTerm = (
  a: Pick<CourseBook, "module" | "term">,
  b: Pick<QuestionBankBook, "module" | "term">,
): boolean => canonicalModuleKey(a.module) === canonicalModuleKey(b.module)
  && termKey(a.term) === termKey(b.term);

const sameCode = (a?: string, b?: string): boolean => Boolean(a && b && moduleKey(a) === moduleKey(b));

/**
 * Course Library is a projection, not an academic owner resolver.
 * Never display one course's question bank as another course's content
 * merely because they teach modules with the same name.
 */
export function bankForCourseBook(
  book: CourseBook,
  banks: readonly QuestionBankBook[],
  books: readonly CourseBook[],
): QuestionBankBook | undefined {
  const candidates = banks.filter(bank => sameModuleTerm(book, bank));
  const unique = (matches: QuestionBankBook[]) => matches.length === 1 ? matches[0] : undefined;

  if (book.courseId) {
    const exact = candidates.filter(bank => bank.courseId === book.courseId);
    if (exact.length) return unique(exact);
    // Older banks can have a course code without a saved course ID.
    // A conflicting explicit ID is never reassigned by its title.
    return unique(candidates.filter(bank => !bank.courseId && sameCode(book.courseCode, bank.courseCode)));
  }

  if (book.courseCode) {
    const coded = candidates.filter(bank => sameCode(book.courseCode, bank.courseCode));
    if (coded.length) return unique(coded);
  }

  // A legacy module-only association is safe only when there is one candidate
  // and one local course with that module in that term.
  if (books.filter(other => sameModuleTerm(other, book)).length !== 1) return undefined;
  return unique(candidates);
}
