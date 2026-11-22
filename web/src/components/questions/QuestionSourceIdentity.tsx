import type { QuestionRecord } from "../../lib/questions";
import "../../styles/question-content.css";

/** Show the supplied bank/byline intact; never infer an author or source. */
export function QuestionSourceIdentity({ question }: { question: QuestionRecord }) {
  const source = question.content?.source;
  const bank = question.bank?.trim();
  const filename = (source?.filename || question.sourceFile?.name)?.trim();
  const title = bank || filename;
  const number = question.questionNumber ?? source?.questionNumber;
  const page = question.sourcePage ?? source?.page;
  const details = [bank && filename !== bank ? filename : undefined,
    source?.setTitle?.trim() !== title ? source?.setTitle?.trim() : undefined,
    number !== undefined ? `Source question ${number}` : undefined,
    page !== undefined ? `Page ${page}` : undefined].filter(Boolean);
  if (!title && !details.length) return null;
  return <div className="question-source-identity" aria-label="Question source">
    {title && <strong>{title}</strong>}
    {!!details.length && <span>{details.join(" · ")}</span>}
  </div>;
}
