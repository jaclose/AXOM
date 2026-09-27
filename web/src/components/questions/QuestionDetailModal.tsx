// ===========================================================================
// Answer + review flow for a single question. Answer → reveal → capture WHY
// (confidence, guessed?, error type on a miss, note) → optionally turn the
// miss into an error-repair card in one tap (the Capture → Review link in the
// daily loop).
// ===========================================================================
import { useEffect, useRef, useState } from "react";
import { PencilLine, Trash2, WandSparkles } from "lucide-react";
import { useStore } from "../../lib/store";
import {
  ERROR_TYPE_LABEL,
  QUESTION_MAPPING_STATUS_LABEL, questionMappingStatus,
  type QuestionErrorType, type QuestionRecord, type QuestionStatus,
} from "../../lib/questions";
import { newSchedule } from "../../lib/ankiCards";
import { Modal, TextAreaField, SelectField } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { pushToast } from "../../lib/toast";
import { QuestionProvenance, QuizFeedback } from "./QuizFeedback";
import { sourceCandidates, type QuestionEvidenceKind, type SourceCandidate } from "../../lib/questionProvenance";
import { ICON_SIZE } from "../../lib/iconSize";
import { createTextAnnotationWithIntegrity, removeTextAnnotationById, type QuestionAnnotationTarget, type QuestionAnnotationTone } from "../../lib/questionAnnotations";
import { AnnotatedQuestionText, type QuestionTextSelection } from "./AnnotatedQuestionText";
import { QuestionAnnotationToolbar } from "./QuestionAnnotationToolbar";
import { QuestionNotesPanel } from "./QuestionNotesPanel";
import { QuestionAttachmentsPanel } from "./QuestionAttachmentsPanel";

const ERROR_TYPES = Object.keys(ERROR_TYPE_LABEL) as QuestionErrorType[];

