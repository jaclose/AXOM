// ===========================================================================
// Source Library + Question Sets (layer 3). Documents and sets are separate
// but linked: a document can be reference-only or feed question sets; a set
// shows its current mastery and historical accuracy, digest (when AI-enhanced), and can launch blocks or
// generate more questions from its source document (review-gated).
// ===========================================================================
import { useMemo, useRef, useState } from "react";
import { BookOpen, FileText, FolderInput, ListPlus, Search, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "../../lib/store";
import { questionSetMetrics, sortQuestionSetsByRecency, type QuestionSet, type SourceDocument } from "../../lib/library";
import { enhanceQuestionSet, resolveActiveProvider } from "../../lib/ai";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import type { QuestionRecord } from "../../lib/questions";
import type { MissingQuestionRecovery } from "../../lib/questionRecovery";
import { QuestionSetCard } from "./QuestionSetCard";
import type { Course, Term } from "../../lib/types";
import { ICON_SIZE } from "../../lib/iconSize";
import { createQuestionSetShare } from "../../lib/sharing/questionSetShare";
import {
  listQuestionSetShares,
  publishShare,
  revokeShare,
  type OwnedQuestionSetShare,
} from "../../lib/sharing/supabaseSharing";
import { CourseBankBrowser, type BankLocation } from "./CourseBankBrowser";
import { sortByNaturalTitle } from "../../lib/naturalSort";
import { reviewTaskInputs } from "../../lib/courseWork";

const NO_QUESTIONS: QuestionRecord[] = [];
const NO_DOCUMENTS: SourceDocument[] = [];
const NO_SETS: QuestionSet[] = [];
const SOURCE_PAGE_SIZE = 40;

interface ManagedQuestionSetShare extends OwnedQuestionSetShare {
  link: string;
}

export function SourceLibrary({
  onParseFrom,
  onGenerateFrom,
}: {
  onParseFrom: (doc: SourceDocument) => void;
  onGenerateFrom: (doc: SourceDocument) => void;
}) {
  const s = useStore();
  const documents = useMemo(() => (s.documents ?? NO_DOCUMENTS).filter(doc => !["axom-private-library-catalog", "axom-private-bank-review"].includes(doc.fileType)), [s.documents]);
  const [preview, setPreview] = useState<SourceDocument | null>(null);
  const [query, setQuery] = useState("");
  const [sourceLimit, setSourceLimit] = useState(SOURCE_PAGE_SIZE);
  const provider = useMemo(() => resolveActiveProvider(), []);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sortByNaturalTitle(term ? documents.filter((document) =>
      document.title.toLowerCase().includes(term)
      || document.fileName.toLowerCase().includes(term)
      || document.tags.some((tag) => tag.toLowerCase().includes(term))) : documents);
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
          <input className="field grow" value={query} onChange={(event) => { setQuery(event.target.value); setSourceLimit(SOURCE_PAGE_SIZE); }}
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
          {filtered.slice(0, sourceLimit).map((doc) => (
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
          {filtered.length > 0 && <div className="row wrap gap8" role="status">
            <span className="sub">Showing {Math.min(sourceLimit, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} source documents</span>
            {filtered.length > sourceLimit && <GhostButton onClick={() => setSourceLimit((value) => value + SOURCE_PAGE_SIZE)}>
              Show {Math.min(SOURCE_PAGE_SIZE, filtered.length - sourceLimit)} more sources
            </GhostButton>}
          </div>}
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
  initialScope,
  onRunSet,
  onRunSets,
  onReviewIssues,
  onImportMissing,
  onReviewMisses,
  onOpenInsights,
  recent = false,
  compact = false,
  limit,
  title,
  sub,
}: {
  initialScope?: BankLocation;
  onRunSet: (set: QuestionSet) => void;
  onRunSets?: (sets: QuestionSet[]) => void;
  onReviewIssues?: (ids: string[]) => void;
  onImportMissing?: (request: MissingQuestionRecovery) => void;
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
  const [filingSet, setFilingSet] = useState<QuestionSet | null>(null);
  const [shareSet, setShareSet] = useState<QuestionSet | null>(null);
  const [shareConsent, setShareConsent] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareLookup, setShareLookup] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [shareLookupError, setShareLookupError] = useState("");
  const shareOperation = useRef(false);
  const shareLookupOperation = useRef(0);
  const [managedShares, setManagedShares] = useState<Record<string, ManagedQuestionSetShare[]>>({});
  const orderedSets = useMemo(
    // Uploads land newest-first in the store; the library reads in lecture order (I3-26).
    () => (recent ? sortQuestionSetsByRecency(sets, questions) : sortByNaturalTitle(sets)),
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
  function installManagedShares(shares: OwnedQuestionSetShare[]) {
    const grouped: Record<string, ManagedQuestionSetShare[]> = {};
    for (const share of shares) {
      const managed = {
        ...share,
        link: `${location.origin}${location.pathname}#shared-set?token=${encodeURIComponent(share.token)}`,
      };
      (grouped[share.sourceId] ??= []).push(managed);
    }
    setManagedShares(grouped);
    return grouped;
  }

  async function openShare(set: QuestionSet) {
    const lookupId = ++shareLookupOperation.current;
    setShareConsent(false);
    setShareSet(set);
    setShareLookup("loading");
    setShareLookupError("");
    try {
      const shares = await listQuestionSetShares();
      if (lookupId !== shareLookupOperation.current) return;
      installManagedShares(shares);
      setShareLookup("ready");
    } catch (error) {
      if (lookupId !== shareLookupOperation.current) return;
      const detail = error instanceof Error ? error.message : "Active links could not be loaded.";
      setShareLookupError(detail);
      setShareLookup("error");
      pushToast({
        title: "Share management unavailable",
        body: `${detail} AXOM will not publish another link until existing links can be checked.`,
        tone: "warn",
      });
    }
  }

  async function createShare() {
    if (!shareSet || !shareConsent || shareLookup !== "ready" || shareOperation.current
      || (managedShares[shareSet.id]?.length ?? 0) > 0) return;
    const selected = shareSet;
    shareOperation.current = true;
    setShareBusy(true);
    try {
      const snapshot = createQuestionSetShare(selected, questions);
      const result = await publishShare(selected.id, snapshot);
      const link = `${location.origin}${location.pathname}#shared-set?token=${encodeURIComponent(result.token)}`;
      const managed = { ...result, link };
      setManagedShares(current => ({
        ...current,
        [selected.id]: [managed, ...(current[selected.id] ?? []).filter(share => share.id !== managed.id)],
      }));
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
        await navigator.clipboard.writeText(link);
        pushToast({
          title: "Unlisted Question Set link copied",
          body: "The active bearer link remains visible here so you can copy it again or revoke it.",
          tone: "success",
        });
      } catch {
        pushToast({
          title: "Unlisted link created — clipboard unavailable",
          body: "The cloud share exists. Copy the visible link manually or revoke it before closing this dialog.",
          tone: "warn",
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Sign in and try again.";
      try {
        const recovered = installManagedShares(await listQuestionSetShares())[selected.id] ?? [];
        setShareLookup("ready");
        setShareLookupError("");
        if (recovered.length > 0) {
          pushToast({
            title: "Unlisted link recovered",
            body: "The publish response was interrupted, but AXOM found the active owner link. It remains visible and revocable here.",
            tone: "warn",
          });
        } else {
          pushToast({
            title: "Share outcome unconfirmed",
            body: `${detail} No active owner link was found. A safe retry reuses the same snapshot if the first request committed late.`,
            tone: "warn",
          });
        }
      } catch (recoveryError) {
        const recoveryDetail = recoveryError instanceof Error
          ? recoveryError.message
          : "Active links could not be checked.";
        setShareLookup("error");
        setShareLookupError(recoveryDetail);
        pushToast({
          title: "Share outcome unconfirmed",
          body: `${detail} Owner recovery also failed: ${recoveryDetail} Any server-created link expires automatically within seven days.`,
          tone: "warn",
        });
      }
    } finally {
      shareOperation.current = false;
      setShareBusy(false);
    }
  }

  async function copyShare(share: ManagedQuestionSetShare) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(share.link);
      pushToast({ title: "Unlisted link copied", body: "Anyone with the link can open this snapshot.", tone: "success" });
    } catch {
      pushToast({ title: "Copy failed", body: "Select and copy the visible link manually.", tone: "warn" });
    }
  }

  async function revokeManagedShare(share: ManagedQuestionSetShare) {
    if (shareOperation.current) return;
    shareOperation.current = true;
    setShareBusy(true);
    try {
      await revokeShare(share.id);
      setManagedShares(current => {
        const next = { ...current };
        const remaining = (next[share.sourceId] ?? []).filter(item => item.id !== share.id);
        if (remaining.length > 0) next[share.sourceId] = remaining;
        else delete next[share.sourceId];
        return next;
      });
      setShareConsent(false);
      pushToast({ title: "Unlisted link revoked", body: "That link can no longer open the snapshot.", tone: "success" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The revoke request could not be confirmed.";
      pushToast({
        title: "Share not revoked",
        body: `${detail} Treat the link as active and try again before sharing it further.`,
        tone: "warn",
      });
    } finally {
      shareOperation.current = false;
      setShareBusy(false);
    }
  }

  // Filing must include the selected course ID. Free-text module names alone can
  // silently associate a bank with the wrong term when module names repeat.

  function addDigestReview(set: QuestionSet) {
    const suggestions = set.digest?.suggestedReview ?? [];
    const course = (s.courses ?? []).find((item) => item.id === set.scope?.courseId);
    const term = (s.terms ?? []).find((item) => item.id === course?.termId);
    const destination = set.scope?.module
      ? [term?.name ?? course?.code ?? "Question Bank", set.scope.module, set.scope.week ? `Week ${set.scope.week}` : "Review"].join("/")
      : "Question Bank/Review";
    const items = reviewTaskInputs(suggestions, destination, { source: "digest", sourceId: set.id }, s.tracker);
    if (!items.length) {
      pushToast({ title: "Review already tracked", body: "Those active digest topics are already in the Course Tracker.", tone: "warn" });
      return;
    }
    s.bulkAddTrackerItems(items);
    pushToast({ title: "Review work added", body: `${items.length} digest topic${items.length === 1 ? "" : "s"} added to the Course Tracker.`, tone: "success" });
  }

  function renderCard(set: QuestionSet) {
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
        onShare={!compact ? () => void openShare(set) : undefined}
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
          {set.digest?.suggestedReview.length ? (
            <GhostButton onClick={() => addDigestReview(set)}>
              <ListPlus size={ICON_SIZE.body} /> Add review to Tracker
            </GhostButton>
          ) : null}
          {(s.courses ?? []).length > 0 && (
            <GhostButton onClick={() => setFilingSet(set)}>
              <FolderInput size={ICON_SIZE.body} /> {set.scope?.module ? "Move" : "File under a week"}
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
  }

  const filingDialog = filingSet && (
    <QuestionSetFilingDialog key={filingSet.id} set={filingSet} courses={s.courses ?? []} terms={s.terms ?? []}
      onClose={() => setFilingSet(null)}
      onSave={(scope) => { s.updateQuestionSet(filingSet.id, { scope }); setFilingSet(null); }} />
  );
  const managedShareList = shareSet ? managedShares[shareSet.id] ?? [] : [];
  const shareDialog = shareSet && (
    <Modal title={managedShareList.length > 0 ? `Manage links for ${shareSet.title}` : `Share ${shareSet.title}`}
      onClose={() => {
        if (shareOperation.current) return;
        shareLookupOperation.current += 1;
        setShareSet(null);
        setShareLookup("idle");
      }}>
      {shareLookup === "loading" ? (
        <p className="sub" role="status">Checking this account for active links…</p>
      ) : shareLookup === "error" ? <div className="stack gap12">
        <p className="sub" role="alert">{shareLookupError} AXOM will not publish another link while the owner link list is unavailable.</p>
        <GButton variant="primary" onClick={() => void openShare(shareSet)}>Retry owner link check</GButton>
      </div> : managedShareList.length > 0 ? <div className="stack gap12">
        <p className="sub" role="status">{managedShareList.length === 1 ? "This unlisted bearer link is" : `These ${managedShareList.length} unlisted bearer links are`} active. Anyone with a link can open and import its snapshot.</p>
        {managedShareList.map((managedShare, index) => {
          const label = managedShareList.length === 1
            ? "Unlisted Question Set link"
            : `Unlisted Question Set link ${index + 1}`;
          return <div className="stack gap6" key={managedShare.id}>
            <label className="stack gap6">
              <span className="field-label">{label}</span>
              <input className="field" readOnly value={managedShare.link} aria-label={label}
                onFocus={event => event.currentTarget.select()} />
            </label>
            <span className="sub">Expires automatically {new Date(managedShare.expiresAt).toLocaleString()}.</span>
            <div className="row wrap gap6">
              <GButton variant="primary" disabled={shareBusy} onClick={() => void copyShare(managedShare)}>
                {managedShareList.length === 1 ? "Copy link" : `Copy link ${index + 1}`}
              </GButton>
              <GhostButton disabled={shareBusy} onClick={() => void revokeManagedShare(managedShare)}>
                {shareBusy ? "Revoking…" : managedShareList.length === 1 ? "Revoke link" : `Revoke link ${index + 1}`}
              </GhostButton>
            </div>
          </div>;
        })}
        <p className="sub">The snapshot includes question text, choices, answer keys, explanations, rationales, tags, and citations. Attempts, notes, annotations, analytics, attachments, source files, and course filing are excluded.</p>
      </div> : <div className="stack gap12">
        <p className="sub">Creating an unlisted bearer link uploads this snapshot to AXOM's cloud for up to seven days. Anyone with the link can open and import its question text, choices, answer keys, explanations, rationales, tags, and citations.</p>
        <p className="sub">Attempts, notes, annotations, analytics, attachments, source files, and course filing are excluded. Do not continue with restricted or private source material.</p>
        <label className="row gap8">
          <input type="checkbox" checked={shareConsent} disabled={shareBusy || shareLookup !== "ready"}
            onChange={event => setShareConsent(event.target.checked)} />
          <span>I reviewed this set and have permission to distribute its question content.</span>
        </label>
        <GButton variant="primary" disabled={!shareConsent || shareBusy || shareLookup !== "ready"} onClick={() => void createShare()}>
          {shareBusy ? "Creating link…" : "Create unlisted link"}
        </GButton>
      </div>}
    </Modal>
  );

  if (!recent && !compact) return <>
    <CourseBankBrowser initialScope={initialScope}
      onPractice={(chosen) => chosen.length === 1 ? onRunSet(chosen[0]) : onRunSets?.(chosen)}
      onReviewQuestionIds={onReviewIssues}
      onRestoreMissing={onImportMissing}
      renderSet={renderCard}
    />
    {filingDialog}
    {shareDialog}
  </>;

  return (
    <>
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
            {filteredSets.map(renderCard)}
            {filteredSets.length === 0 && <EmptyState title="No question sets match" hint="Try a different set title or tag." />}
          </div>
      )}
    </GlassCard>
    {filingDialog}
    {shareDialog}
    </>
  );
}


/** Filing is always keyed to an actual course, never a fuzzy module name.
 * Duplicate module names across terms must not silently move question sets. */
function QuestionSetFilingDialog({ set, courses, terms, onSave, onClose }: {
  set: QuestionSet;
  courses: readonly Course[];
  terms: readonly Term[];
  onSave: (scope: QuestionSet["scope"] | undefined) => void;
  onClose: () => void;
}) {
  const [courseId, setCourseId] = useState(set.scope?.courseId ?? "");
  const [moduleName, setModuleName] = useState(set.scope?.courseId ? set.scope.module ?? "" : "");
  const [weekInput, setWeekInput] = useState(set.scope?.week === undefined ? "" : String(set.scope.week));
  const selectedCourse = courses.find((course) => course.id === courseId);
  const validModule = Boolean(selectedCourse?.modules.some((module) => module.name === moduleName));
  const weekText = weekInput.trim();
  const week = weekText === "" ? undefined : Number(weekText);
  const validWeek = week === undefined || (Number.isSafeInteger(week) && week > 0);

  return <Modal title={`File ${set.title} in a course`} onClose={onClose}>
    <div className="stack gap12">
      <p className="sub">Choose the actual course, module and (if established) week. A shared module name alone does not establish a term assignment.</p>
      <label className="stack gap6">
        <span className="field-label">Destination course</span>
        <select className="field" aria-label="Destination course" value={courseId}
          onChange={(event) => { setCourseId(event.target.value); setModuleName(""); }}>
          <option value="">Select a course</option>
          {courses.map((course) => {
            const term = terms.find((item) => item.id === course.termId)?.name;
            return <option key={course.id} value={course.id}>
              {[term, course.code ?? course.name, course.name].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ")}
            </option>;
          })}
        </select>
      </label>
      <label className="stack gap6">
        <span className="field-label">Module</span>
        <select className="field" aria-label="Destination module" value={validModule ? moduleName : ""}
          onChange={(event) => setModuleName(event.target.value)} disabled={!selectedCourse}>
          <option value="">Select a module</option>
          {selectedCourse?.modules.map((module) => <option key={module.id} value={module.name}>{module.name}</option>)}
        </select>
      </label>
      <label className="stack gap6">
        <span className="field-label">Week (optional; only enter a confirmed placement)</span>
        <input className="field" type="number" min="1" step="1" aria-label="Destination week" value={weekInput}
          onChange={(event) => setWeekInput(event.target.value)} />
      </label>
      {!validWeek && <p className="sub" role="alert">Week must be a positive whole number or left blank.</p>}
      <div className="row wrap gap6">
        <GhostButton onClick={() => onSave(undefined)}>Remove course filing</GhostButton>
        <GButton variant="primary" disabled={!selectedCourse || !validModule || !validWeek}
          onClick={() => onSave({ courseId: selectedCourse!.id, module: moduleName, ...(week === undefined ? {} : { week }) })}>
          Save course location
        </GButton>
      </div>
    </div>
  </Modal>;
}
