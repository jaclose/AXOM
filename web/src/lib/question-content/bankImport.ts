// ===========================================================================
// Saving a package into the workspace: each set of the source through the
// canonical import, one after another, with a plain account of what happened.
//
// It never reports success for something that was not written. A refusal or
// failed write is recorded against its section. If another section was already
// written durably, the bank reports a truthful partial result instead of
// pretending that either the whole bank succeeded or nothing was saved.
// ===========================================================================
import type { ImportLibrary } from "../questionImportHistory";
import { prepareReviewedImport, saveReviewedImport, type PreparedReviewedImport, type ReviewedImportStore, type SavedReviewedImport } from "../questionImportSave";
import { hasReviewedImportInFlight, type ReviewedFilingScope } from "../questionImportFinalization";
import type { ReviewedSourceRefreshFields, ReviewedSourceRefreshResult } from "../questionImportFinalization";
import type { QuestionRecord } from "../questions";
import type { ImportPackage, PackageIssue } from "./package";
import { legacyQuestionFields } from "./legacyFields";
import { packageToReviewedImport, type HeldQuestion, type PackageImportOptions, type WithheldAsset } from "./toReviewedImport";

export interface SavedSection {
  set?: number;
  title?: string;
  setTitle: string;
  setId?: string;
  documentId?: string;
  /** The package question ids, and the ids they were saved under, in step. */
  questionIds: string[];
  savedIds: string[];
  /** An earlier question set was reused; missing image bytes may have been repaired. */
  reused: boolean;
  /** Existing source questions brought up to this audited package version. */
  refreshed?: number;
  images: { attached: number; missing: number; problems: string[] };
}

export interface IncompleteSection {
  set?: number;
  title?: string;
  setTitle: string;
  /** Package identities in the section that did not finish as requested. */
  questionIds: string[];
  /** Durable local identities, when core records existed before the failure. */
  savedIds: string[];
  setId?: string;
  documentId?: string;
  reused: boolean;
  reason: string;
}

export interface BankSave {
  /**
   * "saved": at least one set was written. "already-saved": every set was found from an
   * earlier import (missing image bytes may still have been repaired). "nothing-ready": no question may be saved yet.
   * "partial": at least one section is durable but another part did not finish.
   * "failed": nothing completed as requested; see `errors` and `incompleteSections`.
   */
  status: "saved" | "already-saved" | "partial" | "nothing-ready" | "failed";
  sections: SavedSection[];
  incompleteSections: IncompleteSection[];
  held: HeldQuestion[];
  withheldAssets: WithheldAsset[];
  filing: { module: string; week?: number; term: number; curriculumTerm?: string; agrees: boolean };
  errors: string[];
}

export interface Workspace {
  /** The library as it stands now. Read again before each set, so a later set sees what an earlier one wrote. */
  library: () => ImportLibrary;
  store: () => ReviewedImportStore;
}

const REFUSAL: Record<string, string> = {
  "nothing-to-save": "There was nothing to save.",
  "review-incomplete": "The import was refused: a question still needs review.",
  "invalid-question": "The import was refused: a question is not valid.",
};

type FilingScope = ReviewedFilingScope;
type RefileRequest = { setId: string; target: FilingScope };
type RefileResult = { ok: true } | { ok: false; message: string; rollbackFailures: string[] };
type RefileCommit = NonNullable<ReviewedImportStore["commitReviewedRefiling"]>;

const reviewedRefilingQueues = new WeakMap<RefileCommit, Promise<void>>();
const reviewedRefilingsInFlight = new WeakMap<RefileCommit, Map<string, Promise<RefileResult>>>();

function sameScope(left: FilingScope | undefined, right: FilingScope | undefined): boolean {
  return left?.module === right?.module
    && left?.week === right?.week
    && left?.courseId === right?.courseId;
}

function questionScope(question: QuestionRecord): FilingScope | undefined {
  return question.module
    ? { module: question.module, ...(question.week !== undefined ? { week: question.week } : {}), ...(question.courseId ? { courseId: question.courseId } : {}) }
    : undefined;
}

