import type { ImportPackage, PackageIssue } from "../question-content/package";

export const PRIVATE_LIBRARY_FORMAT = "axom-private-library";
export const PRIVATE_LIBRARY_DOCUMENT = "axom-private-library-catalog";
export const PRIVATE_REVIEW_DOCUMENT = "axom-private-bank-review";

export type ReviewedFilingTerm = "Term 1" | "Term 2" | "Term 3" | "Term 4" | "Term 5";

/** Human/source-supported filing for a package whose original scope remains
 * preserved in `pkg` as evidence. Reviewed source-only banks never invent a
 * week. */
export interface ReviewedFiling {
  readonly term: ReviewedFilingTerm;
  readonly module: string;
  readonly evidence: "source-metadata" | "human-reviewed";
  readonly weekAssignment: "unassigned";
}

export interface PreparedBank {
  pkg: ImportPackage;
  issues: PackageIssue[];
  sourceText: { rawText: string; pageTexts?: string[] };
  sourceBytes: number;
  notes: string[];
  /** Immutable reviewed filing layered over, never written into, source scope. */
  readonly reviewedFiling?: ReviewedFiling;
  /** Unreadable extracted rows remain in the original document, outside scoring. */
  unreadableQuestions?: number;
}

export interface PrivateLibraryCatalog {
  format: typeof PRIVATE_LIBRARY_FORMAT;
  schemaVersion: 1;
  id: string;
  version: string;
  preparerVersion?: number;
  templates: Array<{ file: string; name: string; checksum: string }>;
  sources: Array<{
    id: string;
    name: string;
    sourcePath: string;
    checksum: string;
    module?: string;
    status: "prepared" | "review-required" | "duplicate-linked" | "reference/template-only" | "unsupported" | "missing" | "failed";
    reason: string;
    bankFile?: string;
    originalFile?: string;
    ready: number;
    review: number;
    duplicateOf?: string;
  }>;
}
