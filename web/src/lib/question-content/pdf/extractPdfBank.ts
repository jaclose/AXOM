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
import { questionReadiness, type Readiness, type ReadinessVerdict } from "../readiness";
import { validatePackage } from "../validate";
import { taggedPdfFileToQuestions } from "./taggedPdfInBrowser";
import type { TaggedConversion } from "./taggedPdfToQuestions";

export interface BankAssessment {
  issues: PackageIssue[];
  verdicts: Map<string, ReadinessVerdict>;
  counts: Record<Readiness, number>;
}

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
    });

/** The package checks and each question's verdict. Run it again after a question changes. */
export function assessBank(pkg: ImportPackage, conversionIssues: readonly PackageIssue[], files: readonly { name: string }[]): BankAssessment {
  const issues = [...conversionIssues, ...validatePackage(pkg, { assetFiles: new Set(files.map((file) => file.name)) })];
  const verdicts = new Map(pkg.questions.map((question) => [question.id, questionReadiness(question, issues)]));
  const counts: Record<Readiness, number> = { ready: 0, "needs-review": 0, unresolved: 0 };
  for (const verdict of verdicts.values()) counts[verdict.readiness] += 1;
  return { issues, verdicts, counts };
}

export async function extractPdfBank(file: { arrayBuffer(): Promise<ArrayBuffer> }, manifest: PackageManifest): Promise<PdfBankExtraction> {
  const buffer = await file.arrayBuffer();
  const checksum = await sha256(new Uint8Array(buffer.slice(0)));
  const read = await taggedPdfFileToQuestions(buffer, { bankId: manifest.bank.id, sourceFilename: manifest.source.filename, createdAt: new Date().toISOString() });
  if (!read.tagged) return read;
  // Every question says which file it was read from, so the same file is known again.
  for (const question of read.questions) question.provenance.sourceChecksum = checksum;
  const pkg: ImportPackage = { manifest, questions: read.questions };
  return {
    tagged: true,
    ...(read.creator ? { creator: read.creator } : {}),
    slides: read.slides,
    pkg,
    files: read.files,
    conversionIssues: read.issues,
    warnings: read.warnings,
    notes: read.notes,
    unplaced: read.unplaced,
    report: read.report,
    sourceText: read.sourceText,
    sourceBytes: buffer.byteLength,
    ...assessBank(pkg, read.issues, read.files),
  };
}
