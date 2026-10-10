import type { SourceDocument } from "../library";
import type { QuestionImageAttachment, QuestionAttachmentMimeType } from "../questionAttachments";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "./types";

/** Review documents share the existing media vault and portable backup lifecycle. */
export function privateReviewMedia(documents: readonly SourceDocument[] = []): Array<{ id: string; attachments: QuestionImageAttachment[] }> {
  const refs: Array<{ id: string; attachments: QuestionImageAttachment[] }> = [];
  for (const doc of documents) {
    if (doc.fileType !== PRIVATE_REVIEW_DOCUMENT) continue;
    try {
      const bank = JSON.parse(doc.rawText) as PreparedBank;
      for (const question of bank.pkg.questions) refs.push({ id: question.id, attachments: question.assets.flatMap(asset =>
        asset.checksum && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mimeType) ? [{
          id: `private-library:${asset.checksum}`, blobKey: `private-library:${asset.checksum}`, assetId: asset.id,
          fileName: asset.filename, mimeType: asset.mimeType as QuestionAttachmentMimeType, byteSize: asset.byteSize ?? 0,
          width: asset.width, height: asset.height, role: asset.role, altText: "Source review image", createdAt: doc.uploadedAt, updatedAt: doc.uploadedAt,
        }] : []) });
    } catch { /* A damaged review document cannot authorize deleting any existing media. */ }
  }
  return refs;
}
