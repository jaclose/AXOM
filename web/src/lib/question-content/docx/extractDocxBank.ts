// Convert an ordinary Word document using the existing block-preserving parser.
// A DOCX is an archive internally, but it is NEVER treated as a prepared library.
import { sha256 } from "../assets";
import { assessBank } from "../assessBank";
import type { ImportPackage, PackageIssue, PackageManifest } from "../package";
import { docxToQuestions } from "./docxToQuestions";
import type { UnplacedMedia } from "../fromDrafts";
import { extractDocxText } from "../../extractText";

export interface DocxBankExtraction {
  pkg: ImportPackage;
  conversionIssues: PackageIssue[];
  files: File[];
  sourceText: { rawText: string };
  sourceBytes: number;
  originalFile?: Blob;
  notes: string[];
  warnings: string[];
  unplaced: UnplacedMedia[];
  readBy: "markers" | "text-parser" | "nothing";
}

const MAX_DOCX_BYTES = 128 * 1024 * 1024;

/** A Word file may contain tables, styled medical formulae and embedded images.
 * Parse those as blocks, not via Mammoth's lossy plain-text output. The plain
 * text is only the re-openable source record, not the question payload.
 */
export async function extractDocxBank(
  file: { arrayBuffer(): Promise<ArrayBuffer>; size?: number },
  manifest: PackageManifest,
): Promise<DocxBankExtraction> {
  if (file.size && file.size > MAX_DOCX_BYTES) {
    throw new Error("This Word document is larger than 128 MB. Split it into smaller documents before importing.");
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_DOCX_BYTES) {
    throw new Error("This Word document is larger than 128 MB. Split it into smaller documents before importing.");
  }
  const conversion = await docxToQuestions(bytes.slice(0), {
    bankId: manifest.bank.id,
    sourceFilename: manifest.source.filename,
    createdAt: new Date().toISOString(),
  });
  if (conversion.issues.some(issue => issue.code === "invalid_document")) {
    throw new Error(conversion.issues.find(issue => issue.code === "invalid_document")?.message ?? "This is not a readable DOCX document.");
  }
  const checksum = await sha256(new Uint8Array(bytes));
  for (const question of conversion.questions) {
    // Explicit provenance from a marker can identify a *different* original
    // document. Never overwrite that recorded original source identity.
    if (!question.provenance.sourceChecksum && question.source.filename === manifest.source.filename) {
      question.provenance.sourceChecksum = checksum;
    }
  }
  const pkg: ImportPackage = { manifest, questions: conversion.questions };
  const files = Array.from(conversion.files, ([name, bytes]) => {
    const extension = name.split(".").pop()?.toLowerCase();
    const mime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "gif" ? "image/gif" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "application/octet-stream";
    return new File([bytes.slice() as BlobPart], name, { type: mime });
  });
  // This source view is intentionally secondary. It must never replace the
  // block structure returned by docxToQuestions.
  const source = await extractDocxText(bytes.slice(0));
  const assessed = assessBank(pkg, conversion.issues, files);
  return {
    pkg,
    conversionIssues: conversion.issues,
    files,
    sourceText: { rawText: source.text },
    sourceBytes: bytes.byteLength,
    ...(file instanceof Blob ? { originalFile: file } : {}),
    notes: [`Read Word document using ${conversion.readBy === "markers" ? "AXOM structure markers" : "structured document blocks"}.`],
    warnings: [...source.warnings, ...assessed.issues.filter(issue => issue.severity === "error" && !issue.questionId).map(issue => issue.message)],
    unplaced: conversion.unplaced,
    readBy: conversion.readBy,
  };
}
