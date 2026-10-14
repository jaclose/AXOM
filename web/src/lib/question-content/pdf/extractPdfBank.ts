// ===========================================================================
// Browser only: a PDF file a person has chosen, read into a question package
// with its picture files and a readiness verdict for every question. This is
// the step before the import screen's preview. Saving is `saveBank`.
//
// A PDF with no structure tags is not read here. The caller is told so and
// falls back to the existing PDF import.
// ===========================================================================
import { sha256 } from "../assets";
import type { ImportPackage, PackageIssue, PackageManifest } from "../package";
import { assessBank, type BankAssessment } from "../assessBank";
export { assessBank, type BankAssessment } from "../assessBank";
import { taggedPdfFileToQuestions } from "./taggedPdfInBrowser";
import { applyReviewedSourceExceptions } from "./sourceReviewExceptions";
import type { TaggedConversion } from "./taggedPdfToQuestions";

export type PdfBankExtraction =
  | { tagged: false; creator?: string }
  | (BankAssessment & {
      tagged: true;
      creator?: string;
      slides: boolean;
      pkg: ImportPackage;
      /** One PNG for each picture a question names. */
      files: File[];
      /** What the converter found, kept apart from the package checks so the checks can be run again. */
      conversionIssues: PackageIssue[];
      /** Pictures that could not be drawn, in plain words. */
      warnings: string[];
      notes: string[];
      unplaced: TaggedConversion["unplaced"];
      report: TaggedConversion["report"];
      sourceText: TaggedConversion["sourceText"];
      sourceBytes: number;
      originalFile?: Blob;
    });

export async function extractPdfBank(file: { arrayBuffer(): Promise<ArrayBuffer> }, manifest: PackageManifest): Promise<PdfBankExtraction> {
  const buffer = await file.arrayBuffer();
  const checksum = await sha256(new Uint8Array(buffer.slice(0)));
  const read = await taggedPdfFileToQuestions(buffer, { bankId: manifest.bank.id, sourceFilename: manifest.source.filename, createdAt: new Date().toISOString() });
  if (!read.tagged) return read;
  // Every question says which file it was read from, so the same file is known again.
  for (const question of read.questions) question.provenance.sourceChecksum = checksum;
  // A direct PDF import must not discard known, checksum-verified source
  // inconsistencies already found in the reviewed native collection.
  const reviewed = applyReviewedSourceExceptions(read.questions, checksum);
  const pkg: ImportPackage = { manifest, questions: reviewed.questions };
  const conversionIssues = [...read.issues, ...reviewed.issues];
  return {
    tagged: true,
    ...(read.creator ? { creator: read.creator } : {}),
    slides: read.slides,
    pkg,
    files: read.files,
    conversionIssues,
    warnings: read.warnings,
    notes: [...read.notes, ...reviewed.notes],
    unplaced: read.unplaced,
    report: read.report,
    sourceText: read.sourceText,
    sourceBytes: buffer.byteLength,
    ...(file instanceof Blob ? { originalFile: file } : {}),
    ...assessBank(pkg, conversionIssues, read.files),
  };
}
