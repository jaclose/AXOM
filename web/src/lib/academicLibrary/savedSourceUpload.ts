import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import { questionPracticeReadiness } from "../questionFilters";
import { readOriginalFile } from "../sourceOriginal";
import { readSourceOriginal } from "../decode/sources";
import { getQuestionAttachmentBlob } from "../questionAttachments";
import { sha256 } from "../question-content/assets";
import { assessBank } from "../question-content/assessBank";
import { legacyQuestionFields } from "../question-content/legacyFields";
import { questionScope, type ImportPackage, type PackageManifest, type PackageQuestion } from "../question-content/package";
import { moduleIdentity } from "./coursePlan";
import { prepareAcademicUpload, type AcademicUpload } from "./upload";
import type { LibraryReader } from "../privateLibrary/install";
import type { PreparedBank, PrivateLibraryCatalog, ReviewedFilingTerm } from "../privateLibrary/types";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const basename = (value: string) => value.split(/[\\/]/).at(-1)?.trim() ?? "";
const hash = (value: string) => value.replace(/^sha256:/, "");
const sourceExtension: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

/**
 * An existing saved source can enter Community without asking the owner to
 * assemble a ZIP. This adapter only accepts the source-backed, reviewed part
 * of the local bank. The canonical academic uploader still validates the
 * resulting course and its figures before any network write.
 */
