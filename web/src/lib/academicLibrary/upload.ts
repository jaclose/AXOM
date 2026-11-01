import type { SupabaseClient } from "@supabase/supabase-js";
import { hasUniformUnfiledSourceScope, preparedBankImportOptions, readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import { sha256 } from "../question-content/assets";
import {
  assertInstallableAcademicImageBytes,
  type InstallableAcademicImage,
} from "./gifIntegrity";
import { assessBank } from "../question-content/assessBank";
import { packageToReviewedImport } from "../question-content/toReviewedImport";
import type { PreparedBank, PrivateLibraryCatalog, ReviewedFiling } from "../privateLibrary/types";
import { questionScope, type PackageIssue, type QuestionAsset } from "../question-content/package";
import { academicCoursePlan, moduleIdentity, reviewedTermNumber, type AcademicCoursePlan, type AcademicPlanTerm } from "./coursePlan";
import { accountOperationClient } from "../account/supabase";
import { RESUMABLE_CHUNK_BYTES, uploadResumableObject, type ResumableStorageConfig } from "../sync/resumableObject";
import { MAX_QUESTION_ATTACHMENTS, MAX_QUESTION_ATTACHMENT_BYTES, MAX_QUESTION_ATTACHMENT_TOTAL_BYTES,
  type QuestionAttachmentMimeType } from "../questionAttachments";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const basename = (name: string) => name.split(/[\\/]/).at(-1) || "source";
const compareAcademicPath = (left: { path: string }, right: { path: string }) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
// Matches academic_files.byte_size and academic-content Storage bucket limit.
const fileLimit = 50 * 1024 * 1024;
/** Plan sections one course may combine; real modules have two or three. */
const MAX_PLAN_SECTIONS = 24;
const imageMimeByExtension: Readonly<Record<string, QuestionAttachmentMimeType>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
const originalMimeByExtension: Readonly<Record<string, string>> = {
  pdf: "application/pdf", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
type PrivateLibrarySource = PrivateLibraryCatalog["sources"][number];
export type VerifiedAcademicImage = InstallableAcademicImage;

/** A template is authority only for content that demonstrably shares its
 * term and module. Merely including one parseable template must not let an
 * unrelated source or question bypass manual filing review. */
function assertTemplateOwnsSource(
  template: Pick<AcademicCoursePlan, "term" | "module">, source: PrivateLibrarySource, bank?: PreparedBank,
): void {
  const term = reviewedTermNumber(template.term);
  const module = moduleIdentity(template.module);
  if (!term || !module) throw new Error("The course plan needs an exact Term 1-5 and reviewed module before upload.");
  if (source.module !== undefined && moduleIdentity(source.module) !== module)
    throw new Error("A source module does not match the reviewed course plan. Split or correct the private package before upload.");
  if (!bank) {
    if (!source.module)
      throw new Error("Every source without a question bank must name the module owned by the reviewed course plan.");
    return;
  }
  if (bank.reviewedFiling) {
    if (!hasUniformUnfiledSourceScope(bank.pkg.manifest, bank.pkg.questions)
      || bank.reviewedFiling.evidence !== "human-reviewed")
      throw new Error("A template-backed bank cannot also carry a manual reviewed filing. Split the conflicting academic scopes.");
    if (bank.reviewedFiling.term !== template.term || moduleIdentity(bank.reviewedFiling.module) !== module)
      throw new Error("The Unfiled source's reviewed filing does not match its course plan.");
    return;
  }
  if (moduleIdentity(bank.pkg.manifest.course.name) !== module || bank.pkg.manifest.course.term !== term)
    throw new Error("A question bank's module or term does not match the reviewed course plan.");
  for (const question of bank.pkg.questions) {
    const scope = questionScope(bank.pkg.manifest, question);
    if (moduleIdentity(scope.course) !== module || scope.term !== term)
      throw new Error("A question's module or term does not match the reviewed course plan.");
  }
}
/** Map a reviewed bank's figure to its immutable package path. Root-level
 * bank.json is supported; blindly slicing at index -1 corrupts the path. */
export function academicAssetPath(bankFile: string, filename: string): string {
  safeLibraryPath(bankFile); safeLibraryPath(filename);
  const index = bankFile.lastIndexOf("/");
  const prefix = index === -1 ? "" : bankFile.slice(0, index + 1);
  return safeLibraryPath(`${prefix}assets/${filename}`);
}

/** Cloud storage can accept much larger objects than the learner's real
 * question-attachment installer. Do not certify media that cannot be restored. */
export async function assertInstallableAcademicImage(bytes: Uint8Array, mime: string): Promise<VerifiedAcademicImage> {
  return assertInstallableAcademicImageBytes(bytes, mime);
}

/** Optional package metadata may be absent in older packages, but when a
 * package declares facts that only bytes can prove, disagreement is fatal. */
export function assertAcademicAssetMatchesBytes(asset: QuestionAsset, image: VerifiedAcademicImage): void {
  if (asset.mimeType !== image.mimeType
    || (asset.byteSize !== undefined && asset.byteSize !== image.byteSize)
    || (asset.width !== undefined && asset.width !== image.width)
    || (asset.height !== undefined && asset.height !== image.height))
    throw new Error(`The academic figure ${asset.filename} has declared MIME, byte-size or dimensions that differ from its verified bytes.`);
}

const MAX_HELD_ACADEMIC_FIGURES = 64;

/** All stored figures keep their integrity and byte budgets, including those
 * on questions held from learner import. */
function assertFigureBudget(
  questions: readonly { assets: readonly { filename: string; checksum?: string }[] }[],
  sizes: ReadonlyMap<string, number> | undefined,
  maxFigures: number,
): void {
  const filenames = new Map<string, string>();
  for (const question of questions) {
    if (question.assets.length > maxFigures)
      throw new Error(maxFigures === MAX_QUESTION_ATTACHMENTS
        ? "An academic question exceeds AXOM's 10-figure attachment limit."
        : "A held academic question exceeds AXOM's 64-figure source limit.");
    let questionBytes = 0;
    for (const asset of question.assets) {
      const key = asset.filename.trim().split(/[\\/]/).pop()?.normalize("NFC").toLowerCase();
      if (!key || !asset.checksum) throw new Error("An academic figure needs a reviewed filename and SHA-256.");
      const previous = filenames.get(key);
      if (previous && previous !== asset.checksum)
        throw new Error("Two different images share the same installable filename. Review and rename the conflicting figure.");
      filenames.set(key, asset.checksum);
      if (sizes) {
        const bytes = sizes.get(asset.filename);
        if (!Number.isSafeInteger(bytes) || !bytes || bytes > MAX_QUESTION_ATTACHMENT_BYTES)
          throw new Error("An academic figure cannot be restored within the 8 MiB attachment limit.");
        questionBytes += bytes;
        if (questionBytes > MAX_QUESTION_ATTACHMENT_TOTAL_BYTES)
          throw new Error("An academic question exceeds AXOM's 30 MiB total figure attachment limit.");
      }
    }
  }
}

/** Held source questions are stored for review, not imported into learner
 * practice. Their figures still have a bounded count and the same byte checks. */
export function assertAcademicStoredFigureBudget(
  questions: readonly { assets: readonly { filename: string; checksum?: string }[] }[],
  sizes?: ReadonlyMap<string, number>,
): void {
  assertFigureBudget(questions, sizes, MAX_HELD_ACADEMIC_FIGURES);
}

/** Answer-ready questions must fit the canonical local attachment limit. */
export function assertAcademicFigureBudget(
  questions: readonly { assets: readonly { filename: string; checksum?: string }[] }[],
  sizes?: ReadonlyMap<string, number>,
): void {
  assertFigureBudget(questions, sizes, MAX_QUESTION_ATTACHMENTS);
}
/** Readiness alone is not a promise that AXOM's canonical question importer
 * can produce a scored set. It additionally refuses multi-answer keys, bad
 * choice bodies and duplicate numbers within a source set. The uploader and
 * owner readback must agree with that ACTUAL importer before issuing receipts.
 * No learner records are written by this pure compatibility check. */
export function assertAcademicQuestionsInstallable(
  bank: PreparedBank, issues: readonly PackageIssue[], ready: number, review: number,
): void {
  const adapted = packageToReviewedImport(bank.pkg, issues, preparedBankImportOptions(bank));
  const importable = adapted.imports.flatMap(section => section.questionIds);
  const held = adapted.held.length + (bank.unreadableQuestions ?? 0);
  if (importable.length !== ready || held !== review || new Set(importable).size !== importable.length)
    throw new Error("The reviewed source's ready count does not match AXOM's canonical scored importer. Resolve held questions and answer-key identity before cloud saving.");
}

/** A question collection without an official weekly plan must carry verified
 * classification rather than synthesizing fictitious SGU activity weeks. */
export interface AcademicUnscheduledScope {
  term: ReviewedFiling["term"];
  module: string;
  title?: string;
  evidence: ReviewedFiling["evidence"];
}
export interface AcademicUploadOptions {
  /** Required when no plan section states its term; never inferred here. */
  planTerm?: AcademicPlanTerm;
}
export interface AcademicUpload {
  catalogId: string;
  metadata: Record<string, string | number | undefined>;
  template: string;
  provenance: {
    sourceChecksums: string[]; scopeEvidence?: AcademicUnscheduledScope["evidence"]; weekAssignment?: "unassigned";
    /** Present when a reviewer confirmed the term of a plan that does not state it. */
    planTermEvidence?: AcademicPlanTerm["evidence"];
  };
  files: Array<{ path: string; sha256: string; byte_size: number; mime_type: string; bytes: Uint8Array }>;
  hash: string;
  /** Verified source bytes that exceed academic-content's per-file ceiling.
   * The reviewed question packages still upload; these originals do not. */
  localOnlyOriginals: Array<{ sourceId: string; sha256: string; byteSize: number; reason: "over-limit" }>;
}

type UnknownRecord = Record<string, unknown>;
const own = (value: UnknownRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function plainRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as UnknownRecord;
}

function assertKeys(value: UnknownRecord, allowed: readonly string[], required: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some(key => !allowedKeys.has(key)) || required.some(key => !own(value, key))) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error(`${label} is invalid.`);
  return value;
}

/** Take ownership of every replay byte and every server-bound field before the
 * first async boundary. Callers may keep and mutate their prepared object; no
 * such mutation can alter the revision that this invocation validates. */
function snapshotAcademicUpload(value: AcademicUpload): AcademicUpload {
  const upload = plainRecord(value, "The academic upload envelope");
  assertKeys(upload,
    ["catalogId", "metadata", "template", "provenance", "files", "hash", "localOnlyOriginals"],
    ["catalogId", "metadata", "template", "provenance", "files", "hash", "localOnlyOriginals"],
    "The academic upload envelope");
  if (typeof upload.catalogId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(upload.catalogId)
    || typeof upload.template !== "string" || typeof upload.hash !== "string" || !/^[a-f0-9]{64}$/.test(upload.hash)) {
    throw new Error("The academic upload envelope has an invalid catalog, template or content hash.");
  }

  const sourceMetadata = plainRecord(upload.metadata, "Academic metadata");
  const metadataKeys = ["title", "module", "term", "academic_term", "cohort", "source_revision",
    "ready_questions", "review_questions", "local_only_originals"] as const;
  assertKeys(sourceMetadata, metadataKeys,
    ["title", "module", "term", "ready_questions", "review_questions", "local_only_originals"], "Academic metadata");
  const title = sourceMetadata.title;
  const module = sourceMetadata.module;
  const term = sourceMetadata.term;
  const ready = sourceMetadata.ready_questions;
  const review = sourceMetadata.review_questions;
  const localOnlyCount = sourceMetadata.local_only_originals;
  if (typeof title !== "string" || !title.trim() || title.length > 180
    || typeof module !== "string" || !moduleIdentity(module)
    || typeof term !== "string" || !/^Term [1-5]$/.test(term)
    || ![ready, review].every(count => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 100000)
    || !Number.isSafeInteger(localOnlyCount) || Number(localOnlyCount) < 0 || Number(localOnlyCount) > 10000) {
    throw new Error("Academic metadata has an invalid course identity or verified count.");
  }
  const metadata: AcademicUpload["metadata"] = {
    title, module, term,
    ...(own(sourceMetadata, "academic_term") ? { academic_term: optionalString(sourceMetadata.academic_term, "Academic term") } : {}),
    ...(own(sourceMetadata, "cohort") ? { cohort: optionalString(sourceMetadata.cohort, "Academic cohort") } : {}),
    ...(own(sourceMetadata, "source_revision") ? { source_revision: optionalString(sourceMetadata.source_revision, "Academic source revision") } : {}),
    ready_questions: Number(ready), review_questions: Number(review), local_only_originals: Number(localOnlyCount),
  };

  const sourceProvenance = plainRecord(upload.provenance, "Academic provenance");
  assertKeys(sourceProvenance, ["sourceChecksums", "scopeEvidence", "weekAssignment", "planTermEvidence"], ["sourceChecksums"], "Academic provenance");
  if (!Array.isArray(sourceProvenance.sourceChecksums) || sourceProvenance.sourceChecksums.length > 10000
    || sourceProvenance.sourceChecksums.some(checksum => typeof checksum !== "string" || !/^[a-f0-9]{64}$/.test(checksum))
    || (sourceProvenance.scopeEvidence !== undefined
      && !["source-metadata", "human-reviewed"].includes(String(sourceProvenance.scopeEvidence)))
    || (sourceProvenance.weekAssignment !== undefined && sourceProvenance.weekAssignment !== "unassigned")
    || (sourceProvenance.planTermEvidence !== undefined && sourceProvenance.planTermEvidence !== "human-reviewed")) {
    throw new Error("Academic provenance has an invalid source identity or filing envelope.");
  }
  const provenance: AcademicUpload["provenance"] = {
    sourceChecksums: [...sourceProvenance.sourceChecksums] as string[],
    ...(own(sourceProvenance, "scopeEvidence")
      ? { scopeEvidence: sourceProvenance.scopeEvidence as AcademicUpload["provenance"]["scopeEvidence"] }
      : {}),
    ...(own(sourceProvenance, "weekAssignment") ? { weekAssignment: "unassigned" as const } : {}),
    ...(own(sourceProvenance, "planTermEvidence") ? { planTermEvidence: "human-reviewed" as const } : {}),
  };

  if (!Array.isArray(upload.files) || !upload.files.length || upload.files.length > 1500)
    throw new Error("A private academic upload must contain 1–1500 verified files.");
  let totalBytes = 0;
  const files = upload.files.map((candidate, index): AcademicUpload["files"][number] => {
    const file = plainRecord(candidate, `Academic file ${index + 1}`);
    assertKeys(file, ["path", "sha256", "byte_size", "mime_type", "bytes"],
      ["path", "sha256", "byte_size", "mime_type", "bytes"], `Academic file ${index + 1}`);
    if (typeof file.path !== "string" || file.path.length > 1024 || /^[a-z]:/i.test(file.path)
      || [...file.path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || !(file.bytes instanceof Uint8Array) || !Number.isSafeInteger(file.byte_size)
      || Number(file.byte_size) < 1 || Number(file.byte_size) > fileLimit
      || Number(file.byte_size) !== file.bytes.length || typeof file.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.mime_type !== "string" || !file.mime_type) {
      throw new Error("An academic file's path, MIME type, byte size or SHA-256 differs from its private upload manifest.");
    }
    safeLibraryPath(file.path);
    totalBytes += Number(file.byte_size);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > 512 * 1024 * 1024)
      throw new Error("This collection exceeds the supported upload size.");
    return Object.freeze({
      path: file.path, sha256: file.sha256, byte_size: Number(file.byte_size), mime_type: file.mime_type,
      bytes: new Uint8Array(file.bytes),
    });
  });

  if (!Array.isArray(upload.localOnlyOriginals) || upload.localOnlyOriginals.length > 10000)
    throw new Error("The local-only original manifest is invalid.");
  const localOnlyOriginals = upload.localOnlyOriginals.map((candidate, index): AcademicUpload["localOnlyOriginals"][number] => {
    const original = plainRecord(candidate, `Local-only original ${index + 1}`);
    assertKeys(original, ["sourceId", "sha256", "byteSize", "reason"],
      ["sourceId", "sha256", "byteSize", "reason"], `Local-only original ${index + 1}`);
    if (typeof original.sourceId !== "string" || !original.sourceId
      || typeof original.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(original.sha256)
      || !Number.isSafeInteger(original.byteSize) || Number(original.byteSize) <= fileLimit
      || original.reason !== "over-limit") {
      throw new Error("The local-only original manifest is invalid.");
    }
    return Object.freeze({ sourceId: original.sourceId, sha256: original.sha256,
      byteSize: Number(original.byteSize), reason: "over-limit" as const });
  });

  Object.freeze(metadata);
  Object.freeze(provenance.sourceChecksums);
  Object.freeze(provenance);
  Object.freeze(files);
  Object.freeze(localOnlyOriginals);
  return Object.freeze({
    catalogId: upload.catalogId, metadata, template: upload.template, provenance, files,
    hash: upload.hash, localOnlyOriginals,
  });
}

function uploadManifest(files: AcademicUpload["files"]) {
  return [...files]
    .sort(compareAcademicPath)
    .map(file => ({ path: file.path, sha256: file.sha256, byte_size: file.byte_size, mime_type: file.mime_type }));
}

function localOnlyManifest(originals: AcademicUpload["localOnlyOriginals"]) {
  return [...originals]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId)
      || left.sha256.localeCompare(right.sha256) || left.byteSize - right.byteSize)
    .map(original => ({ sourceId: original.sourceId, sha256: original.sha256,
      byteSize: original.byteSize, reason: original.reason }));
}

