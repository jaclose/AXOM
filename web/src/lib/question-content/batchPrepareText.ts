// Deterministic local/offline bridge from ordinary academic text to AXOM's
// existing canonical question package and private reviewed-save contract.
// Writes NOTHING, performs NO online calls; the caller is responsible for
// human answer validation and private persistence receipts.
import { sha256 } from "./assets";
import { blocksToPlainText } from "./blocks";
import { draftsToQuestions } from "./fromDrafts";
import { assessBank } from "./assessBank";
import type { ImportPackage, PackageIssue, PackageQuestion } from "./package";
import { importFromText } from "../questionImport";
import { splitDeclaredQuestionSections } from "./splitDeclaredQuestionSections";

const SOURCE_TEXT_MAX = 10_000_000;
export interface PreparedTextBatch {
  pkg: ImportPackage;
  issues: PackageIssue[];
  sourceSha256: string;
  sourceBytes: number;
  detected: number;
  verifiedReadyIds: string[];
  reviewRequiredIds: string[];
  unresolvedIds: string[];
  duplicateStemGroups: string[][];
  declaredSets: number;
  warnings: string[];
}

function compact(text: string): string { return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim(); }

/** Exact normalized wording candidates; a match is a review hint, not an automatic merge. */
function duplicateStems(questions: readonly PackageQuestion[]): string[][] {
  const matched = new Map<string, string[]>();
  for (const question of questions) {
    const stem = compact(blocksToPlainText(question.stem));
    if (stem.length < 20) continue;
    matched.set(stem, [...(matched.get(stem) ?? []), question.id]);
  }
  return [...matched.values()].filter(ids => ids.length > 1);
}

export async function prepareRawTextBank(
  input: { sourceBytes: Uint8Array; filename: string; expectedSha256?: string },
): Promise<PreparedTextBatch> {
  if (input.sourceBytes.length > 128 * 1024 * 1024) throw new Error("Text source exceeds 128 MB; split before preparation.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(input.sourceBytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (source.length > SOURCE_TEXT_MAX) throw new Error("Academic source exceeds 10 million text characters; split it to avoid partial preparation.");
  const checksum = await sha256(input.sourceBytes);
  if (input.expectedSha256 && checksum !== `sha256:${input.expectedSha256.replace(/^sha256:/, "")}`)
    throw new Error("Source SHA-256 differs from the inventory. Refresh the source inventory; no questions were prepared.");
  const digest = checksum.slice("sha256:".length);
  const bankId = `source-${digest.slice(0, 20)}`;
  const declaredSections = splitDeclaredQuestionSections(source);
  const questions: PackageQuestion[] = [];
  const conversionIssues: PackageIssue[] = [];
  const warnings: string[] = [];
  let detected = 0;
  for (const section of declaredSections) {
    const read = importFromText(section.body);
    warnings.push(...read.warnings.map(note => section.set ? "Set " + section.set + ": " + note : note));
    detected += read.drafts.length;
    const ids = read.drafts.map((draft, position) => bankId
      + (section.set ? "-s" + section.set : "")
      + "-q" + String(draft.questionNumber ?? position + 1).padStart(3, "0")
      + "-p" + String(position + 1).padStart(3, "0"));
    const converted = draftsToQuestions(read.drafts, { media: [] }, {
      bankId, sourceFilename: input.filename, method: "manual-transcription", ids,
    });
    conversionIssues.push(...converted.issues);
    for (const question of converted.questions) {
      if (section.set !== undefined) question.source.set = section.set;
      if (section.title) question.source.setTitle = section.title;
      if (section.sourceLabel) question.provenance.notes = "Declared source: " + section.sourceLabel + "; original not independently verified.";
      questions.push(question);
    }
    if (!read.drafts.length) warnings.push("No question candidates found in declared section " + (section.set ?? 1) + ".");
  }
  const sourceNumberCounts = new Map<string, number>();
  for (const question of questions) {
    const number = question.source.questionNumber;
    if (number !== undefined) {
      const key = (question.source.set ?? 0) + ":" + number;
      sourceNumberCounts.set(key, (sourceNumberCounts.get(key) ?? 0) + 1);
    }
  }
  for (const question of questions) {
    question.provenance.sourceChecksum = checksum;
    question.provenance.notes = [question.provenance.notes, "Raw text transcription; scope and answer keys not independently source verified."].filter(Boolean).join("\n");
    // The prepared package format stores question flags, not transient parser
    // issues. Without carrying diagnostic flags, a reopen could silently
    // upgrade an ambiguous source to scored-practice ready.
    const hold = conversionIssues.filter(issue => issue.questionId === question.id && issue.severity !== "info");
    if (hold.length) question.flags = [...(question.flags ?? []), ...hold.map(issue => ({
      type: "source_inconsistency" as const,
      message: `Source extraction needs review: ${issue.message}`,
    }))];
    const number = question.source.questionNumber;
    if (number !== undefined && (sourceNumberCounts.get((question.source.set ?? 0) + ":" + number) ?? 0) > 1) {
      question.flags = [...(question.flags ?? []), { type: "source_inconsistency",
        message: `Source question number ${number} repeats within this document. This may be a new assessment or a duplicate revision; confirm set boundaries before scoring.` }];
    }
    if (question.correctAnswer) {
      // Preserve the labelled answer candidate but never treat a derived
      // TXT transcription as an independently inspected original answer key.
      question.flags = [...(question.flags ?? []), {
        type: "answer_needs_review",
        message: "This TXT labels an answer, but its original academic key is not independently verified. Confirm the original before scored practice.",
      }];
    }
  }
  const pkg: ImportPackage = {
    manifest: { schemaVersion: 1,
      course: { name: "UNMAPPED", term: 0, week: 0 },
      bank: { id: bankId, title: input.filename.replace(/\.[^.]+$/, ""), discipline: "Imported academic questions" },
      source: { filename: input.filename, sourceWeekDeclared: false },
      questionsFile: "questions.json", assetsDirectory: "assets/" },
    questions,
  };
  const assessment = assessBank(pkg, conversionIssues, []);
  const ready = [], review = [], unresolved = [];
  for (const question of questions) {
    const verdict = assessment.verdicts.get(question.id)?.readiness;
    if (verdict === "ready") ready.push(question.id);
    else if (verdict === "needs-review") review.push(question.id);
    else unresolved.push(question.id);
  }
  return { pkg, issues: assessment.issues, sourceSha256: digest, sourceBytes: input.sourceBytes.length,
    detected, verifiedReadyIds: ready, reviewRequiredIds: review, unresolvedIds: unresolved,
    declaredSets: declaredSections.length, duplicateStemGroups: duplicateStems(questions), warnings };
}
