import { useId, useMemo, useState } from "react";
import { BookOpen, Check, Eye, EyeOff, Sparkles, Undo2, X } from "lucide-react";
import type { AIProvider } from "../../lib/ai/types";
import {
  analysisPages, pendingAnalyses, proposeAnalyses, questionSourcePages, sourceTeachingProposals, teachingView, withAnalysis,
  withAnalysisStatus, type QuestionAnalysis,
} from "../../lib/decode";
import { ICON_SIZE } from "../../lib/iconSize";
import type { SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { GButton, GhostButton } from "../ui/primitives";
import { SourcePagePreview } from "./SourcePagePreview";

const same = (a: string | undefined, b: string | undefined) => (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();

/**
 * What the question's source teaches about it, shown once the learner has
 * committed to an answer (lib/decode). Teaching the learner has kept is shown
 * as teaching. A reading of the source's slides, or a model's, is shown as a
 * proposal to keep or discard. Nothing is stored until the learner decides.
 */
export function SourceTeaching({ question, document: source, siblings, provider, onChange }: {
  question: QuestionRecord;
  /** The question's source document, when it is in the library. */
  document?: SourceDocument;
  /** Every question imported from the same source, so a page that holds two is not guessed at. */
  siblings?: readonly QuestionRecord[];
  provider?: AIProvider | null;
  onChange: (analyses: QuestionAnalysis[] | undefined) => void;
}) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [showPage, setShowPage] = useState(false);
  const [pagePicked, setPagePicked] = useState<number>();
  /** What the question's analyses were before the last discard or removal, so it can be taken back. */
  const [undo, setUndo] = useState<{ questionId: string; analyses: QuestionAnalysis[] | undefined; what: string }>();

  const view = useMemo(() => teachingView(question, source), [question, source]);
  const kept = view.analysis;
  // A proposal already stored on the question (a model's), or else what the source's own slides give, read now.
  const proposal = useMemo(() => {
    if (kept) return undefined;
    const stored = pendingAnalyses(question, source)[0];
    if (stored || !source) return stored;
    // The question as it is on screen stands in for its own entry among the questions of its source.
    const group = [question, ...(siblings ?? []).filter((entry) => entry.id !== question.id)];
    return sourceTeachingProposals(source, group, new Date().toISOString()).find((analysis) => analysis.questionId === question.id);
  }, [kept, question, siblings, source]);
  const shown = kept ?? proposal;

  const canAsk = Boolean(provider) && !shown && view.answer !== undefined;
  const pages = shown ? analysisPages(shown) : questionSourcePages(question);
  const page = pagePicked && pages.includes(pagePicked) ? pagePicked : pages[0];
  const taken = undo?.questionId === question.id ? undo : undefined;
  // With nothing to teach and no way to ask, the feedback above already says all there is.
  if (!shown && !canAsk && !taken) return null;

  const notes = (shown?.distractors ?? []).filter((note) => !same(note.whyWrong, question.choiceRationales?.[note.key]));
  const ownExplanation = shown?.explanation && !same(shown.explanation, question.explanation) ? shown.explanation : undefined;

  function decide(analysis: QuestionAnalysis, status: "reviewed" | "rejected") {
    // A discarded reading is not offered again, so the step can be taken back while the question is on screen.
    setUndo(status === "rejected"
      ? { questionId: question.id, analyses: question.analyses, what: analysis.status === "reviewed" ? "Teaching removed." : "Proposal discarded." }
      : undefined);
    onChange(withAnalysisStatus(withAnalysis(question.analyses, analysis), analysis.id, status));
  }

  function takeBack() {
    if (!taken) return;
    onChange(taken.analyses);
    setUndo(undefined);
  }

  async function ask() {
    if (!provider) return;
    setBusy(true);
    setProblem("");
    try {
      const batch = await proposeAnalyses(provider, { questions: [question], documentsById: source ? new Map([[source.id, source]]) : undefined });
      const analysis = batch.analyses[0];
      if (analysis) onChange(withAnalysis(question.analyses, analysis));
      else setProblem(batch.errors[0]?.message ?? "No analysis came back. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading = !shown ? "Teaching from the source"
    : kept ? (kept.origin === "source" ? "From the source" : "A model's reading, kept by you")
    : shown.origin === "source" ? "From the source's slides" : `Proposed by ${shown.provider ?? "a model"}`;

  return (
    <section className="source-teaching" aria-labelledby={headingId}>
      <div className="row spread wrap gap6">
        <div className="stack" style={{ gap: 2 }}>
          <b id={headingId} className="source-teaching-title"><BookOpen size={ICON_SIZE.body} /> {heading}</b>
          {shown && <span className="sub">{[shown.concept, shown.lecture].filter(Boolean).join(" · ")}</span>}
        </div>
        {proposal && (
          <div className="row gap6">
            <GButton size="sm" variant="primary" onClick={() => decide(proposal, "reviewed")}><Check size={ICON_SIZE.body} /> Keep</GButton>
            <GhostButton onClick={() => decide(proposal, "rejected")}><X size={ICON_SIZE.body} /> Discard</GhostButton>
          </div>
        )}
        {kept && <GhostButton onClick={() => decide(kept, "rejected")}><X size={ICON_SIZE.body} /> Remove</GhostButton>}
      </div>
      {proposal && (
        <p className="sub">
          {proposal.origin === "source"
            ? "Read from this question's answer and explanation slides. Check it against the page, then keep it or discard it."
            : "A model wrote this from the source pages. Check it against the page, then keep it or discard it."}
        </p>
      )}

      {shown?.rule && (
        <div className="learning-objective">
          <span>The rule to carry forward</span>
          <p>{shown.rule}</p>
        </div>
      )}
      {shown && shown.decisiveClues.length > 0 && (
        <div className="feedback-explanation">
          <span className="field-label">What decides it</span>
          <ul className="source-teaching-list">{shown.decisiveClues.map((clue) => <li key={clue}>{clue}</li>)}</ul>
        </div>
      )}
      {(ownExplanation || (shown && shown.mechanism.length > 0)) && (
        <div className="feedback-explanation">
          <span className="field-label">Why it is right</span>
          {ownExplanation && <p>{ownExplanation}</p>}
          {shown && shown.mechanism.length > 0 && <ol className="source-teaching-list">{shown.mechanism.map((step) => <li key={step}>{step}</li>)}</ol>}
        </div>
      )}
      {notes.length > 0 && (
        <div className="stack gap6 choice-rationales">
          {notes.map((note) => (
            <div key={note.key} className="rationale-lead">
              <b>Why {note.key} is not the answer</b>
              <p>{note.whyWrong}</p>
              {note.wouldFitIf && <p className="sub">It would fit if {note.wouldFitIf}</p>}
            </div>
          ))}
        </div>
      )}

      {source && page && (
        <div className="source-teaching-trace">
          <div className="row wrap gap6">
            <GhostButton aria-expanded={showPage} onClick={() => setShowPage((open) => !open)}>
              {showPage ? <EyeOff size={ICON_SIZE.body} /> : <Eye size={ICON_SIZE.body} />} {showPage ? "Hide the source page" : `See the source, page ${page}`}
            </GhostButton>
            {showPage && pages.length > 1 && (
              <div className="row gap6" role="group" aria-label="Source pages">
                {pages.map((number) => (
                  <button type="button" key={number} className={`filter-pill ${number === page ? "on" : ""}`}
                    aria-pressed={number === page} onClick={() => setPagePicked(number)}>Page {number}</button>
                ))}
              </div>
            )}
          </div>
          {showPage && <SourcePagePreview document={source} page={page} />}
        </div>
      )}

      {canAsk && (
        <div className="row wrap gap6">
          <GhostButton disabled={busy} onClick={() => void ask()}>
            <Sparkles size={ICON_SIZE.body} /> {busy ? "Reading the source…" : "Ask for an analysis from the source"}
          </GhostButton>
          <span className="sub">Uses one AI request. You review what comes back before it is kept.</span>
        </div>
      )}
      {taken && (
        <div className="row wrap gap6">
          <span className="sub" role="status">{taken.what}</span>
          <GhostButton onClick={takeBack}><Undo2 size={ICON_SIZE.body} /> Undo</GhostButton>
        </div>
      )}
      {problem && <p className="source-page-problem" role="alert">{problem}</p>}
    </section>
  );
}
