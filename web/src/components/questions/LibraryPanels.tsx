// ===========================================================================
// Source Library + Question Sets (layer 3). Documents and sets are separate
// but linked: a document can be reference-only or feed question sets; a set
// shows its current mastery and historical accuracy, digest (when AI-enhanced), and can launch blocks or
// generate more questions from its source document (review-gated).
// ===========================================================================
import { useMemo, useState } from "react";
import { FileText, ListPlus, Sparkles, Trash2, BookOpen, Search } from "lucide-react";
import { useStore } from "../../lib/store";
import { questionSetMetrics, sortQuestionSetsByRecency, type QuestionSet, type SourceDocument } from "../../lib/library";
import { enhanceQuestionSet, resolveActiveProvider } from "../../lib/ai";
import { GlassCard, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionSetCard } from "./QuestionSetCard";
import { ICON_SIZE } from "../../lib/iconSize";
import { createQuestionSetShare } from "../../lib/sharing/questionSetShare";
import { publishShare } from "../../lib/sharing/supabaseSharing";

const NO_QUESTIONS: QuestionRecord[] = [];
const NO_DOCUMENTS: SourceDocument[] = [];
const NO_SETS: QuestionSet[] = [];

export function SourceLibrary({
  onParseFrom,
  onGenerateFrom,
}: {
  onParseFrom: (doc: SourceDocument) => void;
  onGenerateFrom: (doc: SourceDocument) => void;
}) {
  const s = useStore();
  const documents = s.documents ?? NO_DOCUMENTS;
  const [preview, setPreview] = useState<SourceDocument | null>(null);
  const [query, setQuery] = useState("");
  const provider = useMemo(() => resolveActiveProvider(), []);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter((document) =>
      document.title.toLowerCase().includes(term)
      || document.fileName.toLowerCase().includes(term)
      || document.tags.some((tag) => tag.toLowerCase().includes(term)));
  }, [documents, query]);

  return (
    <GlassCard>
      <PanelHeader
        title="Source Library"
        headingLevel={2}
        sub="Every uploaded file, with its extracted text and linked question sets. Reference-only documents live here too."
      />
      {documents.length > 0 && (
        <div className="row" style={{ gap: 7, marginBottom: 12 }}>
          <Search size={ICON_SIZE.body} className="dim" />
          <input className="field grow" value={query} onChange={(event) => setQuery(event.target.value)}
            aria-label="Search source documents" placeholder="Search source documents…" />
        </div>
      )}
      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={ICON_SIZE.emphasis} />}
          title="No documents yet"
          hint="Import a PDF, DOCX, or text file in the Import Center — choose 'library document' to keep it here even without questions."
        />
      ) : (
        <div className="stack gap6">
          {filtered.map((doc) => (
            <div key={doc.id} className="import-draft">
              <div className="row" style={{ gap: 8 }}>
                <button className="grow stack card-row-main" onClick={() => setPreview(doc)}>
                  <span className="truncate" style={{ fontWeight: 600 }}>{doc.title}</span>
                  <span className="sub truncate">
                    {doc.fileType.toUpperCase()} · {Math.round(doc.sizeBytes / 1024)} KB · {doc.uploadedAt.slice(0, 10)}
                    {doc.pageTexts?.length ? ` · ${doc.pageTexts.length} pages` : ""}
                    · {doc.linkedQuestionSetIds.length ? `${doc.linkedQuestionSetIds.length} linked set${doc.linkedQuestionSetIds.length === 1 ? "" : "s"}` : "reference only"}
                  </span>
                </button>
                {!doc.rawText && <Tag tone="orange">no text</Tag>}
                {doc.rawText && (
                  <GhostButton title="Parse this saved document into reviewable question drafts" onClick={() => onParseFrom(doc)}>
                    <ListPlus size={ICON_SIZE.body} /> Parse into questions
                  </GhostButton>
                )}
                {doc.rawText && provider && (
                  <GhostButton title="Generate questions grounded in this document" onClick={() => onGenerateFrom(doc)}>
                    <Sparkles size={ICON_SIZE.body} /> Generate
                  </GhostButton>
                )}
                <GhostButton aria-label={`Delete ${doc.title}`} onClick={() => {
                  if (confirm(`Remove "${doc.title}" from the library? Its questions stay in the bank, unlinked.`)) s.removeDocument(doc.id);
                }}>
                  <Trash2 size={ICON_SIZE.body} />
                </GhostButton>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyState title="No source documents match" hint="Try a different title, filename, or tag." />}
        </div>
      )}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <div className="sub">{preview.fileName} · uploaded {preview.uploadedAt.slice(0, 10)}</div>
          {preview.rawText
            ? <div className="question-stem" style={{ maxHeight: 360, overflowY: "auto" }}>{preview.rawText.slice(0, 20_000)}{preview.rawText.length > 20_000 ? "\n…" : ""}</div>
            : <div className="sub">No extractable text — this file is stored as provenance only (scan/image; OCR isn't available in-app yet).</div>}
        </Modal>
      )}
    </GlassCard>
  );
}

