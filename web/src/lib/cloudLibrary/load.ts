import { useStore } from "../store";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { loadPreparedCourse, withPreparedCourses } from "../bookshelf/preparedCourses";
import { buildCourseBooks } from "../bookshelf/courseBooks";
import { CURRICULA } from "../curricula";
import { readPreparedBank } from "../privateLibrary/install";
import { readImageInfo, sha256 } from "../question-content/assets";
import { saveBank } from "../question-content/bankImport";
import { assessBank } from "../question-content/assessBank";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { PracticeSelection } from "../bookshelf/questionBankBooks";
import type { CatalogCourse, CatalogEntry } from "./model";
import { catalogClient, readCloudFile } from "./client";

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
let activeLoad: Promise<unknown> | undefined;
async function exclusively<T>(work: () => Promise<T>): Promise<T> {
  if (activeLoad) throw new Error("Another course or quiz is being prepared. Wait for it to finish.");
  const run = work(); activeLoad = run;
  try { return await run; } finally { if (activeLoad === run) activeLoad = undefined; }
}
async function sessionGuard(signal: AbortSignal) {
  const client = await catalogClient();
  const initial = await client.auth.getSession();
  if (initial.error) throw new Error("Your account session could not be verified.");
  const id = initial.data.session?.user.id ?? null;
  return async () => {
    signal.throwIfAborted();
    const latest = await client.auth.getSession();
    if (latest.error || (latest.data.session?.user.id ?? null) !== id) throw new Error("The signed-in account changed. Restart this action in the intended account.");
  };
}

/** Copy only selected template content into the existing versioned local cache. */
export function loadCloudCourse(course: CatalogCourse, signal: AbortSignal): Promise<string> {
  return exclusively(async () => {
    const templates = course.entries.filter(e => e.kind === "template");
    if (!templates.length) throw new Error("This course has no published template yet.");
    const guard = await sessionGuard(signal);
    const documents = [];
    for (const entry of templates) {
      const raw = decode(await readCloudFile(entry.release_id, entry.payload_path, signal));
      const document = await prepareCourseTemplate(raw, entry.source_label);
      documents.push(document);
    }
    await guard();
    const checkpoint = getVaultWriteCheckpoint();
    for (const document of documents) {
      const state = useStore.getState();
      if (!state.documents.some(d => d.id === document.id)) state.addDocument(document);
    }
    await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
    const s = useStore.getState();
    const books = withPreparedCourses(buildCourseBooks({ terms: s.terms, courses: s.courses,
      tracker: s.tracker, questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), s.documents, s.tracker);
    const ids = new Set(documents.map(d => d.id));
    const matches = books.filter(book => book.term === course.term && book.module === course.module
      && book.templateIds?.some(id => ids.has(id)));
    if (matches.length !== 1) throw new Error("The published course scope needs review. Its template is saved; use Customize Weeks & Activities rather than guessing a term.");
    await guard();
    const result = await loadPreparedCourse(matches[0]);
    if (result.status === "failed") throw new Error(result.message || "The course could not be saved.");
    return result.status === "nothing-to-save" ? "This course is already in your tracker. Progress was preserved." : "Course loaded. Your progress is saved on this device.";
  });
}

/** The shared bank stays canonical. The existing question engine caches selected
 * content locally and owns personal attempts; no workspace is copied to the catalog. */
export function prepareCloudQuiz(entries: readonly CatalogEntry[], wanted: number, signal: AbortSignal): Promise<PracticeSelection> {
  return exclusively(async () => {
    if (!entries.length || entries.some(e => e.kind !== "bank")) throw new Error("Select at least one question set.");
    if (!Number.isSafeInteger(wanted) || wanted < 1 || wanted > 500) throw new Error("Choose between 1 and 500 questions.");
    const module = entries[0].module, term = entries[0].term;
    if (entries.some(e => e.module !== module || e.term !== term)) throw new Error("Use one course scope for this quiz. Cross-course mixing is available from your saved sets.");
    const guard = await sessionGuard(signal), prepared = [];
    for (const entry of entries) {
      const read = (path: string) => readCloudFile(entry.release_id, path, signal);
      const bank = readPreparedBank(JSON.parse(decode(await read(entry.payload_path))));
      // Resolve bytes before writes. Invalid data never enters scored practice.
      const files: File[] = [];
      const byName = new Map<string, string>();
      for (const asset of new Map(bank.pkg.questions.flatMap(q => q.assets).map(a => [a.id, a])).values()) {
        if (!asset.checksum) throw new Error("A published image is missing its checksum.");
        const old = byName.get(asset.filename);
        if (old && old !== asset.checksum) throw new Error("Ambiguous image filenames require publisher review.");
        if (old) continue;
        byName.set(asset.filename, asset.checksum);
        const bytes = await read(`${entry.payload_path.slice(0, entry.payload_path.lastIndexOf("/"))}/assets/${asset.filename}`);
        const image = readImageInfo(bytes);
        if (!image || bytes.length > 8 * 1024 * 1024 || (await sha256(bytes)).replace(/^sha256:/, "") !== asset.checksum.replace(/^sha256:/, "")) throw new Error("Published image validation failed.");
        files.push(new File([new Uint8Array(bytes).buffer], asset.filename, { type: image.mimeType }));
      }
      const assessment = assessBank(bank.pkg, bank.issues, files);
      if (assessment.counts.ready !== entry.question_count || assessment.counts.ready !== bank.pkg.questions.length) throw new Error("Published question readiness changed. This set needs publisher review.");
      prepared.push({ bank, files, assessment });
    }
    const setIds = new Set<string>(), questionIds = new Set<string>();
    for (const { bank, files, assessment } of prepared) {
      await guard();
      const result = await saveBank(bank.pkg, assessment.issues, files, {
        library: () => { signal.throwIfAborted(); return useStore.getState(); }, store: () => { signal.throwIfAborted(); return useStore.getState(); },
      }, { sourceText: bank.sourceText, sourceBytes: bank.sourceBytes, notes: bank.notes });
      if (result.status === "failed") throw new Error("The selected set could not be saved. Previously saved content and progress remain intact.");
      for (const section of result.sections) {
        if (section.setId) setIds.add(section.setId);
        for (const id of section.savedIds) questionIds.add(id);
      }
    }
    await guard(); await flushLocalVaultWrites();
    if (!setIds.size || !questionIds.size) throw new Error("No verified questions are available from this selection.");
    const week = entries.every(e => e.week === entries[0].week) ? entries[0].week : null;
    return { module, ...(week != null ? { week } : {}), setIds: [...setIds], count: Math.min(wanted, questionIds.size) };
  });
}
