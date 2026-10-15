import { useStore } from "../store";
import { academicBindings, type AcademicBindings } from "./contentReferences";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountOperationClient } from "../account/supabase";
import { sha256 } from "../question-content/assets";
import { installPrivateLibrary, safeLibraryPath, type LibraryReader, type LibraryInstallation } from "../privateLibrary/install";
import type { LibraryInstallScope } from "../privateLibrary/install";

export interface AcademicCourse {
  id: string;
  title: string;
  module: string;
  term: string;
  academic_term?: string;
  cohort?: string;
  visibility: "private" | "group" | "shared";
  review_status: "pending" | "approved" | "rejected";
  current_revision_id: string;
  owned: boolean;
  ready_questions: number;
  review_questions: number;
}
export interface AcademicPreview {
  id: string;
  collection_id: string;
  source_revision?: string;
  template_text: string;
  ready_questions: number;
  review_questions: number;
}
export interface AcademicFile {
  path: string;
  object_path: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
}

export async function academicClient(accountId?: string): Promise<SupabaseClient> {
  const operation = await accountOperationClient();
  if (accountId && operation.userId !== accountId) throw new Error("The account changed. Reopen this course in your current account.");
  return operation.client;
}

/** Catalog responses contain bounded metadata only, never questions or media. */
export async function listAcademicCourses(search = "", term = "", afterId?: string): Promise<AcademicCourse[]> {
  const client = await academicClient();
  const { data, error } = await client.rpc("academic_catalog", { search, term_filter: term, after_id: afterId ?? null });
  if (error) throw new Error("The academic collection could not be loaded. Your downloaded courses are unchanged.");
  return readAcademicCourses(data);
}
export async function getAcademicCourse(collection: string, accountId: string): Promise<AcademicCourse> {
  const { data, error } = await (await academicClient(accountId)).rpc("academic_course", { collection });
  if (error || !data) throw new Error("This course is unavailable to this account. Your saved material is unchanged.");
  const course = readAcademicCourses([data])[0];
  if (course.id !== collection) throw new Error("The course identity did not match this link.");
  return course;
}
function readAcademicCourses(data: unknown): AcademicCourse[] {
  if (!Array.isArray(data) || data.length > 24 || data.some(row => !row || !uuid(row.id) || !uuid(row.current_revision_id)
    || ![row.title, row.module, row.term].every(value => typeof value === "string" && value.length > 0 && value.length <= 180)
    || typeof row.owned !== "boolean" || !counts(row) || !["private", "group", "shared"].includes(row.visibility)
    || !["pending", "approved", "rejected"].includes(row.review_status))) throw new Error("The catalog response is invalid.");
  return data as AcademicCourse[];
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const counts = (row: { ready_questions: unknown; review_questions: unknown }) => [row.ready_questions, row.review_questions].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100000);
export async function academicPreview(revision: string, accountId?: string): Promise<AcademicPreview> {
  const client = await academicClient(accountId);
  const { data, error } = await client.from("academic_revisions").select("id,collection_id,source_revision,template_text,ready_questions,review_questions").eq("id", revision).single();
  if (error || !data || data.id !== revision || !uuid(data.collection_id) || typeof data.template_text !== "string" || new TextEncoder().encode(data.template_text).length > 262144 || !counts(data)) throw new Error("This course revision is unavailable. Your current course has not changed.");
  return data as AcademicPreview;
}

/** Adapt the backend to the existing reviewed package installer. Hash checks
 * precede every adoption, including media and original source documents. */
export async function academicLibraryReader(client: SupabaseClient, revision: string): Promise<LibraryReader & { files: AcademicFile[] }> {
  const manifest: AcademicFile[] = [];
  // Supabase's row cap also applies to file metadata; never mistake a truncated
  // index for a complete course when a revision contains more than 1,000 files.
  for (let start = 0; start <= 1500; start += 500) {
    const { data, error } = await client.from("academic_files").select("path,object_path,sha256,byte_size,mime_type").eq("revision_id", revision).order("path").range(start, start + 499);
    if (error || !Array.isArray(data)) throw new Error("The course file index is unavailable. Keep your local copy and retry.");
    manifest.push(...data as AcademicFile[]);
    if (data.length < 500) break;
  }
  if (!manifest.length || manifest.length > 1500) throw new Error("Invalid course file manifest.");
  const files = new Map(manifest.map(file => [safeLibraryPath(file.path), file]));
  if (files.size !== manifest.length || !files.has("catalog.json")) throw new Error("Invalid course file manifest.");
  let bytes = 0;
  for (const file of files.values()) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.byte_size) || file.byte_size < 1 || file.byte_size > 50 * 1024 * 1024 || typeof file.object_path !== "string" || !uuid(file.object_path.split("/")[0]) || file.object_path.split("/").length !== 2 || !file.object_path.endsWith(`/${file.sha256}`)) throw new Error("Invalid course file manifest.");
    bytes += file.byte_size;
  }
  if (bytes > 512 * 1024 * 1024) throw new Error("This course exceeds the supported download size.");
  const read: LibraryReader = async path => {
    const file = files.get(safeLibraryPath(path));
    if (!file) throw new Error("A required course file is missing from this revision.");
    const result = await client.storage.from("academic-content").download(file.object_path);
    if (result.error || !result.data) throw new Error("A course file could not be downloaded. Your local work is preserved; reconnect and retry.");
    const buffer = new Uint8Array(await result.data.arrayBuffer());
    if (buffer.length !== file.byte_size || await sha256(buffer) !== `sha256:${file.sha256}`) throw new Error("A course file failed its integrity check. Your local work is unchanged.");
    return buffer;
  };
  return Object.assign(read, { files: manifest });
}

export async function downloadAcademicCourse(revision: string, progress: (message: string) => void, scope: LibraryInstallScope): Promise<LibraryInstallation & { bindings: AcademicBindings }> {
  const client = await academicClient(scope.key);
  const read = await academicLibraryReader(client, revision);
  scope.assertCurrent();
  const captured = new Map<string, Uint8Array>();
  const installation = await installPrivateLibrary(async path => {
    scope.assertCurrent(); const bytes = await read(path); scope.assertCurrent();
    if (path.endsWith(".json")) captured.set(path, bytes);
    return bytes;
  }, progress, scope);
  if (installation.status === "partial") {
    throw new Error(`${installation.questionIds.length} course question${installation.questionIds.length === 1 ? " remains" : "s remain"} saved on this device, but the download is incomplete. ${installation.warnings.slice(0, 3).join(" ")} Retry this course before enrollment.`);
  }
  const bindings = await academicBindings(useStore.getState(), installation, revision, read.files, captured);
  scope.assertCurrent();
  if (typeof window !== "undefined") await import("../../pages/QuestionWorkspacePage");
  scope.assertCurrent();
  return { ...installation, bindings };
}
export async function enrollAcademicCourse(course: AcademicCourse, weeks: number[], accountId: string): Promise<void> {
  const client = await academicClient(accountId);
  const { error } = await client.rpc("academic_enroll", { collection: course.id, revision: course.current_revision_id, weeks });
  if (error) throw new Error("Your course is saved on this device. Account enrollment needs another try.");
}
