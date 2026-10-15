import { useStore } from "../store";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { canonicalModuleKey } from "../course-engine/vocabulary";
import { saveBank } from "../question-content/bankImport";
import { assessBank } from "../question-content/assessBank";
import type { PackageImportOptions } from "../question-content/toReviewedImport";
import { questionScope, type PackageIssue, type PackageQuestion } from "../question-content/package";
import type { QuestionBlock, TableBlock } from "../question-content/blocks";
import { readManifest, readQuestionsFile } from "../question-content/packageJson";
import { sha256 } from "../question-content/assets";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob, type QuestionAttachmentBlobRecord } from "../questionAttachments";
import { assertInstallableAcademicImageBytes, type InstallableAcademicImage } from "../academicLibrary/gifIntegrity";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import { createLocalBackup, listLocalBackups } from "../localBackup";
import { BUILD_INFO } from "../buildInfo";
import { readSourceOriginal, saveSourceOriginal } from "../decode/sources";
import { questionPracticeReadiness } from "../questionFilters";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_LIBRARY_FORMAT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog, type ReviewedFiling } from "./types";
import type { SourceDocument } from "../library";

export type LibraryReader = (path: string) => Promise<Uint8Array>;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export function safeLibraryPath(path: string): string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("Unsafe library path.");
  return path;
}
function reviewedModuleIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > 80
    || /[/\\]/.test(value) || [...value].some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || code === 0x2028 || code === 0x2029;
  })) return undefined;
  const key = canonicalModuleKey(value);
  return key || undefined;
}
function assertReviewedFilingMatchesSource(
  manifest: PreparedBank["pkg"]["manifest"], questions: readonly PackageQuestion[], filing: ReviewedFiling,
): void {
  const originalScopes = [
    { module: manifest.course.name, term: manifest.course.term },
    ...questions.map(question => {
      const scope = questionScope(manifest, question);
      return { module: scope.course, term: scope.term };
    }),
  ];
  const pairs = new Map<string, { module: string; term: number }>();
  for (const scope of originalScopes) {
    const module = reviewedModuleIdentity(scope.module);
    if (!module || !Number.isInteger(scope.term) || scope.term < 1 || scope.term > 5)
      throw new Error("The prepared bank has invalid original module or term evidence.");
    pairs.set(`${module}|${scope.term}`, { module, term: scope.term });
  }
  if (pairs.size !== 1)
    throw new Error("A reviewed filing cannot collapse several original modules or terms. Split the bank before installation.");
  if (filing.evidence === "source-metadata") {
    const original = [...pairs.values()][0];
    if (original.module !== reviewedModuleIdentity(filing.module) || `Term ${original.term}` !== filing.term)
      throw new Error("Source-metadata filing must agree with the bank's original module and term.");
  }
}
export function readCatalog(value: unknown): PrivateLibraryCatalog {
  const c = value as PrivateLibraryCatalog | undefined;
  if (!c || c.format !== PRIVATE_LIBRARY_FORMAT || c.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]+$/.test(c.id) || typeof c.version !== "string" || !Array.isArray(c.templates) || !Array.isArray(c.sources) || c.sources.length > 10000) throw new Error("This is not a supported AXOM private library.");
  for (const t of c.templates) { safeLibraryPath(t.file); if (typeof t.name !== "string" || !/^[a-f0-9]{64}$/.test(t.checksum)) throw new Error("Invalid template identity."); }
  for (const s of c.sources) { if (s.bankFile) safeLibraryPath(s.bankFile); if (s.originalFile) safeLibraryPath(s.originalFile); if (typeof s.id !== "string" || !s.id || typeof s.name !== "string" || typeof s.sourcePath !== "string" || typeof s.reason !== "string" || !/^[a-f0-9]{64}$/.test(s.checksum) || ![s.ready,s.review].every(n => Number.isSafeInteger(n) && n >= 0) || !["prepared", "review-required", "duplicate-linked", "reference/template-only", "unsupported", "missing", "failed"].includes(s.status)) throw new Error("Invalid source identity or counts."); }
  return c;
}
export function readPreparedBank(value: unknown): PreparedBank {
  const bank = value as PreparedBank;
  const issues: PackageIssue[] = [];
  const manifest = readManifest(bank?.pkg?.manifest, issues);
  const parsed = readQuestionsFile({ schemaVersion: 1, bankId: manifest?.bank.id, questions: bank?.pkg?.questions }, issues);
  if (!manifest || !parsed || issues.some(i => i.severity === "error" && !i.questionId) || !Array.isArray(bank.issues) || typeof bank.sourceText?.rawText !== "string") throw new Error("The prepared bank is damaged or unsupported.");
  let reviewedFiling: ReviewedFiling | undefined;
  if (bank.reviewedFiling !== undefined) {
    const filing = bank.reviewedFiling as unknown as Record<string, unknown>;
    const keys = filing && typeof filing === "object" && !Array.isArray(filing) ? Object.keys(filing).sort() : [];
    const expected = ["evidence", "module", "term", "weekAssignment"];
    const module = filing?.module;
    const term = filing?.term;
    const evidence = filing?.evidence;
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
      || typeof term !== "string" || !/^Term [1-5]$/.test(term)
      || typeof module !== "string" || !reviewedModuleIdentity(module)
      || typeof evidence !== "string" || !["source-metadata", "human-reviewed"].includes(evidence)
      || filing?.weekAssignment !== "unassigned") {
      throw new Error("The prepared bank has an invalid reviewed filing envelope.");
    }
    const verifiedFiling: ReviewedFiling = Object.freeze({
      term: term as ReviewedFiling["term"],
      module,
      evidence: evidence as ReviewedFiling["evidence"],
      weekAssignment: "unassigned",
    });
    assertReviewedFilingMatchesSource(manifest, parsed.questions, verifiedFiling);
    reviewedFiling = verifiedFiling;
  }
  return { ...bank, ...(reviewedFiling ? { reviewedFiling } : {}), issues: [...bank.issues, ...issues], unreadableQuestions: (bank.unreadableQuestions ?? 0) + bank.pkg.questions.length - parsed.questions.length, pkg: { manifest, questions: parsed.questions } };
}
/** One canonical option projection for every PreparedBank consumer. A reviewed
 * filing changes where imported records live without rewriting source evidence. */
