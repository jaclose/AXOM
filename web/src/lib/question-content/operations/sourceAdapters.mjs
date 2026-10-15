// Headless adapters around AXOM's existing import parsers. No alternative
// question schema or persistence path. This module only runs on the user's
// authorized local computer; proprietary originals remain on that machine.
import { execFileSync } from "node:child_process";
import { File as NodeFile } from "node:buffer";
import { basename } from "node:path";
import { extractPptxSlides } from "./pptxSlides.mjs";
import { ocrImageOnlyPdf } from "./ocrImageOnlyPdf.local.mjs";

const MAX_SOURCE_TEXT = 10_000_000;
export const SUPPORTED_CORPUS_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".ppsx", ".txt", ".md", ".markdown", ".csv", ".json"]);

function externalPdfText(path) {
  // Poppler runs in its own bounded process, keeping PDF decompression out of
  // the Node/Vite heap. Never shell-interpolate a user-controlled filename.
  const rendered = execFileSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", path, "-"], {
    timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  }).toString("utf8");
  if (rendered.length > MAX_SOURCE_TEXT) throw new Error("PDF text exceeds ten million characters; split this source.");
  const pages = rendered.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  return { pages, text: pages.join("\n\n") };
}
function unassignedManifest(name, sha, kind) {
  return {
    schemaVersion: 1, course: { name: "UNMAPPED", term: 0, week: 0 },
    bank: { id: kind + "-" + sha.slice(0, 20), title: name.replace(/\.[^.]+$/, ""), discipline: "Academic source (review required)" },
    source: { filename: name, sourceWeekDeclared: false },
    questionsFile: "questions.json", assetsDirectory: "assets/",
  };
}
function holdUnverified(q, sha, reason) {
  q.provenance.sourceChecksum = "sha256:" + sha;
  const existing = q.flags ?? [];
  q.flags = [
    ...existing,
    ...(q.correctAnswer && !existing.some(flag => flag.type === "answer_needs_review") ? [
      { type: "answer_needs_review", message: reason },
    ] : []),
  ];
}
export async function prepareCorpusSource(path, bytes, sha, extension, services) {
  const filename = basename(path);
  if (extension === ".pdf") {
    const extracted = externalPdfText(path);
    const ocrNotes = [];
    let ocrApplied = false;
    if (!extracted.text.trim() && process.env.ROLE2_ENABLE_OCR === "1") {
      const recovery = ocrImageOnlyPdf(path, extracted.pages.length);
      ocrNotes.push(...recovery.notes);
      if (recovery.attempted) {
        ocrApplied = true;
        extracted.pages = recovery.pages;
        extracted.text = recovery.pages.join("\n\n");
      }
    }
    const prepared = await services.prepareRawPdfForReview({
      filename, originalBytes: bytes, fullText: extracted.text,
      pageTexts: extracted.pages, expectedSha256: sha,
    });
    if (ocrApplied) for (const question of prepared.pkg.questions) {
      question.provenance.notes = [question.provenance.notes,
        "Opt-in OCR transcription is unverified: compare original page image for every unit, option, label, figure and answer."].filter(Boolean).join("\n");
      question.flags = [...(question.flags ?? []), {
        type: "source_inconsistency",
        message: "OCR may misread source letters, numbers, medical units, or figures. Manual page inspection is mandatory.",
      }];
    }
    return {
      pkg: prepared.pkg, issues: prepared.issues, files: [], ocrApplied,
      sourceBytes: bytes.byteLength,
      sourcePages: extracted.pages.length, pageMapped: prepared.pageMapped,
      sourceText: { rawText: extracted.text.slice(0, 400_000), pageTexts: extracted.pages.map(page => page.slice(0, 15_000)) },
      notes: [
        ...prepared.notes,
        ...ocrNotes,
        "Headless Poppler layout text is an extraction candidate, not an authoritative PDF visual/figure/key transcript.",
        "Original remains at its original private source path; no public upload or scored answers.",
      ],
      detected: prepared.detected,
    };
  }
  if (extension === ".docx") {
    const file = new NodeFile([bytes], filename, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const extracted = await services.extractDocxBank(file, unassignedManifest(filename, sha, "docx"));
    for (const q of extracted.pkg.questions) holdUnverified(q, sha,
      "The extracted Word answer label has not been independently verified against the original academic key.");
    return {
      pkg: extracted.pkg, issues: extracted.conversionIssues, files: extracted.files,
      sourceText: { rawText: extracted.sourceText.rawText.slice(0, 400_000) },
      sourceBytes: bytes.byteLength, sourcePages: 0,
      pageMapped: extracted.pkg.questions.filter(q => q.source.page !== undefined).length,
      detected: extracted.pkg.questions.length,
      notes: [...extracted.notes, ...extracted.warnings,
        "Embedded Word figures and tables retained as AXOM blocks. Key evidence still requires user review."],
    };
  }
  if (extension === ".pptx" || extension === ".ppsx") {
    if (filename.startsWith("~$")) throw new Error("This is an Office lock file, not a slide deck. Import the unlocked original presentation.");
    const source = await extractPptxSlides(bytes, services);
    const bankId = "slides-" + sha.slice(0, 20);
    const questions = [], issues = [];
    let detected = 0, slidesWithoutReliableQuestions = 0;
    for (const slide of source.pages) {
      // AXOM's text parser can emit a 0-choice draft for ordinary slide
      // titles. Such material is source context, NOT a complete question.
      const candidates = services.importFromText(slide.text).drafts;
      const drafts = candidates.filter(draft =>
        draft.stem?.trim().length >= 12
        && Array.isArray(draft.options) && draft.options.length >= 2
        && draft.options.filter(option => option.text?.trim()).length >= 2);
      if (!drafts.length && slide.text.trim()) slidesWithoutReliableQuestions++;
      const originalIds = drafts.map((question, index) =>
        bankId + "-p" + String(slide.number).padStart(4, "0") + "-q" +
        String(question.questionNumber ?? index + 1).padStart(3, "0") + "-i" + index);
      const normalized = services.draftsToQuestions(drafts, { media: [] }, {
        bankId, sourceFilename: filename, method: "manual-transcription",
        ids: originalIds,
      });
      detected += drafts.length;
      issues.push(...normalized.issues);
      for (const question of normalized.questions) {
        question.source.page = slide.number;
        question.provenance.notes =
          "Question shapes read from PowerPoint slide " + slide.number +
          ". Original speaker notes, slide visuals and drawing layer must be reviewed.";
        holdUnverified(question, sha,
          "A PowerPoint slide/notes answer is not independently verified. Check original slide and notes before scoring.");
        // The presentation may have embedded diagrams, vector figures or
        // animations that the plain-text reader cannot place. Retain the full
        // original and make this a review-only candidate.
        question.flags.push({
          type: "media_association_uncertain",
          message: "PowerPoint geometry, vector diagrams, and pictures were not mapped to this question. Confirm the complete original slide before practice.",
        });
        if (slide.notesPresent && !question.correctAnswer) question.flags.push({
          type: "answer_needs_review",
          message: "The original contains speaker notes; answers are not inferred from their text. Check the note slide manually.",
        });
        questions.push(question);
      }
    }
    return {
      pkg: { manifest: unassignedManifest(filename, sha, "slides"), questions },
      issues, files: [], detected,
      sourceBytes: bytes.byteLength, sourcePages: source.slides,
      pageMapped: questions.filter(q => q.source.page !== undefined).length,
      sourceText: {
        rawText: source.pages.map(p => "PowerPoint slide " + p.number + "\n" + p.text).join("\n\n").slice(0, 400_000),
        pageTexts: source.pages.map(p => p.text.slice(0, 15_000)),
      },
      notes: [...source.warnings,
        `${slidesWithoutReliableQuestions} slides had source text but no reliably structured question/choice block. Their original content is retained for review.`,
        "Provisional PowerPoint text candidates are intentionally review-held. Full original slides must be visually checked.",
      ],
    };
  }
  if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
    const prepared = await services.prepareRawTextBank({
      sourceBytes: bytes, filename, expectedSha256: sha,
    });
    return {
      pkg: prepared.pkg, issues: prepared.issues, files: [],
      sourceText: { rawText: new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 400_000) },
      sourceBytes: bytes.byteLength, sourcePages: 0, pageMapped: 0,
      detected: prepared.detected, notes: [...prepared.warnings, "All answer evidence held for independent original-source review."],
    };
  }
  if (extension === ".csv" || extension === ".json") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length > MAX_SOURCE_TEXT) throw new Error("Structured import exceeds ten million characters.");
    const result = extension === ".csv" ? services.importFromCsv(text) : services.importFromJson(text);
    const bankId = "structured-" + sha.slice(0, 20);
    const normalized = services.draftsToQuestions(result.drafts, { media: [] }, {
      bankId, sourceFilename: filename, method: "manual-transcription",
      ids: result.drafts.map((draft, index) => bankId + "-q" + String(draft.questionNumber ?? index + 1).padStart(4, "0") + "-p" + index),
    });
    for (const q of normalized.questions) holdUnverified(q, sha,
      "The structured source answer has not been independently matched to an authoritative academic key.");
    return {
      pkg: { manifest: unassignedManifest(filename, sha, "structured"), questions: normalized.questions },
      issues: normalized.issues, files: [],
      sourceText: { rawText: text.slice(0, 400_000) },
      sourceBytes: bytes.byteLength, sourcePages: 0, pageMapped: 0, detected: result.drafts.length,
      notes: [...result.warnings, "Source schema was normalized using AXOM's existing CSV/JSON reader; all keys are review gated."],
    };
  }
  throw new Error("Unsupported academic source format. Convert to PDF or DOCX and retain the original.");
}
