import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { saveBank, type BankSave } from "../../lib/question-content/bankImport";
import type { PdfBankExtraction } from "../../lib/question-content/pdf/extractPdfBank";
import { assessBank } from "../../lib/question-content/assessBank";
import { withReviewedAnswer } from "../../lib/question-content/readiness";
import { isAssetVisible, type ContentViewMode } from "../../lib/question-content/visibility";
import { summarizePackage } from "../../lib/question-content/validate";
import { courseForScope } from "../../lib/course-engine/questionBank";
import { Field, SelectField } from "../ui/Modal";
import { GButton, GhostButton } from "../ui/primitives";
import { QuestionBlocks } from "./QuestionContent";
import type { ImportFinalizationResult } from "./ImportPanel";

export type TaggedBank = Extract<PdfBankExtraction, { tagged: true }>;
export function BankImportReview({ bank, onBack, onSaved }: { bank: TaggedBank; onBack: () => void; onSaved?: (result: ImportFinalizationResult) => void }) {
  const [pkg, setPackage] = useState(bank.pkg);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<ContentViewMode>("question");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BankSave>();
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const assessed = useMemo(() => assessBank(pkg, bank.conversionIssues, bank.files), [pkg, bank]);
  const summary = useMemo(() => summarizePackage(pkg, assessed.issues), [pkg, assessed.issues]);
  const question = pkg.questions[index];
  const verdict = question && assessed.verdicts.get(question.id);
  const globalErrors = assessed.issues.filter((issue) => issue.severity === "error" && !issue.questionId);
  const validLocation = pkg.manifest.course.name.trim() && pkg.manifest.course.term > 0 && pkg.manifest.course.week > 0;
  function fileUnder(patch: Partial<typeof pkg.manifest.course>) {
    setPackage((current) => ({ ...current, manifest: { ...current.manifest, course: { ...current.manifest.course, ...patch } } }));
    setResult(undefined);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const saved = await saveBank(pkg, assessed.issues, bank.files, {
        library: () => { const state = useStore.getState(); return { questions: state.questions ?? [], questionSets: state.questionSets ?? [], documents: state.documents ?? [] }; },
        store: () => useStore.getState(),
      }, { sourceText: bank.sourceText, sourceBytes: bank.sourceBytes, notes: bank.notes,
        courseId: courseForScope({ module: pkg.manifest.course.name }, useStore.getState().courses)?.id });
      setResult(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The import could not be saved. Keep this source file and try again."); }
    finally { setBusy(false); }
  }
  const savedIds = result?.sections.flatMap((section) => section.savedIds) ?? [];
  return <section className="bank-import-review stack" aria-label="PDF bank preview" style={{ gap: 18 }}>
    <header><p className="sub">Source → Review → Save</p><h2>{pkg.manifest.bank.title}</h2>
      <p role="status">{pkg.questions.length} questions · {assessed.counts.ready} ready · {assessed.counts["needs-review"]} need review · {assessed.counts.unresolved} unresolved</p>
      <p className="sub">{summary.tables} tables · {summary.images} images · {summary.answerReveals} answer-reveal images</p>
    </header>
    <div className="grid grid-3">
      <Field label="Bank module" value={pkg.manifest.course.name} onChange={(event) => fileUnder({ name: event.target.value })} />
      <Field label="Bank term" type="number" min={1} value={pkg.manifest.course.term || ""} onChange={(event) => fileUnder({ term: Number(event.target.value) })} />
      <Field label="Bank week" type="number" min={1} value={pkg.manifest.course.week || ""} onChange={(event) => fileUnder({ week: Number(event.target.value) })} />
    </div>
    {!pkg.manifest.source.sourceWeekDeclared && <p className="sub">The week is your filing choice; it is not stated by the source.</p>}
    {[...bank.warnings, ...bank.unplaced.map((entry) => entry.reason), ...globalErrors.map((issue) => issue.message)].map((note, n) => <p key={n} className="sub">{note}</p>)}
    {question && <article className="bank-import-question">
      <div className="row wrap gap8">
        <GhostButton disabled={index === 0} onClick={() => { setIndex(index - 1); setAnswer(""); }}>Previous question</GhostButton>
        <span>Question {index + 1} of {pkg.questions.length}</span>
        <GhostButton disabled={index === pkg.questions.length - 1} onClick={() => { setIndex(index + 1); setAnswer(""); }}>Next question</GhostButton>
        <SelectField label="Preview mode" value={mode} onChange={(event) => setMode(event.target.value as ContentViewMode)}>
          <option value="question">While answering</option><option value="answered">After answering</option><option value="review">Source review</option>
        </SelectField>
      </div>
      <p className="sub">{verdict?.readiness === "ready" ? "READY" : "NEEDS REVIEW"} · Source page {question.source.page ?? "not stated"}{question.source.set ? ` · Set ${question.source.set}` : ""} · Original question {question.source.questionNumber ?? index + 1}</p>
      <QuestionBlocks blocks={question.stem} content={question} files={bank.files} mode={mode} />
      {question.choiceTable && <QuestionBlocks blocks={[question.choiceTable]} content={question} files={bank.files} mode={mode} section="choice" />}
      <ol className="bank-import-choices">{question.choices.map((choice) => <li key={choice.id}><b>{choice.label}.</b><QuestionBlocks blocks={choice.blocks} content={question} files={bank.files} mode={mode} section="choice" /></li>)}</ol>
      {mode !== "question" && <>
        <p>Answer: {question.correctAnswer?.labels.join(", ") || "Requires verification"}</p>
        <QuestionBlocks blocks={question.explanation ?? []} content={question} files={bank.files} mode={mode} section="explanation" />
        <QuestionBlocks blocks={question.assets.filter((asset) => ["answer_reveal", "reference", "source_page"].includes(asset.role) && isAssetVisible(asset.role, mode)).map((asset) => ({ type: "image", assetId: asset.id, role: asset.role, alt: "Source answer or reference" }))} content={question} files={bank.files} mode={mode} />
      </>}
      {verdict && [...verdict.reasons, ...verdict.advisories].map((note, n) => <p key={n} className="sub">{note}</p>)}
      {verdict?.readiness !== "ready" && <div className="row wrap gap8">
        <SelectField label="Verified answer" value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">Choose after checking the source</option>{question.choices.map((choice) => <option key={choice.id}>{choice.label}</option>)}</SelectField>
        <GButton disabled={!answer || mode === "question"} onClick={() => { setPackage({ ...pkg, questions: pkg.questions.map((entry) => entry.id === question.id ? withReviewedAnswer(entry, answer) : entry) }); setAnswer(""); setResult(undefined); }}>Confirm answer from source</GButton>
      </div>}
    </article>}
    {error && <p role="alert">{error}</p>}
    {result && <div role={result.status === "failed" ? "alert" : "status"}>
      {result.status === "saved" ? `${savedIds.length} question${savedIds.length === 1 ? "" : "s"} saved on this device.` : result.status === "already-saved" ? "Already imported. No duplicate questions were added." : result.status === "nothing-ready" ? "No verified questions to save yet." : "The import did not finish."}
      {result.errors.map((note) => <p key={note}>{note}</p>)}
      {result.sections.flatMap((section) => section.images.problems).map((note) => <p key={note}>{note}</p>)}
      {result.held.length > 0 && <p>{result.held.length} question{result.held.length === 1 ? "" : "s"} still need{result.held.length === 1 ? "s" : ""} review and {result.held.length === 1 ? "was" : "were"} not imported. Keep the source file to review {result.held.length === 1 ? "it" : "them"} later.</p>}
    </div>}
    <div className="row wrap gap8">
      <GhostButton disabled={busy} onClick={onBack}>Choose another file</GhostButton>
      <GButton variant="primary" disabled={busy || !validLocation || !assessed.counts.ready || Boolean(globalErrors.length)} onClick={() => void save()}>{busy ? "Saving…" : `Import ${assessed.counts.ready} verified questions`}</GButton>
      {savedIds.length > 0 && <GButton onClick={() => onSaved?.({ setId: result?.sections[0]?.setId, documentId: result?.sections[0]?.documentId, questionIds: savedIds })}>Open imported bank</GButton>}
    </div>
  </section>;
}