function refileFingerprint(requests: readonly RefileRequest[]): string {
  return JSON.stringify([...requests]
    .map(({ setId, target }) => ({ setId, target }))
    .sort((left, right) => left.setId.localeCompare(right.setId)));
}

/**
 * Refiling reads live set membership before building its compare-and-swap
 * plan. Keep that read inside the same queue as the durable commit: otherwise
 * another caller can observe a tentative target scope and report it as an
 * already-durable success. Identical callers share one result; conflicting
 * destinations wait and then preflight against the settled workspace.
 */
function coordinateReviewedRefiling(
  commit: RefileCommit,
  fingerprint: string,
  operation: () => Promise<RefileResult>,
): Promise<RefileResult> {
  let inFlight = reviewedRefilingsInFlight.get(commit);
  if (!inFlight) {
    inFlight = new Map();
    reviewedRefilingsInFlight.set(commit, inFlight);
  }
  const existing = inFlight.get(fingerprint);
  if (existing) return existing;

  let resolvePending!: (result: RefileResult) => void;
  let rejectPending!: (reason?: unknown) => void;
  const pending = new Promise<RefileResult>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  inFlight.set(fingerprint, pending);

  const preceding = reviewedRefilingQueues.get(commit);
  const operationPromise = preceding ? preceding.then(operation) : Promise.resolve().then(operation);
  const tail = operationPromise.then(() => undefined, () => undefined);
  reviewedRefilingQueues.set(commit, tail);
  void operationPromise.then(resolvePending, rejectPending);
  const cleanup = () => {
    const active = reviewedRefilingsInFlight.get(commit);
    if (active?.get(fingerprint) === pending) active.delete(fingerprint);
    if (active?.size === 0) reviewedRefilingsInFlight.delete(commit);
    if (reviewedRefilingQueues.get(commit) === tail) reviewedRefilingQueues.delete(commit);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

async function refileReusedSets(
  workspace: Workspace,
  requests: readonly RefileRequest[],
): Promise<RefileResult> {
  if (!requests.length) return { ok: true };
  const targets = new Map<string, FilingScope>();
  for (const request of requests) {
    const prior = targets.get(request.setId);
    if (prior && !sameScope(prior, request.target)) {
      return { ok: false, message: "The same reused source set was assigned conflicting reviewed filings.", rollbackFailures: [] };
    }
    targets.set(request.setId, request.target);
  }

  const store = workspace.store();
  if (!store.commitReviewedRefiling) {
    return { ok: false, message: "This workspace cannot durably update reused source sets' reviewed filings.", rollbackFailures: [] };
  }
  const commit = store.commitReviewedRefiling;
  const fingerprint = refileFingerprint([...targets].map(([setId, target]) => ({ setId, target })));
  return coordinateReviewedRefiling(commit, fingerprint, async () => {
    const before = workspace.library();
    const seenQuestionIds = new Set<string>();
    const originals: Array<{
      set: (typeof before.questionSets)[number];
      questions: QuestionRecord[];
      target: FilingScope;
    }> = [];
    for (const [setId, target] of targets) {
      const set = before.questionSets.find((candidate) => candidate.id === setId);
      if (!set) return { ok: false, message: "A reused source set disappeared before its reviewed filing could be saved.", rollbackFailures: [] };
      const questions = set.questionIds.map((id) => before.questions.find((question) => question.id === id));
      if (questions.some((question) => !question)) {
        return { ok: false, message: "A reused source set has a missing question and no reviewed filing was changed.", rollbackFailures: [] };
      }
      for (const question of questions as QuestionRecord[]) {
        if (seenQuestionIds.has(question.id)) {
          return { ok: false, message: "A question belongs to more than one reused source set, so no reviewed filing was changed.", rollbackFailures: [] };
        }
        seenQuestionIds.add(question.id);
      }
      originals.push({ set, questions: questions as QuestionRecord[], target });
    }

    if (originals.every(({ set, questions, target }) => sameScope(set.scope as FilingScope | undefined, target)
      && questions.every((question) => sameScope(questionScope(question), target)))) return { ok: true };

    try {
      store.assertCurrent?.();
      return await commit({
        sets: originals.map((original) => ({
          setId: original.set.id,
          expectedScope: original.set.scope,
          questions: original.questions.map((question) => ({
            questionId: question.id,
            expectedScope: questionScope(question),
          })),
          targetScope: original.target,
        })),
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The reviewed filing could not be saved.",
        rollbackFailures: [],
      };
    }
  });
}

type SavedSuccess = Extract<SavedReviewedImport, { ok: true }>;

function untouchedSourceEvidence(question: QuestionRecord): boolean {
  const content = question.content;
  const extraction = question.extraction;
  if (!content || !extraction || extraction.reviewed !== true
    || extraction.reviewedAt !== question.sourceFile?.addedAt
    || question.sourcePage !== content.source.page
    || question.questionNumber !== content.source.questionNumber) return false;
  const source = content.source;
  const place = source.set === undefined ? "" : `set ${source.set}${source.setTitle ? ` (${source.setTitle})` : ""}`;
  const citation = [source.filename, place,
    ...(source.questionNumber !== undefined ? [`question ${source.questionNumber}`] : []),
  ].filter(Boolean).join(", ");
  const answerImage = content.assets.find((asset) => asset.role === "answer_reveal");
  const teachingImage = content.assets.find((asset) => asset.role === "explanation");
  const answerLabel = content.correctAnswer?.labels.join(", ");
  const answerSnippet = answerImage && answerLabel
    ? `${content.correctAnswer?.evidence === "source-mark-verified" ? "Visually marked source answer" : "Source answer image"}: ${answerLabel}. Original image: ${answerImage.sourceFile ?? source.filename}${answerImage.sourcePage !== undefined ? `, page ${answerImage.sourcePage}` : ""}${answerImage.checksum ? `, ${answerImage.checksum}` : ""}.`
    : undefined;
  const teachingSnippet = teachingImage
    ? `Original teaching image: ${teachingImage.sourceFile ?? source.filename}${teachingImage.sourcePage !== undefined ? `, page ${teachingImage.sourcePage}` : ""}${teachingImage.checksum ? `, ${teachingImage.checksum}` : ""}.`
    : undefined;
  return question.citation === citation
    && extraction.questionSourcePage === source.page
    && extraction.answerEvidenceSnippet === answerSnippet
    && extraction.answerEvidencePage === answerImage?.sourcePage
    && extraction.explanationSourceSnippet === teachingSnippet
    && extraction.explanationSourcePage === teachingImage?.sourcePage
    && !extraction.sourceSnippet && !extraction.questionSourceSnippet
    && !extraction.answerEvidence && !extraction.explanationSource
    && !extraction.explanationRawCandidate && !extraction.explanationCleanupOperations?.length
    && extraction.answerDetectionConfidence === undefined
    && extraction.questionDetectionConfidence === undefined
    && extraction.explanationDetectionConfidence === undefined
    && extraction.overallImportConfidence === undefined
    && JSON.stringify(extraction.parserRuleIds) === JSON.stringify([
      "import.package", `import.package.${content.provenance.method}`,
    ]);
}

function untouchedSourceQuestion(question: QuestionRecord, pkg: ImportPackage): boolean {
  if (question.status !== "unseen" || question.attempts.length || question.marked
    || question.notes?.trim() || question.annotations?.length || question.userAnswerKey
    || question.attemptedAt || question.reviewDueAt || question.confidence !== undefined
    || question.timeSpentSeconds !== undefined || question.errorType || question.needsReview
    || !question.content) return false;
  const original = legacyQuestionFields(pkg.manifest, question.content);
  // Earlier table serialization could drop one trailing cell space. That
  // whitespace has no learner meaning; all substantive wording must match.
  return untouchedSourceEvidence(question)
    && question.stem.trimEnd() === original.stem.trimEnd()
    && JSON.stringify(question.options) === JSON.stringify(original.options)
    && (question.explanation ?? "") === (original.explanation ?? "")
    && question.correctKey === original.correctKey;
}

async function refreshReusedSource(
  pkg: ImportPackage,
  prepared: PreparedReviewedImport,
  saved: SavedSuccess,
  workspace: Workspace,
): Promise<ReviewedSourceRefreshResult> {
  const failure = (message: string): ReviewedSourceRefreshResult => ({ ok: false, message, rollbackFailures: [] });
  if (!saved.reused || !saved.setId || !prepared.plan.questionSet) {
    return failure("An existing source question could not be matched to its saved set; no audited content was replaced.");
  }
  if (saved.images.missing || saved.images.problems.length) {
    return failure("Source images did not finish saving, so the existing questions were not refreshed. Retry with the same package.");
  }
  const store = workspace.store();
  if (!store.commitReviewedSourceRefresh) {
    return failure("This workspace cannot durably refresh equivalent source questions.");
  }
  store.assertCurrent?.();
  const library = workspace.library();
  const set = library.questionSets.find((entry) => entry.id === saved.setId);
  if (!set || set.questionIds.length !== saved.questionIds.length
    || set.questionIds.some((id) => !saved.questionIds.includes(id))
    || saved.questionIds.length !== prepared.plan.questions.length) {
    return failure("The reused source set has different membership. Its existing questions were preserved for inspection.");
  }
  const entries: Array<{ expected: QuestionRecord; source: ReviewedSourceRefreshFields }> = [];
  for (const [index, id] of saved.questionIds.entries()) {
    const previous = library.questions.find((question) => question.id === id);
    const candidate = prepared.plan.questions[index];
    const content = candidate?.content;
    if (!previous || !content || previous.setId !== set.id || !previous.content
      || previous.content.id !== content.id || previous.content.bankId !== content.bankId
      || previous.content.provenance.sourceChecksum !== content.provenance.sourceChecksum
      || previous.correctKey !== candidate.correctKey) {
      return failure(`Question ${id} no longer matches this exact source, so its old record was preserved.`);
    }
    if (!untouchedSourceQuestion(previous, pkg)) {
      return failure(`Question ${id} has learner edits or source text changes. The set was preserved without an automatic refresh.`);
    }
    entries.push({ expected: previous, source: {
      content,
      stem: candidate.stem,
      options: candidate.options,
      correctKey: candidate.correctKey,
      correctAnswerText: candidate.options.find((option) => option.key === candidate.correctKey)?.text,
      explanation: candidate.explanation,
      extraction: candidate.extraction,
      citation: candidate.citation,
      module: prepared.plan.questionSet.scope?.module,
      week: prepared.plan.questionSet.scope?.week,
      courseId: prepared.plan.questionSet.scope?.courseId,
      questionNumber: candidate.questionNumber,
      sourcePage: candidate.sourcePage,
      needsReview: undefined,
    } });
  }
  try {
    store.assertCurrent?.();
    return await store.commitReviewedSourceRefresh({
      setId: set.id,
      expectedSet: set,
      targetScope: prepared.plan.questionSet.scope,
      questions: entries,
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The audited source refresh could not be saved.");
  }
}

export async function saveBank(pkg: ImportPackage, issues: readonly PackageIssue[], files: readonly File[], workspace: Workspace, options: PackageImportOptions = {}): Promise<BankSave> {
  const adapted = packageToReviewedImport(pkg, issues, options);
  const result: BankSave = { status: "nothing-ready", sections: [], incompleteSections: [], held: adapted.held, withheldAssets: adapted.withheldAssets, filing: adapted.filing, errors: [] };
  if (options.refreshEquivalentSource) {
    const existing = workspace.library().questions;
    const conflicts = adapted.imports.flatMap((section) => section.request.drafts.flatMap((draft) => {
      const content = draft.content;
      if (!content) return [];
      const match = existing.find((question) => question.content?.id === content.id
        && question.content.bankId === content.bankId
        && question.content.provenance.sourceChecksum === content.provenance.sourceChecksum
        && (!question.setId || question.correctKey !== draft.correctKey));
      return match ? [content.id] : [];
    }));
    if (conflicts.length) {
      result.status = "failed";
      result.errors.push(`Audited reimport found existing questions without an intact set or with a different source key: ${conflicts.join(", ")}. No questions from this bank were imported.`);
      return result;
    }
  }
  // A later review can release more questions from the same source. Reuse
  // earlier subsets instead of importing their canonical questions again.
  const imports = adapted.imports.flatMap(section => {
    const groups = new Map<string, number[]>();
    const existing = workspace.library().questions;
    section.request.drafts.forEach((draft, index) => {
      const content = draft.content;
      const previous = content?.provenance.sourceChecksum && existing.find(question =>
        question.content?.id === content.id && question.content.bankId === content.bankId &&
        question.content.provenance.sourceChecksum === content.provenance.sourceChecksum &&
        question.correctKey === draft.correctKey && question.setId);
      const key = previous ? previous.setId! : "new";
      groups.set(key, [...(groups.get(key) ?? []), index]);
    });
    return [...groups.entries()].map(([existingSetId, indices]) => ({ ...section,
      existingSetId: existingSetId === "new" ? undefined : existingSetId,
      questionIds: indices.map(index => section.questionIds[index]),
      request: { ...section.request, drafts: indices.map(index => section.request.drafts[index]) },
    }));
  });
  const pendingSections: Array<SavedSection & { requiresRefiling: boolean }> = [];
  const refileRequests: RefileRequest[] = [];
  for (const section of imports) {
    const name = section.request.setTitle;
    const incomplete = (reason: string, saved?: {
      setId?: string; documentId?: string; questionIds: string[]; reused: boolean;
    }): IncompleteSection => ({
      ...(section.set !== undefined ? { set: section.set } : {}),
      ...(section.title ? { title: section.title } : {}),
      setTitle: name,
      questionIds: section.questionIds,
      savedIds: saved?.questionIds ?? [],
      ...(saved?.setId ? { setId: saved.setId } : {}),
      ...(saved?.documentId ? { documentId: saved.documentId } : {}),
      reused: saved?.reused ?? false,
      reason,
    });
    try {
      const prepared = prepareReviewedImport(section.request, workspace.library());
      if (!prepared.ok) {
        const detail = prepared.reason === "invalid-question" ? ` ${prepared.errors.join(" ")}` : "";
        const reason = `${name}: ${REFUSAL[prepared.reason] ?? "The import was refused."}${detail}`;
        result.errors.push(reason);
        result.incompleteSections.push(incomplete(reason));
        continue;
      }
      // Canonical source identities survive learner edits to tags, titles and
      // wording. An unchanged source must repair media without cloning those
      // questions or discarding their attempts. Never adopt tentative writes.
      if (section.existingSetId && !hasReviewedImportInFlight()) {
        const library = workspace.library();
        const set = library.questionSets.find(s => s.id === section.existingSetId);
        const previous = section.request.drafts.map(draft => library.questions.find(q =>
          set?.questionIds.includes(q.id) && q.content?.id === draft.content?.id &&
          q.content?.bankId === draft.content?.bankId && q.content?.provenance.sourceChecksum === draft.content?.provenance.sourceChecksum));
        // A matching source with a changed key is a conflict, never a silent
        // replacement of a learner's existing answer mapping.
        if (options.refreshEquivalentSource && previous.some((q, index) => q?.correctKey !== section.request.drafts[index].correctKey)) {
          const reason = `${name}: an existing source answer differs from the audited package; no question was replaced.`;
          result.errors.push(reason);
          result.incompleteSections.push(incomplete(reason));
          continue;
        }
        if (set && previous.every(q => q !== undefined)) prepared.equivalent = {
          setId: set.id, questionIds: previous.map(q => q!.id), attachments: previous.map(q => q!.attachments ?? []),
        };
      }
      if (options.refreshEquivalentSource && section.existingSetId && !prepared.equivalent) {
        const reason = `${name}: matching source questions have no intact saved set; no duplicate was imported.`;
        result.errors.push(reason);
        result.incompleteSections.push(incomplete(reason));
        continue;
      }
      if (options.refreshEquivalentSource && prepared.equivalent) {
        const library = workspace.library();
        const set = library.questionSets.find((entry) => entry.id === prepared.equivalent!.setId);
        const current = prepared.equivalent.questionIds.map((id) => library.questions.find((question) => question.id === id));
        if (!set || set.questionIds.length !== current.length
          || set.questionIds.some((id) => !prepared.equivalent!.questionIds.includes(id))
          || current.some((question) => !question || !untouchedSourceQuestion(question, pkg))) {
          const reason = `${name}: a reused source question has learner edits or changed set membership. Its existing record and images were preserved.`;
          result.errors.push(reason);
          result.incompleteSections.push(incomplete(reason, {
            setId: set?.id, questionIds: prepared.equivalent.questionIds, reused: true,
          }));
          continue;
        }
      }
      if (options.refreshEquivalentSource && section.existingSetId && !workspace.store().commitReviewedSourceRefresh) {
        const reason = `${name}: this workspace cannot durably refresh equivalent source questions.`;
        result.errors.push(reason);
        result.incompleteSections.push(incomplete(reason));
        continue;
      }
      const saved = await saveReviewedImport(prepared, workspace.store(), files);
      if (!saved.ok) {
        const reason = `${name}: ${saved.message}${saved.rollbackFailures.length ? ` ${saved.rollbackFailures.join(" ")}` : ""}`;
        result.errors.push(reason);
        result.incompleteSections.push(incomplete(reason));
        continue;
      }
      let refreshed = 0;
      if (options.refreshEquivalentSource && section.existingSetId) {
        const refresh = await refreshReusedSource(pkg, prepared, saved, workspace);
        if (!refresh.ok) {
          const reason = `${name}: ${refresh.message}${refresh.rollbackFailures.length ? ` Rollback could not restore ${refresh.rollbackFailures.join(", ")}.` : ""}`;
          result.errors.push(reason);
          result.incompleteSections.push(incomplete(reason, {
            setId: saved.setId, documentId: saved.documentId, questionIds: saved.questionIds, reused: saved.reused,
          }));
          continue;
        }
        refreshed = refresh.updated;
      }
      const requiresRefiling = Boolean(saved.reused && saved.setId && options.reviewedFiling);
      if (requiresRefiling) refileRequests.push({ setId: saved.setId!, target: section.request.scope! });
      if (saved.images.missing || saved.images.problems.length) result.errors.push(`${name}: some media could not be saved. ${saved.images.problems.join(" ")}`);
      pendingSections.push({
        ...(section.set !== undefined ? { set: section.set } : {}),
        ...(section.title ? { title: section.title } : {}),
        setTitle: name,
        ...(saved.setId ? { setId: saved.setId } : {}),
        ...(saved.documentId ? { documentId: saved.documentId } : {}),
        questionIds: section.questionIds,
        savedIds: saved.questionIds,
        reused: saved.reused,
        ...(refreshed ? { refreshed } : {}),
        images: saved.images,
        requiresRefiling,
      });
    } catch (error) {
      const reason = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(reason);
      result.incompleteSections.push(incomplete(reason));
    }
  }
  let refilingFailure = "";
  if (refileRequests.length) {
    if (result.errors.length) {
      refilingFailure = "Reviewed filing was not changed because another bank section did not finish.";
      result.errors.push(refilingFailure);
    } else {
      const refiled = await refileReusedSets(workspace, refileRequests);
      if (!refiled.ok) {
        refilingFailure = `${refiled.message}${refiled.rollbackFailures.length ? ` Rollback could not restore ${refiled.rollbackFailures.join(", ")}.` : ""}`;
        result.errors.push(refilingFailure);
      }
    }
  }
  result.sections = pendingSections
    .filter((section) => !section.requiresRefiling || !refilingFailure)
    .map(({ requiresRefiling: _requiresRefiling, ...section }) => section);
  if (refilingFailure) {
    result.incompleteSections.push(...pendingSections
      .filter((section) => section.requiresRefiling)
      .map(({ requiresRefiling: _requiresRefiling, ...section }) => ({
        ...section,
        reason: refilingFailure,
      })));
  }
  if (result.errors.length) result.status = result.sections.length ? "partial" : "failed";
  else if (result.sections.length === 0) result.status = "nothing-ready";
  else result.status = result.sections.every((section) => section.reused) ? "already-saved" : "saved";
  return result;
}
