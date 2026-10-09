import { AlertTriangle, BookMarked, FileSearch, PencilLine, WandSparkles } from "lucide-react";
import { questionMappingStatus, type QuestionRecord } from "../../lib/questions";
import { GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import type { ReactNode } from "react";

export function QuizFeedback({
  question,
  pickedKey,
  onRepairCard,
  onAddReview,
  onMarkExplanationWrong,
  onMarkAnswerWrong,
  onEditMapping,
  onSourceLooksWrong,
  sourceTitle,
  showProvenance = true,
  explanationContent,
}: {
  question: QuestionRecord;
  pickedKey?: string;
  onRepairCard?: () => void;
  onAddReview?: () => void;
  onMarkExplanationWrong?: () => void;
  onMarkAnswerWrong?: () => void;
  onEditMapping?: () => void;
  onSourceLooksWrong?: () => void;
  sourceTitle?: string;
  showProvenance?: boolean;
  explanationContent?: ReactNode;
}) {
  const trusted = questionMappingStatus(question) === "ready";
  const correct = trusted ? question.options.find((option) => option.key === question.correctKey) : undefined;
  const picked = question.options.find((option) => option.key === pickedKey);
  const result = !trusted ? "review" : pickedKey === question.correctKey ? "correct" : "incorrect";
  // Import owns cleanup; display must preserve legitimate user edits.
  const explanation = (question.explanation ?? "").trim();

  return (
    <section className="quiz-feedback" aria-live="polite" data-module-tour="qb-feedback">
      <div className={`result-banner ${result}`} role="status">
        <span className="result-dot" aria-hidden="true" />
        <strong>
          {result === "correct"
            ? `Correct — you picked ${pickedKey}`
            : result === "incorrect"
              ? `Incorrect — you picked ${pickedKey ?? "nothing"}, answer is ${question.correctKey}`
              : "Needs inspection — no reliable answer was mapped"}
        </strong>
      </div>

      <div className="answer-compare">
        {correct && (
          <div className="answer-row correct-answer">
            <span>Correct answer</span>
            <strong>{correct.key}. {correct.text}</strong>
          </div>
        )}
        <div className={`answer-row your-answer ${result === "incorrect" ? "wrong" : ""}`}>
          <span>Your answer</span>
          <strong>{picked ? `${picked.key}. ${picked.text}` : "No answer selected"}</strong>
        </div>
      </div>

      {explanation && (
        <div className="feedback-explanation">
          <span className="field-label">Explanation</span>
          {question.content ? <div>{explanationContent ?? explanation}</div> : <p>{explanationContent ?? explanation}</p>}
        </div>
      )}

      {question.objective && (
        <div className="learning-objective">
          <span>Learning objective</span>
          <p>{question.objective}</p>
        </div>
      )}

      {showProvenance && (
        <QuestionProvenance
          question={question}
          sourceTitle={sourceTitle}
          onSourceLooksWrong={onSourceLooksWrong}
        />
      )}

      <div className="feedback-repair" aria-label="Repair this question">
        <span className="field-label">Repair</span>
        <div className="row wrap gap6">
          {onRepairCard && <GhostButton onClick={onRepairCard}><WandSparkles size={ICON_SIZE.body} /> Repair card</GhostButton>}
          {onAddReview && <GhostButton onClick={onAddReview}><BookMarked size={ICON_SIZE.body} /> Add to review</GhostButton>}
          {onMarkExplanationWrong && <GhostButton onClick={onMarkExplanationWrong}><AlertTriangle size={ICON_SIZE.body} /> Explanation wrong</GhostButton>}
          {onMarkAnswerWrong && <GhostButton onClick={onMarkAnswerWrong}><AlertTriangle size={ICON_SIZE.body} /> Answer wrong</GhostButton>}
          {onEditMapping && <GhostButton onClick={onEditMapping}><PencilLine size={ICON_SIZE.body} /> Edit mapping</GhostButton>}
        </div>
      </div>
    </section>
  );
}

export function QuestionProvenance({
  question,
  sourceTitle,
  onSourceLooksWrong,
}: {
  question: QuestionRecord;
  sourceTitle?: string;
  onSourceLooksWrong?: () => void;
}) {
  const extraction = question.extraction;
  const hasSource = Boolean(
    sourceTitle
    || question.citation
    || question.sourceDocumentId
    || question.sourcePage
    || extraction?.sourceSnippet
    || extraction?.answerEvidence
    || extraction?.explanationSource,
  );
  if (!hasSource) return null;

  const questionSnippet = extraction?.questionSourceSnippet;
  const legacySnippet = extraction?.sourceSnippet;
  const answerSnippet = extraction?.answerEvidenceSnippet ?? extraction?.answerEvidence;
  const explanationSnippet = extraction?.explanationSourceSnippet;
  const explanationFallback = extraction?.explanationSource === "answer-section"
    ? "Recorded from a separate answer section; no separate excerpt was stored."
    : extraction?.explanationSource
      ? "Recorded alongside the question; no separate excerpt was stored."
      : "No explanation source was recorded.";

  return (
    <section className="question-provenance" aria-labelledby={`question-provenance-${question.id}`}>
      <div className="row spread wrap gap6">
        <div className="stack" style={{ gap: 2 }}>
          <b id={`question-provenance-${question.id}`}><FileSearch size={ICON_SIZE.body} /> Source</b>
          <span className="sub">{sourceTitle ?? question.citation ?? question.bank ?? "Imported source"}</span>
        </div>
        {onSourceLooksWrong && <GhostButton onClick={onSourceLooksWrong}>This source looks wrong</GhostButton>}
      </div>
      <div className="question-provenance-grid">
        <EvidenceExcerpt
          label="Question source"
          page={extraction?.questionSourcePage ?? question.sourcePage}
          snippet={questionSnippet}
          empty="No separate question excerpt was stored."
        />
        <EvidenceExcerpt
          label="Answer evidence"
          page={extraction?.answerEvidencePage}
          snippet={answerSnippet}
          empty="No answer evidence was recorded."
        />
        <EvidenceExcerpt
          label="Explanation source"
          page={extraction?.explanationSourcePage}
          snippet={explanationSnippet}
          empty={explanationFallback}
        />
        {legacySnippet && !questionSnippet && (
          <EvidenceExcerpt
            label="Legacy source excerpt"
            page={question.sourcePage}
            snippet={legacySnippet}
            empty=""
          />
        )}
      </div>
      {(typeof extraction?.overallImportConfidence === "number" || extraction?.parserRuleIds?.length) ? (
        <details className="source-evidence">
          <summary>Technical extraction details</summary>
          <div className="source-evidence-body">
            {typeof extraction?.overallImportConfidence === "number" && (
              <span className="sub">Parser confidence {Math.round(extraction.overallImportConfidence * 100)}%</span>
            )}
            {extraction?.parserRuleIds?.length ? (
              <div className="source-rules">Rules: {extraction.parserRuleIds.join(" · ")}</div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function EvidenceExcerpt({
  label,
  page,
  snippet,
  empty,
}: {
  label: string;
  page?: number;
  snippet?: string;
  empty: string;
}) {
  const clean = snippet?.trim();
  const compact = clean && clean.length > 280 ? `${clean.slice(0, 280).trimEnd()}…` : clean;
  return (
    <div className="question-provenance-item">
      <div className="source-line"><b>{label}</b>{page && <span>page {page}</span>}</div>
      <p className={clean ? "" : "sub"}>{compact ?? empty}</p>
      {clean && clean.length > 280 && (
        <details><summary>Surrounding context</summary><pre>{clean}</pre></details>
      )}
    </div>
  );
}