export function QuestionDetailModal({ question, onClose }: { question: QuestionRecord; onClose: () => void }) {
  const s = useStore();
  const [picked, setPicked] = useState<string | undefined>();
  const [firstPick, setFirstPick] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [guessed, setGuessed] = useState(false);
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5 | undefined>();
  const [errorType, setErrorType] = useState<QuestionErrorType | "">("");
  const [note, setNote] = useState("");
  const [editingMapping, setEditingMapping] = useState(false);
  const [mappingKey, setMappingKey] = useState(question.correctKey ?? "");
  const [sourceReviewOpen, setSourceReviewOpen] = useState(false);
  const [sourceKind, setSourceKind] = useState<QuestionEvidenceKind>("question");
  const [startedAt] = useState(() => Date.now());
  const [annotations, setAnnotations] = useState(() => question.annotations ?? []);
  const [attachmentsList, setAttachmentsList] = useState(() => question.attachments ?? []);
  const annotationsRef = useRef(annotations);
  const [annotationStatus, setAnnotationStatus] = useState<string>();
  const [annotationTone, setAnnotationTone] = useState<QuestionAnnotationTone>("yellow");
  const [annotationSelection, setAnnotationSelection] = useState<{
    target: QuestionAnnotationTarget;
    range: QuestionTextSelection;
  } | null>(null);

  // Track answer changes so "Changed Answer" mode has real data.
  useEffect(() => {
    if (picked && !firstPick) setFirstPick(picked);
  }, [picked, firstPick]);

  const mappingStatus = questionMappingStatus(question);
  const hasTrustedKey = mappingStatus === "ready";
  const isCorrect = hasTrustedKey && picked === question.correctKey;
  const changed = Boolean(firstPick && picked && firstPick !== picked);
  const sourceDocument = (s.documents ?? []).find((document) => document.id === question.sourceDocumentId);
  const sourceNeedle = sourceKind === "question"
    ? question.stem
    : sourceKind === "answer"
      ? question.extraction?.answerEvidenceSnippet ?? question.extraction?.answerEvidence
      : question.extraction?.explanationSourceSnippet ?? question.explanation;
  const sourceAnchorPage = sourceKind === "question"
    ? question.extraction?.questionSourcePage ?? question.sourcePage
    : sourceKind === "answer"
      ? question.extraction?.answerEvidencePage ?? question.extraction?.questionSourcePage ?? question.sourcePage
      : question.extraction?.explanationSourcePage ?? question.extraction?.questionSourcePage ?? question.sourcePage;
  const candidates = sourceDocument ? sourceCandidates(sourceDocument, sourceKind, sourceNeedle, {
    anchorPage: sourceAnchorPage,
    anchorNeedle: question.stem,
  }) : [];

  function saveAnnotation() {
    if (!annotationSelection) return;
    const sourceText = annotationSelection.target === "stem" ? question.stem : question.explanation ?? "";
    const now = new Date().toISOString();
    const result = createTextAnnotationWithIntegrity({
      id: `annotation-${crypto.randomUUID()}`,
      target: annotationSelection.target,
      sourceText,
      startOffset: annotationSelection.range.startOffset,
      endOffset: annotationSelection.range.endOffset,
      tone: annotationTone,
      now,
      existingAnnotations: annotationsRef.current,
    });
    if (result.status !== "created") {
      setAnnotationStatus(result.status === "overlap" ? result.reason : undefined);
      return;
    }
    const next = [...annotationsRef.current, result.annotation];
    annotationsRef.current = next;
    setAnnotations(next);
    s.updateQuestion(question.id, { annotations: next });
    setAnnotationSelection(null);
    setAnnotationStatus("Highlight saved.");
    window.getSelection()?.removeAllRanges();
  }

  function submit() {
    if (!picked && question.options.length > 0) return;
    setRevealed(true);
  }

  function deleteAnnotation(annotationId: string) {
    const next = removeTextAnnotationById(annotationsRef.current, annotationId);
    if (next.length === annotationsRef.current.length) return;
    annotationsRef.current = next;
    setAnnotations(next);
    s.updateQuestion(question.id, { annotations: next });
    setAnnotationStatus("Highlight deleted.");
  }

  function saveAttempt() {
    let status: QuestionStatus;
    if (!hasTrustedKey) status = "needs-review";
    else if (isCorrect) status = guessed ? "guessed" : "correct";
    else status = "incorrect";
    s.recordQuestionAttempt(question.id, {
      answerKey: picked,
      status,
      confidence,
      timeSpentSeconds: Math.round((Date.now() - startedAt) / 1000),
      changedFromKey: changed ? firstPick : undefined,
      errorType: status === "incorrect" || status === "guessed" ? (errorType || undefined) : undefined,
      note: note.trim() || undefined,
    });
    onClose();
  }

  function makeRepairCard() {
    const correct = hasTrustedKey ? question.options.find((o) => o.key === question.correctKey) : undefined;
    const result = s.addAnkiCards([{
      type: "error-repair",
      front: `You missed this: ${question.stem.slice(0, 300)}${question.stem.length > 300 ? "…" : ""}`,
      back: [
        correct ? `Correct: ${correct.key}. ${correct.text}` : "Set the correct answer on the question first.",
        question.explanation?.trim() ?? "",
        errorType ? `Why missed: ${ERROR_TYPE_LABEL[errorType as QuestionErrorType]}` : "",
      ].filter(Boolean).join("\n\n"),
      source: question.citation ?? "Question Workspace",
      tags: ["error-repair", ...(question.topic ? [question.topic] : [])],
      questionId: question.id,
      aiGenerated: false,
      schedule: newSchedule(),
    }]);
    pushToast(result.saved
      ? { title: "Repair card created", body: "It's due now in the Anki Lab review queue.", tone: "success" }
      : { title: "Couldn't create card", body: result.errors.join(" "), tone: "warn" });
  }

  function remove() {
    if (!confirm("Permanently delete this question and its attempt history? It will be safely unlinked from question sets.")) return;
    s.removeQuestion(question.id);
    onClose();
  }

  function repairMapping() {
    const correctOption = question.options.find((option) => option.key === mappingKey);
    if (!correctOption) return;
    const reviewedAt = new Date().toISOString();
    s.updateQuestion(question.id, {
      correctKey: mappingKey,
      correctAnswerText: correctOption.text,
      needsReview: false,
      extraction: question.extraction ? {
        ...question.extraction,
        reviewed: true,
        reviewedAt,
        answerDetectionConfidence: 1,
      } : undefined,
    });
    pushToast({ title: "Answer mapping confirmed", body: `${mappingKey}. ${correctOption.text}`, tone: "success" });
    onClose();
  }

  function openSourceReview() {
    setSourceReviewOpen(true);
    setEditingMapping(true);
  }

  function selectSourceCandidate(candidate: SourceCandidate) {
    const extraction = {
      ...(question.extraction ?? { confidence: "medium" as const, reviewed: true }),
    };
    if (candidate.kind === "question") {
      extraction.questionSourceSnippet = candidate.snippet;
      extraction.questionSourcePage = candidate.page;
    } else if (candidate.kind === "answer") {
      extraction.answerEvidenceSnippet = candidate.snippet;
      extraction.answerEvidencePage = candidate.page;
    } else {
      extraction.explanationSourceSnippet = candidate.snippet;
      extraction.explanationSourcePage = candidate.page;
    }
    s.updateQuestion(question.id, {
      extraction,
      ...(candidate.kind === "question" ? { sourcePage: candidate.page } : {}),
    });
    pushToast({ title: "Source updated", body: "Only the selected provenance excerpt changed. Attempts and practice status were preserved.", tone: "success" });
    onClose();
  }

  return (
    <Modal
      title={question.topic ? `Question · ${question.topic}` : "Question"}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={remove}><Trash2 size={ICON_SIZE.body} /> Delete</GhostButton>
          {!revealed
            ? <GButton variant="primary" onClick={submit} disabled={!picked && question.options.length > 0}>Check answer</GButton>
            : <GButton variant="primary" onClick={saveAttempt}>Save attempt</GButton>}
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <Tag tone="neutral">{question.status}</Tag>
        {question.category && <Tag tone="neutral">{question.category}</Tag>}
        {question.system && <Tag tone="neutral">{question.system}</Tag>}
        {question.bank && <Tag tone="neutral">{question.bank}</Tag>}
        {question.ai?.generated && <Tag tone="purple">AI-generated</Tag>}
        {mappingStatus !== "ready" && (
          <Tag tone={mappingStatus === "unresolved" ? "red" : "orange"}>{QUESTION_MAPPING_STATUS_LABEL[mappingStatus]}</Tag>
        )}
        {question.citation && <span className="sub">{question.citation}</span>}
        <button className={`filter-pill ${question.marked ? "on" : ""}`} onClick={() => s.toggleQuestionMarked(question.id)}>
          {question.marked ? "Marked ✓" : "Mark for review"}
        </button>
      </div>

      <QuestionAnnotationToolbar
        activeMode={{ kind: "highlight", tone: annotationTone }}
        hasSelection={Boolean(annotationSelection)}
        onHighlightMode={setAnnotationTone}
        onEraserMode={() => setAnnotationStatus("Use Delete or Backspace on a focused highlight.")}
        onHighlight={saveAnnotation}
        onClear={() => {
          annotationsRef.current = [];
          setAnnotations([]);
          s.updateQuestion(question.id, { annotations: [] });
          setAnnotationSelection(null);
          setAnnotationStatus("Highlights cleared.");
        }}
        statusMessage={annotationStatus}
      />

      <AnnotatedQuestionText
        text={question.stem}
        annotations={annotations.filter((annotation) => annotation.target === "stem")}
        className="question-stem"
        label="Question stem"
        onDelete={deleteAnnotation}
        onSelection={(range) => setAnnotationSelection(range ? { target: "stem", range } : null)}
      />

      <QuestionProvenance
        question={question}
        sourceTitle={sourceDocument?.title}
        onSourceLooksWrong={openSourceReview}
      />

      {sourceReviewOpen && (
        <section className="mapping-repair" aria-label="Source review">
          <div className="row spread wrap gap6">
            <div className="stack" style={{ gap: 2 }}>
              <b>Review source evidence</b>
              <span className="sub">Choose only an excerpt you can verify. Changing it will not alter the question or its attempts.</span>
            </div>
            <GhostButton onClick={() => setSourceReviewOpen(false)}>Close source review</GhostButton>
          </div>
          <div className="row wrap gap6">
            {(["question", "answer", "explanation"] as QuestionEvidenceKind[]).map((kind) => (
              <button key={kind} className={`filter-pill ${sourceKind === kind ? "on" : ""}`} onClick={() => setSourceKind(kind)}>
                {kind === "question" ? "Question source" : kind === "answer" ? "Answer evidence" : "Explanation source"}
              </button>
            ))}
          </div>
          {candidates.length > 0 ? (
            <div className="stack gap6">
              {candidates.map((candidate, index) => (
                <button
                  key={`${candidate.page ?? 0}-${index}`}
                  className="source-candidate"
                  onClick={() => selectSourceCandidate(candidate)}
                >
                  <span className="source-line"><b>{candidate.basis === "nearby" ? "Use nearby excerpt" : "Use this excerpt"}</b>{candidate.page && <span>page {candidate.page}</span>}</span>
                  <span>{candidate.snippet.slice(0, 320)}{candidate.snippet.length > 320 ? "…" : ""}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="sub">No exact nearby excerpt was found in the linked source. AXOM will not substitute unrelated text.</p>
          )}
        </section>
      )}

      {(mappingStatus !== "ready" || sourceReviewOpen) && (
        <section className="mapping-repair" aria-label="Answer mapping review">
          <div className="row spread wrap">
            <div className="stack" style={{ gap: 2 }}>
              <b>{mappingStatus === "ready" ? "Review the answer mapping" : "Confirm the correct answer before practice"}</b>
              <span className="sub">This updates mapping metadata only. Existing attempts and practice status stay unchanged.</span>
            </div>
            <GhostButton onClick={() => setEditingMapping((value) => !value)}>
              <PencilLine size={ICON_SIZE.body} /> {editingMapping ? "Cancel" : "Review answer mapping"}
            </GhostButton>
          </div>
          {editingMapping && (
            <div className="stack gap6">
              <SelectField
                label="Correct answer mapping"
                value={mappingKey}
                onChange={(event) => setMappingKey(event.target.value)}
              >
                <option value="">Select the confirmed answer…</option>
                {question.options.map((option) => (
                  <option key={option.key} value={option.key}>{option.key}. {option.text}</option>
                ))}
              </SelectField>
              <GButton variant="primary" size="sm" disabled={!mappingKey} onClick={repairMapping}>Confirm mapping</GButton>
            </div>
          )}
        </section>
      )}

      {question.options.length > 0 && (
        <div className="stack gap6">
          {question.options.map((opt) => {
            const isPicked = picked === opt.key;
            const showCorrect = revealed && hasTrustedKey && opt.key === question.correctKey;
            const showWrong = revealed && isPicked && hasTrustedKey && opt.key !== question.correctKey;
            return (
              <button
                key={opt.key}
                className={`option-row ${isPicked ? "picked" : ""} ${showCorrect ? "correct" : ""} ${showWrong ? "wrong" : ""}`}
                onClick={() => !revealed && setPicked(opt.key)}
                disabled={revealed}
              >
                <span className="mono option-key">{opt.key}</span>
                <span>{opt.text}</span>
              </button>
            );
          })}
        </div>
      )}

      {revealed && (
        <>
          <QuizFeedback
            question={question}
            pickedKey={picked}
            onRepairCard={hasTrustedKey && !isCorrect ? makeRepairCard : undefined}
            onAddReview={() => s.updateQuestion(question.id, { marked: true })}
            onMarkExplanationWrong={() => s.updateQuestion(question.id, { needsReview: true, status: "needs-review" })}
            onMarkAnswerWrong={() => s.updateQuestion(question.id, { needsReview: true, status: "needs-review" })}
            showProvenance={false}
            explanationContent={question.explanation ? (
              <AnnotatedQuestionText
                text={question.explanation.trim()}
                annotations={annotations.filter((annotation) => annotation.target === "explanation")}
                className="question-explanation-text"
                label="Question explanation"
                onDelete={deleteAnnotation}
                inline
                onSelection={(range) => setAnnotationSelection(range ? { target: "explanation", range } : null)}
              />
            ) : undefined}
          />
          <div className="stack gap6">
            <span className="field-label">Confidence</span>
            <div className="row">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <button key={n} className={`filter-pill ${confidence === n ? "on" : ""}`} onClick={() => setConfidence(n)}>{n}</button>
              ))}
              {isCorrect && (
                <button className={`filter-pill ${guessed ? "on" : ""}`} onClick={() => setGuessed((v) => !v)}>
                  I guessed
                </button>
              )}
            </div>
          </div>
          {hasTrustedKey && (!isCorrect || guessed) && (
            <>
              <SelectField label="Why did this go wrong?" value={errorType}
                onChange={(e) => setErrorType(e.target.value as QuestionErrorType | "")}>
                <option value="">Pick an error type (recommended)</option>
                {ERROR_TYPES.map((t) => <option key={t} value={t}>{ERROR_TYPE_LABEL[t]}</option>)}
              </SelectField>
              <GhostButton onClick={makeRepairCard}>
                <WandSparkles size={ICON_SIZE.body} /> Create an error-repair card from this miss
              </GhostButton>
            </>
          )}
          <TextAreaField label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {changed && <div className="sub">You changed your answer from {firstPick} to {picked} — recorded.</div>}
          <QuestionNotesPanel
            questionId={question.id}
            value={question.notes}
            onSave={(notes) => s.updateQuestion(question.id, { notes: notes.trim() || undefined })}
          />
          <QuestionAttachmentsPanel
            questionId={question.id}
            attachments={attachmentsList}
            onChange={(next) => {
              const value = next.length ? next : undefined;
              setAttachmentsList(next);
              s.updateQuestion(question.id, { attachments: value });
            }}
          />
        </>
      )}
    </Modal>
  );
}