export async function prepareSavedSourceUpload(
  document: SourceDocument,
  questions: readonly QuestionRecord[],
  classification: { term: ReviewedFilingTerm; module: string },
  assertCurrent: () => void = () => {},
): Promise<AcademicUpload> {
  assertCurrent();
  const sourceHash = hash(document.checksum ?? "");
  const originalIdentity = readOriginalFile(document);
  const extension = originalIdentity && sourceExtension[originalIdentity.mimeType];
  const sourceName = basename(document.fileName);
  const termNumber = Number(classification.term.slice(-1));
  const module = classification.module.trim();
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || !originalIdentity || !extension
    || originalIdentity.byteSize > 50 * 1024 * 1024 || !sourceName
    || !/^Term [1-5]$/.test(classification.term) || !moduleIdentity(module)
    || !questions.length || questions.length > 20_000) {
    throw new Error("This saved source needs its original PDF, Word or text file and a confirmed Term 1-5 module before it can be shared.");
  }

  const sourceQuestions: PackageQuestion[] = [];
  const localIds = new Set<string>(), sourceIds = new Set<string>();
  for (const [index, saved] of questions.entries()) {
    let content = saved.content;
    if (!content && saved.attachments?.length) {
      throw new Error("This saved set has images without a source-linked asset map. Use the AXOM course folder or ZIP below if you have a reviewed package, or keep this source local.");
    }
    if (!content && saved.extraction?.reviewed === true && !(saved.attachments?.length)
      && saved.stem.trim() && saved.options.length >= 2 && saved.correctKey && saved.explanation?.trim()) {
      // The ordinary PDF/text importer stores exact reviewed strings rather
      // than a PackageQuestion. The original bytes are checked below. Never
      // invent a source page, a figure, or a printed-answer claim here.
      const digest = hash(await sha256(encode({ sourceHash, page: saved.sourcePage,
        number: saved.questionNumber, stem: saved.stem, options: saved.options,
        answer: saved.correctKey, explanation: saved.explanation })));
      const id = `saved-text-${digest.slice(0, 24)}`;
      content = {
        id, course: module, term: termNumber, week: saved.week ?? 0,
        source: { filename: sourceName,
          ...(saved.sourcePage !== undefined ? { page: saved.sourcePage } : {}),
          ...(saved.questionNumber !== undefined ? { questionNumber: saved.questionNumber } : {}) },
        stem: [{ type: "text", text: saved.stem }],
        choices: saved.options.map((option) => ({ id: `${id}-${option.key}`, label: option.key,
          blocks: [{ type: "text", text: option.text }] })),
        correctAnswer: { labels: [saved.correctKey], evidence: "reviewer" },
        explanation: [{ type: "text", text: saved.explanation }],
        assets: [], provenance: { method: "manual-transcription", tool: "AXOM reviewed text import",
          sourceChecksum: `sha256:${sourceHash}`,
          notes: "Exact saved text from an owner-reviewed import. The original file is retained; the answer was confirmed by a person, not read as a printed key." },
      };
    }
    if (saved.sourceDocumentId !== document.id || localIds.has(saved.id) || !content
      || (saved.sourceFile !== undefined
        && (basename(saved.sourceFile.name) !== sourceName || saved.sourceFile.size !== document.sizeBytes))
      || sourceIds.has(content.id) || questionPracticeReadiness(saved) !== "ready"
      || !saved.explanation?.trim() || !content.explanation?.length
      || hash(content.provenance.sourceChecksum ?? "") !== sourceHash
      || content.source.filename !== sourceName) {
      throw new Error(`Saved question ${index + 1} needs source, answer, explanation or duplicate review before sharing.`);
    }
    const declaredAssetIds = new Set(content.assets.map(asset => asset.id));
    const attachmentAssetIds = (saved.attachments ?? []).map(attachment => attachment.assetId);
    if (declaredAssetIds.size !== content.assets.length
      || attachmentAssetIds.length !== content.assets.length
      || attachmentAssetIds.some(id => !id || !declaredAssetIds.has(id))
      || new Set(attachmentAssetIds).size !== attachmentAssetIds.length) {
      throw new Error(`Saved question ${index + 1} has images that do not match its source-linked asset map. Review the exact figures before sharing.`);
    }
    localIds.add(saved.id); sourceIds.add(content.id);
    // The upload may canonicalize fields. It must never mutate the local bank.
    sourceQuestions.push(structuredClone(content));
  }

  const first = sourceQuestions[0];
  const originalModule = first.course ?? module;
  const originalTerm = first.term ?? termNumber;
  const bankId = first.bankId ?? `saved-${sourceHash.slice(0, 24)}`;
  const manifest: PackageManifest = {
    schemaVersion: 2,
    course: { name: originalModule, term: originalTerm, week: 0 },
    bank: { id: bankId, title: `${module} saved source`, discipline: module },
    source: { filename: sourceName, sourceWeekDeclared: false },
    questionsFile: "questions.json", assetsDirectory: "assets",
  };
  const originalKey = moduleIdentity(originalModule);
  const selectedKey = moduleIdentity(module);
  for (const [index, saved] of questions.entries()) {
    const content = sourceQuestions[index];
    const scope = questionScope(manifest, content);
    const fields = legacyQuestionFields(manifest, content);
    if (saved.sourcePage !== fields.sourcePage || saved.questionNumber !== fields.questionNumber) {
      throw new Error(`Saved question ${index + 1} has a source page or number that differs from its verified content. Reopen its source review before sharing.`);
    }
    const originalIsUnfiled = originalKey === "unfiled" && originalTerm === 0;
    if ((content.bankId !== undefined && content.bankId !== bankId)
      || moduleIdentity(scope.course) !== originalKey || scope.term !== originalTerm
      || (!originalIsUnfiled && (originalKey !== selectedKey || originalTerm !== termNumber))
      || (saved.module && moduleIdentity(saved.module) !== selectedKey && moduleIdentity(saved.module) !== "unfiled")
      || fields.stem !== saved.stem || fields.correctKey !== saved.correctKey
      || fields.explanation !== saved.explanation
      || fields.options.length !== saved.options.length
      || fields.options.some((option, at) => option.key !== saved.options[at].key || option.text !== saved.options[at].text)) {
      throw new Error(`Saved question ${index + 1} differs from its reviewed source or confirmed course. Reopen its review before sharing.`);
    }
  }

  // A saved course's personal schedule is not evidence for a shared week.
  // Publish only the owner-confirmed term/module; later source-backed review
  // can assign community weeks without changing this local workspace.
  const sharedQuestions = sourceQuestions.map(question => ({ ...question, course: module, term: termNumber, week: 0 }));
  const sharedManifest: PackageManifest = {
    ...manifest,
    course: { name: module, term: termNumber, week: 0 },
    source: { filename: sourceName, sourceWeekDeclared: false },
  };
  const pkg: ImportPackage = { manifest: sharedManifest, questions: sharedQuestions };
  const declaredAssets = sourceQuestions.flatMap(question => question.assets.map(asset => ({ name: asset.filename })));
  const assessment = assessBank(pkg, [], declaredAssets);
  if (assessment.counts.ready !== sourceQuestions.length || assessment.counts["needs-review"] || assessment.counts.unresolved)
    throw new Error("This saved source has questions still awaiting answer or media review. Resolve them before sharing.");

  const original = await readSourceOriginal(document.id, document.checksum);
  assertCurrent();
  if (!original || original.size !== originalIdentity.byteSize || original.type !== originalIdentity.mimeType)
    throw new Error("The original source file is missing or changed on this device. Restore or re-import it before sharing.");
  const originalBytes = new Uint8Array(await original.arrayBuffer());
  assertCurrent();
  if (await sha256(originalBytes) !== `sha256:${sourceHash}`)
    throw new Error("The stored original no longer matches the source review. Re-import it before sharing.");

  const assetBytes = new Map<string, Uint8Array>();
  const assetChecksums = new Map<string, string>();
  for (const [index, saved] of questions.entries()) {
    for (const asset of sourceQuestions[index].assets) {
      if (asset.questionId !== sourceQuestions[index].id || !/^[a-f0-9]{64}$/.test(hash(asset.checksum ?? ""))
        || !asset.filename || basename(asset.filename) !== asset.filename) {
        throw new Error(`Saved question ${index + 1} has a figure without exact source identity.`);
      }
      const questionPage = sourceQuestions[index].source.page;
      const isQuestionFigure = ["question", "stem", "choice"].includes(asset.role);
      if (asset.sourceFile !== sourceName
        || (asset.sourcePage !== undefined && (!Number.isSafeInteger(asset.sourcePage) || asset.sourcePage < 1))
        || (extension === "pdf" && asset.sourcePage === undefined)
        || (isQuestionFigure && questionPage !== undefined && asset.sourcePage !== questionPage)) {
        throw new Error(`Saved question ${index + 1} has a figure whose source filename or page does not match its verified source. Review the exact figure before sharing.`);
      }
      const attachment = saved.attachments?.find(item => item.assetId === asset.id);
      if (!attachment || attachment.mimeType !== asset.mimeType)
        throw new Error(`Saved question ${index + 1} is missing a source figure on this device.`);
      const record = await getQuestionAttachmentBlob(attachment.blobKey);
      assertCurrent();
      if (!record || record.mimeType !== asset.mimeType || record.byteSize !== attachment.byteSize)
        throw new Error(`Saved question ${index + 1} has a missing or changed source figure.`);
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      assertCurrent();
      if (await sha256(bytes) !== asset.checksum)
        throw new Error(`Saved question ${index + 1} has a source figure that differs from its reviewed checksum.`);
      const key = asset.filename.normalize("NFC").toLowerCase();
      const prior = assetChecksums.get(key);
      if (prior && prior !== asset.checksum)
        throw new Error("Two different source figures share a filename. Resolve that collision before sharing.");
      assetChecksums.set(key, asset.checksum!);
      assetBytes.set(asset.filename, bytes);
    }
  }

  const bank: PreparedBank = {
    pkg, issues: [],
    sourceText: { rawText: "" },
    sourceBytes: document.sizeBytes, notes: [],
    reviewedFiling: { term: classification.term, module, evidence: "human-reviewed", weekAssignment: "unassigned" },
  };
  const bankPath = `banks/${sourceHash}/bank.json`;
  const originalPath = `sources/${sourceHash}.${extension}`;
  const stored = new Map<string, Uint8Array>([
    [bankPath, encode(bank)], [originalPath, originalBytes],
  ]);
  for (const [name, bytes] of assetBytes) stored.set(`banks/${sourceHash}/assets/${name}`, bytes);
  const bankHash = hash(await sha256(stored.get(bankPath)!));
  const catalog: PrivateLibraryCatalog = {
    format: "axom-private-library", schemaVersion: 1,
    id: `saved-${sourceHash.slice(0, 24)}`, version: `saved-v1-${bankHash.slice(0, 16)}`,
    templates: [],
    sources: [{
      id: `saved-source-${sourceHash}`, name: sourceName, sourcePath: sourceName,
      checksum: sourceHash, module, status: "prepared",
      reason: "Source-backed saved questions reviewed by the owner.",
      bankFile: bankPath, originalFile: originalPath,
      ready: sourceQuestions.length, review: 0,
    }],
  };
  stored.set("catalog.json", encode(catalog));
  const reader: LibraryReader = async path => {
    const bytes = stored.get(path);
    if (!bytes) throw new Error("A source-backed saved course is missing a required file.");
    return bytes.slice();
  };
  const upload = await prepareAcademicUpload(reader, { term: classification.term, module, evidence: "human-reviewed" });
  assertCurrent();
  if (upload.metadata.ready_questions !== sourceQuestions.length || upload.metadata.review_questions !== 0)
    throw new Error("The saved course's verified question count changed during preparation.");
  return upload;
}
