// ===========================================================================
// Checking a package that has been read: do the pieces refer to each other,
// can every question be answered, and what should the import preview say.
//
// Nothing here changes the package. A wrong answer key, a ragged table or a
// misplaced image is reported and left exactly as the source has it.
// ===========================================================================
import { countMedia, type AssetRole, type QuestionBlock } from "./blocks";
import type { ImportPackage, IssueCode, IssueSeverity, PackageIssue, PackageQuestion, QuestionFlagType } from "./package";
import { effectiveRole } from "./visibility";

export interface ValidateOptions {
  /** File names present in the assets folder. When given, a block whose file is absent is reported. */
  assetFiles?: ReadonlySet<string>;
}

const FLAG_SEVERITY: Record<QuestionFlagType, IssueSeverity> = {
  source_inconsistency: "warning",
  missing_explanation: "info",
  possible_duplicate: "warning",
  answer_reveal_asset: "info",
  media_association_uncertain: "warning",
  table_parse_uncertain: "warning",
  missing_required_media: "error",
  answer_needs_review: "warning",
};

/** Assets that are kept for later and so are not expected to sit in a block. */
const HELD_ROLES: ReadonlySet<AssetRole> = new Set<AssetRole>(["answer_reveal", "reference", "source_page"]);

interface Section {
  path: string;
  role: AssetRole;
  blocks: readonly QuestionBlock[];
  /** The question cannot be answered without what this section shows. */
  required: boolean;
}

function sectionsOf(question: PackageQuestion): Section[] {
  return [
    { path: "stem", role: "stem", blocks: question.stem, required: true },
    ...question.choices.map((choice): Section => ({ path: `choices[${choice.label}].blocks`, role: "choice", blocks: choice.blocks, required: true })),
    { path: "explanation", role: "explanation", blocks: question.explanation ?? [], required: false },
  ];
}

function checkQuestion(pkg: ImportPackage, question: PackageQuestion, options: ValidateOptions): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const add = (severity: IssueSeverity, code: IssueCode, message: string, path?: string): void => {
    issues.push({ severity, code, message, questionId: question.id, ...(path ? { path } : {}) });
  };

  for (const flag of question.flags ?? []) add(FLAG_SEVERITY[flag.type], flag.type, flag.message);

  // --- assets and where they are placed
  const assets = new Map(question.assets.map((asset) => [asset.id, asset]));
  const placed = new Set<string>();
  for (const asset of question.assets) {
    const path = `assets[${asset.id}]`;
    if (asset.questionId !== question.id) {
      add("warning", "media_association_uncertain", `The image ${asset.filename} is listed here but says it belongs to "${asset.questionId}".`, path);
    }
    if (asset.revealOf && !assets.has(asset.revealOf)) {
      add("error", "asset_reference_broken", `The answer-reveal image ${asset.filename} points at an image this question does not have.`, path);
    }
    if (asset.crop) {
      add("info", "media_cropped", `${asset.filename} is cropped in the source. Only the part the source shows may be shown.`, path);
    }
    if (asset.role === "answer_reveal") {
      add("info", "answer_reveal_asset", `${asset.filename} shows the answer. It is held back while the question is open.`, path);
    }
  }
  for (const section of sectionsOf(question)) {
    section.blocks.forEach((block, index) => {
      const path = `${section.path}[${index}]`;
      if (block.type === "table" && block.sourceImageAssetId) {
        placed.add(block.sourceImageAssetId);
        if (!assets.has(block.sourceImageAssetId)) add("warning", "asset_reference_broken", "The picture of this table in the source is not among the question's assets.", path);
      }
      if (block.type !== "image") return;
      placed.add(block.assetId);
      const asset = assets.get(block.assetId);
      const absent = !asset
        ? "names an image this question does not have"
        : options.assetFiles && !options.assetFiles.has(asset.filename)
          ? `needs the file ${asset.filename}, which is not in the package`
          : undefined;
      if (absent && section.required) {
        add("error", "missing_required_media", `The ${section.role} ${absent}. The question cannot be answered without it.`, path);
      } else if (absent) {
        add("warning", "asset_reference_broken", `The ${section.role} ${absent}.`, path);
      }
      if (section.required && effectiveRole(block.role, asset?.role, section.role) === "answer_reveal") {
        add("warning", "answer_reveal_asset", `An image that shows the answer is placed in the ${section.role}. It will not be shown while the question is open.`, path);
      }
    });
  }
  if (question.choiceTable?.sourceImageAssetId) placed.add(question.choiceTable.sourceImageAssetId);
  for (const asset of question.assets) {
    if (!placed.has(asset.id) && !HELD_ROLES.has(asset.role)) {
      add("warning", "media_association_uncertain", `The image ${asset.filename} belongs to this question but is not placed anywhere in it.`, `assets[${asset.id}]`);
    }
  }

  // --- choices and the answer key
  const labels = question.choices.map((choice) => choice.label);
  if (new Set(labels).size !== labels.length) add("error", "duplicate_id", "Two choices have the same letter.", "choices");
  if (labels.length < 2) add("warning", "choices_incomplete", "The question has fewer than two answer choices.", "choices");
  const tableKeys = new Set(question.choiceTable?.rowKeys ?? []);
  for (const choice of question.choices) {
    if (!choice.blocks.length && !tableKeys.has(choice.label)) add("error", "choices_incomplete", `Choice ${choice.label} has no content.`, `choices[${choice.label}]`);
  }
  for (const key of tableKeys) {
    if (!labels.includes(key)) add("error", "choices_incomplete", `The answer table has a row "${key}" that is not one of the choices.`, "choiceTable");
  }
  if (!question.correctAnswer) {
    add("warning", "missing_answer_key", "The question has no answer key.", "correctAnswer");
  } else {
    for (const label of question.correctAnswer.labels) {
      if (!labels.includes(label)) add("error", "answer_key_not_a_choice", `The answer key says ${label}, which is not one of the choices. It was not changed.`, "correctAnswer");
    }
  }
  if (!question.explanation?.length && !question.flags?.some((flag) => flag.type === "missing_explanation")) {
    add("info", "missing_explanation", "The source gives no explanation for this question.", "explanation");
  }

  // --- filing
  const { manifest } = pkg;
  if (question.bankId && question.bankId !== manifest.bank.id) {
    add("warning", "scope_mismatch", `The question says bank "${question.bankId}"; the package is "${manifest.bank.id}". Both were kept.`);
  }
  if (question.week !== undefined && question.week !== manifest.course.week) {
    add("warning", "scope_mismatch", `The question says week ${question.week}; the bank is filed under week ${manifest.course.week}. Both were kept.`);
  }
  return issues;
}

