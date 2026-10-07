// ===========================================================================
// Analysis: what the learner's answers show and the one thing to do about it.
// A short ranked list from the pattern engine, not a dashboard. Every finding
// carries its footing (observed, computed, or read from the wording) and the
// number of answers behind it, and anything the engine cannot say yet is
// listed as what it is waiting for instead of being guessed.
// ===========================================================================
import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useStore } from "../../lib/store";
import type { QuestionRecord } from "../../lib/questions";
import {
  EVIDENCE_BASIS_LABEL, buildPatternReport, describeQuestionStyle, styleObservations, type Finding,
} from "../../lib/learning-intelligence";
import { EmptyState, GButton, GhostButton, GlassCard, PanelHeader } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

const NO_QUESTIONS: QuestionRecord[] = [];
/** Findings shown before "Show more": enough to act on, few enough to read. */
const VISIBLE_FINDINGS = 3;
/** A practice block started from a finding stays a sitting, not a marathon. */
const PRACTICE_LIMIT = 20;

function footing(finding: Finding): string {
  const unit = finding.kind === "figure-missing" ? "question" : "answer";
  return `${EVIDENCE_BASIS_LABEL[finding.basis]} · ${finding.sample} ${unit}${finding.sample === 1 ? "" : "s"}`;
}

export function AnalysisPanel({ onPractice }: { onPractice: (questionIds: string[]) => void }) {
  const questions = useStore((s) => s.questions ?? NO_QUESTIONS);
  const questionSets = useStore((s) => s.questionSets ?? []);
  const [setId, setSetId] = useState("");
  const [showAll, setShowAll] = useState(false);

  const scoped = useMemo(() => {
    const set = questionSets.find((item) => item.id === setId);
    if (!set) return questions;
    const ids = new Set(set.questionIds);
    return questions.filter((question) => ids.has(question.id));
  }, [questionSets, questions, setId]);
  const report = useMemo(() => buildPatternReport(scoped), [scoped]);
  const style = useMemo(() => describeQuestionStyle(scoped), [scoped]);
  const observations = useMemo(() => styleObservations(style), [style]);

  const [lead, ...rest] = report.findings;
  const others = showAll ? rest : rest.slice(0, VISIBLE_FINDINGS - 1);
  const answered = report.totals.all.attempts > 0;

  function action(finding: Finding, primary = false) {
    // A missing image is fixed in the question, not by answering it again.
    if (finding.kind === "figure-missing" || finding.questionIds.length === 0) return null;
    const Button = primary ? GButton : GhostButton;
    return (
      <Button {...(primary ? { variant: "primary" as const, size: "sm" as const } : {})}
        onClick={() => onPractice(finding.questionIds.slice(0, PRACTICE_LIMIT))}>
        {finding.actionLabel} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
      </Button>
    );
  }

  return (
    <GlassCard className="analysis-panel">
      <PanelHeader
        title="Analysis"
        sub="What your answers show, and what to do next."
        action={questionSets.length > 0 ? (
          <label className="analysis-scope">
            <span className="sr-only">Analyse</span>
            <select className="field" value={setId} onChange={(event) => { setSetId(event.target.value); setShowAll(false); }}>
              <option value="">All questions</option>
              {questionSets.map((set) => <option key={set.id} value={set.id}>{set.title}</option>)}
            </select>
          </label>
        ) : undefined}
      />

      {!answered && report.findings.length === 0 ? (
        <EmptyState
          title="Nothing to analyse yet"
          hint="Answer a block. AXOM records each answer, how long it took, and whether it was your first time with the question."
        />
      ) : (
        <div className="stack analysis-body">
          {answered && (
            <p className="analysis-summary">
              {report.totals.all.attempts} answer{report.totals.all.attempts === 1 ? "" : "s"} on {report.totals.questions} question{report.totals.questions === 1 ? "" : "s"}.
              {report.totals.first.accuracy !== null && <> <b>{report.totals.first.accuracy}%</b> right the first time you saw a question.</>}
            </p>
          )}

          {lead ? (
            <section className="analysis-lead" aria-labelledby="analysis-lead-title">
              <span className="field-label">Start here</span>
              <h3 id="analysis-lead-title">{lead.title}</h3>
              <p>{lead.detail}</p>
              <div className="analysis-foot">
                <span className="analysis-footing">{footing(lead)}</span>
                {action(lead, true)}
              </div>
            </section>
          ) : (
            <p className="sub">No pattern stands out yet. That is a result too: nothing below is being hidden.</p>
          )}

          {others.length > 0 && (
            <ul className="analysis-findings" aria-label="Other findings">
              {others.map((finding) => (
                <li key={finding.id} className="analysis-finding">
                  <div>
                    <b>{finding.title}</b>
                    <p>{finding.detail}</p>
                    <span className="analysis-footing">{footing(finding)}</span>
                  </div>
                  {action(finding)}
                </li>
              ))}
            </ul>
          )}
          {rest.length > VISIBLE_FINDINGS - 1 && (
            <GhostButton className="analysis-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              <ChevronDown size={ICON_SIZE.body} aria-hidden="true" className={showAll ? "flipped" : ""} />
              {showAll ? "Show fewer" : `Show ${rest.length - (VISIBLE_FINDINGS - 1)} more`}
            </GhostButton>
          )}

          {observations.length > 0 && (
            <section className="analysis-style" aria-labelledby="analysis-style-title">
              <span className="field-label" id="analysis-style-title">How these questions are written</span>
              <ul>
                {observations.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <span className="analysis-footing">
                Read from the wording of {style.sampleSize} question{style.sampleSize === 1 ? "" : "s"}.
                {!style.reliable && " Too few to rely on yet."}
              </span>
            </section>
          )}

          {report.waitingFor.length > 0 && (
            <details className="analysis-waiting">
              <summary>What AXOM cannot say yet</summary>
              <ul>
                {report.waitingFor.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </GlassCard>
  );
}
