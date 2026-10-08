// ===========================================================================
// A question package, into the one way AXOM saves reviewed questions.
//
// `prepareReviewedImport` and `saveReviewedImport` (lib/questionImportSave)
// check, de-duplicate and write every import. This turns a package into the
// request they take, so a package is saved by the same code as a pasted or
// parsed import and never by a second path.
//
// Only a question that is ready goes in. One that needs review goes in only
// once a person has accepted it, and never without a key. Everything held
// back is returned with its reasons.
//
// Until a question record can hold blocks, three things do not make the trip
// and are listed in the result instead of being dropped silently: a picture
// that must stay hidden until the answer is given, a table as a table (it is
// saved as text), and where in the stem a picture sits.
// ===========================================================================
import { CURRICULA } from "../curricula";
import type { ImportDestination, ReviewedDraft, ReviewedImportRequest } from "../questionImportSave";
import type { QuestionSource } from "../questions";
import { legacyQuestionFields } from "./legacyFields";
import type { ImportPackage, PackageIssue, PackageQuestion, QuestionAsset } from "./package";
import { questionReadiness, type Readiness } from "./readiness";
import { isAssetVisible } from "./visibility";

export interface PackageImportOptions {
  destination?: ImportDestination;
  /** The source file's size, for the library's note of where the questions came from. */
  sourceBytes?: number;
  /** Ids of questions a person has looked at and accepts although they carry a review note. */
  acknowledged?: ReadonlySet<string>;
  /** Notes on how the file was read, kept on the saved set. */
  notes?: readonly string[];
}

export interface HeldQuestion {
  questionId: string;
  readiness: Readiness;
  reasons: string[];
}

export interface WithheldAsset {
  questionId: string;
  assetId: string;
  filename: string;
  role: QuestionAsset["role"];
  reason: string;
}

export interface PackageReviewedImport {
  /** What to hand to `prepareReviewedImport`. Its drafts are only the questions that may be saved. */
  request: ReviewedImportRequest;
  /** The package question each draft came from, in step with `request.drafts`. */
  questionIds: string[];
  /** The image files `saveReviewedImport` has to be given, by file name. */
  imageNames: string[];
  held: HeldQuestion[];
  withheldAssets: WithheldAsset[];
  /** Where the set is filed, and whether the curriculum agrees that the module sits in that term. */
  filing: { module: string; week: number; term: number; curriculumTerm?: string; agrees: boolean };
  /** True when the source's own numbers repeat, so the saved questions are numbered in running order. */
  renumbered: boolean;
}

const FILE_TYPE: Record<string, string> = { pdf: "pdf", docx: "docx", doc: "docx", pptx: "pptx", txt: "text", md: "text" };

function curriculumTermOf(module: string): string | undefined {
  for (const curriculum of CURRICULA) {
    const term = curriculum.terms.find((entry) => entry.courses.some((course) => course.modules.includes(module)));
    if (term) return term.name;
  }
  return undefined;
}

