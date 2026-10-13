import type { QuestionRecord } from "../../lib/questions";
import type { SourceDocument } from "../../lib/library";
import { QuestionBlocks } from "./QuestionContent";
import { SourcePagePreview } from "./SourcePagePreview";

/** Called only by completed-session review, never by the answering surface. */
export function QuestionReviewSlides({ question, source }: { question: QuestionRecord; source?: SourceDocument }) {
  const content = question.content;
  const pages = content?.assets.filter(asset => asset.role === "source_page") ?? [];
  // Published page images work offline without requiring a separate PDF import.
  if (content && pages.length) return <QuestionBlocks content={content} attachments={question.attachments} mode="review"
    blocks={pages.map(asset => ({ type: "image", assetId: asset.id, role: "source_page", alt: "Original source slide" }))} />;
  if (source?.fileType === "pdf" && question.sourcePage) return <SourcePagePreview key={`${source.id}:${question.sourcePage}`} document={source} page={question.sourcePage} />;
  return null;
}
