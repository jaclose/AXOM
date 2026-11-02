import { Check, CircleHelp, Target, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { questionMappingStatus, type QuestionRecord } from "../../lib/questions";

interface ChoiceTeachingRow {
  key: string;
  text: string;
  rationale?: string;
  coveredByCore: boolean;
  kind: "correct" | "picked" | "alternative";
}
function teachingRows(question: QuestionRecord, pickedKey?: string): ChoiceTeachingRow[] {
  if (questionMappingStatus(question) !== "ready" || !question.correctKey) return [];
  const rows = question.options.map((option): ChoiceTeachingRow => ({
    key: option.key,
    text: option.text,
    rationale: question.choiceRationales?.[option.key]?.trim() || undefined,
    coveredByCore: option.key === question.correctKey && Boolean(question.explanation?.trim()),
    kind: option.key === question.correctKey ? "correct" : option.key === pickedKey ? "picked" : "alternative",
  }));
  const rank = (row: ChoiceTeachingRow) => row.kind === "correct" ? 0 : row.kind === "picked" ? 1 : 2;
  return rows.sort((left, right) => rank(left) - rank(right));
}

/**
 * Reviewed teaching beside each answer choice. This is deliberately derived
 * from additive explanation fields: it never rewrites the imported stem,
 * choices, answer evidence or source blocks.
 */
export function ChoiceTeaching({ question, pickedKey }: { question: QuestionRecord; pickedKey?: string }) {
  const rows = teachingRows(question, pickedKey);
  if (!rows.length) return null;
  const explained = rows.filter((row) => row.rationale || row.coveredByCore).length;
  if (!explained) return null;

  return (
    <section className="choice-teaching" aria-labelledby={`choice-teaching-${question.id}`} data-study-text="choice-explanations">
      <div className="choice-teaching-heading">
        <div>
          <span className="field-label">Choice by choice</span>
          <h3 id={`choice-teaching-${question.id}`}>Why each option fits or fails</h3>
        </div>
        <span className="choice-teaching-coverage">{explained} of {rows.length} explained</span>
      </div>
      <ol className="choice-teaching-list">
        {rows.map((row) => {
          const isOpen = row.kind === "correct" || row.kind === "picked";
          const Icon = row.kind === "correct" ? Check : row.kind === "picked" ? X : CircleHelp;
          const status = row.kind === "correct" ? "Correct answer" : row.kind === "picked" ? "Your answer" : "Alternative";
          return (
            <li key={row.key} className={`choice-teaching-row ${row.kind}`}>
              <details open={isOpen} data-choice-key={row.key}>
                <summary>
                  <span className="choice-teaching-key" aria-hidden="true">{row.key}</span>
                  <span className="choice-teaching-copy"><b>{row.text}</b><small><Icon size={ICON_SIZE.microInline} aria-hidden="true" /> {status}</small></span>
                  <span className="choice-teaching-action">{row.rationale ? "Explain" : row.coveredByCore ? "Covered above" : "Pending review"}</span>
                </summary>
                <div className="choice-teaching-rationale">
                  {row.rationale ? <p>{row.rationale}</p>
                    : row.coveredByCore
                      ? <p className="sub"><Check size={ICON_SIZE.body} aria-hidden="true" /> The core explanation above covers why this answer is correct.</p>
                      : <p className="sub"><Target size={ICON_SIZE.body} aria-hidden="true" /> No reviewed explanation has been added for this choice yet.</p>}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
