import type { SupabaseClient } from "@supabase/supabase-js";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import { sha256 } from "../question-content/assets";
import { parseCourseTemplate } from "../course-engine/templateParse";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";
import { accountOperationClient } from "../account/supabase";
import { RESUMABLE_CHUNK_BYTES, uploadResumableObject, type ResumableStorageConfig } from "../sync/resumableObject";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const basename = (name: string) => name.split(/[\\/]/).at(-1) || "source";
// Matches academic_files.byte_size and academic-content Storage bucket limit.
const fileLimit = 50 * 1024 * 1024;
export interface AcademicUpload {
  catalogId: string;
  metadata: Record<string, string | number | undefined>;
  template: string;
  provenance: { sourceChecksums: string[] };
  files: Array<{ path: string; sha256: string; byte_size: number; mime_type: string; bytes: Uint8Array }>;
  hash: string;
  /** Verified source bytes that exceed academic-content's per-file ceiling.
   * The reviewed question packages still upload; these originals do not. */
  localOnlyOriginals: Array<{ sourceId: string; sha256: string; byteSize: number; reason: "over-limit" }>;
}

/** A course-specific prepared package, never a portable learner backup. Only
 * referenced content enters the upload; unrelated ZIP files are not enumerated. */
export async function prepareAcademicUpload(read: LibraryReader): Promise<AcademicUpload> {
  const source = readCatalog(JSON.parse(decode(await read("catalog.json"))));
  if (source.templates.length !== 1) throw new Error("Choose a prepared collection for one course with one reviewed weekly plan.");
  const templateEntry = source.templates[0];
  const templateBytes = await read(templateEntry.file);
  if (await sha256(templateBytes) !== `sha256:${templateEntry.checksum}`) throw new Error("The course plan failed its integrity check.");
  const template = decode(templateBytes);
  const plan = parseCourseTemplate(template);
  if (plan.problems.length || !plan.term || !plan.items.length) throw new Error("Review the course plan and confirm its academic term before uploading.");
  const files: AcademicUpload["files"] = [];
  const localOnlyOriginals: AcademicUpload["localOnlyOriginals"] = [];
  const paths = new Set<string>();
  async function add(path: string, bytes: Uint8Array, mime: string, expected?: string) {
    safeLibraryPath(path);
    if (paths.has(path)) return;
    if (!bytes.length || bytes.length > fileLimit) throw new Error("This academic collection supports originals up to 50 MiB per file. Keep larger sources in your local private library.");
    const checksum = (await sha256(bytes)).slice(7);
    if (expected && expected.replace(/^sha256:/, "") !== checksum) throw new Error("A source or image failed its integrity check.");
    files.push({ path, bytes, sha256: checksum, byte_size: bytes.length, mime_type: mime }); paths.add(path);
    if (files.length > 1500 || files.reduce((sum, file) => sum + file.byte_size, 0) > 512 * 1024 * 1024) throw new Error("This collection exceeds the supported upload size.");
  }
  await add(templateEntry.file, templateBytes, "text/plain", templateEntry.checksum);
  const sources: PrivateLibraryCatalog["sources"] = [];
  for (const item of source.sources) {
    // Remove local paths and incidental preparation diagnostics before transfer.
    const clean = { id: item.id, name: basename(item.name), sourcePath: basename(item.name), checksum: item.checksum,
      module: item.module, status: item.status, reason: item.status === "prepared" ? "Prepared for review" : "Source review required",
      bankFile: item.bankFile, originalFile: item.originalFile, ready: item.ready, review: item.review, duplicateOf: item.duplicateOf };
    sources.push(clean);
    if (item.originalFile) {
      const extension = item.originalFile.split(".").at(-1)?.toLowerCase();
      const mime = ({ pdf: "application/pdf", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })[extension as "pdf"];
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
    if (!item.bankFile) continue;
    const bank = readPreparedBank(JSON.parse(decode(await read(item.bankFile))));
    bank.pkg.manifest.source.filename = basename(bank.pkg.manifest.source.filename);
    for (const question of bank.pkg.questions) {
      question.source.filename = basename(question.source.filename);
      delete question.provenance.notes;
      for (const asset of question.assets) {
        if (!asset.checksum) throw new Error("Review image integrity before uploading this collection.");
        const path = `${item.bankFile.slice(0, item.bankFile.lastIndexOf("/"))}/assets/${asset.filename}`;
        const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" })[asset.filename.split(".").at(-1)?.toLowerCase() as "png"];
        if (!mime) throw new Error("Unsupported academic image type.");
        await add(path, await read(safeLibraryPath(path)), mime, asset.checksum);
      }
    }
    // The parsed package is canonical content. No learner attempts, notes,
    // account identifiers or unknown backup fields are copied into this envelope.
    await add(item.bankFile, encode({ pkg: bank.pkg, issues: bank.issues.map(({ severity, code, message, questionId, path }) => ({ severity, code, message, questionId, path })),
      sourceText: { rawText: bank.sourceText.rawText, pageTexts: bank.sourceText.pageTexts }, sourceBytes: bank.sourceBytes, notes: [], unreadableQuestions: bank.unreadableQuestions }), "application/json");
  }
  await add("catalog.json", encode({ format: source.format, schemaVersion: source.schemaVersion, id: source.id, version: source.version,
    preparerVersion: source.preparerVersion, templates: [{ ...templateEntry, name: basename(templateEntry.name) }], sources }), "application/json");
  files.sort((a, b) => a.path.localeCompare(b.path));
  const metadata = { title: plan.module, module: plan.module, term: plan.term, academic_term: plan.context?.academicTerm,
    cohort: plan.context?.cohort, source_revision: plan.context?.sourceRevision,
    ready_questions: sources.reduce((sum, item) => sum + item.ready, 0), review_questions: sources.reduce((sum, item) => sum + item.review, 0),
    local_only_originals: localOnlyOriginals.length };
  const provenance = { sourceChecksums: sources.map(item => item.checksum) };
  const hash = (await sha256(encode({ metadata, template, provenance, files: files.map(({ bytes: _bytes, ...file }) => file) }))).slice(7);
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
  assertCurrent: () => void, progress: (message: string) => void, resumable?: ResumableStorageConfig, signal?: AbortSignal,
): Promise<AcademicUploadResult> {
  const collection = await academicCollectionId(accountId, upload.catalogId);
  // The existing small-object SDK uploader is sufficient for compact JSON
  // and images. Only larger originals need tus's partial-transfer recovery.
  const checkCancel = () => { if (signal?.aborted) throw new DOMException("The upload was cancelled; your local package is safe.", "AbortError"); };
  let verifyTransfer = async () => { checkCancel(); assertCurrent(); checkCancel(); };
  if (upload.files.some(file => file.byte_size > RESUMABLE_CHUNK_BYTES) && !resumable) {
    const operation = await accountOperationClient();
    if (operation.userId !== accountId) throw new Error("The account changed. Reopen your collection and retry.");
    resumable = operation.resumable;
    verifyTransfer = async () => { checkCancel(); assertCurrent(); await operation.assertCurrent(); checkCancel(); };
  }
  await verifyTransfer();
  const { data, error } = await client.rpc("academic_create_revision", { metadata: upload.metadata, template: upload.template, provenance: upload.provenance,
    files: upload.files.map(({ bytes: _bytes, ...file }) => file), content_hash: upload.hash, collection });
  if (error || !data?.revision_id || data.collection_id !== collection) throw new Error("Your private upload could not be registered. Keep the package and retry.");
  for (const [index, file] of upload.files.entries()) {
    await verifyTransfer();
    progress(`Saving private course · ${index + 1} of ${upload.files.length} files`);
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
    || revision.data.content_hash !== upload.hash || fileIndex.error || fileIndex.count !== upload.files.length
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