export function preparedBankImportOptions(bank: PreparedBank): PackageImportOptions {
  const filing = bank.reviewedFiling;
  return {
    sourceText: bank.sourceText,
    sourceBytes: bank.sourceBytes,
    notes: bank.notes,
    ...(filing ? { reviewedFiling: {
      module: filing.module,
      term: Number(filing.term.slice(-1)) as 1 | 2 | 3 | 4 | 5,
    } } : {}),
  };
}
const reviewBlobKey = (checksum: string) => `private-library:${checksum}`;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
function mergeReviewedTable(incoming: TableBlock, stored: TableBlock, label: string): TableBlock {
  const sameShape = (incoming.headers?.length ?? 0) === (stored.headers?.length ?? 0)
    && incoming.rows.length === stored.rows.length
    && incoming.rows.every((row, index) => row.length === stored.rows[index]?.length);
  if (!sameShape) throw new Error(`The incoming bank changed the structure of ${label}. Keep both copies and reconcile it before reinstalling.`);
  return {
    ...incoming,
    ...(stored.headers ? { headers: [...stored.headers] } : {}),
    rows: stored.rows.map(row => [...row]),
  };
}
function mergeReviewedBlocks(incoming: readonly QuestionBlock[], stored: readonly QuestionBlock[], label: string): QuestionBlock[] {
  if (incoming.length !== stored.length) throw new Error(`The incoming bank changed the structure of ${label}. Keep both copies and reconcile it before reinstalling.`);
  return incoming.map((block, index) => {
    const reviewed = stored[index];
    if (!reviewed || reviewed.type !== block.type)
      throw new Error(`The incoming bank changed the structure of ${label}. Keep both copies and reconcile it before reinstalling.`);
    if (block.type === "text" && reviewed.type === "text") return { ...block, text: reviewed.text };
    if (block.type === "rich_text" && reviewed.type === "rich_text") return { ...block, html: reviewed.html };
    if (block.type === "callout" && reviewed.type === "callout") return { ...block, text: reviewed.text };
    if (block.type === "table" && reviewed.type === "table") return mergeReviewedTable(block, reviewed, label);
    // Media/equation identity is source-owned and cannot be edited in review.
    return block;
  });
}
function mergeReviewedQuestion(incoming: PackageQuestion, stored: PackageQuestion): PackageQuestion {
  if (incoming.choices.length !== stored.choices.length
    || incoming.choices.some((choice, index) => choice.id !== stored.choices[index]?.id || choice.label !== stored.choices[index]?.label)) {
    throw new Error(`The incoming bank changed the answer-choice structure of ${incoming.id}. Keep both copies and reconcile it before reinstalling.`);
  }
  if (Boolean(incoming.choiceTable) !== Boolean(stored.choiceTable))
    throw new Error(`The incoming bank changed the shared answer-table structure of ${incoming.id}. Keep both copies and reconcile it before reinstalling.`);
  if (stored.explanation && !incoming.explanation)
    throw new Error(`The incoming bank removed the reviewed explanation for ${incoming.id}. Keep both copies and reconcile it before reinstalling.`);

  const reviewerAnswer = stored.correctAnswer?.evidence === "reviewer";
  const answerNeedsReview = stored.flags?.filter(flag => flag.type === "answer_needs_review") ?? [];
  const sourceFlags = (incoming.flags ?? []).filter(flag => flag.type !== "answer_needs_review");
  const flags = reviewerAnswer ? sourceFlags : [...sourceFlags, ...answerNeedsReview];
  const { correctAnswer: _incomingAnswer, flags: _incomingFlags, ...sourceOwned } = incoming;
  return {
    ...sourceOwned,
    stem: mergeReviewedBlocks(incoming.stem, stored.stem, `${incoming.id} stem`),
    choices: incoming.choices.map((choice, index) => ({
      ...choice,
      blocks: mergeReviewedBlocks(choice.blocks, stored.choices[index].blocks, `${incoming.id} choice ${choice.label}`),
    })),
    ...(incoming.choiceTable && stored.choiceTable
      ? { choiceTable: mergeReviewedTable(incoming.choiceTable, stored.choiceTable, `${incoming.id} shared answer table`) }
      : {}),
    ...(incoming.explanation
      ? { explanation: stored.explanation
        ? mergeReviewedBlocks(incoming.explanation, stored.explanation, `${incoming.id} explanation`)
        : incoming.explanation }
      : {}),
    ...(reviewerAnswer ? { correctAnswer: stored.correctAnswer }
      : answerNeedsReview.length ? {}
      : incoming.correctAnswer ? { correctAnswer: incoming.correctAnswer } : {}),
    ...(flags.length ? { flags } : {}),
  };
}
export function mergeStoredReview(incoming: PreparedBank, storedValue: unknown, expectedSourceChecksum?: string): PreparedBank {
  const stored = readPreparedBank(storedValue);
  if (stored.pkg.manifest.bank.id !== incoming.pkg.manifest.bank.id)
    throw new Error("A saved local review belongs to a different bank identity. Keep both copies and reconcile them before reinstalling.");
  const incomingById = new Map(incoming.pkg.questions.map(question => [question.id, question]));
  const preserved = new Map<string, PackageQuestion>();
  for (const question of stored.pkg.questions) {
    const next = incomingById.get(question.id);
    const incomingChecksum = next?.provenance.sourceChecksum;
    const storedChecksum = question.provenance.sourceChecksum;
    if (!next || !incomingChecksum || !storedChecksum
      || !SHA256_ID.test(incomingChecksum) || !SHA256_ID.test(storedChecksum)
      || incomingChecksum !== storedChecksum
      || (expectedSourceChecksum !== undefined && incomingChecksum !== expectedSourceChecksum))
      throw new Error("The incoming bank conflicts with saved local review work. Export a backup and reconcile the changed question identities before reinstalling.");
    preserved.set(question.id, mergeReviewedQuestion(next, question));
  }
  // New source rows arrive from the incoming package; matching rows retain the
  // learner's explicit text/key review. Filing evidence always comes from the
  // newly verified envelope, so an older review document cannot shadow it.
  return readPreparedBank({
    ...incoming,
    pkg: { ...incoming.pkg, questions: incoming.pkg.questions.map(question => preserved.get(question.id) ?? question) },
    // The freshly verified package owns filing metadata. A stored review may
    // preserve reviewer-editable question content, never an omitted or stale
    // filing envelope from an older package revision.
    ...(incoming.reviewedFiling ? { reviewedFiling: incoming.reviewedFiling } : {}),
  });
}
function bankAssetPath(bankFile: string, filename: string): string {
  const separator = bankFile.lastIndexOf("/");
  const prefix = separator === -1 ? "" : bankFile.slice(0, separator + 1);
  return safeLibraryPath(`${prefix}assets/${filename}`);
}
export async function bankFiles(bank: PreparedBank, read?: LibraryReader, bankFile?: string, assertCurrent: () => void = () => {}): Promise<File[]> {
  const files: File[] = [];
  const pendingRecords: Array<{ key: string; record: QuestionAttachmentBlobRecord }> = [];
  // Several question assets can refer to the *same* source-page file while
  // having distinct question-local asset IDs. The image matcher intentionally
  // refuses ambiguous duplicate filenames. Supply each verified file once,
  // and refuse collisions where identical names claim different bytes.
  const byFileName = new Map<string, (typeof bank.pkg.questions)[number]["assets"][number]>();
  for (const asset of bank.pkg.questions.flatMap(question => question.assets)) {
    if (!asset.checksum) continue;
    const key = asset.filename.trim().split(/[\\/]/).pop()!.normalize("NFC").toLowerCase();
    const previous = byFileName.get(key);
    if (previous && previous.checksum !== asset.checksum) {
      throw new Error(`Two different images are named ${asset.filename}. Rename and review their references before importing.`);
    }
    if (!previous) byFileName.set(key, asset);
  }
  for (const asset of byFileName.values()) {
    if (!asset.checksum) continue;
    // The assessor holds questions whose essential images are absent. One
    // incomplete extraction must not prevent verified siblings from loading.
    const key = reviewBlobKey(asset.checksum);
    const stored = await getQuestionAttachmentBlob(key);
    const bytes = read && bankFile
      ? await read(bankAssetPath(bankFile, asset.filename))
      : stored ? new Uint8Array(await stored.blob.arrayBuffer()) : undefined;
    if (!bytes) throw new Error("A review image is missing on this device. Reinstall the private bundle to restore it.");
    let image: InstallableAcademicImage;
    try {
      image = await assertInstallableAcademicImageBytes(bytes, asset.mimeType);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The image could not be verified.";
      throw new Error(`Image integrity check failed: ${asset.filename}. ${reason}`, { cause });
    }
    if (await sha256(bytes) !== asset.checksum
      || (asset.byteSize !== undefined && asset.byteSize !== image.byteSize)
      || (asset.width !== undefined && asset.width !== image.width)
      || (asset.height !== undefined && asset.height !== image.height))
      throw new Error(`Image integrity check failed: ${asset.filename}. Its checksum, byte size or dimensions do not match the verified bytes.`);
    const record: QuestionAttachmentBlobRecord = {
      blob: new Blob([bytes as BlobPart], { type: image.mimeType }),
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      questionId: asset.questionId,
      updatedAt: new Date().toISOString(),
    };
    if (read && bankFile) pendingRecords.push({ key, record });
    files.push(new File([record.blob], asset.filename, { type: record.mimeType }));
  }
  // Validate every referenced file before the first IndexedDB write so a
  // corrupt later sibling cannot leave a partially persisted image set.
  assertCurrent();
  for (const pending of pendingRecords) await putQuestionAttachmentBlob(pending.key, pending.record);
  return files;
}

