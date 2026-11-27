import { academicClient, academicLibraryReader } from "./client";
import { downloadAcademicAsset, type AcademicAssetReference } from "./contentReferences";
import { readCatalog, type LibraryInstallScope } from "../privateLibrary/install";

export type AcademicSourcePdf = { id: string; name: string } & ({
  available: true;
  fileName: string;
  byteSize: number;
  asset: AcademicAssetReference;
} | { available: false });

/** Discover only catalog-declared originals in this exact, permissioned revision.
 * Preview reads the verified catalog, never the PDFs or the local content cache. */
export async function listAcademicSourcePdfs(revisionId: string, scope: LibraryInstallScope): Promise<AcademicSourcePdf[]> {
  scope.assertCurrent();
  const client = await academicClient(scope.key);
  scope.assertCurrent();
  const read = await academicLibraryReader(client, revisionId);
  scope.assertCurrent();
  const bytes = await read("catalog.json");
  scope.assertCurrent();
  const catalog = readCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  const files = new Map(read.files.map(file => [file.path, file]));
  const seen = new Set<string>();
  return catalog.sources.flatMap((source, index): AcademicSourcePdf[] => {
    const file = source.originalFile ? files.get(source.originalFile) : undefined;
    const isPdf = file?.mime_type === "application/pdf"
      || [source.originalFile, source.name, source.sourcePath].some(path => path && /\.pdf$/i.test(path));
    if (!isPdf) return [];
    const identity = source.originalFile ?? source.sourcePath;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const name = source.name.trim() || source.originalFile?.split("/").pop() || "Original PDF";
    const row = { id: `${source.id}:${index}`, name };
    if (!source.originalFile || !file || file.mime_type !== "application/pdf" || file.sha256 !== source.checksum)
      return [{ ...row, available: false }];
    const leaf = (name.split(/[\\/]/).pop() || "Original").replace(/[:*?"<>|]/g, "_");
    return [{ ...row, available: true, fileName: /\.pdf$/i.test(leaf) ? leaf : `${leaf}.pdf`, byteSize: file.byte_size,
      asset: { revisionId, path: source.originalFile, sha256: source.checksum } }];
  });
}

export async function downloadAcademicSourcePdf(pdf: AcademicSourcePdf, scope: LibraryInstallScope): Promise<Blob> {
  scope.assertCurrent();
  if (!pdf.available) throw new Error("This original PDF is unavailable in this course revision.");
  const client = await academicClient(scope.key);
  scope.assertCurrent();
  const blob = await downloadAcademicAsset(client, pdf.asset);
  scope.assertCurrent();
  return new Blob([blob], { type: "application/pdf" });
}
