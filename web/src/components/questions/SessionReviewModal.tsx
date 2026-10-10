import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { resolveActiveProvider } from "../../lib/ai";
import { ICON_SIZE } from "../../lib/iconSize";
import { questionMappingStatus } from "../../lib/questions";
import type { QuizSession } from "../../lib/quiz";
import { useStore } from "../../lib/store";
import { Modal } from "../ui/Modal";
import { GhostButton, Tag } from "../ui/primitives";
import { QuestionContent, QuestionSupportingContent } from "./QuestionContent";
import { QuestionExhibits } from "./QuestionExhibits";
import { SourceTeaching } from "./SourceTeaching";

/** Reopens a completed run without submitting, rescoring, or creating attempts. */
export function SessionReviewModal({ session, onClose, onPractice }: {
  session: QuizSession;
  onClose: () => void;
  onPractice: (ids: string[]) => void;
}) {
  const s = useStore();
  const [filter, setFilter] = useState<"all" | "missed" | "flagged">("all");
  const [selected, setSelected] = useState(session.questionIds[0]);
  const questionRef = useRef<HTMLElement>(null);
  const provider = useMemo(() => resolveActiveProvider(), []);
  const date = new Date(session.startedAt);
  const dateLabel = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date) : "Saved block";
  const answers = new Map(session.answers.map((answer) => [answer.questionId, answer]));
  const ids = [...new Set(session.questionIds)].filter((id) => filter === "all"
    || (filter === "missed" ? answers.get(id)?.correct === false : answers.get(id)?.flagged));
  const id = ids.includes(selected) ? selected : ids[0];
  const index = ids.indexOf(id);
  const question = s.questions?.find((entry) => entry.id === id);
  const answer = answers.get(id);
  const source = question?.sourceDocumentId ? s.documents?.find((entry) => entry.id === question.sourceDocumentId) : undefined;
  const ready = question && questionMappingStatus(question) === "ready";
  const missed = [...new Set(session.answers.filter((entry) => entry.correct === false).map((entry) => entry.questionId))]
    .filter((questionId) => s.questions?.some((entry) => entry.id === questionId && questionMappingStatus(entry) === "ready"));
  useEffect(() => {
    const body = questionRef.current?.closest<HTMLElement>(".modal-body");
    if (body) body.scrollTop = 0;
  }, [id]);

  return <Modal title="Review saved block" onClose={onClose} className="session-review-modal"
    footer={<>
      <GhostButton disabled={index <= 0} onClick={() => setSelected(ids[index - 1])}><ChevronLeft size={ICON_SIZE.body} /> Previous</GhostButton>
      <span className="sub" aria-live="polite">{ids.length ? `${index + 1} of ${ids.length}` : "No questions"}</span>
      <GhostButton disabled={index < 0 || index >= ids.length - 1} onClick={() => setSelected(ids[index + 1])}>Next <ChevronRight size={ICON_SIZE.body} /></GhostButton>
    </>}>
    {!session.endedAt ? <p role="status">Finish this block before opening answer review.</p> : <>
      <header className="session-review-heading">
        <div><span className="field-label">{session.mode === "exam" ? "Exam" : "Tutor"} · {dateLabel}</span>
          <p>Revisit the distinction. Keep what the source teaches.</p>
          <span className="sub">Saved results stay unchanged. Reviewing does not record another attempt.</span>
        </div>
        {missed.length > 0 && <GhostButton onClick={() => onPractice(missed)}><RotateCcw size={ICON_SIZE.body} /> Practice {missed.length} missed</GhostButton>}
      </header>
      <div className="session-review-filters" role="group" aria-label="Review questions">
        {([ ["all", "All answers"], ["missed", "Missed"], ["flagged", "Flagged"] ] as const).map(([value, label]) =>
          <button type="button" key={value} className={`filter-pill ${filter === value ? "on" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {!ids.length ? <p role="status">No {filter === "all" ? "saved" : filter} questions in this block. Choose another filter.</p>
        : !question ? <p role="status">This question is no longer in your library. Its saved result is retained. Restore the question from your backup to review its source.</p>
        : <article ref={questionRef} className="session-review-question" key={question.id} aria-label="Saved question review">
          <div className="row wrap gap8">
            <Tag tone={answer?.correct === true ? "green" : answer?.correct === false ? "red" : "neutral"}>
              {answer?.correct === true ? "Correct when submitted" : answer?.correct === false ? "Missed when submitted" : "Unscored"}
            </Tag>
            <span className="sub">Your answer: {answer?.answerKey ?? "Not answered"}</span>
            {answer?.flagged && <span className="sub">Flagged in this block</span>}
          </div>
          <QuestionContent question={question} part="stem" mode="review" fallback={<p className="question-stem">{question.stem}</p>} />
          <QuestionSupportingContent question={question} mode="question" />
          {!question.content && <QuestionExhibits attachments={(question.attachments ?? []).filter((entry) => entry.role === "exhibit")} />}
          <ol className="session-review-options" aria-label="Answer choices">
            {question.options.map((option) => <li key={option.key} className={ready && option.key === question.correctKey ? "is-correct" : ""}>
              <b>{option.key}</b>
              <QuestionContent question={question} part="choice" choice={option.key} mode="review" fallback={<span>{option.text}</span>} />
              <span className="sub">{[ready && option.key === question.correctKey && "Current key", answer?.answerKey === option.key && "Your answer"].filter(Boolean).join(" · ")}</span>
            </li>)}
          </ol>
          {!ready && <p role="status">The current answer key needs review. The saved result is historical, not a verified answer for this revision.</p>}
          <SourceTeaching key={question.id} question={question} document={source}
            siblings={s.questions?.filter((entry) => entry.sourceDocumentId === source?.id)} provider={provider}
            compact onChange={(analyses) => s.updateQuestion(question.id, { analyses })} />
          <details className="session-review-explanation session-review-why">
            <summary>Source explanation</summary>
            {question.explanation || question.content?.explanation?.length
              ? <QuestionContent question={question} part="explanation" mode="review" fallback={<p>{question.explanation}</p>} />
              : <p className="sub">No explanation was supplied with this question. Check the source before drawing a conclusion.</p>}
            <QuestionSupportingContent question={question} mode="answered" />
          </details>
          {question.choiceRationales && <details className="session-review-why">
            <summary>Why the other choices differ</summary>
            {question.options.filter((option) => question.choiceRationales?.[option.key]).map((option) =>
              <p key={option.key}><b>{option.key}.</b> {question.choiceRationales?.[option.key]}</p>)}
          </details>}
          {(source || question.citation) && <p className="sub session-review-citation">{source?.title ?? question.citation}{question.sourcePage ? ` · page ${question.sourcePage}` : ""}</p>}
        </article>}
    </>}
  </Modal>;
}
