import { sha256Hex } from "./checksum";
import { documentTitleFromFile } from "./library";
import { extractDocxText, RAW_TEXT_CAP } from "./extractText";
import { detectImportFormat, importFromCsv, importFromJson, importFromText } from "./questionImport";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "./questionParse";
import { parsePdfQuestions } from "./pdfQuestionImport";
import { attachPdfFigures, type FigurePlacement } from "./pdfFigures";
import { proposePdfMarkedAnswers } from "./pdfMarkedAnswers";
import { proposePdfEmphasisAnswers } from "./pdfEmphasisAnswers";
import type { ImportSourceFile } from "./questionImportSave";
import type { QuestionSource } from "./questions";
import type { PackageManifest } from "./question-content/package";
import type { PdfBankExtraction } from "./question-content/pdf/extractPdfBank";

type TaggedBank = Extract<PdfBankExtraction, { tagged: true }>;
export type QuestionFileBank = Omit<Pick<TaggedBank, "pkg" | "conversionIssues" | "files" | "sourceText" | "sourceBytes" | "originalFile" | "notes" | "warnings" | "unplaced">, "sourceText"> & {
  sourceText: { rawText: string; pageTexts?: string[] };
};
export type QuestionFileRead = { kind: "bank"; bank: QuestionFileBank } | {
  kind: "drafts"; drafts: ParsedQuestionDraft[]; document: ImportSourceFile;
  source: QuestionSource; warnings: string[]; images: File[]; placements: FigurePlacement[];
};

/** The same complete source read for single-file and batch imports. */
export async function readQuestionImportFile(file: File, manifest: PackageManifest, progress?: (message: string) => void): Promise<QuestionFileRead> {
  if (file.size > 128 * 1024 * 1024) throw new Error("This source exceeds 128 MB. Split it before importing; no partial questions were staged.");
  const name = file.name.toLowerCase();
  const pdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const docx = name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (pdf) {
    const { extractPdfBank } = await import("./question-content/pdf/extractPdfBank");
    const bank = await extractPdfBank(file, manifest);
    if (bank.tagged) return { kind: "bank", bank };
  }
  if (docx) {
    const { extractDocxBank } = await import("./question-content/docx/extractDocxBank");
    const bank = await extractDocxBank(file, manifest);
    if (bank.pkg.questions.length) return { kind: "bank", bank };
  }
  const bytes = await file.arrayBuffer();
  const document: ImportSourceFile = {
    originalFile: file, title: documentTitleFromFile(file.name), fileName: file.name,
    fileType: pdf ? "pdf" : docx ? "docx" : file.type, sizeBytes: file.size,
    rawText: "", checksum: await sha256Hex(bytes),
  };
  if (pdf || docx) {
    const extracted = pdf ? await (await import("./question-content/pdf/extractCompletePdfSource"))
      .extractCompletePdfSource(bytes.slice(0), ({ readPages, totalPages }) => progress?.(`Scanning page ${readPages}/${totalPages} in ${file.name}…`))
      : await extractDocxText(bytes.slice(0));
    document.rawText = "previewText" in extracted && typeof extracted.previewText === "string" ? extracted.previewText : extracted.text;
    document.pageTexts = "previewPages" in extracted && Array.isArray(extracted.previewPages)
      && extracted.previewPages.every((page): page is string => typeof page === "string") ? extracted.previewPages : undefined;
    const parsed = pdf ? parsePdfQuestions(extracted.text, extracted.pages)
      : { drafts: parseQuestionBlocks(extracted.text), notes: [], deckPages: undefined };
    const marks = pdf ? await proposePdfMarkedAnswers(bytes.slice(0), parsed.drafts, parsed.deckPages) : [];
    const emphasis = pdf ? await proposePdfEmphasisAnswers(bytes.slice(0), parsed.drafts) : [];
    const figures = pdf ? await attachPdfFigures(bytes.slice(0), file.name, parsed.drafts, extracted.pages ?? [], parsed.deckPages)
      : { images: [] as File[], notes: [] as string[], placements: [] as FigurePlacement[] };
    return { kind: "drafts", document, drafts: parsed.drafts, source: pdf ? "pdf" : "imported",
      images: figures.images, placements: figures.placements ?? [], warnings: [...extracted.warnings, ...parsed.notes, ...marks, ...emphasis, ...figures.notes,
        ...(!parsed.drafts.length ? ["No question pattern was found. Review the source or keep it as a library document."] : [])] };
  }
  if (file.type.startsWith("image/")) return { kind: "drafts", document, drafts: [], source: "image", images: [], placements: [],
    warnings: [`${file.name} is retained as an original image. Paste the question text for review; OCR is not included.`] };
  const format = detectImportFormat(file.name, file.type);
  if (format === "unsupported") throw new Error("Use PDF, DOCX, TXT, Markdown, CSV, or JSON.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  if (text.length > 10_000_000) throw new Error("This source exceeds 10 million characters. Split it before importing; no partial questions were staged.");
  const read = format === "csv" ? importFromCsv(text) : format === "json" ? importFromJson(text) : importFromText(text);
  document.fileType = format; document.rawText = text.slice(0, RAW_TEXT_CAP);
  return { kind: "drafts", document, drafts: read.drafts, source: "imported", images: [], placements: [], warnings: [...read.warnings,
    ...(text.length > RAW_TEXT_CAP ? ["The complete file was parsed. Only the stored text preview is shortened; the original file is retained."] : [])] };
}