export function QuestionSetList({
  onRunSet,
  onReviewIssues,
  onReviewMisses,
  onOpenInsights,
  recent = false,
  compact = false,
  limit,
  title,
  sub,
}: {
  onRunSet: (set: QuestionSet) => void;
  onReviewIssues?: (ids: string[]) => void;
  onReviewMisses?: (ids: string[]) => void;
  onOpenInsights?: () => void;
  recent?: boolean;
  compact?: boolean;
  limit?: number;
  title?: string;
  sub?: string;
}) {
  const s = useStore();
  const sets = s.questionSets ?? NO_SETS;
  const questions = s.questions ?? NO_QUESTIONS;
  const provider = useMemo(() => resolveActiveProvider(), []);
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const orderedSets = useMemo(
    () => (recent ? sortQuestionSetsByRecency(sets, questions) : sets),
    [questions, recent, sets],
  );
  const filteredSets = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = term
      ? orderedSets.filter((set) => set.title.toLowerCase().includes(term)
        || set.tags.some((tag) => tag.toLowerCase().includes(term)))
      : orderedSets;
    if (limit === undefined) return matching;
    return matching.slice(0, Math.max(0, Math.floor(limit)));
  }, [limit, orderedSets, query]);

  async function enhance(set: QuestionSet) {
    if (!provider) return;
    setEnhancing(set.id);
    try {
      const byId = new Map(questions.map((q) => [q.id, q]));
      const forDigest = set.questionIds
        .map((id) => byId.get(id))
        .filter((q): q is NonNullable<typeof q> => !!q)
        .map((q) => ({ stem: q.stem, correct: q.options.find((o) => o.key === q.correctKey)?.text, explanation: q.explanation }));
      const digest = await enhanceQuestionSet(provider, { title: set.title, questions: forDigest });
      s.updateQuestionSet(set.id, {
        aiEnhanced: true,
        digest: { ...digest, generatedBy: provider.info.label, generatedAt: new Date().toISOString() },
      });
    } catch (err) {
      pushToast({ title: "Enhancement failed", body: err instanceof Error ? err.message : "Unknown error.", tone: "warn" });
    } finally {
      setEnhancing(null);
    }
  }
  async function share(set: QuestionSet) {
    try {
      const snapshot = createQuestionSetShare(set, questions);
      const result = await publishShare(set.id, snapshot);
      const link = `${location.origin}${location.pathname}#shared-set?token=${encodeURIComponent(result.token)}`;
      await navigator.clipboard.writeText(link);
      pushToast({ title: "Private share link copied", body: "Only the resolved Question Set snapshot is included. Attempts, notes, annotations, and private workspace data are excluded.", tone: "success" });
    } catch (error) {
      pushToast({ title: "Share not created", body: error instanceof Error ? error.message : "Sign in and try again.", tone: "warn" });
    }
  }

  return (
    <GlassCard>
      <PanelHeader
        title={title ?? (recent ? "Recent sets" : "Question Sets")}
        headingLevel={2}
        sub={sub ?? (recent
          ? "Your most recently studied sets, ordered by activity."
          : "Parsed sets with current mastery, attempt accuracy, source links, and Question Intelligence digests.")}
      />
      {!compact && sets.length > 0 && (
        <div className="row" style={{ gap: 7, marginBottom: 12 }}>
          <Search size={ICON_SIZE.body} className="dim" />
          <input className="field grow" value={query} onChange={(event) => setQuery(event.target.value)}
            aria-label="Search question sets" placeholder="Search question sets…" />
        </div>
      )}
      {sets.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={ICON_SIZE.emphasis} />}
          title="No sets yet"
          hint="Import questions in the Import Center and save them as a question set — they'll appear here with mastery tracking."
        />
      ) : (
        <div className={`qset-grid ${compact ? "compact" : ""}`}>
          {filteredSets.map((set) => {
            const metrics = questionSetMetrics(set, questions, s.documents ?? []);
            return (
              <QuestionSetCard
                key={set.id}
                set={set}
                metrics={metrics}
                onStart={() => onRunSet(set)}
                onReviewIssues={onReviewIssues && metrics.mapping.issueCount > 0
                  ? () => onReviewIssues(metrics.mapping.issueQuestionIds)
                  : undefined}
                onReviewMisses={!compact && onReviewMisses ? () => onReviewMisses(metrics.missedQuestionIds) : undefined}
                onInsights={!compact ? onOpenInsights : undefined}
                onEdit={!compact ? () => {
                  const title = prompt("Rename this question set:", set.title)?.trim();
                  if (title && title !== set.title) s.updateQuestionSet(set.id, { title });
                } : undefined}
                onShare={!compact ? () => void share(set) : undefined}
                compact={compact}
              >
                {!compact && set.digest && (
                  <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                    <div className="question-explanation">
                      <b>{set.digest.generatedBy}:</b> {set.digest.summary}
                    </div>
                    {set.digest.pitfalls.length > 0 && (
                      <div className="sub"><b>Pitfalls:</b> {set.digest.pitfalls.join(" · ")}</div>
                    )}
                    {set.digest.suggestedReview.length > 0 && (
                      <div className="sub"><b>Review next:</b> {set.digest.suggestedReview.join(" · ")}</div>
                    )}
                  </div>
                )}
                {!compact && <div className="row wrap gap6">
                  {provider && !set.digest && (
                    <GhostButton disabled={enhancing === set.id} onClick={() => void enhance(set)}>
                      <Sparkles size={ICON_SIZE.body} /> {enhancing === set.id ? "Analyzing…" : "Build digest"}
                    </GhostButton>
                  )}
                  <GhostButton aria-label={`Delete ${set.title}`} onClick={() => {
                    if (confirm(`Remove the set "${set.title}"? Its questions stay in the bank, unlinked.`)) s.removeQuestionSet(set.id);
                  }}>
                    <Trash2 size={ICON_SIZE.body} /> Remove set
                  </GhostButton>
                </div>}
              </QuestionSetCard>
            );
          })}
          {filteredSets.length === 0 && <EmptyState title="No question sets match" hint="Try a different set title or tag." />}
        </div>
      )}
    </GlassCard>
  );
}
