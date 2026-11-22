import { academicClient, academicLibraryReader, type AcademicCourse } from "./client";
import { readCatalog, safeLibraryPath, type LibraryInstallScope } from "../privateLibrary/install";

const MAX_REVIEW_TEXT_BYTES = 128 * 1024 * 1024;
type CourseRevision = Pick<AcademicCourse, "id" | "current_revision_id" | "module">;

/** A read-only evidence export, not an installer or approval. Every source file
 * retains the immutable revision's bytes; binaries are explicitly omitted. */
export async function createStoredReviewArchive(course: CourseRevision, scope: LibraryInstallScope,
  progress: (message: string) => void = () => {}) {
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
  const catalogBytes = await read("catalog.json");
  scope.assertCurrent();
  const catalog = readCatalog(JSON.parse(new TextDecoder().decode(catalogBytes)));
  const paths = [...new Set(["catalog.json", ...catalog.sources.flatMap(source => source.bankFile ? [safeLibraryPath(source.bankFile)] : [])])];
  const manifest = new Map(read.files.map(file => [file.path, file]));
  let total = 0;
  for (const path of paths) {
    const file = manifest.get(path);
    if (!file || file.mime_type !== "application/json" || !/\.json$/i.test(path))
      throw new Error("A declared question file is missing from the verified revision manifest.");
    total += file.byte_size;
  }
  if (total > MAX_REVIEW_TEXT_BYTES) throw new Error("The source text exceeds the supported review-export size.");
  const { default: JSZip } = await import("jszip");
  scope.assertCurrent();
  const zip = new JSZip();
  for (const [index, path] of paths.entries()) {
    progress(`Preparing review files · ${index + 1} of ${paths.length}`);
    scope.assertCurrent();
    const bytes = path === "catalog.json" ? catalogBytes : await read(path);
    scope.assertCurrent();
    zip.file(`stored-revision/${path}`, bytes);
  }
  const included = new Set(paths);
  const omitted = read.files.length - paths.length;
  zip.file("README.txt", [
    "AXOM stored revision review evidence",
    "",
    "This archive contains the exact stored catalog and its declared question-bank JSON files.",
    "This review evidence is not intended as a complete course package or a learner backup.",
    "Images, original PDFs and tracker templates are not included. Their complete revision manifest is supplied.",
    "Use the course's original-PDF controls and normal image-aware review before approving any content.",
    "The export does not read this device's learner answers, notes, progress, authentication credentials or approval attestations.",
    "Exporting these files does not verify clinical accuracy or approve the revision.",
  ].join("\n"));
  zip.file("review-manifest.json", JSON.stringify({ format: "axom-stored-review-evidence", version: 1,
    collectionId: course.id, revisionId: course.current_revision_id, contentHash: expectedHash,
    exportedAt: new Date().toISOString(), includedFiles: paths.length, omittedFiles: omitted,
    binariesIncluded: false, files: read.files.map(file => ({ path: file.path, sha256: file.sha256,
      byte_size: file.byte_size, mime_type: file.mime_type, included: included.has(file.path) })),
  }, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await assertRevision();
  const label = course.module.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "Course";
  return { blob: new Blob([bytes as BlobPart], { type: "application/zip" }),
    fileName: `AXOM_${label}_Review_Evidence_${course.current_revision_id}.zip`, includedFiles: paths.length, omittedFiles: omitted };
}
