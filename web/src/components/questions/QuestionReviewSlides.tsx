import type { QuestionRecord } from "../../lib/questions";
import type { SourceDocument } from "../../lib/library";
import { QuestionBlocks } from "./QuestionContent";
import { SourcePagePreview } from "./SourcePagePreview";

/** Called only by completed-session review, never by the answering surface. */
export function QuestionReviewSlides({ question, source }: { question: QuestionRecord; source?: SourceDocument }) {
  const content = question.content;
  const pages = content?.assets.filter(asset => asset.role === "source_page") ?? [];
  const placedImages = content ? [content.stem, ...content.choices.map((choice) => choice.blocks), content.explanation ?? []]
    .flat().filter((block) => block.type === "image") : [];
  // Published page images work offline without requiring a separate PDF import.
  if (content && pages.length) return <QuestionBlocks content={content} attachments={question.attachments} mode="review"
    blocks={pages.map(asset => ({
      type: "image", assetId: asset.id, role: "source_page",
      alt: placedImages.find((block) => block.assetId === asset.id && block.alt?.trim())?.alt ?? "Original source slide",
    }))} />;
  if (source?.fileType === "pdf" && question.sourcePage) return <SourcePagePreview key={`${source.id}:${question.sourcePage}`} document={source} page={question.sourcePage} />;
  return null;
}
