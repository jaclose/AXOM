/** A private, fail-closed bridge from explicit owner review to a shareable candidate. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile,
  type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { assessBank } from "../src/lib/question-content/assessBank";
import { blocksToPlainText, type QuestionBlock } from "../src/lib/question-content/blocks";
import { readImageInfo, SHOWABLE_IMAGE_TYPES } from "../src/lib/question-content/assets";
import type { PackageQuestion, QuestionAsset } from "../src/lib/question-content/package";
import { hasQuestionExplanation } from "../src/lib/academicLibrary/explanationReview";
import { assertCompleteAcademicGif, MAX_ACADEMIC_IMAGE_PIXELS } from "../src/lib/academicLibrary/gifIntegrity";
import { MAX_QUESTION_ATTACHMENT_BYTES } from "../src/lib/questionAttachmentLimits";
import { planPublication, readPublicationInventory } from "../src/lib/academicLibrary/publication";
import { readCatalog, readPreparedBank, safeLibraryPath } from "../src/lib/privateLibrary/install";
import type { PreparedBank, PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";

const FORMAT = "axom-approved-question-decisions";
const HEX = /^[a-f0-9]{64}$/;
const unsafeName = /[\\/]|^\.{1,2}$|^[a-zA-Z]:/;
type Status = "pending" | "held" | "approved";

export interface ApprovalRecord {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  questionId: string;
  questionSha256: string;
  answerSha256: string;
  explanationSha256: string;
  status: Status;
  sourceChecked: boolean;
  filingChecked: boolean;
  weekChecked: boolean;
  weekEvidence: string;
  clinicalChecked: boolean;
  explanationChecked: boolean;
  assetContentChecked: boolean;
  rightsStatus: "pending" | "cleared";
  rightsEvidence: string;
  reviewer: string;
  reviewedAt: string;
}

export interface ApprovalDecisions {
  format: typeof FORMAT;
  schemaVersion: 1;
  catalogSha256: string;
  blockedSourcesReceiptSha256?: string;
  records: ApprovalRecord[];
}

interface BlockedSource {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  catalogName: string;
  bankSourceName: string;
  reason: string;
}

interface UnreviewableSource {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  status: PrivateLibraryCatalog["sources"][number]["status"];
  catalogDeclared: number;
  rawQuestionRows: number;
  parsedQuestionRows: number;
  preexistingUnreadable: number;
  declaredBeyondRaw: number;
  filteredOnReadback: number;
}

interface BlockedSourcesReceipt {
  format: "axom-approved-template-blockers";
  schemaVersion: 2;
  catalogSha256: string;
  blockedSources: BlockedSource[];
  unreviewableSources: UnreviewableSource[];
  totals: { catalogDeclared: number; identityBlockedDeclared: number; pendingQuestionRows: number;
    declaredBeyondRaw: number; filteredOnReadback: number };
}

function fail(message: string): never { throw new Error(message); }
function sha(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hashValue(value: unknown): string { return sha(JSON.stringify(canonical(value))); }
export function questionApprovalHashes(question: PackageQuestion) {
  return {
    questionSha256: hashValue(question),
    answerSha256: hashValue(question.correctAnswer ?? null),
    explanationSha256: hashValue({ explanation: question.explanation ?? null, teaching: question.teaching ?? null }),
  };
}

function safeName(name: string): string {
  if (!name || unsafeName.test(name) || name.includes("\0") || basename(name) !== name) fail("A source or figure name contains a local path.");
  return name;
}
async function assertOutsideRepo(path: string): Promise<string> {
  const requested = resolve(path);
  const target = join(await realpath(dirname(requested)), basename(requested));
  let parent = dirname(target);
  while (true) {
    try { await lstat(join(parent, ".git")); fail("Private review output must be outside every repository."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  if (/(?:^|\/)(?:public|dist)(?:\/|$)/i.test(target)) fail("Private review output cannot be inside public assets.");
  return target;
}
async function privateRoot(path: string) {
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) fail("Prepared library is not a folder.");
  try { await lstat(join(root, ".git")); fail("Prepared library must be outside every repository."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await assertOutsideRepo(join(root, "catalog.json"));
  return root;
}
async function inside(root: string, path: string): Promise<string> {
  const resolved = await realpath(resolve(root, safeLibraryPath(path)));
  if (resolved === root || !resolved.startsWith(`${root}${sep}`)) fail("A prepared library path escapes its folder.");
  return resolved;
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function readDecisions(value: unknown): ApprovalDecisions {
  const file = value as ApprovalDecisions | undefined;
  if ((file as { format?: string } | undefined)?.format === "axom-private-inline-rationale-decisions")
    fail("The 17-question offline review export binds original unanswered questions. Apply its source answers in a separately verified private candidate before creating approval decisions.");
  if (!file || file.format !== FORMAT || file.schemaVersion !== 1 || !HEX.test(file.catalogSha256) || !Array.isArray(file.records))
    fail("This is not an AXOM approved-question decision file.");
  if (file.blockedSourcesReceiptSha256 !== undefined && !HEX.test(file.blockedSourcesReceiptSha256))
    fail("The blocked-source receipt fingerprint is invalid.");
  const seen = new Set<string>();
  for (const row of file.records) {
    if (!row || ![row.sourceId, row.questionId, row.reviewer, row.rightsEvidence, row.weekEvidence].every(v => typeof v === "string")
      || ![row.sourceChecksum, row.bankSha256, row.questionSha256, row.answerSha256, row.explanationSha256].every(v => typeof v === "string" && HEX.test(v))
      || !["pending", "held", "approved"].includes(row.status)
      || ![row.sourceChecked, row.filingChecked, row.weekChecked, row.clinicalChecked, row.explanationChecked, row.assetContentChecked].every(v => typeof v === "boolean")
      || !["pending", "cleared"].includes(row.rightsStatus) || typeof row.reviewedAt !== "string")
      fail("A decision row has invalid identity or review fields.");
    const key = `${row.sourceId}\u0000${row.questionId}`;
    if (seen.has(key)) fail("The same question has more than one review decision.");
    seen.add(key);
    if (row.status === "approved" && (!row.sourceChecked || !row.filingChecked || !row.clinicalChecked || !row.explanationChecked
      || row.rightsStatus !== "cleared" || row.rightsEvidence.trim().length < 8 || !row.reviewer.trim()
      || !Number.isFinite(Date.parse(row.reviewedAt)))) fail("An approved row lacks source, clinical, explanation, or rights review evidence.");
  }
  return file;
}
class SourceIdentityMismatch extends Error {}
function sourceIdentityFail(message: string): never { throw new SourceIdentityMismatch(message); }
function sourceName(name: string): string {
  try { return safeName(name); }
  catch (error) { sourceIdentityFail((error as Error).message); }
}
function assertSourceIdentity(source: PrivateLibraryCatalog["sources"][number], bank: PreparedBank) {
  if (sourceName(bank.pkg.manifest.source.filename) !== sourceName(source.name)) sourceIdentityFail("A bank names a different catalog source file.");
  for (const question of bank.pkg.questions) {
    if (question.provenance.sourceChecksum !== `sha256:${source.checksum}`) sourceIdentityFail("A question does not match its catalog source checksum.");
    if (sourceName(question.source.filename) !== bank.pkg.manifest.source.filename) sourceIdentityFail("A question names a different source file.");
    for (const asset of question.assets) {
      sourceName(asset.filename);
      if (asset.sourceFile && sourceName(asset.sourceFile) !== bank.pkg.manifest.source.filename) sourceIdentityFail("A figure names a different source file.");
    }
  }
}
function substantiveExplanation(question: PackageQuestion): boolean {
  if (!hasQuestionExplanation(question)) return false;
  const source = blocksToPlainText(question.explanation ?? []);
  const teaching = question.teaching?.factCheck.humanReviewerApproved ? question.teaching.whyCorrect : "";
  const text = `${source} ${teaching}`.trim();
  return text.length >= 35 && (text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 6;
}
const localPath = /file:\/\/|(?:^|[^\p{L}\p{N}._/\\])(?:\/[^\s/\\]+\/[^\s/\\]+|[a-z]:[\\/]|\\\\|(?:\.{1,2}[\\/])+[^\s/\\]+|~[\\/][^\s/\\]+)/iu;
function visiblePathText(value: string): string {
  return value.replace(/&#(?:x3a|58);?|&colon;|%3a/gi, ":")
    .replace(/&#(?:x2f|47);?|&sol;|%2f/gi, "/")
    .replace(/&#(?:x5c|92);?|&bsol;|%5c/gi, "\\");
}
function memberMetadata(field: string, value: string | undefined): void {
  if (value && localPath.test(visiblePathText(value))) fail(`A member-visible ${field} contains a local path.`);
}
function memberContent(field: string, value: unknown): void {
  if (typeof value === "string") memberMetadata(field, value);
  else if (Array.isArray(value)) value.forEach((item, index) => memberContent(`${field}[${index}]`, item));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) memberContent(`${field}.${key}`, item);
  }
}
function blockMetadata(blocks: readonly QuestionBlock[]): void {
  for (const block of blocks) {
    if (block.type === "image") {
      memberMetadata("image asset ID", block.assetId);
      memberMetadata("image alt", block.alt);
      memberMetadata("image caption", block.caption);
    } else if (block.type === "table") {
      memberMetadata("table image asset ID", block.sourceImageAssetId);
      memberMetadata("table caption", block.caption);
      for (const key of block.rowKeys ?? []) memberMetadata("table row key", key);
    }
  }
}
function assertMemberMetadata(source: PrivateLibraryCatalog["sources"][number], bank: PreparedBank): void {
  memberMetadata("source ID", source.id);
  memberMetadata("module", source.module);
  const { manifest, questions } = bank.pkg;
  memberMetadata("course name", manifest.course.name);
  for (const [field, value] of Object.entries({
    "bank ID": manifest.bank.id, "bank title": manifest.bank.title,
    "bank discipline": manifest.bank.discipline, "bank topic": manifest.bank.topic,
    "source institution": manifest.source.institution, "source title": manifest.source.declaredTitle,
    "source term": manifest.source.declaredTerm, "reviewed module": bank.reviewedFiling?.module,
  })) memberMetadata(field, value);
  for (const question of questions) {
    blockMetadata(question.stem);
    for (const choice of question.choices) blockMetadata(choice.blocks);
    blockMetadata(question.explanation ?? []);
    if (question.choiceTable) blockMetadata([question.choiceTable]);
    for (const [field, value] of Object.entries({
      "question ID": question.id, "question course": question.course, "question bank ID": question.bankId,
      "question discipline": question.discipline, "question topic": question.topic,
      "question subtopic": question.subtopic, "source set title": question.source.setTitle,
      "question creation time": question.provenance.createdAt,
      "teaching concept": question.teaching?.concept, "teaching reviewer": question.teaching?.factCheck.checkedBy,
      "teaching review time": question.teaching?.factCheck.checkedOn,
      "teaching answer source": question.teaching?.factCheck.answerKeyEvidence?.sourceId,
      "teaching answer method": question.teaching?.factCheck.answerKeyEvidence?.method,
      "teaching printed answer": question.teaching?.factCheck.answerKeyEvidence?.printedAnswer,
      "teaching answer label": question.teaching?.answerLabel,
    })) memberMetadata(field, value);
    for (const choice of question.choices) {
      memberMetadata("choice ID", choice.id);
      memberMetadata("choice label", choice.label);
    }
    for (const asset of question.assets) {
      memberMetadata("figure ID", asset.id);
      memberMetadata("figure type", asset.mimeType);
      memberMetadata("figure question ID", asset.questionId);
      memberMetadata("figure reference", asset.revealOf);
    }
    for (const limitation of question.teaching?.factCheck.limitations ?? []) memberMetadata("teaching limitation", limitation);
    for (const distractor of question.teaching?.distractors ?? []) memberMetadata("teaching distractor label", distractor.label);
    for (const reference of question.teaching?.sourceReferences ?? []) {
      memberMetadata("teaching source ID", reference.sourceId);
      memberMetadata("teaching source purpose", reference.purpose);
      memberMetadata("teaching document ID", reference.documentId);
    }
    for (const excerpt of question.teaching?.factCheck.supportingExcerpts ?? []) {
      memberMetadata("teaching excerpt source", excerpt.sourceId);
      memberMetadata("teaching inspection", excerpt.inspection);
    }
    // The approved question is the member-facing payload. Inspect every nested
    // string so new block or teaching fields cannot bypass the path gate.
    memberContent("question", question);
  }
}
function assertApprovedImageBytes(asset: QuestionAsset, bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > MAX_QUESTION_ATTACHMENT_BYTES) fail("An approved figure exceeds AXOM's per-image limit.");
  const image = readImageInfo(bytes);
  if (!image || image.mimeType !== asset.mimeType || !SHOWABLE_IMAGE_TYPES.has(image.mimeType)
    || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || !image.width || !image.height || image.width * image.height > MAX_ACADEMIC_IMAGE_PIXELS
    || asset.byteSize !== undefined && asset.byteSize !== bytes.length
    || asset.width !== undefined && asset.width !== image.width
    || asset.height !== undefined && asset.height !== image.height)
    fail("An approved figure is not the declared, supported image bytes.");
  if (Buffer.from(bytes).includes("%PDF-")) fail("An approved figure contains PDF source bytes.");
  if (image.mimeType === "image/gif") assertCompleteAcademicGif(bytes);
  if (image.mimeType === "image/png") {
    if (bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a)
      fail("An approved PNG has an invalid image signature.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 8;
    let first = true;
    let hasImageData = false;
    let ended = false;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      const next = at + 12 + length;
      if (next > bytes.length || first && (type !== "IHDR" || length !== 13)) break;
      if (type === "IDAT") hasImageData = true;
      if (type === "IEND") {
        ended = length === 0 && next === bytes.length;
        break;
      }
      first = false;
      at = next;
    }
    if (!hasImageData || !ended) fail("An approved PNG has incomplete image structure or trailing bytes.");
  }
  if (image.mimeType === "image/jpeg" && (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9))
    fail("An approved JPEG has incomplete image structure or trailing bytes.");
  if (image.mimeType === "image/webp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length)
      fail("An approved WebP has incomplete image structure or trailing bytes.");
    let at = 12;
    while (at + 8 <= bytes.length) {
      const length = view.getUint32(at + 4, true);
      at += 8 + length + (length & 1);
      if (at > bytes.length) break;
    }
    if (at !== bytes.length) fail("An approved WebP has incomplete image structure or trailing bytes.");
  }
}
function safeApprovedQuestion(question: PackageQuestion, row: ApprovalRecord): PackageQuestion {
  if (!substantiveExplanation(question)) fail("An approved question lacks a substantive source or reviewed AXOM explanation.");
  if (question.assets.length && !row.assetContentChecked) fail("A question with figures lacks asset-content review.");
  if (question.assets.some(asset => ["source_page", "reference", "answer_reveal"].includes(asset.role) || asset.derivation === "page-render"))
    fail("A question includes a source or answer page that could expose held material. Review and crop it into an approved figure first.");
  const clean = structuredClone(question);
  delete clean.flags;
  delete clean.provenance.notes;
  delete clean.provenance.tool;
  return clean;
}
function verifyRecord(row: ApprovalRecord, source: PrivateLibraryCatalog["sources"][number], bankHash: string, question: PackageQuestion) {
  const hashes = questionApprovalHashes(question);
  if (row.sourceChecksum !== source.checksum || row.bankSha256 !== bankHash || row.questionId !== question.id
    || row.questionSha256 !== hashes.questionSha256 || row.answerSha256 !== hashes.answerSha256
    || row.explanationSha256 !== hashes.explanationSha256) fail("A review decision no longer matches the exact source, bank, answer, or explanation.");
}

function canonicalBankSources(catalog: PrivateLibraryCatalog): Map<string, PrivateLibraryCatalog["sources"][number]> {
  const byId = new Map<string, PrivateLibraryCatalog["sources"][number]>();
  const checksums = new Set<string>();
  for (const source of catalog.sources) {
    if (!source.bankFile || source.duplicateOf || !["prepared", "review-required"].includes(source.status)) continue;
    if (byId.has(source.id)) fail("Prepared library has duplicate active source IDs.");
    if (checksums.has(source.checksum)) fail("Prepared library has duplicate active source checksums.");
    byId.set(source.id, source);
    checksums.add(source.checksum);
  }
  return byId;
}

function readBlockedSourcesReceipt(value: unknown): BlockedSourcesReceipt {
  const receipt = value as BlockedSourcesReceipt | undefined;
  if (!receipt || receipt.format !== "axom-approved-template-blockers" || receipt.schemaVersion !== 2
    || !HEX.test(receipt.catalogSha256) || !Array.isArray(receipt.blockedSources)
    || !Array.isArray(receipt.unreviewableSources)
    || !receipt.blockedSources.length && !receipt.unreviewableSources.length
    || !receipt.totals || !Object.values(receipt.totals).every(value => Number.isSafeInteger(value) && value >= 0))
    fail("The blocked-source receipt is invalid.");
  const seen = new Set<string>();
  for (const item of receipt.blockedSources) {
    if (!item || ![item.sourceId, item.catalogName, item.bankSourceName, item.reason].every(value => typeof value === "string" && value.length > 0)
      || ![item.sourceChecksum, item.bankSha256].every(value => typeof value === "string" && HEX.test(value))
      || seen.has(item.sourceId)) fail("The blocked-source receipt has an invalid source identity.");
    seen.add(item.sourceId);
  }
  for (const item of receipt.unreviewableSources) {
    if (!item || !item.sourceId || !HEX.test(item.sourceChecksum) || !HEX.test(item.bankSha256)
      || ![item.catalogDeclared, item.rawQuestionRows, item.parsedQuestionRows, item.preexistingUnreadable,
        item.declaredBeyondRaw, item.filteredOnReadback].every(value => Number.isSafeInteger(value) && value >= 0)
      || item.catalogDeclared - item.rawQuestionRows !== item.declaredBeyondRaw
      || item.rawQuestionRows - item.parsedQuestionRows !== item.filteredOnReadback
      || seen.has(item.sourceId)) fail("The blocked-source receipt has invalid unreviewable counts.");
    seen.add(item.sourceId);
  }
  if (receipt.totals.catalogDeclared !== receipt.totals.identityBlockedDeclared + receipt.totals.pendingQuestionRows
    + receipt.totals.declaredBeyondRaw + receipt.totals.filteredOnReadback)
    fail("The blocked-source receipt does not reconcile its question counts.");
  if (receipt.totals.declaredBeyondRaw !== receipt.unreviewableSources.reduce((count, item) => count + item.declaredBeyondRaw, 0)
    || receipt.totals.filteredOnReadback !== receipt.unreviewableSources.reduce((count, item) => count + item.filteredOnReadback, 0))
    fail("The blocked-source receipt has inconsistent unreviewable totals.");
  return receipt;
}

async function unlinkIfSameFile(path: string, created: { dev: number; ino: number }) {
  try {
    const current = await lstat(path);
    if (current.dev === created.dev && current.ino === created.ino) await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function writeFreshPrivateFile(path: string, contents: string,
  writer: (file: FileHandle, value: string) => Promise<void> = (file, value) => file.writeFile(value)) {
  const file = await open(path, "wx", 0o600);
  const created = await file.stat();
  try { await writer(file, contents); await file.close(); return created; }
  catch (error) {
    await file.close().catch(() => undefined);
    await unlinkIfSameFile(path, created);
    throw error;
  }
}

/** Generate a metadata-only, all-pending template. A person must inspect sources before approval. */
export async function createApprovalTemplate(preparedRoot: string, destination: string,
  options: { writeBlockedReceipt?: (file: FileHandle, value: string) => Promise<void> } = {}): Promise<{
  records: number; blockedSources: number; unreviewableRows: number; blockedReceiptPath?: string }> {
  const root = await privateRoot(preparedRoot);
  const target = await assertOutsideRepo(destination);
  if (target === root || target.startsWith(`${root}${sep}`)) fail("Review decisions must be outside the prepared library.");
  const blockedReceiptPath = `${target}.blocked-sources.json`;
  for (const path of [target, blockedReceiptPath]) {
    try { await lstat(path); fail("A review template or blocker receipt already exists."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const catalogBytes = await readFile(await inside(root, "catalog.json"));
  const catalog = readCatalog(JSON.parse(catalogBytes.toString("utf8")));
  const sources = canonicalBankSources(catalog);
  const active = new Set(sources.values());
  if (catalog.sources.some(source => !active.has(source) && source.ready + source.review > 0))
    fail("A non-bank or duplicate-linked source claims question rows. Reconcile the catalog before review.");
  const records: ApprovalRecord[] = [];
  const blockedSources: BlockedSource[] = [];
  const unreviewableSources: UnreviewableSource[] = [];
  let identityBlockedDeclared = 0;
  for (const source of sources.values()) {
    if (!source.bankFile) fail("A canonical source lacks a bank.");
    const bankBytes = await readFile(await inside(root, source.bankFile));
    const bankSha256 = sha(bankBytes);
    const rawBank = JSON.parse(bankBytes.toString("utf8")) as PreparedBank;
    const rawQuestionRows = rawBank.pkg?.questions?.length ?? 0;
    const preexistingUnreadable = rawBank.unreadableQuestions ?? 0;
    if (!Number.isSafeInteger(preexistingUnreadable) || preexistingUnreadable < 0
      || source.ready + source.review < rawQuestionRows)
      fail("A prepared bank has inconsistent question counts. Reconcile it before review.");
    const bank = readPreparedBank(rawBank);
    const parsedQuestionRows = bank.pkg.questions.length;
    try { assertSourceIdentity(source, bank); }
    catch (error) {
      if (!(error instanceof SourceIdentityMismatch)) throw error;
      blockedSources.push({ sourceId: source.id, sourceChecksum: source.checksum, bankSha256,
        catalogName: source.name, bankSourceName: bank.pkg.manifest.source.filename, reason: error.message });
      identityBlockedDeclared += source.ready + source.review;
      continue;
    }
    const declaredBeyondRaw = source.ready + source.review - rawQuestionRows;
    const filteredOnReadback = rawQuestionRows - parsedQuestionRows;
    if (declaredBeyondRaw || filteredOnReadback) unreviewableSources.push({ sourceId: source.id,
      sourceChecksum: source.checksum, bankSha256, status: source.status,
      catalogDeclared: source.ready + source.review, rawQuestionRows, parsedQuestionRows,
      preexistingUnreadable, declaredBeyondRaw, filteredOnReadback });
    for (const question of bank.pkg.questions) records.push({ sourceId: source.id, sourceChecksum: source.checksum,
      bankSha256, questionId: question.id, ...questionApprovalHashes(question), status: "pending",
      sourceChecked: false, filingChecked: false, weekChecked: false, weekEvidence: "",
      clinicalChecked: false, explanationChecked: false, assetContentChecked: false,
      rightsStatus: "pending", rightsEvidence: "", reviewer: "", reviewedAt: "" });
  }
  records.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.questionId.localeCompare(b.questionId));
  const catalogSha256 = sha(catalogBytes);
  const totals: BlockedSourcesReceipt["totals"] = {
    catalogDeclared: [...sources.values()].reduce((count, source) => count + source.ready + source.review, 0),
    identityBlockedDeclared, pendingQuestionRows: records.length,
    declaredBeyondRaw: unreviewableSources.reduce((count, source) => count + source.declaredBeyondRaw, 0),
    filteredOnReadback: unreviewableSources.reduce((count, source) => count + source.filteredOnReadback, 0),
  };
  if (totals.catalogDeclared !== totals.identityBlockedDeclared + totals.pendingQuestionRows
    + totals.declaredBeyondRaw + totals.filteredOnReadback)
    fail("The review template did not account for every declared question row.");
  let blockedSourcesReceiptSha256: string | undefined;
  let receiptBytes: string | undefined;
  if (blockedSources.length || unreviewableSources.length) {
    const receipt: BlockedSourcesReceipt = { format: "axom-approved-template-blockers", schemaVersion: 2,
      catalogSha256, blockedSources, unreviewableSources, totals };
    receiptBytes = JSON.stringify(receipt, null, 2);
    blockedSourcesReceiptSha256 = sha(receiptBytes);
  }
  const value: ApprovalDecisions = { format: FORMAT, schemaVersion: 1, catalogSha256,
    ...(blockedSourcesReceiptSha256 ? { blockedSourcesReceiptSha256 } : {}), records };
  const writtenTemplate = await writeFreshPrivateFile(target, JSON.stringify(value, null, 2));
  try { if (receiptBytes) await writeFreshPrivateFile(blockedReceiptPath, receiptBytes, options.writeBlockedReceipt); }
  catch (error) { await unlinkIfSameFile(target, writtenTemplate); throw error; }
  return { records: records.length, blockedSources: blockedSources.length,
    unreviewableRows: totals.declaredBeyondRaw + totals.filteredOnReadback,
    ...(receiptBytes ? { blockedReceiptPath } : {}) };
}

/** Never mutates the prepared library. The output contains approved question rows only. */
export async function createApprovedOnlyLibrary(preparedRoot: string, decisionsFile: string, destination: string,
  options: { writePrivateReceipt?: (path: string, contents: string) => Promise<void> } = {}) {
  const root = await privateRoot(preparedRoot);
  const target = await assertOutsideRepo(destination);
  await assertOutsideRepo(decisionsFile);
  if (target === root || target.startsWith(`${root}${sep}`) || root.startsWith(`${target}${sep}`)) fail("Approved output must be separate from the prepared library.");
  try { await lstat(target); fail("Approved output already exists."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const catalogBytes = await readFile(await inside(root, "catalog.json"));
  const catalog = readCatalog(JSON.parse(catalogBytes.toString("utf8")));
  const decisionBytes = await readFile(decisionsFile);
  const decisions = readDecisions(JSON.parse(decisionBytes.toString("utf8")));
  if (sha(catalogBytes) !== decisions.catalogSha256) fail("The prepared library catalog changed since review.");
  const sourcesById = canonicalBankSources(catalog);
  if (decisions.blockedSourcesReceiptSha256) {
    const receiptBytes = await readFile(`${decisionsFile}.blocked-sources.json`);
    if (sha(receiptBytes) !== decisions.blockedSourcesReceiptSha256) fail("The blocked-source receipt changed since template creation.");
    const receipt = readBlockedSourcesReceipt(JSON.parse(receiptBytes.toString("utf8")));
    if (receipt.catalogSha256 !== decisions.catalogSha256) fail("The blocked-source receipt names a different catalog.");
    for (const item of receipt.blockedSources) {
      const source = sourcesById.get(item.sourceId);
      if (!source?.bankFile || source.checksum !== item.sourceChecksum
        || sha(await readFile(await inside(root, source.bankFile))) !== item.bankSha256)
        fail("A blocked source changed since template creation.");
      if (decisions.records.some(row => row.sourceId === item.sourceId))
        fail("A review decision names a source with unresolved source identity.");
    }
    for (const item of receipt.unreviewableSources) {
      const source = sourcesById.get(item.sourceId);
      if (!source?.bankFile || source.checksum !== item.sourceChecksum || source.status !== item.status
        || source.ready + source.review !== item.catalogDeclared)
        fail("An unreviewable source changed since template creation.");
      const bankBytes = await readFile(await inside(root, source.bankFile));
      const rawBank = JSON.parse(bankBytes.toString("utf8")) as PreparedBank;
      if (sha(bankBytes) !== item.bankSha256 || rawBank.pkg?.questions?.length !== item.rawQuestionRows
        || (rawBank.unreadableQuestions ?? 0) !== item.preexistingUnreadable
        || readPreparedBank(rawBank).pkg.questions.length !== item.parsedQuestionRows)
        fail("An unreviewable bank changed since template creation.");
    }
    if (receipt.totals.pendingQuestionRows !== decisions.records.length)
      fail("The review decisions no longer account for every pending question row.");
  }
  const approved = decisions.records.filter(row => row.status === "approved");
  if (!approved.length) fail("No explicitly approved questions are in this review file. Nothing was written.");
  const bySource = new Map<string, ApprovalRecord[]>();
  for (const row of decisions.records) bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), row]);
  const output: Array<{ row: PrivateLibraryCatalog["sources"][number]; bank: PreparedBank; assets: Array<{ path: string; source: string; checksum: string }> }> = [];
  const outputBankPaths = new Set<string>();
  const approvedIds = new Set<string>();
  const approvedContent = new Set<string>();
  for (const [id, rows] of bySource) {
    const source = sourcesById.get(id);
    if (!source?.bankFile) {
      if (catalog.sources.some(item => item.id === id && (item.status === "duplicate-linked" || item.duplicateOf)))
        fail("A review decision names a duplicate-linked source.");
      fail("A review decision names a source without a canonical bank.");
    }
    const bankBytes = await readFile(await inside(root, source.bankFile));
    const bankHash = sha(bankBytes);
    const bank = readPreparedBank(JSON.parse(bankBytes.toString("utf8")));
    assertSourceIdentity(source, bank);
    const questions = new Map(bank.pkg.questions.map(question => [question.id, question]));
    if (questions.size !== bank.pkg.questions.length) fail("A prepared bank has duplicate question IDs.");
    const selected: PackageQuestion[] = [];
    const assets = new Map<string, { path: string; source: string; checksum: string }>();
    const files: Array<{ name: string; size: number }> = [];
    for (const review of rows) {
      const question = questions.get(review.questionId);
      if (!question) fail("A review decision names a question that is absent from its source bank.");
      verifyRecord(review, source, bankHash, question);
      if (review.status !== "approved") continue;
      for (const asset of question.assets) {
        const path = `${dirname(source.bankFile)}/assets/${asset.filename}`;
        const sourceFile = await inside(root, path);
        const sourceSize = (await stat(sourceFile)).size;
        if (!sourceSize || sourceSize > MAX_QUESTION_ATTACHMENT_BYTES) fail("An approved figure exceeds AXOM's per-image limit.");
        if (asset.checksum !== `sha256:${await fileHash(sourceFile)}`) fail("An approved figure does not match its recorded checksum.");
        assertApprovedImageBytes(asset, await readFile(sourceFile));
        files.push({ name: asset.filename, size: sourceSize });
        if (assets.has(path) && assets.get(path)!.checksum !== asset.checksum) fail("Two approved figures claim different bytes at one path.");
        assets.set(path, { path: `banks/${source.checksum}/assets/${asset.filename}`, source: sourceFile, checksum: asset.checksum });
      }
      const cleanQuestion = safeApprovedQuestion(question, review);
      const contentHash = hashValue({ stem: cleanQuestion.stem,
        choices: cleanQuestion.choices.map(choice => ({ label: choice.label, blocks: choice.blocks })),
        choiceTable: cleanQuestion.choiceTable ?? null });
      if (approvedIds.has(cleanQuestion.id) || approvedContent.has(contentHash))
        fail("An approved question is repeated across source banks. Review the repeated appearance before publishing.");
      approvedIds.add(cleanQuestion.id);
      approvedContent.add(contentHash);
      selected.push(cleanQuestion);
    }
    if (!selected.length) continue;
    if (!source.originalFile || await fileHash(await inside(root, source.originalFile)) !== source.checksum)
      fail("An approved source original is missing or has changed.");
    const manifest = structuredClone(bank.pkg.manifest);
    manifest.course.week = 0;
    manifest.source.sourceWeekDeclared = false;
    delete manifest.source.axomAssignedWeek;
    manifest.questionsFile = "questions.json";
    manifest.assetsDirectory = "assets";
    for (const question of selected) question.week = 0;
    const slim: PreparedBank = { pkg: { manifest, questions: selected }, issues: [], sourceText: { rawText: "" },
      sourceBytes: 0, notes: [], ...(bank.reviewedFiling ? { reviewedFiling: bank.reviewedFiling } : {}) };
    assertMemberMetadata(source, slim);
    const original = assessBank(bank.pkg, bank.issues, files);
    if (selected.some(question => original.verdicts.get(question.id)?.readiness !== "ready"))
      fail("An approved question is held or unresolved in the original prepared bank.");
    const assessed = assessBank(slim.pkg, [], files);
    if (assessed.counts.ready !== selected.length || assessed.counts["needs-review"] || assessed.counts.unresolved)
      fail("An approved subset did not remain answer-ready after removing held material.");
    const checked = readPreparedBank(JSON.parse(JSON.stringify(slim)));
    if (checked.pkg.questions.length !== selected.length) fail("Approved bank failed package readback.");
    const outputBankPath = `banks/${source.checksum}/bank.json`;
    if (outputBankPaths.has(outputBankPath)) fail("Two approved sources would write the same public bank path.");
    outputBankPaths.add(outputBankPath);
    output.push({ row: { id: source.id, name: safeName(source.name), sourcePath: `approved/${source.checksum}`,
      checksum: source.checksum, ...(source.module ? { module: source.module } : {}), status: "prepared",
      reason: "Explicitly reviewed question subset. Original source retained privately.", bankFile: outputBankPath,
      ready: selected.length, review: 0 }, bank: slim, assets: [...assets.values()] });
  }
  if (!output.length) fail("No reviewed questions could be included. Nothing was written.");
  const version = sha(JSON.stringify([sha(catalogBytes), sha(decisionBytes), output.map(item => [item.row.id, item.row.ready])])).slice(0, 16);
  const publicCatalog: PrivateLibraryCatalog = { format: catalog.format, schemaVersion: 1, id: catalog.id,
    version, templates: [], sources: output.map(item => item.row) };
  readCatalog(publicCatalog);
  const temp = `${target}.pending-${process.pid}`;
  await mkdir(temp, { recursive: false, mode: 0o700 });
  const library = join(temp, "library");
  await mkdir(library, { recursive: false, mode: 0o700 });
  for (const item of output) {
    const bankPath = join(library, safeLibraryPath(item.row.bankFile!));
    await mkdir(dirname(bankPath), { recursive: true, mode: 0o700 });
    await writeFile(bankPath, JSON.stringify(item.bank), { flag: "wx", mode: 0o600 });
    for (const asset of item.assets) {
      const path = join(library, safeLibraryPath(asset.path));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await copyFile(asset.source, path);
      await chmod(path, 0o600);
      if (`sha256:${await fileHash(path)}` !== asset.checksum) fail("An approved figure failed byte-level output readback.");
    }
  }
  await writeFile(join(library, "catalog.json"), JSON.stringify(publicCatalog), { flag: "wx", mode: 0o600 });
  const written = await realpath(library);
  const inventory = await readPublicationInventory(async path => new Uint8Array(await readFile(await inside(written, path))));
  const plan = planPublication(inventory);
  if (plan.blocked.length || plan.excluded.length || !plan.courses.length
    || plan.courses.reduce((count, course) => count + course.ready, 0) !== output.reduce((count, item) => count + item.row.ready, 0))
    fail("The approved-only output does not form a complete publishable course plan.");
  const receipt = { format: "axom-approved-only-private-receipt", schemaVersion: 1, catalogSha256: sha(catalogBytes),
    decisionsSha256: sha(decisionBytes), outputCatalogSha256: await fileHash(join(library, "catalog.json")),
    approvedQuestions: output.reduce((count, item) => count + item.row.ready, 0), heldQuestionsIncluded: 0,
    sources: output.map(item => ({ sourceId: item.row.id, sourceChecksum: item.row.checksum, approved: item.row.ready })),
    reviewedEvidence: approved.map(row => ({ sourceId: row.sourceId, questionId: row.questionId,
      questionSha256: row.questionSha256, reviewer: row.reviewer, reviewedAt: row.reviewedAt,
      rightsEvidence: row.rightsEvidence, ...(row.weekChecked ? { weekEvidence: row.weekEvidence } : {}) })) };
  const receiptPath = join(temp, "private-receipt.json");
  const receiptContents = JSON.stringify(receipt, null, 2);
  if (options.writePrivateReceipt) await options.writePrivateReceipt(receiptPath, receiptContents);
  else await writeFile(receiptPath, receiptContents, { flag: "wx", mode: 0o600 });
  if (sha(await readFile(receiptPath)) !== sha(receiptContents)) fail("The private approval receipt failed byte-level readback.");
  await rename(temp, target);
  return { sources: output.length, ready: receipt.approvedQuestions, held: 0, version,
    libraryPath: join(target, "library"), privateReceiptPath: join(target, "private-receipt.json") };
}
