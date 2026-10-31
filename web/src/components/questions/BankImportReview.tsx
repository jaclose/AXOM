import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { saveBank, type BankSave } from "../../lib/question-content/bankImport";
import type { PdfBankExtraction } from "../../lib/question-content/pdf/extractPdfBank";
import { assessBank } from "../../lib/question-content/assessBank";
import { withReviewedAnswer } from "../../lib/question-content/readiness";
import { isAssetVisible, type ContentViewMode } from "../../lib/question-content/visibility";
import { summarizePackage } from "../../lib/question-content/validate";
import { courseForScope } from "../../lib/course-engine/questionBank";
import { preparedBankImportOptions } from "../../lib/privateLibrary/install";
import type { PreparedBank } from "../../lib/privateLibrary/types";
import { Field, SelectField, TextAreaField } from "../ui/Modal";
import { GButton, GhostButton } from "../ui/primitives";
import { QuestionBlocks } from "./QuestionContent";
import { BankImportSourcePage } from "./BankImportSourcePage";
import type { ImportFinalizationResult } from "./ImportPanel";
import type { ImportPackage } from "../../lib/question-content/package";
import type { QuestionBlock, TableBlock } from "../../lib/question-content/blocks";
import { editReviewedBlock, editReviewedTableCell, unresolvedExtractionIssues, type ReviewBlockLocation, type ReviewSection } from "../../lib/question-content/reviewEdits";

