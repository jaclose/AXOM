import { useState } from "react";
import { BookOpen, ChevronRight, Eye, FileText, Lightbulb } from "lucide-react";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionAnalysis } from "../../lib/decodeTypes";
import { useStore } from "../../lib/store";
import { useDecodeState } from "../../lib/decodeWorkspace";
import { analysisIsCurrent } from "../../lib/decode";
import { SourcePagePreview } from "./SourcePagePreview";

type TutorDepth = "full" | "high-yield" | "presenter" | "handout" | "visual" | "repair";
const DEPTHS: Array<[TutorDepth, string]> = [["full", "Full"], ["high-yield", "High-yield"], ["presenter", "Presenter"], ["handout", "Handout"], ["visual", "Visual"], ["repair", "Repair"]];

/** Mount only after answer commitment, or an explicit review action outside practice. */
export function DecodeTutor({ question, analysis: supplied, preview = false }: { question: QuestionRecord; analysis?: QuestionAnalysis; preview?: boolean }) {
  const s = useStore();
  const decode = useDecodeState();
  const [depth, setDepth] = useState<TutorDepth>("full");
  const [stage, setStage] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const analysis = supplied ?? decode.analyses.find((item) => item.questionId === question.id && item.status === "reviewed" && analysisIsCurrent(item, question, s.documents));
  const rationale = analysis?.explanation || question.explanation;
  const rule = analysis?.rule;
  const sourcePages = analysis?.sourcePages.length ? analysis.sourcePages : question.sourcePage ? [question.sourcePage] : [];
  const [selectedPage, setSelectedPage] = useState<number>();
  const reference = analysis?.references[0];
  const documentId = question.sourceDocumentId ?? reference?.documentId;
  const page = selectedPage ?? reference?.page ?? sourcePages[0];
  const answer = question.options.find((option) => option.key === question.correctKey);
  const distractors = analysis?.distractors.length ? analysis.distractors : Object.entries(question.choiceRationales ?? {}).filter(([key]) => key !== question.correctKey).map(([key, whyWrong]) => ({ key, whyWrong, wouldFitIf: undefined }));
  const presenter = depth === "presenter";
  const reveal = !presenter || stage > 0;
  const full = depth === "full" || depth === "handout" || (presenter && stage > 1);

  return <section className={`decode-tutor decode-tutor-${depth}`} aria-label="Source-grounded tutor">
    <header><div><span className="decode-eyebrow">{analysis?.origin === "ai" ? "Reviewed AI teaching" : "Source teaching"}</span><h3>{analysis?.concept || "Understand the distinction"}</h3></div>
      {analysis?.lecture && <span className="decode-lecture"><BookOpen size={15} />{analysis.lecture}</span>}</header>
    {preview && <p className="decode-notice">Import preview. Check the source and answer before accepting.</p>}
    <div className="decode-mode-switch" aria-label="Tutor depth">{DEPTHS.map(([id, label]) => <button type="button" key={id} aria-pressed={depth === id} onClick={() => { setDepth(id); setStage(0); }}>{label}</button>)}</div>
    {presenter && <div className="decode-presenter"><p>{question.stem}</p>{!reveal && <p className="decode-muted">Commit to an answer before revealing the explanation.</p>}<button type="button" className="gbtn" onClick={() => setStage((n) => Math.min(3, n + 1))} disabled={stage >= 3}>{["Reveal answer", "Explain why", "Show the rule", "Complete"][stage]}<ChevronRight size={16} /></button></div>}
    {reveal && <>
      <div className="decode-answer"><span>Source answer</span><strong>{answer ? `${answer.key}. ${answer.text}` : "No confirmed source answer"}</strong></div>
      {depth !== "visual" && (rule ? <div className="decode-rule"><Lightbulb size={18} /><div><span>The rule to carry forward</span><p>{rule}</p></div></div> : <p className="decode-muted">No compressed rule has been supplied. Review the source explanation or request an analysis in Decode.</p>)}
      {depth === "repair" ? <div className="decode-repair"><h4>Rebuild, then retrieve</h4><ol><li>State the rule without looking.</li><li>Identify the clue that separates your choice from the source answer.</li><li>Explain why the nearest distractor fails here.</li><li>Try an available related question in a fresh block.</li></ol><p>Reading this page does not count as a repaired concept. Later retrieval is the evidence.</p></div> : null}
      {analysis?.decisiveClues.length ? <div className="decode-clues"><h4>Decisive clues</h4><ul>{analysis.decisiveClues.map((clue, i) => <li key={i}>{clue}</li>)}</ul></div> : null}
      {full && <div className="decode-reasoning"><div><h4>Why it is right</h4><p className="decode-preserve">{rationale || "No source explanation supplied."}</p>{analysis?.mechanism.length ? <ol>{analysis.mechanism.map((step, i) => <li key={i}>{step}</li>)}</ol> : null}</div>
        <div><h4>Why the others are wrong</h4>{question.options.filter((option) => option.key !== question.correctKey).map((option) => { const why = distractors.find((item) => item.key === option.key); return <div className="decode-distractor" key={option.key}><b>{option.key}</b><div><strong>{option.text}</strong><p>{why?.whyWrong || "Not explained in the supplied source."}</p>{why?.wouldFitIf && <p><em>Would fit if:</em> {why.wouldFitIf}</p>}</div></div>; })}</div></div>}
      {depth === "high-yield" && distractors.length > 0 && <div><h4>Do not confuse</h4>{distractors.slice(0, 2).map((item) => <p key={item.key}>{item.whyWrong}</p>)}</div>}
    </>}
    {reveal && documentId && page && <div className="decode-trace"><button type="button" className="decode-link" onClick={() => setShowSource((v) => !v)}><Eye size={16} />{showSource ? "Close source" : "Trace to source"} · page {page}</button>
      {sourcePages.length > 1 && <label>Source page <select value={page} onChange={(e) => { setSelectedPage(Number(e.target.value)); setShowSource(true); }}>{sourcePages.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>}
      {(showSource || depth === "visual") && <SourcePagePreview documentId={documentId} page={page} />}
      {analysis?.references.map((ref, i) => <details key={i}><summary><FileText size={13} /> Evidence · page {ref.page}</summary><blockquote>{ref.quote}</blockquote></details>)}
    </div>}
    {reveal && (!documentId || !page) && <p className="decode-muted">No source-page mapping is available for this question.</p>}
  </section>;
}
