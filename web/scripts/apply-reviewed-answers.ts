/** Apply explicit human answer reviews to a new private library candidate. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assessBank } from "../src/lib/question-content/assessBank";
import { blocksToPlainText } from "../src/lib/question-content/blocks";
import type { PackageIssue, PackageQuestion } from "../src/lib/question-content/package";
import { withReviewedAnswer } from "../src/lib/question-content/readiness";
import { validatePackage } from "../src/lib/question-content/validate";
import { readCatalog, readPreparedBank, safeLibraryPath } from "../src/lib/privateLibrary/install";
import type { PreparedBank, PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";
import { createApprovalTemplate, questionApprovalHashes } from "./approved-only-library";

const FORMAT = "axom-reviewed-answer-decisions";
const HEX = /^[a-f0-9]{64}$/;
const localPath = /file:\/\/|(?:^|[^\p{L}\p{N}._/\\])(?:\/[^\s/\\]+\/[^\s/\\]+|[a-z]:[\\/]|\\\\)/iu;
const runFile = promisify(execFile);
type DecisionStatus = "pending" | "held" | "approved";
type ExplanationMode = "keep" | "replace" | "append";

export interface ReviewedAnswerRecord {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  questionId: string;
  questionSha256: string;
  answerSha256: string;
  explanationSha256: string;
  status: DecisionStatus;
  answerLabel: string;
  answerEvidenceSourcePage: number | null;
  answerEvidenceSourceLine: number | null;
  answerEvidenceNote: string;
  explanationMode: ExplanationMode;
  explanationText: string;
  explanationOrigin: "" | "source" | "axom";
  explanationSourcePage: number | null;
  explanationCitation: string;
  sourceChecked: boolean;
  filingChecked: boolean;
  clinicalChecked: boolean;
  explanationChecked: boolean;
  assetContentChecked: boolean;
  rightsStatus: "pending" | "cleared";
  rightsEvidence: string;
  reviewer: string;
  reviewedAt: string;
}

export interface ReviewedAnswerDecisions {
  format: typeof FORMAT;
  schemaVersion: 1;
  catalogSha256: string;
  records: ReviewedAnswerRecord[];
}

const fail = (message: string): never => { throw new Error(message); };
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

async function fileSha(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function outsideRepo(path: string): Promise<string> {
  const requested = resolve(path);
  const target = join(await realpath(dirname(requested)), basename(requested));
  let parent = dirname(target);
  while (true) {
    try { await lstat(join(parent, ".git")); fail("Private review files must stay outside every repository."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  if (/(?:^|\/)(?:public|dist)(?:\/|$)/i.test(target)) fail("Private review files cannot be in public assets.");
  return target;
}

async function privateRoot(path: string): Promise<string> {
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) fail("Prepared library is not a folder.");
  await outsideRepo(join(root, "catalog.json"));
  return root;
}

async function inside(root: string, path: string): Promise<string> {
  const resolved = await realpath(resolve(root, safeLibraryPath(path)));
  if (resolved === root || !resolved.startsWith(root + sep)) fail("A prepared library path escapes its folder.");
  return resolved;
}

async function assertRegularTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isFile()) return;
  if (!info.isDirectory()) fail("A prepared library contains a symbolic link or non-file entry.");
  for (const name of await readdir(path)) await assertRegularTree(join(path, name));
}

async function clonePrivateTree(root: string, library: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      // Node's forced clone is unimplemented on this Mac; BSD cp -c fails if cloning is unavailable.
      await assertRegularTree(root);
      await runFile("/bin/cp", ["-c", "-R", root, library]);
      await assertRegularTree(library);
    } else {
      await cp(root, library, { recursive: true, force: false, errorOnExist: true,
        mode: constants.COPYFILE_FICLONE, filter: async sourcePath => {
          const info = await lstat(sourcePath);
          if (!info.isDirectory() && !info.isFile())
            fail("A prepared library contains a symbolic link or non-file entry.");
          return true;
        } });
    }
  } catch (error) {
    throw new Error("Private copy-on-write clone failed; no reviewed candidate was written.", { cause: error });
  }
}

function assertUniqueBankPaths(catalog: PrivateLibraryCatalog): void {
  const seen = new Set<string>();
  for (const source of catalog.sources) {
    if (!source.bankFile) continue;
    const path = safeLibraryPath(source.bankFile);
    if (seen.has(path)) fail("Two catalog sources point to the same bank file.");
    seen.add(path);
  }
}

function substantive(text: string): boolean {
  return text.trim().length >= 35 && (text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 6;
}

function readDecisions(value: unknown): ReviewedAnswerDecisions {
  const file = value as ReviewedAnswerDecisions | undefined;
  if (!file || file.format !== FORMAT || file.schemaVersion !== 1
    || !HEX.test(file.catalogSha256) || !Array.isArray(file.records))
    fail("This is not an AXOM human-reviewed answer decision file.");
  const seen = new Set<string>();
  for (const row of file.records) {
    if (!row || ![row.sourceId, row.questionId, row.answerLabel, row.answerEvidenceNote, row.explanationText,
      row.explanationOrigin, row.explanationCitation, row.rightsEvidence, row.reviewer, row.reviewedAt]
      .every(value => typeof value === "string")
      || ![row.sourceChecksum, row.bankSha256, row.questionSha256, row.answerSha256, row.explanationSha256]
        .every(value => typeof value === "string" && HEX.test(value))
      || !["pending", "held", "approved"].includes(row.status)
      || !["keep", "replace", "append"].includes(row.explanationMode)
      || !["", "source", "axom"].includes(row.explanationOrigin)
      || !(row.answerEvidenceSourcePage === null || Number.isSafeInteger(row.answerEvidenceSourcePage))
      || !(row.answerEvidenceSourceLine === null || Number.isSafeInteger(row.answerEvidenceSourceLine))
      || !(row.explanationSourcePage === null || Number.isSafeInteger(row.explanationSourcePage))
      || ![row.sourceChecked, row.filingChecked, row.clinicalChecked, row.explanationChecked,
        row.assetContentChecked].every(value => typeof value === "boolean")
      || !["pending", "cleared"].includes(row.rightsStatus))
      fail("An answer decision has invalid identity or review fields.");
    const key = row.sourceId + "\u0000" + row.questionId;
    if (seen.has(key)) fail("The same question has more than one answer decision.");
    seen.add(key);
    if (row.status !== "approved") continue;
    if (!row.sourceChecked || !row.filingChecked || !row.clinicalChecked || !row.explanationChecked
      || row.rightsStatus !== "cleared" || row.rightsEvidence.trim().length < 8
      || !row.reviewer.trim() || !Number.isFinite(Date.parse(row.reviewedAt)))
      fail("An approved answer lacks source, clinical, explanation, filing, or rights review.");
    if (!/^[A-J]$/.test(row.answerLabel))
      fail("An approved answer must name one A–J choice.");
    if (row.answerEvidenceNote.trim().length < 8 || localPath.test(row.answerEvidenceNote)
      || row.answerEvidenceSourcePage !== null && row.answerEvidenceSourcePage < 1
      || row.answerEvidenceSourceLine !== null && (row.answerEvidenceSourceLine < 1
        || row.answerEvidenceSourcePage === null))
      fail("An approved answer needs inspectable source-key evidence.");
    if (row.explanationMode !== "keep") {
      if (!substantive(row.explanationText) || localPath.test(row.explanationText))
        fail("An approved explanation must be substantive and contain no local path.");
      if (row.explanationOrigin === "source") {
        if (!Number.isSafeInteger(row.explanationSourcePage) || (row.explanationSourcePage ?? 0) < 1)
          fail("A source rationale needs its inspected PDF page.");
      } else if (row.explanationOrigin === "axom") {
        if (row.explanationCitation.trim().length < 8 || localPath.test(row.explanationCitation))
          fail("An AXOM explanation needs a shareable medical citation.");
      } else fail("A new explanation needs its source or AXOM origin.");
    }
  }
  return file;
}

function assertSourceIdentity(source: PrivateLibraryCatalog["sources"][number], bank: PreparedBank): void {
  if (bank.pkg.manifest.source.filename !== source.name)
    fail("A bank names a different catalog source.");
  for (const question of bank.pkg.questions) {
    if (question.provenance.sourceChecksum !== "sha256:" + source.checksum
      || question.source.filename !== source.name)
      fail("A question does not match its catalog source.");
  }
}

async function availableAssets(root: string, bankFile: string, bank: PreparedBank) {
  const files: { name: string; size: number }[] = [];
  const names = new Set(bank.pkg.questions.flatMap(question => question.assets.map(asset => asset.filename)));
  for (const name of names) {
    const path = dirname(bankFile) + "/assets/" + name;
    let file: string;
    try { file = await inside(root, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const info = await stat(file);
    if (!info.isFile()) fail("A question asset is not a regular file.");
    files.push({ name, size: info.size });
  }
  return files;
}

/** Remove old generated validations so reassessment does not duplicate stale warnings. */
function conversionIssues(bank: PreparedBank, files: readonly { name: string; size: number }[]): PackageIssue[] {
  const generated = validatePackage(bank.pkg, {
    assetFiles: new Set(files.map(file => file.name)),
    assetFileSizes: new Map(files.map(file => [file.name, file.size])),
  });
  const remaining = new Map<string, number>();
  for (const issue of generated) {
    const key = JSON.stringify(issue);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return bank.issues.filter(issue => {
    const key = JSON.stringify(issue), count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

function applyRecord(question: PackageQuestion, row: ReviewedAnswerRecord): PackageQuestion {
  if (!question.choices.some(choice => choice.label === row.answerLabel))
    fail("A reviewed answer is absent from the exact question choices.");
  if (question.correctAnswer?.labels.length
    && (question.correctAnswer.labels.length !== 1 || question.correctAnswer.labels[0] !== row.answerLabel))
    fail("A reviewed answer conflicts with the stored key.");
  if (question.assets.length && !row.assetContentChecked)
    fail("A question with figures needs asset-content review.");
  const copy = structuredClone(question);
  if (row.answerEvidenceSourcePage !== null) {
    if (copy.source.answerEvidencePage !== undefined
      && copy.source.answerEvidencePage !== row.answerEvidenceSourcePage)
      fail("The reviewed answer evidence page conflicts with the stored source.");
    copy.source.answerEvidencePage = row.answerEvidenceSourcePage;
  }
  const preserveSourceEvidence = copy.correctAnswer?.labels.length === 1
    && copy.correctAnswer.labels[0] === row.answerLabel
    && ["printed-key", "source-mark-verified", "reviewer"].includes(copy.correctAnswer.evidence ?? "");
  const result = preserveSourceEvidence ? copy : withReviewedAnswer(copy, row.answerLabel);
  if (preserveSourceEvidence) {
    const kept = (result.flags ?? []).filter(flag => flag.type !== "answer_needs_review");
    if (kept.length) result.flags = kept;
    else delete result.flags;
  }
  if (row.explanationMode !== "keep") {
    const blocks = row.explanationMode === "append" ? [...(result.explanation ?? [])] : [];
    blocks.push({ type: "text", text: row.explanationText });
    if (row.explanationOrigin === "axom")
      blocks.push({ type: "text", text: "Reference: " + row.explanationCitation.trim() });
    result.explanation = blocks;
    if (row.explanationOrigin === "source")
      result.source.explanationSourcePage = row.explanationSourcePage!;
  }
  const fullExplanation = blocksToPlainText(result.explanation ?? []);
  if (!substantive(fullExplanation))
    fail("A reviewed question still lacks a substantive explanation.");
  if (localPath.test(fullExplanation) || localPath.test(JSON.stringify(result.explanation ?? [])))
    fail("A reviewed explanation still contains a local path.");
  const memberVisible = { course: result.course, discipline: result.discipline, topic: result.topic,
    subtopic: result.subtopic, stem: result.stem, choices: result.choices,
    choiceTable: result.choiceTable, explanation: result.explanation, teaching: result.teaching };
  if (localPath.test(JSON.stringify(memberVisible)))
    fail("A reviewed question still contains a member-visible local path.");
  return result;
}

function verifyRecord(row: ReviewedAnswerRecord, source: PrivateLibraryCatalog["sources"][number],
  bankSha256: string, question: PackageQuestion): void {
  const hashes = questionApprovalHashes(question);
  if (row.sourceChecksum !== source.checksum || row.bankSha256 !== bankSha256
    || row.questionId !== question.id || row.questionSha256 !== hashes.questionSha256
    || row.answerSha256 !== hashes.answerSha256 || row.explanationSha256 !== hashes.explanationSha256)
    fail("An answer decision no longer matches the exact source, bank, question, key, or explanation.");
}

/** A metadata-only template; a reviewer must supply every approved answer and rationale. */
export async function createReviewedAnswerTemplate(preparedRoot: string, destination: string,
  sourceChecksum?: string): Promise<{ records: number }> {
  const root = await privateRoot(preparedRoot), target = await outsideRepo(destination);
  if (target === root || target.startsWith(root + sep)) fail("Decisions must be outside the prepared library.");
  if (sourceChecksum !== undefined && !HEX.test(sourceChecksum)) fail("Source filter must be a SHA-256 checksum.");
  const catalogBytes = await readFile(await inside(root, "catalog.json"));
  const catalog = readCatalog(JSON.parse(catalogBytes.toString("utf8")));
  assertUniqueBankPaths(catalog);
  const records: ReviewedAnswerRecord[] = [];
  for (const source of catalog.sources) {
    if (!source.bankFile || sourceChecksum && source.checksum !== sourceChecksum) continue;
    const bankBytes = await readFile(await inside(root, source.bankFile));
    const bank = readPreparedBank(JSON.parse(bankBytes.toString("utf8")));
    assertSourceIdentity(source, bank);
    for (const question of bank.pkg.questions) {
      records.push({ sourceId: source.id, sourceChecksum: source.checksum, bankSha256: sha(bankBytes),
        questionId: question.id, ...questionApprovalHashes(question), status: "pending",
        answerLabel: "", answerEvidenceSourcePage: null, answerEvidenceSourceLine: null,
        answerEvidenceNote: "", explanationMode: "replace", explanationText: "", explanationOrigin: "",
        explanationSourcePage: null, explanationCitation: "", sourceChecked: false,
        filingChecked: false, clinicalChecked: false, explanationChecked: false,
        assetContentChecked: false, rightsStatus: "pending", rightsEvidence: "",
        reviewer: "", reviewedAt: "" });
    }
  }
  if (!records.length) fail("No questions matched the requested prepared source.");
  const value: ReviewedAnswerDecisions = { format: FORMAT, schemaVersion: 1,
    catalogSha256: sha(catalogBytes), records };
  await writeFile(target, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  return { records: records.length };
}

interface ChangedBank {
  bankFile: string;
  oldSha256: string;
  newBank: PreparedBank;
  sourceId: string;
  sourceChecksum: string;
  readyBefore: number;
  readyAfter: number;
  reviewed: Array<{
    questionId: string;
    beforeSha256: string;
    afterSha256: string;
    reviewer: string;
    reviewedAt: string;
    rightsEvidenceSha256: string;
    explanationCitationSha256: string;
    answerEvidenceSourcePage: number | null;
    answerEvidenceSourceLine: number | null;
    answerEvidenceNoteSha256: string;
  }>;
}

/** A private candidate with the same sources and filing; no proposal is an approval. */
export async function applyReviewedAnswers(preparedRoot: string, decisionsFile: string, destination: string) {
  const root = await privateRoot(preparedRoot);
  const decisionPath = await outsideRepo(decisionsFile);
  const target = await outsideRepo(destination);
  if (target === root || target.startsWith(root + sep) || root.startsWith(target + sep)
    || decisionPath === root || decisionPath.startsWith(root + sep)
    || decisionPath === target || decisionPath.startsWith(target + sep))
    fail("Reviewed output and decisions must be separate from the input library.");
  if (!(await lstat(decisionPath)).isFile()) fail("The answer decision input must be a regular file.");
  try { await lstat(target); fail("Reviewed output already exists."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const catalogBytes = await readFile(await inside(root, "catalog.json"));
  const catalog = readCatalog(JSON.parse(catalogBytes.toString("utf8")));
  assertUniqueBankPaths(catalog);
  const decisionBytes = await readFile(decisionPath);
  const decisions = readDecisions(JSON.parse(decisionBytes.toString("utf8")));
  if (sha(catalogBytes) !== decisions.catalogSha256)
    fail("The prepared catalog changed since answer review.");
  const approved = decisions.records.filter(row => row.status === "approved");
  if (!approved.length) fail("No human-approved answers were supplied. Nothing was written.");
  const sources = new Map(catalog.sources.map(source => [source.id, source]));
  if (sources.size !== catalog.sources.length) fail("The prepared catalog has duplicate source IDs.");
  const bySource = new Map<string, ReviewedAnswerRecord[]>();
  for (const row of decisions.records)
    bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), row]);

  const changes: ChangedBank[] = [];
  for (const [sourceId, rows] of bySource) {
    const source = sources.get(sourceId);
    if (!source?.bankFile) fail("An answer decision names a source without a bank.");
    const bankBytes = await readFile(await inside(root, source.bankFile));
    const oldSha256 = sha(bankBytes);
    const bank = readPreparedBank(JSON.parse(bankBytes.toString("utf8")));
    assertSourceIdentity(source, bank);
    const questions = new Map(bank.pkg.questions.map((question, index) => [question.id, index]));
    if (questions.size !== bank.pkg.questions.length) fail("The prepared bank has duplicate question IDs.");
    const files = await availableAssets(root, source.bankFile, bank);
    const before = assessBank(bank.pkg, bank.issues, files);
    const unreadable = bank.unreadableQuestions ?? 0;
    if (before.counts.ready !== source.ready
      || before.counts["needs-review"] + before.counts.unresolved + unreadable !== source.review)
      fail("The prepared bank and catalog disagree on question readiness.");
    const updated = structuredClone(bank);
    const reviewed: ChangedBank["reviewed"] = [];
    const resolved = new Set<string>();
    let sourceVerified = false;
    for (const row of rows) {
      const index = questions.get(row.questionId);
      if (index === undefined) fail("An answer decision names a question absent from its bank.");
      const question = bank.pkg.questions[index];
      verifyRecord(row, source, oldSha256, question);
      if (row.status !== "approved") continue;
      if (source.name.toLowerCase().endsWith(".pdf") && row.answerEvidenceSourcePage === null)
        fail("A reviewed PDF answer needs its inspected source page.");
      if (!sourceVerified) {
        if (!source.originalFile
          || await fileSha(await inside(root, source.originalFile)) !== source.checksum)
          fail("The reviewed source original is missing or has changed.");
        sourceVerified = true;
      }
      for (const asset of question.assets) {
        const file = await inside(root, dirname(source.bankFile) + "/assets/" + asset.filename);
        if (!asset.checksum || asset.checksum !== "sha256:" + await fileSha(file))
          fail("A reviewed question asset does not match its recorded bytes.");
      }
      const changed = applyRecord(question, row);
      updated.pkg.questions[index] = changed;
      resolved.add(question.id);
      reviewed.push({ questionId: question.id, beforeSha256: questionApprovalHashes(question).questionSha256,
        afterSha256: questionApprovalHashes(changed).questionSha256, reviewer: row.reviewer,
        reviewedAt: row.reviewedAt, rightsEvidenceSha256: sha(row.rightsEvidence),
        explanationCitationSha256: sha(row.explanationCitation),
        answerEvidenceSourcePage: row.answerEvidenceSourcePage,
        answerEvidenceSourceLine: row.answerEvidenceSourceLine,
        answerEvidenceNoteSha256: sha(row.answerEvidenceNote) });
    }
    if (!reviewed.length) continue;
    const residual = conversionIssues(bank, files).filter(issue => !(
      issue.questionId && resolved.has(issue.questionId)
      && ["answer_needs_review", "missing_answer_key", "missing_explanation"].includes(issue.code)));
    const after = assessBank(updated.pkg, residual, files);
    for (const id of resolved) {
      if (after.verdicts.get(id)?.readiness !== "ready")
        fail("A reviewed question is still held by source, choice, or media validation.");
    }
    updated.issues = after.issues;
    source.ready = after.counts.ready;
    source.review = after.counts["needs-review"] + after.counts.unresolved + unreadable;
    source.status = source.ready ? "prepared" : "review-required";
    changes.push({ bankFile: source.bankFile, oldSha256, newBank: updated,
      sourceId, sourceChecksum: source.checksum, readyBefore: before.counts.ready,
      readyAfter: after.counts.ready, reviewed });
  }
  if (changes.reduce((sum, change) => sum + change.reviewed.length, 0) !== approved.length)
    fail("A human-approved answer was not applied exactly once.");
  const inputCatalogSha256 = sha(catalogBytes), decisionsSha256 = sha(decisionBytes);
  catalog.version = sha(JSON.stringify([inputCatalogSha256, decisionsSha256,
    changes.map(change => [change.sourceId, change.reviewed.map(row => row.afterSha256)])])).slice(0, 16);

  const stage = target + ".pending-" + randomUUID();
  await mkdir(stage, { mode: 0o700 });
  const library = join(stage, "library");
  let complete = false;
  try {
    await clonePrivateTree(root, library);
    await chmod(library, 0o700);
    if (await fileSha(join(library, "catalog.json")) !== inputCatalogSha256)
      fail("The copied catalog changed during private candidate creation.");
    const outputBanks = [];
    for (const change of changes) {
      const bankPath = await inside(library, change.bankFile);
      if (await fileSha(bankPath) !== change.oldSha256)
        fail("A copied bank changed during private candidate creation.");
      await writeFile(bankPath, JSON.stringify(change.newBank));
      await chmod(bankPath, 0o600);
      const newSha256 = await fileSha(bankPath);
      readPreparedBank(JSON.parse(await readFile(bankPath, "utf8")));
      outputBanks.push({ sourceId: change.sourceId, sourceChecksum: change.sourceChecksum,
        oldBankSha256: change.oldSha256, newBankSha256: newSha256,
        readyBefore: change.readyBefore, readyAfter: change.readyAfter, reviewed: change.reviewed });
      if (await fileSha(await inside(root, change.bankFile)) !== change.oldSha256)
        fail("An input bank changed during private candidate creation.");
    }
    await writeFile(join(library, "catalog.json"), JSON.stringify(catalog));
    await chmod(join(library, "catalog.json"), 0o600);
    const outputCatalogSha256 = await fileSha(join(library, "catalog.json"));
    const receipt = { format: "axom-reviewed-answer-private-receipt", schemaVersion: 1,
      inputCatalogSha256, decisionsSha256, outputCatalogSha256,
      appliedQuestions: approved.length, appliedBanks: changes.length,
      rightsAttestationIsNotIndependentProof: true, banks: outputBanks };
    const receiptPath = join(stage, "private-receipt.json");
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    await createApprovalTemplate(library, join(stage, "approval-decisions.json"));
    await rename(stage, target);
    complete = true;
  } finally {
    if (!complete) await rm(stage, { recursive: true, force: true });
  }
  return { appliedQuestions: approved.length, appliedBanks: changes.length,
    readyAdded: changes.reduce((sum, change) => sum + change.readyAfter - change.readyBefore, 0),
    libraryPath: join(target, "library"),
    approvalTemplatePath: join(target, "approval-decisions.json"),
    privateReceiptPath: join(target, "private-receipt.json") };
}