function hashMetadata(metadata: AcademicUpload["metadata"]): AcademicUpload["metadata"] {
  const result: AcademicUpload["metadata"] = {};
  for (const key of ["title", "module", "term", "academic_term", "cohort", "source_revision",
    "ready_questions", "review_questions", "local_only_originals"] as const) {
    if (metadata[key] !== undefined) result[key] = metadata[key];
  }
  return result;
}

function hashProvenance(provenance: AcademicUpload["provenance"]): AcademicUpload["provenance"] {
  return {
    sourceChecksums: [...provenance.sourceChecksums],
    ...(provenance.scopeEvidence !== undefined ? { scopeEvidence: provenance.scopeEvidence } : {}),
    ...(provenance.weekAssignment !== undefined ? { weekAssignment: provenance.weekAssignment } : {}),
    ...(provenance.planTermEvidence !== undefined ? { planTermEvidence: provenance.planTermEvidence } : {}),
  };
}

function assertCatalogEnvelopeShape(value: unknown): void {
  const catalog = plainRecord(value, "The academic catalog");
  assertKeys(catalog, ["format", "schemaVersion", "id", "version", "preparerVersion", "templates", "sources"],
    ["format", "schemaVersion", "id", "version", "templates", "sources"], "The academic catalog");
  if (catalog.preparerVersion !== undefined
    && (!Number.isSafeInteger(catalog.preparerVersion) || Number(catalog.preparerVersion) < 0)) {
    throw new Error("The academic catalog has an invalid preparer version.");
  }
  if (!Array.isArray(catalog.templates) || !Array.isArray(catalog.sources)) return;
  for (const value of catalog.templates) {
    const template = plainRecord(value, "An academic template entry");
    assertKeys(template, ["file", "name", "checksum"], ["file", "name", "checksum"], "An academic template entry");
    if (typeof template.file !== "string" || typeof template.name !== "string"
      || template.name !== basename(template.name)) {
      throw new Error("An academic template entry contains a noncanonical name or path.");
    }
  }
  for (const value of catalog.sources) {
    const source = plainRecord(value, "An academic source entry");
    assertKeys(source,
      ["id", "name", "sourcePath", "checksum", "module", "status", "reason", "bankFile", "originalFile", "ready", "review", "duplicateOf"],
      ["id", "name", "sourcePath", "checksum", "status", "reason", "ready", "review"], "An academic source entry");
    if (typeof source.name !== "string" || source.name !== basename(source.name)
      || source.sourcePath !== source.name) {
      throw new Error("An academic source entry contains a local or noncanonical source path.");
    }
  }
}

