/** A private, fail-closed bridge from explicit owner review to a shareable candidate. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { assessBank } from "../src/lib/question-content/assessBank";
import { blocksToPlainText } from "../src/lib/question-content/blocks";
import type { PackageQuestion } from "../src/lib/question-content/package";
import { hasQuestionExplanation } from "../src/lib/academicLibrary/explanationReview";
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
  records: ApprovalRecord[];
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
  const target = resolve(path);
  let parent = await realpath(dirname(target));
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
function assertSourceIdentity(source: PrivateLibraryCatalog["sources"][number], bank: PreparedBank) {
  if (safeName(bank.pkg.manifest.source.filename) !== safeName(source.name)) fail("A bank names a different catalog source file.");
  for (const question of bank.pkg.questions) {
    if (question.provenance.sourceChecksum !== `sha256:${source.checksum}`) fail("A question does not match its catalog source checksum.");
    if (safeName(question.source.filename) !== bank.pkg.manifest.source.filename) fail("A question names a different source file.");
    for (const asset of question.assets) {
      safeName(asset.filename);
      if (asset.sourceFile && safeName(asset.sourceFile) !== bank.pkg.manifest.source.filename) fail("A figure names a different source file.");
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
function safeApprovedQuestion(question: PackageQuestion, row: ApprovalRecord): PackageQuestion {
  if (!substantiveExplanation(question)) fail("An approved question lacks a substantive source or reviewed AXOM explanation.");
  if (question.assets.length && !row.assetContentChecked) fail("A question with figures lacks asset-content review.");
  if (question.assets.some(asset => ["source_page", "reference", "answer_reveal"].includes(asset.role) || asset.derivation === "page-render"))
    fail("A question includes a source or answer page that could expose held material. Review and crop it into an approved figure first.");
  const clean = structuredClone(question);
  delete clean.flags;
  delete clean.provenance.notes;
  return clean;
}
function verifyRecord(row: ApprovalRecord, source: PrivateLibraryCatalog["sources"][number], bankHash: string, question: PackageQuestion) {
  const hashes = questionApprovalHashes(question);
  if (row.sourceChecksum !== source.checksum || row.bankSha256 !== bankHash || row.questionId !== question.id
    || row.questionSha256 !== hashes.questionSha256 || row.answerSha256 !== hashes.answerSha256
    || row.explanationSha256 !== hashes.explanationSha256) fail("A review decision no longer matches the exact source, bank, answer, or explanation.");
}

/** Generate a metadata-only, all-pending template. A person must inspect sources before approval. */
export async function createApprovalTemplate(preparedRoot: string, destination: string): Promise<{ records: number }> {
  const root = await privateRoot(preparedRoot);
  const target = await assertOutsideRepo(destination);
  if (target === root || target.startsWith(`${root}${sep}`)) fail("Review decisions must be outside the prepared library.");
  const catalogBytes = await readFile(await inside(root, "catalog.json"));
  const catalog = readCatalog(JSON.parse(catalogBytes.toString("utf8")));
  const records: ApprovalRecord[] = [];
  for (const source of catalog.sources) {
    if (!source.bankFile) continue;
    const bankBytes = await readFile(await inside(root, source.bankFile));
    const bank = readPreparedBank(JSON.parse(bankBytes.toString("utf8")));
    assertSourceIdentity(source, bank);
    for (const question of bank.pkg.questions) records.push({ sourceId: source.id, sourceChecksum: source.checksum,
      bankSha256: sha(bankBytes), questionId: question.id, ...questionApprovalHashes(question), status: "pending",
      sourceChecked: false, filingChecked: false, weekChecked: false, weekEvidence: "",
      clinicalChecked: false, explanationChecked: false, assetContentChecked: false,
      rightsStatus: "pending", rightsEvidence: "", reviewer: "", reviewedAt: "" });
  }
  records.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.questionId.localeCompare(b.questionId));
  const value: ApprovalDecisions = { format: FORMAT, schemaVersion: 1, catalogSha256: sha(catalogBytes), records };
  await writeFile(target, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  return { records: records.length };
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
  const approved = decisions.records.filter(row => row.status === "approved");
  if (!approved.length) fail("No explicitly approved questions are in this review file. Nothing was written.");
  const bySource = new Map<string, ApprovalRecord[]>();
  for (const row of decisions.records) bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), row]);
  const sourcesById = new Map(catalog.sources.map(source => [source.id, source]));
  if (sourcesById.size !== catalog.sources.length) fail("Prepared library has duplicate source IDs.");
  const output: Array<{ row: PrivateLibraryCatalog["sources"][number]; bank: PreparedBank; assets: Array<{ path: string; source: string; checksum: string }> }> = [];
  for (const [id, rows] of bySource) {
    const source = sourcesById.get(id);
    if (!source?.bankFile) fail("A review decision names a source without a bank.");
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
        if (asset.checksum !== `sha256:${await fileHash(sourceFile)}`) fail("An approved figure does not match its recorded checksum.");
        files.push({ name: asset.filename, size: (await stat(sourceFile)).size });
        if (assets.has(path) && assets.get(path)!.checksum !== asset.checksum) fail("Two approved figures claim different bytes at one path.");
        assets.set(path, { path, source: sourceFile, checksum: asset.checksum });
      }
      selected.push(safeApprovedQuestion(question, review));
    }
    if (!selected.length) continue;
    if (!source.originalFile || await fileHash(await inside(root, source.originalFile)) !== source.checksum)
      fail("An approved source original is missing or has changed.");
    const original = assessBank(bank.pkg, bank.issues, files);
    if (selected.some(question => original.verdicts.get(question.id)?.readiness !== "ready"))
      fail("An approved question is held or unresolved in the original prepared bank.");
    const manifest = structuredClone(bank.pkg.manifest);
    manifest.course.week = 0;
    manifest.source.sourceWeekDeclared = false;
    delete manifest.source.axomAssignedWeek;
    for (const question of selected) question.week = 0;
    const slim: PreparedBank = { pkg: { manifest, questions: selected }, issues: [], sourceText: { rawText: "" },
      sourceBytes: 0, notes: [], ...(bank.reviewedFiling ? { reviewedFiling: bank.reviewedFiling } : {}) };
    const assessed = assessBank(slim.pkg, [], files);
    if (assessed.counts.ready !== selected.length || assessed.counts["needs-review"] || assessed.counts.unresolved)
      fail("An approved subset did not remain answer-ready after removing held material.");
    const checked = readPreparedBank(JSON.parse(JSON.stringify(slim)));
    if (checked.pkg.questions.length !== selected.length) fail("Approved bank failed package readback.");
    output.push({ row: { id: source.id, name: safeName(source.name), sourcePath: `approved/${source.checksum}`,
      checksum: source.checksum, ...(source.module ? { module: source.module } : {}), status: "prepared",
      reason: "Explicitly reviewed question subset. Original source retained privately.", bankFile: source.bankFile,
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
