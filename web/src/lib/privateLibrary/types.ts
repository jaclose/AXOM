import type { ImportPackage, PackageIssue } from "../question-content/package";

export const PRIVATE_LIBRARY_FORMAT = "axom-private-library";
export const PRIVATE_LIBRARY_DOCUMENT = "axom-private-library-catalog";
export const PRIVATE_REVIEW_DOCUMENT = "axom-private-bank-review";

export interface PreparedBank {
  pkg: ImportPackage;
  issues: PackageIssue[];
  sourceText: { rawText: string; pageTexts?: string[] };
  sourceBytes: number;
  notes: string[];
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
