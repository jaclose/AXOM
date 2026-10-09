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
// A source file that holds several sets of questions, each numbered from 1,
// stays one source and becomes one saved set for each of its own. Nothing is
// renumbered: every question keeps the number its source gave it.
//
// Ordered blocks and role-aware media travel through that same save path.
// ===========================================================================
import { CURRICULA } from "../curricula";
import type { ImportDestination, ReviewedDraft, ReviewedImportRequest } from "../questionImportSave";
import type { QuestionSource } from "../questions";
import { legacyQuestionFields } from "./legacyFields";
import type { ImportPackage, PackageIssue, PackageQuestion, QuestionAsset } from "./package";
import { questionReadiness, type Readiness } from "./readiness";

export interface PackageImportOptions {
  /** "both" keeps a record of the source file in the library beside the questions. It needs `sourceText`. */
  destination?: ImportDestination;
  courseId?: string;
  /** The source file's size, for the library's note of where the questions came from. */
  sourceBytes?: number;
  /** The text of the source as it was read. With it, the library keeps one record of the file, and every set made from it is tied to that record. */
  sourceText?: { rawText: string; pageTexts?: string[] };
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

/** One set of the source, as one request to the canonical import. */
export interface SectionImport {
  /** Which set of the source this is, counted from 1. Absent when the source is one set. */
  set?: number;
  /** The heading the source prints above the set, when it prints one. */
  title?: string;
  /** What to hand to `prepareReviewedImport`. Its drafts are only the questions that may be saved. */
  request: ReviewedImportRequest;
  /** The package question each draft came from, in step with `request.drafts`. */
  questionIds: string[];
  /** The image files `saveReviewedImport` has to be given, by file name. */
  imageNames: string[];
}

export interface PackageReviewedImport {
  /** One for each set of the source that has a question to save, in the source's order. Prepare and save them one after another. */
  imports: SectionImport[];
  held: HeldQuestion[];
  withheldAssets: WithheldAsset[];
  /** Where the sets are filed, and whether the curriculum agrees that the module sits in that term. */
  filing: { module: string; week: number; term: number; curriculumTerm?: string; agrees: boolean };
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
  const going: { question: PackageQuestion; advisories: string[]; accepted: string[] }[] = [];

  // Within one set a number names one question. Two with the same number cannot both be saved under it.
  const numbered = new Map<string, number>();
  for (const question of pkg.questions) {
    if (question.source.questionNumber === undefined) continue;
    const key = `${question.source.set ?? 0}:${question.source.questionNumber}`;
    numbered.set(key, (numbered.get(key) ?? 0) + 1);
  }

  for (const question of pkg.questions) {
    const verdict = questionReadiness(question, issues);
    const fields = legacyQuestionFields(manifest, question);
    const reasons = [...verdict.reasons];
    let readiness = verdict.readiness;
    let saveable = Boolean(question.correctAnswer);
    if (fields.options.some((option) => !option.text.trim())) {
      // A choice that is only a picture has no text for the current question record to show.
      saveable = false;
      if (readiness === "ready") readiness = "needs-review";
      reasons.push("A choice is a picture with no text. It cannot be saved as a question yet.");
    }
    if (question.correctAnswer && !fields.correctKey) {
      saveable = false;
      if (readiness === "ready") readiness = "needs-review";
      reasons.push("The key names more than one choice. Only single-answer questions can be saved yet.");
    }
    const number = question.source.questionNumber;
    if (number !== undefined && (numbered.get(`${question.source.set ?? 0}:${number}`) ?? 0) > 1) {
      saveable = false;
      if (readiness === "ready") readiness = "needs-review";
      reasons.push(`Another question in the same set also has the number ${number}. Which is which cannot be told from the source.`);
    }
    const accepted = readiness === "needs-review" && saveable && options.acknowledged?.has(question.id);
    if (readiness === "ready" || accepted) going.push({ question, advisories: verdict.advisories, accepted: accepted ? reasons : [] });
    else held.push({ questionId: question.id, readiness, reasons });
  }

