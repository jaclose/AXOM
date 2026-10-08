// ===========================================================================
// The AXOM question bank import package: a manifest, a questions file and a
// folder of assets. One shape whether it came from the DOCX template, a PDF
// importer or AXOM's own export. Types only; reading and writing the JSON is
// in `packageJson.ts`, checking a package is in `validate.ts`.
//
// Image bytes are never in the questions file. A block names an asset by id;
// the asset names a file in the assets folder.
// ===========================================================================
import type { AssetRole, QuestionBlock, TableBlock } from "./blocks";

/** Bumped only when an older AXOM could misread a newer package. See `MIGRATIONS` in packageJson.ts. */
export const PACKAGE_SCHEMA_VERSION = 1;

// --- manifest ----------------------------------------------------------------

export interface PackageCourse {
  /** The module as AXOM files it ("GOER"), matched to a course by the course engine. */
  name: string;
  term: number;
  week: number;
}

export interface PackageBank {
  /** Stable and lower-case with hyphens: "goer-t5-w2-pharmacodynamics-pk". */
  id: string;
  title: string;
  discipline: string;
  topic?: string;
}

export interface PackageSource {
  filename: string;
  institution?: string;
  /** What the source calls itself, word for word. */
  declaredTitle?: string;
  declaredTerm?: string;
  /** False when the week is how AXOM files the bank, not a claim the source makes. */
  sourceWeekDeclared: boolean;
  axomAssignedWeek?: number;
}

export interface PackageManifest {
  schemaVersion: number;
  course: PackageCourse;
  bank: PackageBank;
  source: PackageSource;
  questionsFile: string;
  assetsDirectory: string;
}

// --- questions ---------------------------------------------------------------

export interface SourceMetadata {
  filename: string;
  page?: number;
  pageEnd?: number;
  /** The source's own number for the question. */
  questionNumber?: number;
}

export const PROVENANCE_METHODS = ["authored", "manual-transcription", "docx-template", "docx-import", "pdf-import", "axom-export"] as const;
export type ProvenanceMethod = (typeof PROVENANCE_METHODS)[number];

export interface ProvenanceMetadata {
  /** How the question got into package form. */
  method: ProvenanceMethod;
  /** The parser or exporter and its version, when a program did it. */
  tool?: string;
  createdAt?: string;
  /** "sha256:<hex>" of the source file, to tell a re-issued file from the one that was read. */
  sourceChecksum?: string;
  notes?: string;
}

export const ANSWER_EVIDENCE = ["printed-key", "answer-reveal-slide", "explanation", "reviewer"] as const;
export type AnswerEvidence = (typeof ANSWER_EVIDENCE)[number];

export interface AnswerKey {
  /** One label for a single best answer; more for a multiple-select question. */
  labels: string[];
  /** Where the key came from. A highlighted copy of a slide is evidence, not a printed key. */
  evidence?: AnswerEvidence;
}

export interface QuestionChoice {
  id: string;
  /** "A", "B" ... as the source letters them. */
  label: string;
  /** Empty only when the question's `choiceTable` carries this choice as a row. */
  blocks: QuestionBlock[];
}

export const ASSET_DERIVATIONS = ["embedded", "region-render", "page-render", "authored"] as const;
/**
 * How the picture was obtained. A graph drawn as vector shapes in a slide has
 * no embedded picture to lift out, so it is rendered from a region of the page.
 */
export type AssetDerivation = (typeof ASSET_DERIVATIONS)[number];

export interface QuestionAsset {
  id: string;
  /** File name inside the manifest's assets folder. */
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
  byteSize?: number;
  sourceFile?: string;
  sourcePage?: number;
  role: AssetRole;
  questionId: string;
  /** "sha256:<hex>" of the file. */
  checksum?: string;
  derivation?: AssetDerivation;
  /** The region of the source page, in page points from the top left, for a render. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** On an answer-reveal asset: the clean asset it is the marked copy of. */
  revealOf?: string;
  /**
   * The part of the stored picture the source hides on each side, as a
   * fraction of its width or height. A document can crop a picture on the
   * page and still hold all of it, so whatever shows the picture must hide
   * the same part.
   */
  crop?: { left: number; top: number; right: number; bottom: number };
}

export const QUESTION_FLAG_TYPES = [
  "source_inconsistency",
  "missing_explanation",
  "possible_duplicate",
  "answer_reveal_asset",
  "media_association_uncertain",
  "table_parse_uncertain",
  "missing_required_media",
  "answer_needs_review",
] as const;
export type QuestionFlagType = (typeof QUESTION_FLAG_TYPES)[number];

/**
 * A note about the source or the import, kept beside the question. A flag
 * never changes the question: wording the source got wrong stays wrong, and
 * the flag says so.
 */
export interface QuestionFlag {
  type: QuestionFlagType;
  message: string;
}

export interface PackageQuestion {
  id: string;
  /** Filing. Absent means "as the manifest says"; see `questionScope`. */
  course?: string;
  term?: number;
  week?: number;
  bankId?: string;
  discipline?: string;
  topic?: string;
  subtopic?: string;
  source: SourceMetadata;
  stem: QuestionBlock[];
  choices: QuestionChoice[];
  /** One shared table whose rows are the choices, when the source sets them out that way. */
  choiceTable?: TableBlock;
  correctAnswer?: AnswerKey;
  explanation?: QuestionBlock[];
  assets: QuestionAsset[];
  flags?: QuestionFlag[];
  provenance: ProvenanceMetadata;
}

export interface ImportPackage {
  manifest: PackageManifest;
  questions: PackageQuestion[];
}

// --- issues ------------------------------------------------------------------

export type StructuralIssueCode =
  | "invalid_package"
  | "unsupported_version"
  | "invalid_question"
  | "invalid_block"
  | "rich_text_escaped"
  | "unknown_field"
  | "unknown_flag"
  | "duplicate_id"
  | "scope_mismatch"
  | "missing_answer_key"
  | "answer_key_not_a_choice"
  | "choices_incomplete"
  | "asset_reference_broken"
  | "invalid_document"
  | "unsupported_content"
  | "possible_answer_marking"
  | "tracked_changes"
  | "media_cropped"
  | "needs_review";

export type IssueCode = QuestionFlagType | StructuralIssueCode;

export type IssueSeverity = "error" | "warning" | "info";

/**
 * Something the import preview must show. An error with no `questionId`
 * means the package cannot be read at all. An error on a question means that
 * question cannot be run until it is fixed; the rest of the bank still imports.
 */
export interface PackageIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  questionId?: string;
  /** Where in the question: "stem[2]", "choices[C].blocks[0]", "assets[q9-img-1]". */
  path?: string;
}

// --- filing ------------------------------------------------------------------

export interface ResolvedScope {
  course: string;
  term: number;
  week: number;
  bankId: string;
  discipline: string;
  topic?: string;
  subtopic?: string;
}

/** A question's filing, with the manifest filling whatever the question leaves unsaid. */
export function questionScope(manifest: PackageManifest, question: PackageQuestion): ResolvedScope {
  const topic = question.topic ?? manifest.bank.topic;
  return {
    course: question.course ?? manifest.course.name,
    term: question.term ?? manifest.course.term,
    week: question.week ?? manifest.course.week,
    bankId: question.bankId ?? manifest.bank.id,
    discipline: question.discipline ?? manifest.bank.discipline,
    ...(topic ? { topic } : {}),
    ...(question.subtopic ? { subtopic: question.subtopic } : {}),
  };
}