export function validatePackage(pkg: ImportPackage, options: ValidateOptions = {}): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const { manifest } = pkg;
  if (manifest.source.axomAssignedWeek !== undefined && manifest.source.axomAssignedWeek !== manifest.course.week) {
    issues.push({ severity: "warning", code: "scope_mismatch", message: `The manifest files the bank under week ${manifest.course.week} but records week ${manifest.source.axomAssignedWeek} as the one AXOM assigned.` });
  }
  const seenQuestions = new Set<string>();
  const seenAssets = new Map<string, string>();
  for (const question of pkg.questions) {
    if (seenQuestions.has(question.id)) {
      issues.push({ severity: "error", code: "duplicate_id", message: `Two questions share the id "${question.id}".` });
    }
    seenQuestions.add(question.id);
    for (const asset of question.assets) {
      const owner = seenAssets.get(asset.id);
      // Asset ids key the stored image, so one id can never mean two pictures.
      if (owner !== undefined) {
        issues.push({ severity: "error", code: "duplicate_id", message: `The asset id "${asset.id}" is used twice (in "${owner}" and "${question.id}").` });
      }
      seenAssets.set(asset.id, question.id);
    }
    issues.push(...checkQuestion(pkg, question, options));
  }
  return issues;
}

// --- what the import preview shows --------------------------------------------

export interface PackageSummary {
  questions: number;
  images: number;
  tables: number;
  equations: number;
  explanations: number;
  answerKeys: number;
  /** Answer-marked copies held back for review. Not counted as images. */
  answerReveals: number;
  /** Questions that cannot be run until an error on them is fixed. */
  blockedQuestions: number;
  /** False when an error applies to the whole package and nothing can be imported. */
  importable: boolean;
  issues: Partial<Record<IssueCode, number>>;
}

export function summarizePackage(pkg: ImportPackage, issues: readonly PackageIssue[]): PackageSummary {
  const summary: PackageSummary = {
    questions: pkg.questions.length, images: 0, tables: 0, equations: 0, explanations: 0, answerKeys: 0,
    answerReveals: 0, blockedQuestions: 0, importable: true, issues: {},
  };
  for (const question of pkg.questions) {
    for (const section of sectionsOf(question)) {
      const counts = countMedia(section.blocks);
      summary.images += counts.images;
      summary.tables += counts.tables;
      summary.equations += counts.equations;
    }
    if (question.choiceTable) summary.tables += 1;
    if (question.explanation?.length) summary.explanations += 1;
    if (question.correctAnswer) summary.answerKeys += 1;
    summary.answerReveals += question.assets.filter((asset) => asset.role === "answer_reveal").length;
  }
  const blocked = new Set<string>();
  for (const issue of issues) {
    summary.issues[issue.code] = (summary.issues[issue.code] ?? 0) + 1;
    if (issue.severity !== "error") continue;
    if (issue.questionId) blocked.add(issue.questionId);
    else summary.importable = false;
  }
  summary.blockedQuestions = blocked.size;
  return summary;
}

/** A question can be put in front of a learner only when no error is recorded against it. */
export function isRunnable(questionId: string, issues: readonly PackageIssue[]): boolean {
  return !issues.some((issue) => issue.severity === "error" && (!issue.questionId || issue.questionId === questionId));
}
