import { useStore } from "../store";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { saveBank } from "../question-content/bankImport";
import { assessBank } from "../question-content/assessBank";
import { readManifest, readQuestionsFile } from "../question-content/packageJson";
import { readImageInfo, sha256 } from "../question-content/assets";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob, QUESTION_ATTACHMENT_TYPES, type QuestionAttachmentMimeType } from "../questionAttachments";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import { createLocalBackup, listLocalBackups } from "../localBackup";
import { BUILD_INFO } from "../buildInfo";
import { readSourceOriginal, saveSourceOriginal } from "../decode/sources";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_LIBRARY_FORMAT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "./types";
import type { PackageIssue } from "../question-content/package";
import type { SourceDocument } from "../library";

export type LibraryReader = (path: string) => Promise<Uint8Array>;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export function safeLibraryPath(path: string): string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("Unsafe library path.");
  return path;
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
  return { ...bank, issues: [...bank.issues, ...issues], unreadableQuestions: (bank.unreadableQuestions ?? 0) + bank.pkg.questions.length - parsed.questions.length, pkg: { manifest, questions: parsed.questions } };
}
const reviewBlobKey = (checksum: string) => `private-library:${checksum}`;
export async function bankFiles(bank: PreparedBank, read?: LibraryReader, bankFile?: string, assertCurrent: () => void = () => {}): Promise<File[]> {
  const files: File[] = [];
  for (const asset of new Map(bank.pkg.questions.flatMap(q => q.assets).map(a => [a.id, a])).values()) {
    // The assessor holds questions whose essential images are absent. One
    // incomplete extraction must not prevent verified siblings from loading.
    if (!asset.checksum) continue;
    const key = reviewBlobKey(asset.checksum);
    let record = await getQuestionAttachmentBlob(key);
    if (!record && read && bankFile) {
      const bytes = await read(safeLibraryPath(`${bankFile.slice(0, bankFile.lastIndexOf("/"))}/assets/${asset.filename}`));
      const info = readImageInfo(bytes);
      if (!info || !QUESTION_ATTACHMENT_TYPES.includes(info.mimeType as QuestionAttachmentMimeType) || bytes.length > 8 * 1024 * 1024 || await sha256(bytes) !== asset.checksum) throw new Error(`Image integrity check failed: ${asset.filename}`);
      record = { blob: new Blob([bytes as BlobPart], { type: info.mimeType }), mimeType: info.mimeType as QuestionAttachmentMimeType, byteSize: bytes.length, questionId: asset.questionId, updatedAt: new Date().toISOString() };
      assertCurrent();
      await putQuestionAttachmentBlob(key, record);
    }
    if (!record) throw new Error("A review image is missing on this device. Reinstall the private bundle to restore it.");
    files.push(new File([record.blob], asset.filename, { type: record.mimeType }));
  }
  return files;
}

export interface LibraryInstallation {
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
async function install(read: LibraryReader, progress: (message: string) => void, assertCurrent: () => void) {
  const currentStore = () => {
    assertCurrent();
    // Keep the original action identities: the canonical importer uses them to
    // serialize transactions shared with other import entry points.
    return { ...useStore.getState(), assertCurrent };
  };
  const catalog = readCatalog(JSON.parse(text(await read("catalog.json"))));
  const installedIds: LibraryInstallation = { templateIds: [], documentIds: [], questionIds: [], setIds: [] };
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
  const failures: string[] = [];
  const installed = catalog.sources.map(s => ({ ...s }));
  for (const [index, source] of installed.entries()) {
    if (!source.bankFile && !source.originalFile) continue;
    progress(`Preparing your library · ${index + 1} of ${installed.length} sources`);
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
      const storedReview = currentStore().documents.find(d => d.id === `private-review-${source.checksum}`);
      const bank = readPreparedBank(JSON.parse(storedReview?.rawText ?? text(await read(source.bankFile))));
      const files = await bankFiles(bank, read, source.bankFile, assertCurrent);
      const assessed = assessBank(bank.pkg, bank.issues, files);
      if (assessed.issues.some(i => i.severity === "error" && !i.questionId)) throw new Error("Bank validation failed.");
      // Canonical question import must see its source document. Held-only
      // documents can share one snapshot instead of rewriting tens of MB each.
      if (assessed.counts.ready) await flushDocuments();
      const result = await saveBank(bank.pkg, assessed.issues, files, {
        library: currentStore, store: currentStore,
      }, { sourceText: bank.sourceText, sourceBytes: bank.sourceBytes, notes: bank.notes });
      if (result.status === "failed") throw new Error(result.errors.join(" "));
      for (const section of result.sections) {
        installedIds.questionIds.push(...section.savedIds);
        if (section.setId) installedIds.setIds.push(section.setId);
        if (section.documentId) installedIds.documentIds.push(section.documentId);
      }
      source.ready = result.sections.reduce((n, section) => n + section.savedIds.length, 0);
      source.review = result.held.length + (bank.unreadableQuestions ?? 0);
      if (bank.unreadableQuestions) source.reason = `${bank.unreadableQuestions} extracted rows could not be read. Open the original to review them; they are excluded from scored practice.`;
      const rawText = JSON.stringify(bank);
      const state = currentStore();
      // Preserve an existing reviewer's decisions when refreshing the same source version.
      const id = `private-review-${source.checksum}`;
      if (source.review) installedIds.documentIds.push(id);
      if (source.review && !state.documents.some(d => d.id === id)) pendingDocuments.set(id, { id, title: bank.pkg.manifest.bank.title, fileName: source.name,
        fileType: PRIVATE_REVIEW_DOCUMENT, rawText, uploadedAt: new Date().toISOString(), sizeBytes: rawText.length, tags: [source.module ?? "Unfiled"], libraryOnly: true, linkedQuestionSetIds: result.sections.flatMap(s => s.setId ? [s.setId] : []) });
      }
    } catch (cause) { assertCurrent(); source.status = "failed"; source.ready = 0; source.reason = cause instanceof Error ? cause.message : "Installation failed."; failures.push(source.name); }
    if (pendingDocuments.size >= 20 || source.ready) await flushDocuments();
  }
  await flushDocuments();
  const rawText = JSON.stringify({ ...catalog, sources: installed });
  installedIds.documentIds.push(`private-library-${catalog.id}`);
  currentStore().addDocument({ id: `private-library-${catalog.id}`, title: "Prepared academic library", fileName: "catalog.json", fileType: PRIVATE_LIBRARY_DOCUMENT,
    uploadedAt: new Date().toISOString(), rawText, sizeBytes: rawText.length, tags: [catalog.version], libraryOnly: true, linkedQuestionSetIds: [] });
  await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
  assertCurrent();
  if (failures.length) throw new Error(`${failures.length} banks need another installation attempt. Your saved courses, questions and progress are intact. See source coverage.`);
  progress("Library installed. Choose a course or create a quiz.");
  return { templateIds: [...new Set(installedIds.templateIds)], documentIds: [...new Set(installedIds.documentIds)], questionIds: [...new Set(installedIds.questionIds)], setIds: [...new Set(installedIds.setIds)] };
}

// Shared intake understands wrapper folders and native packages without a user-authored index.
export { zipLibraryReader, folderLibraryReader } from "./fileInput";
