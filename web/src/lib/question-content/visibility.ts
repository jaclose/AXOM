// ===========================================================================
// Which images a learner may see, and when. One rule here, used by every exam
// interface, so no player can show an answer-marked slide by its own mistake.
// ===========================================================================
import type { AssetRole, ImageBlock, QuestionBlock } from "./blocks";

/** What the learner is doing with the question right now. */
export type ContentViewMode =
  /** Answering. Nothing about the answer has been shown. */
  | "question"
  /** Tutor mode, after this one question was checked. */
  | "answered"
  /** After the block ended, or browsing the bank. */
  | "review";

export type SupportingRole = Exclude<AssetRole, "question" | "stem" | "choice">;

const PART_OF_THE_QUESTION: ReadonlySet<AssetRole> = new Set<AssetRole>(["question", "stem", "choice"]);

/**
 * A placement and its asset can disagree about the role. An answer-reveal
 * marking on either one wins, so a mislabelled block cannot expose the slide.
 */
export function effectiveRole(blockRole: AssetRole | undefined, assetRole: AssetRole | undefined, sectionRole: AssetRole): AssetRole {
  if (blockRole === "answer_reveal" || assetRole === "answer_reveal") return "answer_reveal";
  return blockRole ?? assetRole ?? sectionRole;
}

export function isAssetVisible(role: AssetRole, mode: ContentViewMode): boolean {
  if (PART_OF_THE_QUESTION.has(role)) return true;
  // A copy of the slide with the answer marked, or a figure from the
  // explanation, gives the answer away. No exam profile, setting or later
  // edit may show either while the question is open.
  if (mode === "question" && (role === "answer_reveal" || role === "explanation")) return false;
  return supportingAssetVisible(role as SupportingRole, mode);
}

/**
 * The cells the two rules above leave open: a reference panel or a whole
 * source page while the question is open, and all four supporting roles once
 * it has been answered or is under review.
 */
function supportingAssetVisible(_role: SupportingRole, _mode: ContentViewMode): boolean {
  // TODO(human): decide when each supporting role is shown. Until then nothing
  // beyond the question's own images is shown in any mode.
  return false;
}

export function visibleBlocks(
  blocks: readonly QuestionBlock[],
  mode: ContentViewMode,
  roleOf: (block: ImageBlock) => AssetRole,
): QuestionBlock[] {
  return blocks.filter((block) => block.type !== "image" || isAssetVisible(roleOf(block), mode));
}