function assertPreparedBankEnvelopeShape(value: unknown): void {
  const bank = plainRecord(value, "A prepared academic bank");
  assertKeys(bank, ["pkg", "issues", "sourceText", "sourceBytes", "notes", "reviewedFiling", "unreadableQuestions"],
    ["pkg", "issues", "sourceText", "sourceBytes", "notes"], "A prepared academic bank");
  const pkg = plainRecord(bank.pkg, "A prepared academic package");
  assertKeys(pkg, ["manifest", "questions"], ["manifest", "questions"], "A prepared academic package");
  const sourceText = plainRecord(bank.sourceText, "Prepared academic source text");
  assertKeys(sourceText, ["rawText", "pageTexts"], ["rawText"], "Prepared academic source text");
  if (typeof sourceText.rawText !== "string"
    || (sourceText.pageTexts !== undefined
      && (!Array.isArray(sourceText.pageTexts) || sourceText.pageTexts.some(page => typeof page !== "string")))
    || !Number.isSafeInteger(bank.sourceBytes) || Number(bank.sourceBytes) < 0
    || !Array.isArray(bank.notes) || bank.notes.length !== 0
    || (bank.unreadableQuestions !== undefined
      && (!Number.isSafeInteger(bank.unreadableQuestions) || Number(bank.unreadableQuestions) < 0))) {
    throw new Error("A prepared academic bank contains invalid or noncanonical review data.");
  }
  if (!Array.isArray(bank.issues)) throw new Error("A prepared academic bank has an invalid issue list.");
  for (const value of bank.issues) {
    const issue = plainRecord(value, "A prepared academic issue");
    assertKeys(issue, ["severity", "code", "message", "questionId", "path"],
      ["severity", "code", "message"], "A prepared academic issue");
    if (!["error", "warning", "info"].includes(String(issue.severity))
      || typeof issue.code !== "string" || typeof issue.message !== "string"
      || (issue.questionId !== undefined && typeof issue.questionId !== "string")
      || (issue.path !== undefined && typeof issue.path !== "string")) {
      throw new Error("A prepared academic bank has an invalid issue list.");
    }
  }
}