  const checksum = pkg.questions.find((question) => question.provenance.sourceChecksum)?.provenance.sourceChecksum;
  const extension = manifest.source.filename.split(".").pop()?.toLowerCase() ?? "";
  const destination = options.destination ?? (options.sourceText ? "both" : "set");
  const sets = [...new Set(going.map((entry) => entry.question.source.set))];
  const several = new Set(pkg.questions.map((question) => question.source.set)).size > 1;

  const imports: SectionImport[] = sets.map((set) => {
    const members = going.filter((entry) => entry.question.source.set === set);
    const title = members.find((entry) => entry.question.source.setTitle)?.question.source.setTitle;
    const place = set === undefined ? "" : `set ${set}${title ? ` (${title})` : ""}`;
    const drafts: ReviewedDraft[] = members.map(({ question, advisories, accepted }) => {
      const fields = legacyQuestionFields(manifest, question);
      const shown = question.assets;
      const where = [
        question.source.filename,
        ...(place ? [place] : []),
        ...(question.source.questionNumber !== undefined ? [`question ${question.source.questionNumber}`] : []),
      ].join(", ");
      return {
        stem: fields.stem,
        content: question,
        options: fields.options,
        correctKey: fields.correctKey,
        ...(fields.explanation ? { explanation: fields.explanation } : {}),
        ...(fields.topic ? { topic: fields.topic } : {}),
        // The source's own number, as it is. A set never borrows numbers from another set.
        ...(question.source.questionNumber !== undefined ? { questionNumber: question.source.questionNumber } : {}),
        ...(fields.sourcePage !== undefined ? { sourcePage: fields.sourcePage, questionSourcePage: fields.sourcePage } : {}),
        sourceLabel: where,
        ...(shown.length ? { attachmentNames: shown.map((asset) => asset.filename) } : {}),
        parserRuleIds: ["import.package", `import.package.${question.provenance.method}`],
        confidence: "high",
        // Advisory notes travel with the question. Only a doubt a person accepted marks it as reviewed by hand.
        warnings: [...accepted, ...advisories],
        source: question.provenance.method === "pdf-import" ? "pdf" : "imported",
        ...(accepted.length ? { reviewAcknowledged: true } : {}),
      };
    });
    const source: QuestionSource = members.some((entry) => entry.question.provenance.method === "pdf-import") ? "pdf" : "imported";
    return {
      ...(set !== undefined ? { set } : {}),
      ...(title ? { title } : {}),
      request: {
        drafts,
        destination,
        document: {
          title: manifest.bank.title,
          fileName: manifest.source.filename,
          fileType: FILE_TYPE[extension] ?? "text",
          sizeBytes: options.sourceBytes ?? 0,
          rawText: options.sourceText?.rawText ?? "",
          ...(options.sourceText?.pageTexts ? { pageTexts: options.sourceText.pageTexts } : {}),
          ...(checksum ? { checksum } : {}),
        },
        sourceType: source,
        // One source, and one saved set for each of its own sets.
        setTitle: several && place ? `${manifest.bank.title}: ${place}` : manifest.bank.title,
        scope: { module: manifest.course.name, week: manifest.course.week, ...(options.courseId ? { courseId: options.courseId } : {}) },
        parserWarnings: [...(options.notes ?? [])],
      },
      questionIds: members.map((entry) => entry.question.id),
      imageNames: [...new Set(drafts.flatMap((draft) => draft.attachmentNames ?? []))],
    };
  });

  const curriculumTerm = curriculumTermOf(manifest.course.name);
  return {
    imports,
    held,
    withheldAssets,
    filing: {
      module: manifest.course.name,
      week: manifest.course.week,
      term: manifest.course.term,
      ...(curriculumTerm ? { curriculumTerm } : {}),
      agrees: curriculumTerm === undefined || curriculumTerm === `Term ${manifest.course.term}`,
    },
  };
}