export function packageToReviewedImport(pkg: ImportPackage, issues: readonly PackageIssue[], options: PackageImportOptions = {}): PackageReviewedImport {
  const { manifest } = pkg;
  const held: HeldQuestion[] = [];
  const withheldAssets: WithheldAsset[] = [];
  const going: { question: PackageQuestion; reasons: string[] }[] = [];

  for (const question of pkg.questions) {
    const verdict = questionReadiness(question, issues);
    const fields = legacyQuestionFields(manifest, question);
    const reasons = [...verdict.reasons];
    let readiness = verdict.readiness;
    if (readiness !== "unresolved" && fields.options.some((option) => !option.text.trim())) {
      // A choice that is only a picture has no text for the current question record to show.
      readiness = "unresolved";
      reasons.push("A choice is a picture with no text. It cannot be saved as a question yet.");
    }
    if (readiness !== "unresolved" && question.correctAnswer && !fields.correctKey) {
      readiness = "unresolved";
      reasons.push("The key names more than one choice. Only single-answer questions can be saved yet.");
    }
    const accepted = readiness === "needs-review" && Boolean(question.correctAnswer) && options.acknowledged?.has(question.id);
    if (readiness === "ready" || accepted) going.push({ question, reasons });
    else held.push({ questionId: question.id, readiness, reasons });
  }

  // A file with several sets, each numbered from 1, would be refused for its repeated numbers.
  // The saved questions are then numbered in running order, and each keeps its own number in its source label.
  const numbers = going.map((entry) => entry.question.source.questionNumber);
  const renumbered = numbers.some((value) => value === undefined) || new Set(numbers).size !== numbers.length;
  const source: QuestionSource = going.some((entry) => entry.question.provenance.method === "pdf-import") ? "pdf" : "imported";

  const drafts: ReviewedDraft[] = going.map(({ question, reasons }, index) => {
    const fields = legacyQuestionFields(manifest, question);
    const shown = question.assets.filter((asset) => isAssetVisible(asset.role, "question"));
    for (const asset of question.assets) {
      if (shown.includes(asset)) continue;
      withheldAssets.push({
        questionId: question.id,
        assetId: asset.id,
        filename: asset.filename,
        role: asset.role,
        reason: "It must not be seen while the question is open, and the current question record shows every picture with the question. It stays in the package.",
      });
    }
    const where = [
      question.source.filename,
      ...(question.source.set !== undefined ? [`set ${question.source.set}`] : []),
      ...(question.source.questionNumber !== undefined ? [`question ${question.source.questionNumber}`] : []),
    ].join(", ");
    return {
      stem: fields.stem,
      options: fields.options,
      correctKey: fields.correctKey,
      ...(fields.explanation ? { explanation: fields.explanation } : {}),
      ...(fields.topic ? { topic: fields.topic } : {}),
      questionNumber: renumbered ? index + 1 : question.source.questionNumber,
      ...(fields.sourcePage !== undefined ? { sourcePage: fields.sourcePage, questionSourcePage: fields.sourcePage } : {}),
      sourceLabel: where,
      ...(shown.length ? { attachmentNames: shown.map((asset) => asset.filename) } : {}),
      parserRuleIds: ["import.package", `import.package.${question.provenance.method}`],
      confidence: "high",
      warnings: reasons,
      source: question.provenance.method === "pdf-import" ? "pdf" : "imported",
      ...(reasons.length ? { reviewAcknowledged: true } : {}),
    };
  });

  const checksum = pkg.questions.find((question) => question.provenance.sourceChecksum)?.provenance.sourceChecksum;
  const extension = manifest.source.filename.split(".").pop()?.toLowerCase() ?? "";
  const curriculumTerm = curriculumTermOf(manifest.course.name);
  return {
    request: {
      drafts,
      destination: options.destination ?? "set",
      document: {
        title: manifest.bank.title,
        fileName: manifest.source.filename,
        fileType: FILE_TYPE[extension] ?? "text",
        sizeBytes: options.sourceBytes ?? 0,
        // The text of the source is not carried: the package is what was read from it.
        rawText: "",
        ...(checksum ? { checksum } : {}),
      },
      sourceType: source,
      setTitle: manifest.bank.title,
      scope: { module: manifest.course.name, week: manifest.course.week },
      parserWarnings: [...(options.notes ?? [])],
    },
    questionIds: going.map((entry) => entry.question.id),
    imageNames: [...new Set(drafts.flatMap((draft) => draft.attachmentNames ?? []))],
    held,
    withheldAssets,
    filing: {
      module: manifest.course.name,
      week: manifest.course.week,
      term: manifest.course.term,
      ...(curriculumTerm ? { curriculumTerm } : {}),
      agrees: curriculumTerm === undefined || curriculumTerm === `Term ${manifest.course.term}`,
    },
    renumbered,
  };
}
