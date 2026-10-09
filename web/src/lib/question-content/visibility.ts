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
  const roles = [blockRole, assetRole, sectionRole];
  // A placement cannot weaken an asset's restrictions. Whole source pages
  // remain review-only even when somebody places one in a stem.
  for (const restricted of ["source_page", "answer_reveal", "explanation", "reference"] as const) {
    if (roles.includes(restricted)) return restricted;
  }
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
function supportingAssetVisible(role: SupportingRole, mode: ContentViewMode): boolean {
  switch (role) {
    case "explanation":
    case "answer_reveal":
      return mode === "answered" || mode === "review";
    // The label alone never shows an imported image during a question: an
    // answer sheet filed as a reference would be exposed. Vetted exam
    // references, such as lab values, are a separate tool and not an asset.
    case "reference":
      return mode !== "question";
    // A whole page can carry the key or the next question.
    case "source_page":
      return mode === "review";
    default:
      return false;
  }
}

export function visibleBlocks(
  blocks: readonly QuestionBlock[],
  mode: ContentViewMode,
  roleOf: (block: ImageBlock) => AssetRole,
): QuestionBlock[] {
  return blocks.filter((block) => block.type !== "image" || isAssetVisible(roleOf(block), mode));
}