function assertTemplateMetadata(upload: AcademicUpload, plan: AcademicCoursePlan): void {
  if (upload.template !== plan.text
    || upload.metadata.title !== plan.module || upload.metadata.module !== plan.module
    || upload.metadata.term !== plan.term
    || upload.metadata.academic_term !== plan.academicTerm
    || upload.metadata.cohort !== plan.cohort
    || upload.metadata.source_revision !== plan.sourceRevision
    || upload.provenance.scopeEvidence !== undefined || upload.provenance.weekAssignment !== undefined
    || upload.provenance.planTermEvidence !== (plan.termStated ? undefined : "human-reviewed")) {
    throw new Error("The academic upload hash is not canonical for its reviewed course plan and metadata.");
  }
}

/** Each source has its own evidence. A course-level human review cannot
 * reclassify another bank that has no matching bank-level review. */
function sourceOnlyBankFiling(bank: PreparedBank, course: ReviewedFiling, requireStoredFiling: boolean): ReviewedFiling {
  const filing = bank.reviewedFiling;
  if (hasUniformUnfiledSourceScope(bank.pkg.manifest, bank.pkg.questions)) {
    if (!filing || filing.evidence !== "human-reviewed" || course.evidence !== "human-reviewed"
      || filing.term !== course.term || moduleIdentity(filing.module) !== moduleIdentity(course.module))
      throw new Error("An Unfiled question bank needs its own exact human-reviewed filing before upload.");
    return filing;
  }
  const originalModule = moduleIdentity(bank.pkg.manifest.course.name);
  const originalTerm = bank.pkg.manifest.course.term;
  if (!originalModule || !Number.isInteger(originalTerm) || originalTerm < 1 || originalTerm > 5)
    throw new Error("A question bank has an invalid original module or term.");
  for (const question of bank.pkg.questions) {
    const scope = questionScope(bank.pkg.manifest, question);
    if (moduleIdentity(scope.course) !== originalModule || scope.term !== originalTerm)
      throw new Error("A question bank has mixed or invalid original modules or terms. Split it before upload.");
  }
  if (requireStoredFiling && !filing)
    throw new Error("The direct upload envelope is missing a bank's reviewed source filing.");
  const effective = filing ?? {
    term: `Term ${originalTerm}` as ReviewedFiling["term"], module: bank.pkg.manifest.course.name,
    evidence: "source-metadata" as const, weekAssignment: "unassigned" as const,
  };
  if (effective.evidence === "source-metadata"
    && (effective.term !== `Term ${originalTerm}` || moduleIdentity(effective.module) !== originalModule))
    throw new Error("Source-metadata filing must agree with the package's original module and term.");
  if (effective.term !== course.term || moduleIdentity(effective.module) !== moduleIdentity(course.module)
    || (effective.evidence === "human-reviewed" && course.evidence !== "human-reviewed"))
    throw new Error("A bank's reviewed filing does not match its source-only course.");
  return effective;
}

/** The server content hash covers the exact canonical manifest as well as
 * classification metadata. It is recalculated on every direct replay. */
export async function academicUploadHash(
  upload: Pick<AcademicUpload, "metadata" | "template" | "provenance" | "files" | "localOnlyOriginals">,
): Promise<string> {
  return (await sha256(encode({
    metadata: hashMetadata(upload.metadata),
    template: upload.template,
    provenance: hashProvenance(upload.provenance),
    files: uploadManifest(upload.files),
    localOnlyOriginals: localOnlyManifest(upload.localOnlyOriginals),
  }))).slice(7);
}

/** Validate a replayable AcademicUpload as a closed package before any
 * registration RPC. This deliberately repeats preparation checks because a
 * caller can retain and mutate a prepared object between those two steps. */