export type TaggedBank = Extract<PdfBankExtraction, { tagged: true }>;
export type ReviewBank = Omit<Pick<TaggedBank, "pkg" | "conversionIssues" | "files" | "sourceText" | "sourceBytes" | "originalFile" | "notes" | "warnings" | "unplaced">, "sourceText"> & {
  sourceText: { rawText: string; pageTexts?: string[] };
  /** A reviewed destination is layered over immutable source scope. */
  reviewedFiling?: PreparedBank["reviewedFiling"];
};
export function BankImportReview({ bank, onBack, onSaved, onReviewed }: { bank: ReviewBank; onBack: () => void; onSaved?: (result: ImportFinalizationResult) => void; onReviewed?: (pkg: ImportPackage, result: BankSave) => Promise<void> }) {
  const [pkg, setPackage] = useState(bank.pkg);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<ContentViewMode>("question");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BankSave>();
  const [error, setError] = useState("");
  /** The reviewer's own choice; undefined until they pick one, so clearing it is respected. */
  const [answer, setAnswer] = useState<string>();
  const [confirmedAnswerIds, setConfirmedAnswerIds] = useState<ReadonlySet<string>>(() => new Set());
  const assessed = useMemo(() => assessBank(pkg, unresolvedExtractionIssues(bank.conversionIssues, confirmedAnswerIds), bank.files), [pkg, bank, confirmedAnswerIds]);
  const summary = useMemo(() => summarizePackage(pkg, assessed.issues), [pkg, assessed.issues]);
  const question = pkg.questions[index];
  const verdict = question && assessed.verdicts.get(question.id);
  // A marked answer slide suggests a key; it is not a confirmed one. Preselect it
  // for the reviewer, and count it only once they confirm it against the slide.
  const slideKey = question?.correctAnswer?.evidence === "answer-reveal-slide" && question.correctAnswer.labels.length === 1
    && question.choices.some((choice) => choice.label === question.correctAnswer?.labels[0])
    ? question.correctAnswer.labels[0] : "";
  const selectedAnswer = answer ?? slideKey;
  const verifiedKey = question?.correctAnswer
    && ["printed-key", "reviewer"].includes(question.correctAnswer.evidence ?? "")
    && !assessed.issues.some((issue) => issue.questionId === question.id && issue.code === "answer_needs_review");
  // Supporting images are a fallback for unplaced assets. Keep ordered source
  // blocks authoritative so a placed answer slide is not displayed twice.
  const placedAssetIds = new Set(question ? [question.stem, question.explanation ?? [], ...question.choices.map((choice) => choice.blocks)]
    .flat().flatMap((block) => block.type === "image" ? [block.assetId] : []) : []);
  const globalErrors = assessed.issues.filter((issue) => issue.severity === "error" && !issue.questionId);
  const validLocation = bank.reviewedFiling
    ? Boolean(bank.reviewedFiling.module.trim() && /^Term [1-5]$/.test(bank.reviewedFiling.term))
    : Boolean(pkg.manifest.course.name.trim() && pkg.manifest.course.term > 0 && pkg.manifest.course.week > 0);
  function fileUnder(patch: Partial<typeof pkg.manifest.course>) {
    setPackage((current) => ({ ...current, manifest: { ...current.manifest, course: { ...current.manifest.course, ...patch } } }));
    setResult(undefined);
  }
  function edited(patch: ImportPackage) {
    if (patch === pkg) return;
    setPackage(patch);
    if (question) setConfirmedAnswerIds((current) => { const next = new Set(current); next.delete(question.id); return next; });
    setAnswer(undefined);
    setResult(undefined);
  }
  function confirmSourceAnswer() {
    if (!question || !selectedAnswer || mode === "question") return;
    setPackage((current) => ({ ...current, questions: current.questions.map((entry) =>
      entry.id === question.id ? withReviewedAnswer(entry, selectedAnswer) : entry) }));
    setConfirmedAnswerIds((current) => new Set([...current, question.id]));
    setAnswer(undefined); setResult(undefined);
  }
  function editBlock(where: ReviewBlockLocation, value: string) {
    if (question) edited(editReviewedBlock(pkg, question.id, where, value));
  }
  function editTable(where: ReviewBlockLocation | "choiceTable", location: { row: number; column: number } | { header: number }, value: string) {
    if (question) edited(editReviewedTableCell(pkg, question.id, where, location, value));
  }
  function tableEditors(table: TableBlock, where: ReviewBlockLocation | "choiceTable", name: string) {
    return <fieldset key={`${name}-table`} className="stack gap6"><legend>{name} · editable table cells</legend>
      {table.headers?.map((header, i) => <Field key={`${name}-header-${i}`} label={`${name} header ${i + 1}`}
        value={header} onChange={(event) => editTable(where, { header: i }, event.target.value)} />)}
      {table.rows.map((row, r) => <div key={`${name}-row-${r}`} className="row wrap gap6">
        {row.map((value, c) => <Field key={`${name}-cell-${r}-${c}`} label={`${name}, row ${r + 1}, column ${c + 1}`}
          value={value} onChange={(event) => editTable(where, { row: r, column: c }, event.target.value)} />)}
      </div>)}
    </fieldset>;
  }
  function blockEditors(blocks: readonly QuestionBlock[], section: ReviewSection, name: string, choiceId?: string) {
    return blocks.map((block, position) => {
      const where: ReviewBlockLocation = { section, index: position, ...(choiceId ? { choiceId } : {}) };
      const label = `${name} · block ${position + 1}`;
      if (block.type === "text" || block.type === "rich_text" || block.type === "callout") {
        return <TextAreaField key={`${name}-${position}`} label={label} rows={2}
          value={block.type === "rich_text" ? block.html : block.text}
          onChange={(event) => editBlock(where, event.target.value)} />;
      }
      if (block.type === "table") return tableEditors(block, where, label);
      return <p key={`${name}-${position}`} className="sub">{label}: {block.type} is preserved unchanged. Correct the source document to replace this media.</p>;
    });
  }
  async function save() {
    setBusy(true); setError(""); setResult(undefined);
    try {
      const options = bank.reviewedFiling
        ? preparedBankImportOptions({
          pkg,
          issues: bank.conversionIssues,
          sourceText: bank.sourceText,
          sourceBytes: bank.sourceBytes,
          notes: bank.notes,
          reviewedFiling: bank.reviewedFiling,
        })
        : {
          sourceText: bank.sourceText,
          sourceBytes: bank.sourceBytes,
          notes: bank.notes,
          courseId: courseForScope({ module: pkg.manifest.course.name }, useStore.getState().courses)?.id,
        };
      const saved = await saveBank(pkg, assessed.issues, bank.files, {
        library: () => { const state = useStore.getState(); return { questions: state.questions ?? [], questionSets: state.questionSets ?? [], documents: state.documents ?? [] }; },
        store: () => useStore.getState(),
      }, { ...options, originalFile: bank.originalFile });
      if (saved.status !== "failed") await onReviewed?.(pkg, saved);
      setResult(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The import could not be saved. Keep this source file and try again."); }
    finally { setBusy(false); }
  }
  const savedIds = result?.sections.flatMap((section) => section.savedIds) ?? [];
  return <section className="bank-import-review stack" aria-label="Source question bank preview" style={{ gap: 18 }}>
    <header><p className="sub">Source → Review → Save</p><h2>{pkg.manifest.bank.title}</h2>
      <p role="status">{pkg.questions.length} questions · {assessed.counts.ready} ready for import · {assessed.counts["needs-review"]} need review · {assessed.counts.unresolved} unresolved</p>
      <p className="sub">{summary.tables} tables · {summary.images} images · {summary.answerReveals} answer-reveal images</p>
    </header>
    <div className="grid grid-3">
      <Field label={bank.reviewedFiling ? "Source module" : "Bank module"} disabled={Boolean(bank.reviewedFiling)} value={pkg.manifest.course.name} onChange={(event) => fileUnder({ name: event.target.value })} />
      <Field label={bank.reviewedFiling ? "Source term" : "Bank term"} disabled={Boolean(bank.reviewedFiling)} type="number" min={1} value={pkg.manifest.course.term || ""} onChange={(event) => fileUnder({ term: Number(event.target.value) })} />
      <Field label={bank.reviewedFiling ? "Source week" : "Bank week"} disabled={Boolean(bank.reviewedFiling)} type="number" min={1} value={pkg.manifest.course.week || ""} onChange={(event) => fileUnder({ week: Number(event.target.value) })} />
    </div>
    {bank.reviewedFiling
      ? <p className="sub">Source evidence stays {pkg.manifest.course.name} · Term {pkg.manifest.course.term} · Week {pkg.manifest.course.week}. Reviewed placement: {bank.reviewedFiling.module} · {bank.reviewedFiling.term} · week unassigned.</p>
      : !pkg.manifest.source.sourceWeekDeclared && <p className="sub">The week is your filing choice; it is not stated by the source.</p>}
    {[...bank.warnings, ...bank.unplaced.map((entry) => entry.reason), ...globalErrors.map((issue) => issue.message)].map((note, n) => <p key={n} className="sub">{note}</p>)}
    {question && <article className="bank-import-question">
      <div className="row wrap gap8">
        <GhostButton disabled={index === 0} onClick={() => { setIndex(index - 1); setAnswer(undefined); }}>Previous question</GhostButton>
        <span>Question {index + 1} of {pkg.questions.length}</span>
        <GhostButton disabled={index === pkg.questions.length - 1} onClick={() => { setIndex(index + 1); setAnswer(undefined); }}>Next question</GhostButton>
        <SelectField label="Preview mode" value={mode} onChange={(event) => setMode(event.target.value as ContentViewMode)}>
          <option value="question">While answering</option><option value="answered">After answering</option><option value="review">Source review</option>
        </SelectField>
      </div>
      <p className="sub">{verdict?.readiness === "ready" ? "READY FOR IMPORT" : verdict?.readiness === "needs-review" ? "NEEDS REVIEW" : "UNRESOLVED"} · Source page {question.source.page ?? "not stated"}{question.source.set ? ` · Set ${question.source.set}` : ""}{question.source.questionNumber !== undefined ? ` · Original question ${question.source.questionNumber}` : ""}</p>
      {mode === "review" && <BankImportSourcePage originalFile={bank.originalFile} sourceName={pkg.manifest.source.filename} sourcePage={question.source.page} />}
      <QuestionBlocks blocks={question.stem} content={question} files={bank.files} mode={mode} />
      {question.choiceTable && <QuestionBlocks blocks={[question.choiceTable]} content={question} files={bank.files} mode={mode} section="choice" />}
      <ol className="bank-import-choices">{question.choices.map((choice) => <li key={choice.id}><b>{choice.label}.</b><QuestionBlocks blocks={choice.blocks} content={question} files={bank.files} mode={mode} section="choice" /></li>)}</ol>
      {mode !== "question" && <>
        <p>{question.correctAnswer ? `${verifiedKey ? "Source key" : "Candidate key (unverified)"}: ${question.correctAnswer.labels.join(", ")}` : "Answer: Requires verification"}</p>
        <QuestionBlocks blocks={question.explanation ?? []} content={question} files={bank.files} mode={mode} section="explanation" />
        <QuestionBlocks blocks={question.assets.filter((asset) => !placedAssetIds.has(asset.id) && ["answer_reveal", "reference", "source_page"].includes(asset.role) && isAssetVisible(asset.role, mode)).map((asset) => ({ type: "image", assetId: asset.id, role: asset.role, alt: "Source answer or reference" }))} content={question} files={bank.files} mode={mode} />
      </>}
      <details className="stack gap8" aria-label={`Edit question ${index + 1} from source`}>
        <summary>Correct extracted text, answer choices or tables</summary>
        <p className="sub">Only this question is edited. Figures, equations, source pages, stable IDs and block order remain intact. Any edit clears the prior verified key until you confirm it again against the original.</p>
        {blockEditors(question.stem, "stem", `Question ${index + 1} stem`)}
        {question.choiceTable && tableEditors(question.choiceTable, "choiceTable", "Shared answer table")}
        {question.choices.map((choice) => <div key={choice.id} className="stack gap6">
          {blockEditors(choice.blocks, "choice", `Choice ${choice.label}`, choice.id)}
        </div>)}
        {question.explanation?.length ? blockEditors(question.explanation, "explanation", "Explanation") : <p className="sub">The source has no extracted explanation. Add it to the original document and reimport if needed.</p>}
      </details>
      {verdict && [...verdict.reasons, ...verdict.advisories].map((note, n) => <p key={n} className="sub">{note}</p>)}
      {verdict?.readiness !== "ready" && slideKey && <p className="sub">The original answer slide marks {slideKey}. It stays a suggestion until you check the slide and confirm it.</p>}
      {verdict?.readiness !== "ready" && <div className="row wrap gap8">
        <SelectField label="Verified answer" value={selectedAnswer} onChange={(event) => setAnswer(event.target.value)}><option value="">Choose after checking the source</option>{question.choices.map((choice) => <option key={choice.id}>{choice.label}</option>)}</SelectField>
        <GButton disabled={!selectedAnswer || mode === "question"} onClick={confirmSourceAnswer}>Confirm answer from source</GButton>
      </div>}
    </article>}
    {error && <p role="alert">{error}</p>}
    {result && <div role={result.status === "failed" || result.status === "partial" ? "alert" : "status"}>
      {result.status === "saved" ? `${savedIds.length} question${savedIds.length === 1 ? "" : "s"} saved on this device.`
        : result.status === "already-saved" ? "Already imported. No duplicate questions were added."
        : result.status === "partial" ? `${savedIds.length} question${savedIds.length === 1 ? "" : "s"} saved on this device. Other bank sections still need attention; retry will reuse these records.`
        : result.status === "nothing-ready" ? "No answer-ready questions to save yet."
        : "No bank section finished. Nothing new was reported as saved."}
      {result.errors.map((note) => <p key={note}>{note}</p>)}
      {result.incompleteSections.filter((section) => section.savedIds.length > 0).map((section) => <p key={`${section.setTitle}-${section.questionIds.join("-")}-${section.reason}`}>{section.savedIds.length} existing question{section.savedIds.length === 1 ? " remains" : "s remain"} saved, but {section.reason}</p>)}
      {result.sections.flatMap((section) => section.images.problems).map((note) => <p key={note}>{note}</p>)}
      {result.held.length > 0 && <p>{result.held.length} question{result.held.length === 1 ? "" : "s"} still need{result.held.length === 1 ? "s" : ""} review and {result.held.length === 1 ? "was" : "were"} not imported. Keep the source file to review {result.held.length === 1 ? "it" : "them"} later.</p>}
    </div>}
    <div className="row wrap gap8">
      <GhostButton disabled={busy} onClick={onBack}>Choose another file</GhostButton>
      <GButton variant="primary" disabled={busy || !validLocation || !assessed.counts.ready || Boolean(globalErrors.length)} onClick={() => void save()}>{busy ? "Saving…" : `Import ${assessed.counts.ready} answer-ready question${assessed.counts.ready === 1 ? "" : "s"}`}</GButton>
      {savedIds.length > 0 && <GButton onClick={() => onSaved?.({ setId: result?.sections[0]?.setId, documentId: result?.sections[0]?.documentId, questionIds: savedIds })}>Open imported bank</GButton>}
    </div>
  </section>;
}
