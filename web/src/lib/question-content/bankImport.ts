// ===========================================================================
// Saving a package into the workspace: each set of the source through the
// canonical import, one after another, with a plain account of what happened.
//
// It never reports success for something that was not written. A refusal or
// a failed write is in `errors`, and `status` says "failed".
// ===========================================================================
import type { ImportLibrary } from "../questionImportHistory";
import { prepareReviewedImport, saveReviewedImport, type ReviewedImportStore } from "../questionImportSave";
import { hasReviewedImportInFlight } from "../questionImportFinalization";
import type { ImportPackage, PackageIssue } from "./package";
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
  images: { attached: number; missing: number; problems: string[] };
}

export interface BankSave {
  /**
   * "saved": at least one set was written. "already-saved": every set was found from an
   * earlier import (missing image bytes may still have been repaired). "nothing-ready": no question may be saved yet.
   * "failed": something was refused or could not be written; see `errors`.
   */
  status: "saved" | "already-saved" | "nothing-ready" | "failed";
  sections: SavedSection[];
  held: HeldQuestion[];
  withheldAssets: WithheldAsset[];
  filing: { module: string; week: number; term: number; curriculumTerm?: string; agrees: boolean };
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

export async function saveBank(pkg: ImportPackage, issues: readonly PackageIssue[], files: readonly File[], workspace: Workspace, options: PackageImportOptions = {}): Promise<BankSave> {
  const adapted = packageToReviewedImport(pkg, issues, options);
  const result: BankSave = { status: "nothing-ready", sections: [], held: adapted.held, withheldAssets: adapted.withheldAssets, filing: adapted.filing, errors: [] };
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
  for (const section of imports) {
    const name = section.request.setTitle;
    try {
      const prepared = prepareReviewedImport(section.request, workspace.library());
      if (!prepared.ok) {
        const detail = prepared.reason === "invalid-question" ? ` ${prepared.errors.join(" ")}` : "";
        result.errors.push(`${name}: ${REFUSAL[prepared.reason] ?? "The import was refused."}${detail}`);
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
        if (set && previous.every(q => q !== undefined)) prepared.equivalent = {
          setId: set.id, questionIds: previous.map(q => q!.id), attachments: previous.map(q => q!.attachments ?? []),
        };
      }
      const saved = await saveReviewedImport(prepared, workspace.store(), files);
      if (!saved.ok) {
        result.errors.push(`${name}: ${saved.message}${saved.rollbackFailures.length ? ` ${saved.rollbackFailures.join(" ")}` : ""}`);
        continue;
      }
      if (saved.images.missing || saved.images.problems.length) result.errors.push(`${name}: some media could not be saved. ${saved.images.problems.join(" ")}`);
      result.sections.push({
        ...(section.set !== undefined ? { set: section.set } : {}),
        ...(section.title ? { title: section.title } : {}),
        setTitle: name,
        ...(saved.setId ? { setId: saved.setId } : {}),
        ...(saved.documentId ? { documentId: saved.documentId } : {}),
        questionIds: section.questionIds,
        savedIds: saved.questionIds,
        reused: saved.reused,
        images: saved.images,
      });
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (result.errors.length) result.status = "failed";
  else if (result.sections.length === 0) result.status = "nothing-ready";
  else result.status = result.sections.every((section) => section.reused) ? "already-saved" : "saved";
  return result;
}
