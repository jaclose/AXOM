import { academicClient, academicLibraryReader, type AcademicCourse } from "./client";
import { readCatalog, safeLibraryPath, type LibraryInstallScope } from "../privateLibrary/install";
import { safeInputPath } from "../privateLibrary/inputRoot";

const MAX_REVIEW_TEXT_BYTES = 128 * 1024 * 1024;
type CourseRevision = Pick<AcademicCourse, "id" | "current_revision_id" | "module">;
type ArchiveKind = "review" | "source";
let exporting = false;

/** A read-only evidence export, not an installer or approval. Every source file
 * retains the immutable revision's bytes; binaries are explicitly omitted. */
export async function createStoredReviewArchive(course: CourseRevision, scope: LibraryInstallScope,
  progress: (message: string) => void = () => {}) {
  return createStoredArchive("review", course, scope, progress);
}

/** Preserve every stored revision file without installing or caching learner data. */
export async function createStoredSourceArchive(course: CourseRevision, scope: LibraryInstallScope,
  progress: (message: string) => void = () => {}) {
  return createStoredArchive("source", course, scope, progress);
}

async function createStoredArchive(kind: ArchiveKind, course: CourseRevision, scope: LibraryInstallScope,
  progress: (message: string) => void) {
  scope.assertCurrent();
  // Full packages retain their verified input bytes while JSZip builds the
  // output. One export at a time bounds memory across all review controls.
  if (exporting) throw new Error("Another course export is still preparing. Wait for it to finish, then retry.");
  exporting = true;
  try {
    return await buildStoredArchive(kind, course, scope, progress);
  } finally {
    exporting = false;
  }
}

async function buildStoredArchive(kind: ArchiveKind, course: CourseRevision, scope: LibraryInstallScope,
  progress: (message: string) => void) {
  const full = kind === "source";
  scope.assertCurrent();
  const client = await academicClient(scope.key);
  scope.assertCurrent();
  let expectedHash: string | undefined;
  async function assertRevision() {
    scope.assertCurrent();
    const collection = await client.from("academic_collections").select("id,current_revision_id,withdrawn")
      .eq("id", course.id).single();
    scope.assertCurrent();
    if (collection.error || collection.data?.id !== course.id || collection.data.current_revision_id !== course.current_revision_id
      || collection.data.withdrawn !== false)
      throw new Error("The course revision changed or is no longer accessible. Reopen it before exporting review files.");
    const revision = await client.from("academic_revisions").select("id,collection_id,status,content_hash")
      .eq("id", course.current_revision_id).single();
    scope.assertCurrent();
    if (revision.error || revision.data?.id !== course.current_revision_id || revision.data.collection_id !== course.id
      || revision.data.status !== "ready" || !/^[a-f0-9]{64}$/.test(revision.data.content_hash)
      || (expectedHash && expectedHash !== revision.data.content_hash))
      throw new Error("The stored revision could not be verified for export.");
    expectedHash = revision.data.content_hash;
  }
  await assertRevision();
  const read = await academicLibraryReader(client, course.current_revision_id);
  scope.assertCurrent();
  // The reader enforces 1,500 files, 50 MiB per file and 512 MiB total. Apply
  // portable ZIP path rules too, without silently renaming stored paths.
  const portablePaths = new Set<string>();
  for (const file of read.files) {
    const path = safeInputPath(file.path);
    const key = path.toLowerCase();
    if (path !== file.path || portablePaths.has(key)) throw new Error("The stored revision has conflicting or noncanonical export paths.");
    portablePaths.add(key);
  }
  for (const path of portablePaths) {
    const parts = path.split("/");
    if (parts.slice(0, -1).some((_, index) => portablePaths.has(parts.slice(0, index + 1).join("/"))))
      throw new Error("The stored revision contains conflicting file and folder paths.");
  }
  const catalogBytes = await read("catalog.json");
  scope.assertCurrent();
  const catalog = readCatalog(JSON.parse(new TextDecoder().decode(catalogBytes)));
  const questionPaths = [...new Set(["catalog.json", ...catalog.sources.flatMap(source => source.bankFile ? [safeLibraryPath(source.bankFile)] : [])])];
  const paths = full ? read.files.map(file => file.path) : questionPaths;
  const manifest = new Map(read.files.map(file => [file.path, file]));
  let total = 0;
  for (const path of questionPaths) {
    const file = manifest.get(path);
    if (!file || file.mime_type !== "application/json" || !/\.json$/i.test(path))
      throw new Error("A declared question file is missing from the verified revision manifest.");
    total += file.byte_size;
  }
  if (!full && total > MAX_REVIEW_TEXT_BYTES) throw new Error("The source text exceeds the supported review-export size.");
  const { default: JSZip } = await import("jszip");
  scope.assertCurrent();
  const zip = new JSZip();
  // Sequential reads bound network concurrency and avoid additional in-flight
  // binary copies. No attachment store, original-file cache or installer is used.
  for (const [index, path] of paths.entries()) {
    scope.assertCurrent();
    progress(`Preparing ${full ? "source package" : "review files"} · ${index + 1} of ${paths.length}`);
    const bytes = path === "catalog.json" ? catalogBytes : await read(path);
    scope.assertCurrent();
    zip.file(`stored-revision/${path}`, bytes);
  }
  const included = new Set(paths);
  const omitted = read.files.length - paths.length;
  zip.file("README.txt", [
    full ? "AXOM complete stored source package" : "AXOM stored revision review evidence",
    "",
    ...(full ? [
      "Every file declared by this stored revision is included with its original relative path under stored-revision/.",
      "The catalog, questions, images, original files and any course templates retain their exact stored bytes.",
      "This is a source package, not a learner backup. Stored source material may contain its authors' annotations.",
      "The stored catalog identity is unchanged. Confirm the target collection before preparing any later publication.",
    ] : [
      "This archive contains the exact stored catalog and its declared question-bank JSON files.",
      "This review evidence is not intended as a complete course package or a learner backup.",
      "Images, original PDFs and tracker templates are not included. Their complete revision manifest is supplied.",
      "Use the course's original-PDF controls and normal image-aware review before approving any content.",
    ]),
    "The export does not read this device's learner answers, notes, progress, authentication credentials or approval attestations.",
    "Exporting these files does not verify clinical accuracy or approve the revision.",
  ].join("\n"));
  zip.file(full ? "source-manifest.json" : "review-manifest.json", JSON.stringify({ format: full ? "axom-stored-source-package" : "axom-stored-review-evidence", version: 1,
    collectionId: course.id, revisionId: course.current_revision_id, contentHash: expectedHash,
    exportedAt: new Date().toISOString(), includedFiles: paths.length, omittedFiles: omitted,
    binariesIncluded: full, files: read.files.map(file => ({ path: file.path, sha256: file.sha256,
      byte_size: file.byte_size, mime_type: file.mime_type, included: included.has(file.path) })),
  }, null, 2));
  scope.assertCurrent();
  progress(full ? "Building the source package…" : "Building review files…");
  // STORE avoids recompressing large images/PDFs. JSZip still retains input and
  // output in memory; this is a bounded download, not a streaming disk writer.
  const blob = full
    ? await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true })
    : new Blob([await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } }) as BlobPart], { type: "application/zip" });
  await assertRevision();
  const label = course.module.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "Course";
  return { blob,
    fileName: `AXOM_${label}_${full ? "Source_Package" : "Review_Evidence"}_${course.current_revision_id}.zip`, includedFiles: paths.length, omittedFiles: omitted };
}