async function preflightAcademicUpload(upload: AcademicUpload): Promise<AcademicUpload["files"]> {
  if (!upload || !Array.isArray(upload.files) || !upload.files.length || upload.files.length > 1500)
    throw new Error("A private academic upload must contain 1–1500 verified files.");
  const files = [...upload.files].sort(compareAcademicPath);
  const byPath = new Map<string, AcademicUpload["files"][number]>();
  const portablePaths = new Set<string>();
  const verifiedImages = new Map<string, VerifiedAcademicImage>();
  let totalBytes = 0;
  for (const file of files) {
    if (!file || !(file.bytes instanceof Uint8Array) || typeof file.path !== "string"
      || file.path.length > 1024 || /^[a-z]:/i.test(file.path)
      || [...file.path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
      throw new Error("An academic upload contains an unsafe file path or byte payload.");
    safeLibraryPath(file.path);
    const portablePath = file.path.normalize("NFC").toLowerCase();
    if (portablePaths.has(portablePath))
      throw new Error("An academic upload contains duplicate or case-conflicting file paths.");
    portablePaths.add(portablePath);
    if (!Number.isSafeInteger(file.byte_size) || file.byte_size < 1 || file.byte_size > fileLimit
      || file.byte_size !== file.bytes.length || !/^[a-f0-9]{64}$/.test(file.sha256)
      || typeof file.mime_type !== "string" || !file.mime_type)
      throw new Error("An academic file's path, MIME type, byte size or SHA-256 differs from its private upload manifest.");
    totalBytes += file.byte_size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > 512 * 1024 * 1024)
      throw new Error("This collection exceeds the supported upload size.");
    byPath.set(file.path, file);
  }
  // Only after every declared path, size and collection bound is safe do we
  // hash bytes or invoke a potentially expensive native image decoder.
  for (const file of files) {
    if (await sha256(file.bytes) !== `sha256:${file.sha256}`)
      throw new Error("An academic file's path, MIME type, byte size or SHA-256 differs from its private upload manifest.");
    const extension = file.path.split(".").at(-1)?.toLowerCase() ?? "";
    const imageMime = imageMimeByExtension[extension];
    if (imageMime) {
      if (file.mime_type !== imageMime)
        throw new Error("An academic image's path and MIME type disagree.");
      verifiedImages.set(file.path, await assertInstallableAcademicImage(file.bytes, file.mime_type));
    } else if (file.mime_type.startsWith("image/")) {
      throw new Error("An academic image has an unsupported or misleading file extension.");
    }
  }

  const expected = new Map<string, { mime: string; checksum?: string }>();
  const expectFile = (path: string, mime: string, checksum?: string) => {
    safeLibraryPath(path);
    const normalizedChecksum = checksum?.replace(/^sha256:/, "");
    const prior = expected.get(path);
    if (prior && (prior.mime !== mime || (prior.checksum && normalizedChecksum && prior.checksum !== normalizedChecksum)))
      throw new Error("One academic path has conflicting MIME or checksum declarations.");
    expected.set(path, { mime, checksum: prior?.checksum ?? normalizedChecksum });
  };
  expectFile("catalog.json", "application/json");
  const catalogFile = byPath.get("catalog.json");
  if (!catalogFile) throw new Error("A private academic upload is missing catalog.json.");
  const catalogValue: unknown = JSON.parse(decode(catalogFile.bytes));
  assertCatalogEnvelopeShape(catalogValue);
  const catalog = readCatalog(catalogValue);
  if (catalog.id !== upload.catalogId)
    throw new Error("The academic catalog identity differs from the direct upload envelope.");
  if (catalog.templates.length > MAX_PLAN_SECTIONS)
    throw new Error("Split this library into one academic collection per reviewed course.");
  if (upload.provenance.sourceChecksums.length !== catalog.sources.length
    || upload.provenance.sourceChecksums.some((checksum, index) => checksum !== catalog.sources[index].checksum))
    throw new Error("The academic upload provenance differs from its verified source catalog.");

  const sourceIds = new Set<string>();
  const sourceChecksums = new Set<string>();
  for (const source of catalog.sources) {
    if (sourceIds.has(source.id)) throw new Error("The academic catalog contains duplicate source identities.");
    if (sourceChecksums.has(source.checksum))
      throw new Error("The academic catalog contains a duplicate source SHA.");
    sourceIds.add(source.id);
    sourceChecksums.add(source.checksum);
  }

  let plan: AcademicCoursePlan | undefined;
  if (catalog.templates.length) {
    const texts = catalog.templates.map(entry => {
      expectFile(entry.file, "text/plain", entry.checksum);
      const templateFile = byPath.get(entry.file);
      if (!templateFile) throw new Error("A private academic upload is missing its reviewed course plan.");
      return decode(templateFile.bytes);
    });
    const confirmedTerm = upload.provenance.planTermEvidence
      ? { term: upload.metadata.term as AcademicPlanTerm["term"], evidence: upload.provenance.planTermEvidence }
      : undefined;
    plan = academicCoursePlan(texts, confirmedTerm);
    assertTemplateMetadata(upload, plan);
  } else {
    if (upload.template !== "" || !reviewedTermNumber(String(upload.metadata.term))
      || !moduleIdentity(upload.metadata.module) || !catalog.sources.some(source => source.bankFile)
      || !["source-metadata", "human-reviewed"].includes(upload.provenance.scopeEvidence ?? "")
      || upload.provenance.weekAssignment !== "unassigned" || upload.provenance.planTermEvidence !== undefined
      || upload.metadata.academic_term !== undefined || upload.metadata.cohort !== undefined
      || upload.metadata.source_revision !== undefined) {
      throw new Error("A source-only direct upload needs one reviewed term/module filing and no invented course plan.");
    }
  }

  const localOnlyBySource = new Map<string, AcademicUpload["localOnlyOriginals"][number]>();
  const localOnlyReason = "original exceeds the 50 MiB private-course limit and remains local-only";
  for (const original of upload.localOnlyOriginals) {
    if (localOnlyBySource.has(original.sourceId))
      throw new Error("The local-only original manifest contains a duplicate source identity.");
    const source = catalog.sources.find(item => item.id === original.sourceId);
    if (!source || source.originalFile || source.checksum !== original.sha256 || !source.reason.includes(localOnlyReason))
      throw new Error("The local-only original manifest differs from its source catalog receipt.");
    localOnlyBySource.set(original.sourceId, original);
  }
  if (catalog.sources.some(source => source.reason.includes(localOnlyReason) !== localOnlyBySource.has(source.id))
    || upload.metadata.local_only_originals !== upload.localOnlyOriginals.length) {
    throw new Error("The local-only original count or source reconciliation is incomplete.");
  }

  const declaredModules = new Set<string>();
  const declaredTerms = new Set<number>();
  const questionIds = new Set<string>();
  let readyTotal = 0;
  let reviewTotal = 0;
  for (const source of catalog.sources) {
    readyTotal += source.ready;
    reviewTotal += source.review;
    if (!Number.isSafeInteger(readyTotal) || !Number.isSafeInteger(reviewTotal)
      || readyTotal > 100000 || reviewTotal > 100000) {
      throw new Error("The academic catalog's verified question totals exceed supported bounds.");
    }
    if (source.module !== undefined) {
      const identity = moduleIdentity(source.module);
      if (!identity) throw new Error("A source has an invalid or ambiguous module label.");
      if (!plan && identity !== moduleIdentity(upload.metadata.module))
        throw new Error("A source's catalog module does not match its source-only course.");
      if (!plan) declaredModules.add(identity);
    }
    if (source.originalFile) {
      const extension = source.originalFile.split(".").at(-1)?.toLowerCase() ?? "";
      const mime = originalMimeByExtension[extension];
      if (!mime) throw new Error("This source file type is not supported for academic uploads.");
      expectFile(source.originalFile, mime, source.checksum);
    }
    if (!source.bankFile) {
      if (source.ready || source.review)
        throw new Error("A source without a reviewed bank cannot claim ready or review questions.");
      if (plan) assertTemplateOwnsSource(plan, source);
      continue;
    }
    expectFile(source.bankFile, "application/json");
    const bankFile = byPath.get(source.bankFile);
    if (!bankFile) throw new Error("A private academic upload is missing a referenced question bank.");
    const bankValue: unknown = JSON.parse(decode(bankFile.bytes));
    assertPreparedBankEnvelopeShape(bankValue);
    const bank = readPreparedBank(bankValue);
    if (bank.pkg.manifest.source.filename !== basename(bank.pkg.manifest.source.filename))
      throw new Error("A prepared academic bank contains a local or noncanonical source filename.");
    if (plan) assertTemplateOwnsSource(plan, source, bank);
    else {
      const evidence = upload.provenance.scopeEvidence;
      if (evidence !== "source-metadata" && evidence !== "human-reviewed")
        throw new Error("A source-only direct upload needs verified course classification evidence.");
      const filing = sourceOnlyBankFiling(bank, {
        term: upload.metadata.term as ReviewedFiling["term"], module: upload.metadata.module as string,
        evidence, weekAssignment: "unassigned",
      }, true);
      declaredModules.add(moduleIdentity(filing.module)!);
      declaredTerms.add(reviewedTermNumber(filing.term)!);
    }
    assertAcademicStoredFigureBudget(bank.pkg.questions);
    const verifiedAssets: { name: string }[] = [];
    const figureSizes = new Map<string, number>();
    for (const question of bank.pkg.questions) {
      if (questionIds.has(question.id))
        throw new Error("Duplicate question identities across source collections require review.");
      questionIds.add(question.id);
      if (question.provenance.sourceChecksum !== `sha256:${source.checksum}`)
        throw new Error("A reviewed question is missing or claims a different original source checksum.");
      for (const asset of question.assets) {
        if (!asset.checksum) throw new Error("Review image integrity before uploading this collection.");
        const path = academicAssetPath(source.bankFile, asset.filename);
        const file = byPath.get(path);
        const image = verifiedImages.get(path);
        if (!file || !image) throw new Error("A private academic upload is missing a referenced clinical figure.");
        expectFile(path, image.mimeType, asset.checksum);
        assertAcademicAssetMatchesBytes(asset, image);
        verifiedAssets.push({ name: asset.filename });
        figureSizes.set(asset.filename, file.byte_size);
      }
    }
    assertAcademicStoredFigureBudget(bank.pkg.questions, figureSizes);
    const assessment = assessBank(bank.pkg, bank.issues, verifiedAssets);
    const ready = assessment.counts.ready;
    const held = assessment.counts["needs-review"] + assessment.counts.unresolved + (bank.unreadableQuestions ?? 0);
    const readyQuestions = bank.pkg.questions.filter(question => assessment.verdicts.get(question.id)?.readiness === "ready");
    if (readyQuestions.length !== ready) throw new Error("Academic question readiness is incomplete.");
    assertAcademicFigureBudget(readyQuestions, figureSizes);
    if (ready !== source.ready || held !== source.review)
      throw new Error(`The prepared bank's claimed ready/review counts differ from verified answers and figures (${ready} ready; ${held} review). Reopen its review queue before private upload.`);
    assertAcademicQuestionsInstallable(bank, assessment.issues, ready, held);
  }
  if (readyTotal !== upload.metadata.ready_questions || reviewTotal !== upload.metadata.review_questions)
    throw new Error("Academic metadata question totals differ from the verified source catalog.");
  if (!plan) {
    if (declaredModules.size > 1 || declaredTerms.size > 1)
      throw new Error("This source-only collection contains several original modules or terms. Split it before applying one reviewed filing.");
    if (upload.provenance.scopeEvidence === "source-metadata") {
      const module = [...declaredModules][0];
      const term = [...declaredTerms][0];
      if (module !== moduleIdentity(upload.metadata.module) || `Term ${term}` !== upload.metadata.term)
        throw new Error("Source-metadata filing must agree with the package's original module and term.");
    }
  }
  for (const [path, declaration] of expected) {
    const file = byPath.get(path);
    if (!file || file.mime_type !== declaration.mime
      || (declaration.checksum && file.sha256 !== declaration.checksum))
      throw new Error("An academic file differs from its package path, MIME type or declared checksum.");
  }
  if (expected.size !== files.length || files.some(file => !expected.has(file.path)))
    throw new Error("An academic upload contains a file that is not referenced by its verified package.");
  const canonicalHash = await academicUploadHash({ ...upload, files });
  if (!/^[a-f0-9]{64}$/.test(upload.hash) || upload.hash !== canonicalHash)
    throw new Error("The academic upload hash does not match its canonical file manifest and metadata.");
  return files;
}

/** A course-specific prepared package, never a portable learner backup. Only
 * referenced content enters the upload; unrelated ZIP files are not enumerated. */
export async function prepareAcademicUpload(
  read: LibraryReader, unscheduled?: AcademicUnscheduledScope, options: AcademicUploadOptions = {},
): Promise<AcademicUpload> {
  const source = readCatalog(JSON.parse(decode(await read("catalog.json"))));
  if (source.templates.length > MAX_PLAN_SECTIONS) throw new Error("Split this library into one academic collection per reviewed course.");
  // Every section of one module travels together; each keeps its exact bytes.
  const templates: Array<{ entry: PrivateLibraryCatalog["templates"][number]; bytes: Uint8Array }> = [];
  let plan: AcademicCoursePlan | undefined;
  let reviewedFiling: ReviewedFiling | undefined;
  if (source.templates.length) {
    for (const entry of source.templates) {
      const bytes = await read(entry.file);
      if (await sha256(bytes) !== `sha256:${entry.checksum}`) throw new Error("The course plan failed its integrity check.");
      templates.push({ entry, bytes });
    }
    plan = academicCoursePlan(templates.map(template => decode(template.bytes)), options.planTerm);
    if (unscheduled) throw new Error("A collection containing a reviewed weekly plan cannot override its course classification.");
  } else {
    if (options.planTerm) throw new Error("A confirmed course term applies only to a reviewed course plan.");
    if (!unscheduled || !reviewedTermNumber(unscheduled.term) || !["source-metadata", "human-reviewed"].includes(unscheduled.evidence)
      || !moduleIdentity(unscheduled.module)
      || (unscheduled.title !== undefined && (!unscheduled.title.trim() || unscheduled.title.trim().length > 180)))
      throw new Error("Without an academic template, a reviewer must provide a verified term, module and classification evidence. Weeks remain unassigned.");
    if (!source.sources.some(item => item.bankFile)) throw new Error("An unscheduled academic collection needs at least one reviewed question package.");
    reviewedFiling = Object.freeze({
      term: unscheduled.term,
      module: unscheduled.module.trim(),
      evidence: unscheduled.evidence,
      weekAssignment: "unassigned",
    });
  }
  const files: AcademicUpload["files"] = [];
  const localOnlyOriginals: AcademicUpload["localOnlyOriginals"] = [];
  const paths = new Set<string>();
  async function add(path: string, bytes: Uint8Array, mime: string, expected?: string) {
    safeLibraryPath(path);
    if (paths.has(path)) {
      const existing = files.find(file => file.path === path);
      // A package reader may yield different bytes on a second read (or
      // label the same path with another MIME type). Never trust the first
      // source's declared checksum as proof for a later duplicate entry.
      const incomingSha = (await sha256(bytes)).slice(7);
      if (!existing || existing.sha256 !== incomingSha || existing.byte_size !== bytes.length
        || existing.mime_type !== mime || (expected && incomingSha !== expected.replace(/^sha256:/, "")))
        throw new Error("Conflicting immutable files share the same academic path. Review their source/figure identity.");
      return;
    }
    if (!bytes.length || bytes.length > fileLimit) throw new Error("This academic collection supports originals up to 50 MiB per file. Keep larger sources in your local private library.");
    const checksum = (await sha256(bytes)).slice(7);
    if (expected && expected.replace(/^sha256:/, "") !== checksum) throw new Error("A source or image failed its integrity check.");
    files.push({ path, bytes, sha256: checksum, byte_size: bytes.length, mime_type: mime }); paths.add(path);
    if (files.length > 1500 || files.reduce((sum, file) => sum + file.byte_size, 0) > 512 * 1024 * 1024) throw new Error("This collection exceeds the supported upload size.");
  }
  for (const template of templates) await add(template.entry.file, template.bytes, "text/plain", template.entry.checksum);
  const sources: PrivateLibraryCatalog["sources"] = [];
  const declaredModules = new Set<string>();
  const declaredTerms = new Set<number>();
  for (const item of source.sources) {
    if (item.module !== undefined) {
      const identity = moduleIdentity(item.module);
      if (!identity) throw new Error("A source has an invalid or ambiguous module label. Correct or split the private package.");
      if (reviewedFiling && identity !== moduleIdentity(reviewedFiling.module))
        throw new Error("A source's catalog module does not match its source-only course.");
      if (reviewedFiling) declaredModules.add(identity);
    }
    // Remove local paths and incidental preparation diagnostics before transfer.
    const clean = { id: item.id, name: basename(item.name), sourcePath: basename(item.name), checksum: item.checksum,
      module: item.module, status: item.status, reason: item.status === "prepared" ? "Prepared for review" : "Source review required",
      bankFile: item.bankFile, originalFile: item.originalFile, ready: item.ready, review: item.review, duplicateOf: item.duplicateOf };
    sources.push(clean);
    if (item.originalFile) {
      const extension = item.originalFile.split(".").at(-1)?.toLowerCase();
      const mime = originalMimeByExtension[extension ?? ""];
      if (!mime) throw new Error("This source file type is not supported for academic uploads.");
      const original = await read(item.originalFile);
      if (original.length > fileLimit) {
        // Do not drop the reviewed questions just because their source PDF is
        // too large for this bucket. Keep a verifiable provenance receipt and
        // an explicit local-only exception in the installed catalog.
        if (await sha256(original) !== `sha256:${item.checksum.replace(/^sha256:/, "")}`)
          throw new Error("An oversized original failed its integrity check.");
        clean.originalFile = undefined;
        clean.reason += "; original exceeds the 50 MiB private-course limit and remains local-only. Keep the source file or archive.";
        localOnlyOriginals.push({ sourceId: item.id, sha256: item.checksum.replace(/^sha256:/, ""), byteSize: original.length, reason: "over-limit" });
      } else await add(item.originalFile, original, mime, item.checksum);
    }
    if (!item.bankFile) {
      if (plan) assertTemplateOwnsSource(plan, item);
      continue;
    }
    const parsedBank = readPreparedBank(JSON.parse(decode(await read(item.bankFile))));
    if (plan) assertTemplateOwnsSource(plan, item, parsedBank);
    let bankFiling = parsedBank.reviewedFiling;
    if (reviewedFiling) {
      bankFiling = sourceOnlyBankFiling(parsedBank, reviewedFiling, false);
      declaredModules.add(moduleIdentity(bankFiling.module)!);
      declaredTerms.add(reviewedTermNumber(bankFiling.term)!);
    }
    const bank: PreparedBank = bankFiling ? { ...parsedBank, reviewedFiling: bankFiling } : parsedBank;
    bank.pkg.manifest.source.filename = basename(bank.pkg.manifest.source.filename);
    const verifiedAssets: { name: string }[] = [];
    const figureSizes = new Map<string, number>();
    assertAcademicStoredFigureBudget(bank.pkg.questions);
    for (const question of bank.pkg.questions) {
      const questionSourceHash = question.provenance.sourceChecksum?.replace(/^sha256:/, "");
      if (!questionSourceHash || questionSourceHash !== item.checksum.replace(/^sha256:/, ""))
        throw new Error("A reviewed question is missing or claims a different original source checksum. Reconcile its provenance before uploading.");
      question.source.filename = basename(question.source.filename);
      delete question.provenance.notes;
      for (const asset of question.assets) {
        verifiedAssets.push({ name: asset.filename });
        if (!asset.checksum) throw new Error("Review image integrity before uploading this collection.");
        const path = academicAssetPath(item.bankFile, asset.filename);
        const mime = imageMimeByExtension[asset.filename.split(".").at(-1)?.toLowerCase() ?? ""];
        if (!mime) throw new Error("Unsupported academic image type.");
        const imageBytes = await read(safeLibraryPath(path));
        const image = await assertInstallableAcademicImage(imageBytes, mime);
        assertAcademicAssetMatchesBytes(asset, image);
        // The cloud package carries byte-proven metadata even when an older
        // source package omitted these optional facts.
        Object.assign(asset, image);
        figureSizes.set(asset.filename, imageBytes.length);
        await add(path, imageBytes, mime, asset.checksum);
      }
    }
    assertAcademicStoredFigureBudget(bank.pkg.questions, figureSizes);
    // Never trust ready/review totals supplied by a ZIP manifest. Recompute
    // with the same canonical assessor that gates local installation and
    // account for unreadable source rows explicitly.
    const assessment = assessBank(bank.pkg, bank.issues, verifiedAssets);
    const ready = assessment.counts.ready;
    const held = assessment.counts["needs-review"] + assessment.counts.unresolved + (bank.unreadableQuestions ?? 0);
    const readyQuestions = bank.pkg.questions.filter(question => assessment.verdicts.get(question.id)?.readiness === "ready");
    if (readyQuestions.length !== ready) throw new Error("Academic question readiness is incomplete.");
    assertAcademicFigureBudget(readyQuestions, figureSizes);
    if (ready !== item.ready || held !== item.review)
      throw new Error(`The prepared bank's claimed ready/review counts differ from verified answers and figures (${ready} ready; ${held} review). Reopen its review queue before private upload.`);
    assertAcademicQuestionsInstallable(bank, assessment.issues, ready, held);
    // The parsed package is canonical content. No learner attempts, notes,
    // account identifiers or unknown backup fields are copied into this envelope.
    await add(item.bankFile, encode({ pkg: bank.pkg, issues: bank.issues.map(({ severity, code, message, questionId, path }) => ({ severity, code, message, questionId, path })),
      sourceText: { rawText: bank.sourceText.rawText, pageTexts: bank.sourceText.pageTexts }, sourceBytes: bank.sourceBytes, notes: [],
      ...(bank.reviewedFiling ? { reviewedFiling: bank.reviewedFiling } : {}),
      unreadableQuestions: bank.unreadableQuestions }), "application/json");
  }
  if (reviewedFiling) {
    if (declaredModules.size > 1 || declaredTerms.size > 1)
      throw new Error("This source-only collection contains several original modules or terms. Split it before applying one reviewed filing.");
    if (reviewedFiling.evidence === "source-metadata") {
      const module = [...declaredModules][0];
      const term = [...declaredTerms][0];
      if (module !== moduleIdentity(reviewedFiling.module) || term !== reviewedTermNumber(reviewedFiling.term))
        throw new Error("Source-metadata filing must agree with the package's original module and term. Use human review to correct stale filing evidence.");
    }
  }
  await add("catalog.json", encode({ format: source.format, schemaVersion: source.schemaVersion, id: source.id, version: source.version,
    preparerVersion: source.preparerVersion,
    templates: templates.map(({ entry }) => ({ ...entry, name: basename(entry.name) })), sources }), "application/json");
  files.sort(compareAcademicPath);
  const module = plan?.module ?? unscheduled!.module.trim();
  const term = plan?.term ?? unscheduled!.term;
  const template = plan?.text ?? "";
  const metadata = { title: plan?.module ?? unscheduled?.title?.trim() ?? module, module, term, academic_term: plan?.academicTerm,
    cohort: plan?.cohort, source_revision: plan?.sourceRevision,
    ready_questions: sources.reduce((sum, item) => sum + item.ready, 0), review_questions: sources.reduce((sum, item) => sum + item.review, 0),
    local_only_originals: localOnlyOriginals.length };
  const provenance: AcademicUpload["provenance"] = { sourceChecksums: sources.map(item => item.checksum),
    ...(unscheduled ? { scopeEvidence: unscheduled.evidence, weekAssignment: "unassigned" as const } : {}),
    ...(plan && !plan.termStated ? { planTermEvidence: "human-reviewed" as const } : {}) };
  const hash = await academicUploadHash({ metadata, template, provenance, files, localOnlyOriginals });
  return { catalogId: source.id, metadata, template, provenance, files, hash, localOnlyOriginals };
}

/** Stable within an account and collection, including interrupted first uploads. */
export async function academicCollectionId(accountId: string, catalogId: string): Promise<string> {
  const h = (await sha256(encode(["academic-collection-v1", accountId, catalogId]))).slice(7);
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export type AcademicUploadResult = { collection_id: string; revision_id: string; status: "active" }
  | { collection_id: string; revision_id: string; status: "superseded"; active_revision_id: string };

export async function uploadAcademicCourse(client: SupabaseClient, accountId: string, upload: AcademicUpload,
  assertCurrent: () => void | Promise<void>, progress: (message: string) => void, resumable?: ResumableStorageConfig, signal?: AbortSignal,
): Promise<AcademicUploadResult> {
  const checkCancel = () => { if (signal?.aborted) throw new DOMException("The upload was cancelled; your local package is safe.", "AbortError"); };
  checkCancel();
  const snapshot = snapshotAcademicUpload(upload);
  // Complete local integrity/decoder preflight precedes every cloud RPC and
  // revision registration. A failure therefore cannot create or activate a
  // partially trusted revision.
  const files = await preflightAcademicUpload(snapshot);
  checkCancel();
  const collection = await academicCollectionId(accountId, snapshot.catalogId);
  // The existing small-object SDK uploader is sufficient for compact JSON
  // and images. Only larger originals need tus's partial-transfer recovery.
  let verifyTransfer = async () => { checkCancel(); await assertCurrent(); checkCancel(); };
  if (files.some(file => file.byte_size > RESUMABLE_CHUNK_BYTES) && !resumable) {
    const operation = await accountOperationClient();
    if (operation.userId !== accountId) throw new Error("The account changed. Reopen your collection and retry.");
    resumable = operation.resumable;
    verifyTransfer = async () => { checkCancel(); await assertCurrent(); await operation.assertCurrent(); checkCancel(); };
  }
  await verifyTransfer();
  const { data, error } = await client.rpc("academic_create_revision", { metadata: snapshot.metadata, template: snapshot.template,
    provenance: snapshot.provenance, files: uploadManifest(files), content_hash: snapshot.hash, collection });
  if (error && error.code === "23514" && files.some(file => file.mime_type === "image/gif")
    && /academic_files_mime_type_check/.test(error.message ?? ""))
    throw new Error("The academic cloud backend has not enabled GIF figures yet. Your ZIP is unchanged; retry after the private academic GIF schema migration.");
  if (error?.code === "23505" && /Academic source is already registered under another collection/.test(error.message ?? ""))
    throw new Error("This source is already registered in another private academic collection. Reopen that collection instead of creating a duplicate catalog.");
  if (error || !data?.revision_id || data.collection_id !== collection) throw new Error("Your private upload could not be registered. Keep the package and retry.");
  for (const [index, file] of files.entries()) {
    await verifyTransfer();
    progress(`Saving private course · ${index + 1} of ${files.length} files`);
    const path = `${collection}/${file.sha256}`;
    const bucket = client.storage.from("academic-content");
    let transferFailure: unknown;
    if (file.byte_size > RESUMABLE_CHUNK_BYTES) {
      if (!resumable) throw new Error("Resumable academic uploads are unavailable. Keep the private package and retry.");
      try {
        await uploadResumableObject(new Blob([new Uint8Array(file.bytes)], { type: file.mime_type }),
          "academic-content", path, file.sha256, resumable, verifyTransfer, signal);
      } catch (failure) {
        // A retry may collide with a fully stored immutable object, including
        // when the first tus completion response was lost. Verify it below.
        transferFailure = failure;
      }
    } else {
      // Supabase's immutable object namespace makes a 409 retry safe only
      // when the fetched bytes actually match this prepared manifest.
      const result = await bucket.upload(path, file.bytes, { contentType: file.mime_type, upsert: false });
      if (result.error && String(result.error.statusCode) !== "409")
        progress(`Checking whether file ${index + 1} reached Storage despite the interrupted response`);
    }
    await verifyTransfer();
    // Do not trust callbacks, object name collisions or a successful HTTP
    // response alone: compare actual server content to the prepared digest.
    const existing = await bucket.download(path);
    if (existing.error || !existing.data || existing.data.size !== file.byte_size
      || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== `sha256:${file.sha256}`) {
      if (transferFailure) throw new Error("The resumable course upload was interrupted or has invalid server bytes. Keep the package and retry.", { cause: transferFailure });
      throw new Error("The private upload is incomplete or corrupted. Keep the package and retry; verified files will be reused.");
    }
  }
  await verifyTransfer();
  const finished = await client.rpc("academic_finish_revision", { revision: data.revision_id });
  if (finished.error) throw new Error("The upload has not been acknowledged. Keep the package and retry.");
  await verifyTransfer();
  const [revision, fileIndex, current] = await Promise.all([
    client.from("academic_revisions").select("status,collection_id,content_hash").eq("id", data.revision_id).single(),
    client.from("academic_files").select("revision_id", { count: "exact", head: true }).eq("revision_id", data.revision_id),
    client.from("academic_collections").select("current_revision_id").eq("id", collection).single(),
  ]);
  if (revision.error || revision.data?.status !== "ready" || revision.data.collection_id !== collection
    || revision.data.content_hash !== snapshot.hash || fileIndex.error || fileIndex.count !== files.length
    || current.error || !current.data?.current_revision_id)
    throw new Error("The course was transferred, but its server revision and file count could not be confirmed. Keep the package and reconcile before calling this upload complete.");
  await verifyTransfer();
  // A later, valid revision can supersede this one while a slow upload is
  // finishing. This version IS verified and stored, but it is not current.
  // Never represent an older verified revision as failed or newly activated.
  if (current.data.current_revision_id !== data.revision_id) {
    progress("This verified revision was saved in history; a newer course revision remains active.");
    return { collection_id: data.collection_id, revision_id: data.revision_id,
      active_revision_id: current.data.current_revision_id, status: "superseded" };
  }
  return { collection_id: data.collection_id, revision_id: data.revision_id, status: "active" };
}
