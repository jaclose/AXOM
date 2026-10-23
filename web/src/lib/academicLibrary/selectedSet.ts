import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { questionPracticeReadiness } from "../questionFilters";
import { getQuestionAttachmentBlob } from "../questionAttachments";
import { blocksToPlainText, type QuestionBlock } from "../question-content/blocks";
import { readWorkspaceContent } from "../question-content/workspaceContent";
import type { PackageQuestion, QuestionAsset } from "../question-content/package";
import type { PreparedBank, PrivateLibraryCatalog, ReviewedFilingTerm } from "../privateLibrary/types";
import { sha256 } from "../question-content/assets";
import { prepareAcademicUpload, type AcademicUpload } from "./upload";

export interface SetLibraryDetails {
  title: string;
  description: string;
  module: string;
  term: ReviewedFilingTerm;
  topic: string;
  version: string;
  rights: "original" | "permission" | "open-license";
}
export interface SelectedSetUpload {
  upload: AcademicUpload;
  questions: number;
  images: number;
  excludedNoteImages: number;
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const plain = (text: string | undefined): QuestionBlock[] => text ? [{ type: "text", text }] : [];
const extension: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Explicit allowlist into the existing academic package. Never export a
 * workspace question wholesale: its notes, attempts and identities are private. */
export async function prepareSelectedSetUpload(set: QuestionSet, records: readonly QuestionRecord[], details: SetLibraryDetails,
  assertCurrent: () => void = () => {}): Promise<SelectedSetUpload> {
  if (!details.title.trim() || details.title.length > 180 || !details.module.trim() || details.module.length > 80
    || !/^Term [1-5]$/.test(details.term) || !details.version.trim() || details.version.length > 80
    || details.description.length > 2000 || details.topic.length > 180
    || !["original", "permission", "open-license"].includes(details.rights)) throw new Error("Complete the title, term, module, version and content rights before preparing this set.");
  if (!set.questionIds.length || set.questionIds.length > 1000 || new Set(set.questionIds).size !== set.questionIds.length)
    throw new Error("Choose a set with 1–1,000 distinct questions.");
  const byId = new Map(records.map(question => [question.id, question]));
  const selected = set.questionIds.map(id => byId.get(id));
  if (selected.some(question => !question || questionPracticeReadiness(question) !== "ready"))
    throw new Error("Every selected question must be present and reviewed. Resolve missing questions and answer mappings before upload.");
  const identity = (await sha256(encode(set.id))).slice(7);
  assertCurrent();
  const bankId = `community-${identity.slice(0, 24)}`;
  const files = new Map<string, Uint8Array>();
  const questions: PackageQuestion[] = [];
  let images = 0, excludedNoteImages = 0;
  for (const [index, record] of selected.entries()) {
    const q = record!;
    const id = `question-${index + 1}`;
    const parsed = readWorkspaceContent(q.content);
    if (parsed.errors.length) throw new Error(`Question ${index + 1}: ${parsed.errors[0]}`);
    const content = parsed.content;
    if (content && (blocksToPlainText(content.stem) !== q.stem
      || content.choices.length !== q.options.length
      || content.choices.some((choice, i) => choice.label !== q.options[i].key
        || (choice.blocks.length > 0 && blocksToPlainText(choice.blocks) !== q.options[i].text))))
      throw new Error(`Question ${index + 1} has edits that differ from its rich source. Review that edition before publication.`);
    const assets: QuestionAsset[] = [];
    const remap = new Map<string, string>();
    const attachments = (q.attachments ?? []).filter(attachment => attachment.role);
    excludedNoteImages += (q.attachments?.length ?? 0) - attachments.length;
    for (const [assetIndex, attachment] of attachments.entries()) {
      const sourceAsset = content?.assets.find(asset => asset.id === attachment.assetId);
      if (content && !sourceAsset) throw new Error(`Question ${index + 1} has a source figure without a verified content mapping.`);
      const stored = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true });
      assertCurrent();
      if (!stored?.blob || stored.byteSize !== stored.blob.size || attachment.byteSize !== stored.blob.size)
        throw new Error(`Question ${index + 1}: restore every source image before upload.`);
      const bytes = new Uint8Array(await stored.blob.arrayBuffer());
      const checksum = await sha256(bytes);
      assertCurrent();
      if (sourceAsset?.checksum && sourceAsset.checksum !== checksum) throw new Error(`Question ${index + 1}: source image checksum differs.`);
      const ext = extension[stored.mimeType];
      if (!ext) throw new Error("A selected image has an unsupported format.");
      const assetId = `${id}-image-${assetIndex + 1}`;
      const filename = `${checksum.slice(7)}.${ext}`;
      const role = sourceAsset?.role ?? (attachment.role === "exhibit" ? "stem" : attachment.role!);
      if (sourceAsset) remap.set(sourceAsset.id, assetId);
      assets.push({ id: assetId, filename, mimeType: stored.mimeType, role, questionId: id, checksum,
        byteSize: bytes.length, ...(sourceAsset?.crop ? { crop: sourceAsset.crop } : {}),
        ...(sourceAsset?.revealOf ? { revealOf: sourceAsset.revealOf } : {}) });
      files.set(`banks/assets/${filename}`, bytes); images++;
    }
    if (content && content.assets.some(asset => !remap.has(asset.id))) throw new Error(`Question ${index + 1}: a required source image is missing from this device.`);
    const remapBlocks = (blocks: QuestionBlock[]): QuestionBlock[] => blocks.map(block => {
      if (block.type === "image") {
        const assetId = remap.get(block.assetId);
        if (!assetId) throw new Error("A figure reference is missing its source image.");
        return { ...block, assetId };
      }
      if (block.type === "table" && block.sourceImageAssetId) {
        const assetId = remap.get(block.sourceImageAssetId);
        if (!assetId) throw new Error("A table reference is missing its source image.");
        return { ...block, sourceImageAssetId: assetId };
      }
      return block;
    });
    for (const asset of assets) if (asset.revealOf) asset.revealOf = remap.get(asset.revealOf);
    const stem = content ? remapBlocks(content.stem) : [...plain(q.stem), ...assets.filter(asset => ["stem", "question", "choice"].includes(asset.role)).map(asset => ({ type: "image" as const, assetId: asset.id, role: asset.role }))];
    const explanation = content && blocksToPlainText(content.explanation ?? []) === (q.explanation ?? "")
      ? remapBlocks(content.explanation ?? []) : plain(q.explanation);
    if (content?.explanation?.some(block => block.type !== "text") && blocksToPlainText(content.explanation) !== (q.explanation ?? ""))
      throw new Error(`Question ${index + 1}: review the edited explanation before publishing its figures or tables.`);
    if (!content) explanation.push(...assets.filter(asset => !["stem", "question", "choice"].includes(asset.role)).map(asset => ({ type: "image" as const, assetId: asset.id, role: asset.role })));
    for (const option of q.options) if (q.choiceRationales?.[option.key]) explanation.push({ type: "text", text: `${option.key}: ${q.choiceRationales[option.key]}` });
    questions.push({ id, bankId, source: { filename: "selected-set.txt", questionNumber: index + 1 }, stem,
      choices: q.options.map((option, i) => ({ id: `${id}-${option.key}`, label: option.key, blocks: content ? remapBlocks(content.choices[i].blocks) : plain(option.text) })),
      ...(content?.choiceTable ? { choiceTable: remapBlocks([content.choiceTable])[0] as NonNullable<PackageQuestion["choiceTable"]> } : {}),
      correctAnswer: { labels: [q.correctKey!], evidence: "reviewer" }, explanation, assets,
      topic: details.topic.trim() || undefined, provenance: { method: "axom-export", tool: q.ai?.generated ? "axom-generated-reviewed-export@1" : "axom-selected-set@1" } });
  }
  const sourceText = JSON.stringify({ title: details.title.trim(), description: details.description.trim(),
    version: details.version.trim(), rights: details.rights, questions }, null, 2);
  const sourceBytes = new TextEncoder().encode(sourceText);
  const sourceHash = (await sha256(sourceBytes)).slice(7);
  for (const question of questions) question.provenance.sourceChecksum = `sha256:${sourceHash}`;
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, bank: { id: bankId, title: details.title.trim(), discipline: "Community", topic: details.topic.trim() || undefined },
    course: { name: details.module.trim(), term: Number(details.term.slice(-1)), week: 1 },
    source: { filename: "selected-set.txt", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/" }, questions },
    issues: [], sourceText: { rawText: sourceText }, sourceBytes: sourceBytes.length, notes: [] };
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: bankId,
    version: details.version.trim(), templates: [], sources: [{ id: bankId, name: "selected-set.txt", sourcePath: "selected-set.txt", checksum: sourceHash,
      module: details.module.trim(), status: "prepared", reason: "Explicitly selected, rights-declared question edition. Personal data excluded.",
      bankFile: "banks/selected.json", originalFile: "selected-set.txt", ready: questions.length, review: 0 }] };
  files.set("selected-set.txt", sourceBytes); files.set("banks/selected.json", encode(bank)); files.set("catalog.json", encode(catalog));
  const upload = await prepareAcademicUpload(async path => {
    assertCurrent(); const bytes = files.get(path); if (!bytes) throw new Error("A selected package file is missing."); return bytes;
  }, { term: details.term, module: details.module.trim(), title: details.title.trim(), evidence: "human-reviewed" });
  assertCurrent();
  return { upload, questions: questions.length, images, excludedNoteImages };
}
