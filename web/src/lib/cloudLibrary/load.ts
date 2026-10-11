import { useStore } from "../store";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { loadPreparedCourse, withPreparedCourses } from "../bookshelf/preparedCourses";
import { buildCourseBooks, type CourseBook } from "../bookshelf/courseBooks";
import { CURRICULA } from "../curricula";
import { readImageInfo, sha256 } from "../question-content/assets";
import { saveBank } from "../question-content/bankImport";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { PracticeSelection } from "../bookshelf/questionBankBooks";
import { assertPublishedBank, assertPublishedTemplate, parseCloudBank } from "./content";
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
  const client = await catalogClient(), initial = await client.auth.getSession();
  if (initial.error) throw new Error("Your account session could not be verified.");
  const id = initial.data.session?.user.id ?? null;
  let changed = false;
  const { data } = client.auth.onAuthStateChange((_event, next) => { if ((next?.user.id ?? null) !== id) changed = true; });
  return { check: () => { signal.throwIfAborted(); if (changed) throw new Error("The account changed. Restart this action in the intended account."); }, dispose: () => data.subscription.unsubscribe() };
}
export function loadCloudCourse(course: CatalogCourse, signal: AbortSignal): Promise<{ book: CourseBook; message: string }> {
  return exclusively(async () => {
    const templates = course.entries.filter(e => e.kind === "template");
    if (!templates.length) throw new Error("This course has no published template yet.");
    const guard = await sessionGuard(signal);
    try {
      const documents = [];
      for (const entry of templates) {
        const raw = decode(await readCloudFile(entry.release_id, entry.payload_path, signal));
        assertPublishedTemplate(entry, raw);
        documents.push(await prepareCourseTemplate(raw, entry.source_label));
      }
      guard.check();
      const checkpoint = getVaultWriteCheckpoint();
      for (const document of documents) {
        const state = useStore.getState();
        if (!state.documents.some(d => d.id === document.id)) state.addDocument(document);
      }
      await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint); guard.check();
      const s = useStore.getState();
      const books = withPreparedCourses(buildCourseBooks({ terms: s.terms, courses: s.courses,
        tracker: s.tracker, questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), s.documents, s.tracker);
      const ids = new Set(documents.map(d => d.id));
      const matches = books.filter(book => book.term === course.term && book.module === course.module && book.templateIds?.some(id => ids.has(id)));
      if (matches.length !== 1) throw new Error("The published course scope needs review. Its template is saved; use Customize Weeks & Activities rather than guessing a term.");
      guard.check();
      const result = await loadPreparedCourse(matches[0]);
      if (result.status === "failed") throw new Error(result.message || "The course could not be saved.");
      return { book: matches[0], message: result.status === "nothing-to-save" ? "Already in your tracker. Your progress was preserved." : "Course loaded. Your progress is saved on this device." };
    } finally { guard.dispose(); }
  });
}

/** Read-only shared content is cached through the canonical import/save path.
 * Personal answers remain in the learner workspace, never in catalog records. */
export function prepareCloudQuiz(entries: readonly CatalogEntry[], wanted: number, signal: AbortSignal): Promise<PracticeSelection> {
  return exclusively(async () => {
    if (!entries.length || entries.some(e => e.kind !== "bank")) throw new Error("Select at least one question set.");
    if (!Number.isSafeInteger(wanted) || wanted < 1 || wanted > 500) throw new Error("Choose between 1 and 500 questions.");
    const module = entries[0].module, term = entries[0].term;
    if (entries.some(e => e.module !== module || e.term !== term)) throw new Error("Choose sets from one course here. You can mix courses from your saved sets.");
    const guard = await sessionGuard(signal), prepared = [];
    let downloaded = 0;
    try {
      for (const entry of entries) {
        const read = async (path: string) => {
          const bytes = await readCloudFile(entry.release_id, path, signal);
          downloaded += bytes.length;
          if (downloaded > 128 * 1024 * 1024) throw new Error("Choose fewer image-rich sets at a time. Your existing study data is unchanged.");
          return bytes;
        };
        const bank = parseCloudBank(JSON.parse(decode(await read(entry.payload_path))));
        const files: File[] = [], byName = new Map<string, string>();
        for (const asset of new Map(bank.pkg.questions.flatMap(q => q.assets).map(a => [a.id, a])).values()) {
          if (!asset.checksum) throw new Error("A published image is missing its checksum.");
          const old = byName.get(asset.filename);
          if (old && old !== asset.checksum) throw new Error("Ambiguous image filenames need publisher review.");
          if (old) continue;
          byName.set(asset.filename, asset.checksum);
          const bytes = await read(`${entry.payload_path.slice(0, entry.payload_path.lastIndexOf("/"))}/assets/${asset.filename}`);
          const image = readImageInfo(bytes);
          if (!image || bytes.length > 8 * 1024 * 1024 || (await sha256(bytes)).replace(/^sha256:/, "") !== asset.checksum.replace(/^sha256:/, "")) throw new Error("Published image validation failed.");
          files.push(new File([new Uint8Array(bytes).buffer], asset.filename, { type: image.mimeType }));
        }
        const assessment = assertPublishedBank(entry, bank, files);
        prepared.push({ bank, files, assessment });
      }
      const setIds = new Set<string>(), questionIds = new Set<string>(), checkpoint = getVaultWriteCheckpoint();
      for (const { bank, files, assessment } of prepared) {
        guard.check();
        const result = await saveBank(bank.pkg, assessment.issues, files, {
          library: () => { guard.check(); return useStore.getState(); }, store: () => { guard.check(); return useStore.getState(); },
        }, { sourceText: bank.sourceText, sourceBytes: bank.sourceBytes, notes: bank.notes });
        if (result.status === "failed") throw new Error("This set could not be saved. Previously saved content and progress remain intact.");
        for (const section of result.sections) {
          if (section.setId) setIds.add(section.setId);
          for (const id of section.savedIds) questionIds.add(id);
        }
      }
      guard.check(); await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint); guard.check();
      if (!setIds.size || !questionIds.size) throw new Error("No verified questions are available from this selection.");
      const week = entries.every(e => e.week === entries[0].week) ? entries[0].week : null;
      return { module, ...(week != null ? { week } : {}), setIds: [...setIds], count: Math.min(wanted, questionIds.size) };
    } finally { guard.dispose(); }
  });
}
