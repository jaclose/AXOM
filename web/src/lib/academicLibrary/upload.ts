import type { SupabaseClient } from "@supabase/supabase-js";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import { sha256 } from "../question-content/assets";
import { parseCourseTemplate } from "../course-engine/templateParse";
import type { PrivateLibraryCatalog } from "../privateLibrary/types";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const basename = (name: string) => name.split(/[\\/]/).at(-1) || "source";
const fileLimit = 6 * 1024 * 1024;
export interface AcademicUpload {
  catalogId: string;
  metadata: Record<string, string | number | undefined>;
  template: string;
  provenance: { sourceChecksums: string[] };
  files: Array<{ path: string; sha256: string; byte_size: number; mime_type: string; bytes: Uint8Array }>;
  hash: string;
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
  const paths = new Set<string>();
  async function add(path: string, bytes: Uint8Array, mime: string, expected?: string) {
    safeLibraryPath(path);
    if (paths.has(path)) return;
    if (!bytes.length || bytes.length > fileLimit) throw new Error("This upload supports files up to 6 MiB each. Keep larger originals locally until resumable file uploads are available.");
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
      await add(item.originalFile, await read(item.originalFile), mime, item.checksum);
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
    ready_questions: sources.reduce((sum, item) => sum + item.ready, 0), review_questions: sources.reduce((sum, item) => sum + item.review, 0) };
  const provenance = { sourceChecksums: sources.map(item => item.checksum) };
  const hash = (await sha256(encode({ metadata, template, provenance, files: files.map(({ bytes: _bytes, ...file }) => file) }))).slice(7);
  return { catalogId: source.id, metadata, template, provenance, files, hash };
}

/** Stable within an account and collection, including interrupted first uploads. */
export async function academicCollectionId(accountId: string, catalogId: string): Promise<string> {
  const h = (await sha256(encode(["academic-collection-v1", accountId, catalogId]))).slice(7);
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export async function uploadAcademicCourse(client: SupabaseClient, accountId: string, upload: AcademicUpload,
  assertCurrent: () => void, progress: (message: string) => void): Promise<{ collection_id: string; revision_id: string }> {
  const collection = await academicCollectionId(accountId, upload.catalogId);
  assertCurrent();
  const { data, error } = await client.rpc("academic_create_revision", { metadata: upload.metadata, template: upload.template, provenance: upload.provenance,
    files: upload.files.map(({ bytes: _bytes, ...file }) => file), content_hash: upload.hash, collection });
  if (error || !data?.revision_id || data.collection_id !== collection) throw new Error("Your private upload could not be registered. Keep the package and retry.");
  for (const [index, file] of upload.files.entries()) {
    assertCurrent(); progress(`Saving private course · ${index + 1} of ${upload.files.length} files`);
    const path = `${collection}/${file.sha256}`;
    const result = await client.storage.from("academic-content").upload(path, file.bytes, { contentType: file.mime_type, upsert: false });
    assertCurrent();
    // Retry-safe object identity: a conflict or lost response is accepted only
    // after the server returns the exact bytes registered by this revision.
    if (result.error) {
      const existing = await client.storage.from("academic-content").download(path);
      if (existing.error || !existing.data || existing.data.size !== file.byte_size || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== `sha256:${file.sha256}`)
        throw new Error("The private upload is incomplete. Keep the package and retry; completed files will be reused.");
    }
  }
  assertCurrent();
  const finished = await client.rpc("academic_finish_revision", { revision: data.revision_id });
  if (finished.error) throw new Error("The upload has not been acknowledged. Keep the package and retry.");
  assertCurrent(); return data;
}