export interface LibraryInstallation {
  status: "complete" | "partial";
  warnings: string[];
  templateIds: string[];
  documentIds: string[];
  questionIds: string[];
  setIds: string[];
}
export interface LibraryInstallScope { key: string; assertCurrent: () => void }
let installing: { read: LibraryReader; key?: string; promise: Promise<LibraryInstallation> } | undefined;
/** Same canonical import as file review. Each completed source is durable; retry repairs missing media. */
export function installPrivateLibrary(read: LibraryReader, progress: (message: string) => void = () => {}, scope?: LibraryInstallScope): Promise<LibraryInstallation> {
  if (installing) return installing.read === read && installing.key === scope?.key ? installing.promise
    : Promise.reject(new Error("Another library download is being saved. Wait for it to finish, then retry."));
  const promise = install(read, progress, scope?.assertCurrent ?? (() => {})).finally(() => { installing = undefined; });
  installing = { read, key: scope?.key, promise };
  return promise;
}
async function install(read: LibraryReader, progress: (message: string) => void, assertCurrent: () => void): Promise<LibraryInstallation> {
  const currentStore = () => {
    assertCurrent();
    // Keep the original action identities: the canonical importer uses them to
    // serialize transactions shared with other import entry points.
    return { ...useStore.getState(), assertCurrent };
  };
  const catalog = readCatalog(JSON.parse(text(await read("catalog.json"))));
  const installedIds: LibraryInstallation = { status: "complete", warnings: [], templateIds: [], documentIds: [], questionIds: [], setIds: [] };
  progress("Protecting your current workspace…");
  await flushLocalVaultWrites();
  assertCurrent();
  await createLocalBackup(BUILD_INFO.schemaVersion, listLocalBackups().length + 2);
  const checkpoint = getVaultWriteCheckpoint();
  for (const entry of catalog.templates) {
    const bytes = await read(entry.file);
    if (await sha256(bytes) !== `sha256:${entry.checksum}`) throw new Error(`Template integrity check failed: ${entry.name}`);
    const doc = await prepareCourseTemplate(text(bytes), entry.name);
    installedIds.templateIds.push(doc.id);
    installedIds.documentIds.push(doc.id);
    const s = currentStore();
    if (!s.documents.some(d => d.id === doc.id)) s.addDocument(doc);
  }
  await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
  const pendingDocuments = new Map<string, SourceDocument>();
  const flushDocuments = async () => {
    assertCurrent();
    if (pendingDocuments.size) {
      const batch = new Map(pendingDocuments);
      useStore.setState(s => ({ documents: [...batch.values(), ...s.documents.filter(d => !batch.has(d.id))] }));
      pendingDocuments.clear();
    }
    await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
  };
  const warnings: string[] = [];
  const installed = catalog.sources.map(s => ({ ...s }));
  for (const [index, source] of installed.entries()) {
    if (!source.bankFile && !source.originalFile) continue;
    const report = (phase: string) => progress(`Preparing your library · ${index + 1} of ${installed.length} sources · ${phase}`);
    report("checking original");
    try {
      if (source.originalFile) {
        const s = currentStore();
        const existing = [...pendingDocuments.values(), ...s.documents].find(d => d.checksum?.replace(/^sha256:/, "") === source.checksum && d.fileType !== PRIVATE_REVIEW_DOCUMENT);
        const doc = existing ?? { id: `private-source-${source.checksum}`, title: source.name.replace(/\.[^.]+$/, ""), fileName: source.name,
          fileType: source.originalFile.split(".").pop() ?? "file", uploadedAt: new Date().toISOString(), rawText: "", sizeBytes: 0,
          checksum: `sha256:${source.checksum}`, tags: [source.module ?? "Unfiled"], linkedQuestionSetIds: [], libraryOnly: true };
        installedIds.documentIds.push(doc.id);
        if (!await readSourceOriginal(doc.id, doc.checksum)) {
          const bytes = await read(source.originalFile);
          assertCurrent();
          await saveSourceOriginal(doc, new Blob([bytes as BlobPart]));
          assertCurrent();
          if (!existing) pendingDocuments.set(doc.id, { ...doc, sizeBytes: bytes.length });
        } else if (!existing) pendingDocuments.set(doc.id, doc);
      }
      if (source.bankFile) {
      report("opening question package");
      const storedReview = currentStore().documents.find(d => d.id === `private-review-${source.checksum}`);
      const incomingBank = readPreparedBank(JSON.parse(text(await read(source.bankFile))));
      const bank = storedReview
        ? mergeStoredReview(incomingBank, JSON.parse(storedReview.rawText), `sha256:${source.checksum}`)
        : incomingBank;
      report("verifying figure assets");
      const files = await bankFiles(bank, read, source.bankFile, assertCurrent);
      report("reviewing answer evidence");
      const assessed = assessBank(bank.pkg, bank.issues, files);
      if (assessed.issues.some(i => i.severity === "error" && !i.questionId)) throw new Error("Bank validation failed.");
      // Canonical question import must see its source document. Held-only
      // documents can share one snapshot instead of rewriting tens of MB each.
      if (assessed.counts.ready) {
        report("saving source documents");
        await flushDocuments();
      }
      report("saving reviewed questions");
      const result = await saveBank(bank.pkg, assessed.issues, files, {
        library: currentStore, store: currentStore,
      }, preparedBankImportOptions(bank));
      const durableSections = [
        ...result.sections,
        ...result.incompleteSections.filter(section => section.savedIds.length > 0),
      ];
      const localQuestions = currentStore().questions.filter(question => (
        question.content?.provenance.sourceChecksum?.replace(/^sha256:/, "") === source.checksum
        && questionPracticeReadiness(question) === "ready"
      ));
      if (result.status === "failed" && localQuestions.length === 0) throw new Error(result.errors.join(" "));
      report("recording review queue");
      for (const section of durableSections) {
        installedIds.questionIds.push(...section.savedIds);
        if (section.setId) installedIds.setIds.push(section.setId);
        if (section.documentId) installedIds.documentIds.push(section.documentId);
      }
      installedIds.questionIds.push(...localQuestions.map(question => question.id));
      installedIds.setIds.push(...localQuestions.flatMap(question => question.setId ? [question.setId] : []));
      installedIds.documentIds.push(...localQuestions.flatMap(question => question.sourceDocumentId ? [question.sourceDocumentId] : []));
      source.ready = localQuestions.length;
      source.review = result.held.length + (bank.unreadableQuestions ?? 0);
      const sourceWarnings: string[] = [];
      if (bank.unreadableQuestions) sourceWarnings.push(`${bank.unreadableQuestions} extracted rows could not be read. Open the original to review them; they are excluded from scored practice.`);
      if (result.status === "partial" || result.status === "failed") {
        source.status = "review-required";
        sourceWarnings.push(`${source.ready} answer-ready question${source.ready === 1 ? " remains" : "s remain"} saved on this device, but this source did not finish: ${result.errors.slice(0, 3).join(" ")}`);
      }
      if (sourceWarnings.length) source.reason = sourceWarnings.join(" ");
      if (result.status === "partial" || result.status === "failed") warnings.push(`${source.name}: ${source.reason}`);
      const rawText = JSON.stringify(bank);
      const state = currentStore();
      // Preserve an existing reviewer's decisions when refreshing the same source version.
      const id = `private-review-${source.checksum}`;
      const existingReview = state.documents.find(d => d.id === id);
      if (source.review || bank.reviewedFiling || existingReview) {
        installedIds.documentIds.push(id);
        const linkedQuestionSetIds = [...new Set([
          ...(existingReview?.linkedQuestionSetIds ?? []),
          ...result.sections.flatMap(section => section.setId ? [section.setId] : []),
        ])];
        pendingDocuments.set(id, {
          ...(existingReview ?? {
            id, title: bank.pkg.manifest.bank.title, fileName: source.name,
            uploadedAt: new Date().toISOString(), tags: [source.module ?? "Unfiled"], libraryOnly: true,
          }),
          fileType: PRIVATE_REVIEW_DOCUMENT, rawText, sizeBytes: rawText.length, linkedQuestionSetIds,
        });
      }
      }
    } catch (cause) {
      assertCurrent();
      source.status = "failed";
      const retained = currentStore().questions.filter(question => (
        question.content?.provenance.sourceChecksum?.replace(/^sha256:/, "") === source.checksum
        && questionPracticeReadiness(question) === "ready"
      ));
      source.ready = retained.length;
      installedIds.questionIds.push(...retained.map(question => question.id));
      installedIds.setIds.push(...retained.flatMap(question => question.setId ? [question.setId] : []));
      installedIds.documentIds.push(...retained.flatMap(question => question.sourceDocumentId ? [question.sourceDocumentId] : []));
      const failure = cause instanceof Error ? cause.message : "Installation failed.";
      source.reason = retained.length
        ? `${failure} ${retained.length} previously saved answer-ready question${retained.length === 1 ? " remains" : "s remain"} on this device.`
        : failure;
      // Preserve the underlying error, not only a generic file count: otherwise
      // a failed bank can look like a silent stall at the last progress label.
      warnings.push(`${source.name}: ${source.reason}`);
      report("source needs attention; continuing with other files");
    }
    if (pendingDocuments.size >= 20 || source.ready) {
      report("synchronizing local vault");
      await flushDocuments();
    }
  }
  progress("Finalizing local library catalog…");
  await flushDocuments();
  const rawText = JSON.stringify({ ...catalog, sources: installed });
  installedIds.documentIds.push(`private-library-${catalog.id}`);
  currentStore().addDocument({ id: `private-library-${catalog.id}`, title: "Prepared academic library", fileName: "catalog.json", fileType: PRIVATE_LIBRARY_DOCUMENT,
    uploadedAt: new Date().toISOString(), rawText, sizeBytes: rawText.length, tags: [catalog.version], libraryOnly: true, linkedQuestionSetIds: [] });
  await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
  assertCurrent();
  if (warnings.length) progress(`${warnings.length} source${warnings.length === 1 ? " needs" : "s need"} another installation attempt. Saved study progress and completed sources remain available.`);
  else progress("Library installed. Choose a course or create a quiz.");
  return {
    status: warnings.length ? "partial" : "complete",
    warnings,
    templateIds: [...new Set(installedIds.templateIds)],
    documentIds: [...new Set(installedIds.documentIds)],
    questionIds: [...new Set(installedIds.questionIds)],
    setIds: [...new Set(installedIds.setIds)],
  };
}

// Shared intake understands wrapper folders and native packages without a user-authored index.
export { zipLibraryReader, folderLibraryReader } from "./fileInput";
