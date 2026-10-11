/** Shared catalog metadata. Never includes a learner's attempts, notes or credentials. */
export const CATALOG_BUCKET = "academic-catalog";
export const MAX_CATALOG_FILE_BYTES = 16 * 1024 * 1024;
export interface CatalogRelease { id: string; catalog_key: string; version: string; title: string; published_at: string; }
export interface CatalogEntry {
  release_id: string; id: string; kind: "template" | "bank"; title: string;
  module: string; term: string; week: number | null; question_count: number;
  image_question_count: number; activity_count: number; payload_path: string; source_label: string;
}
export interface CatalogFile { release_id: string; path: string; storage_path: string; sha256: string; byte_size: number; mime_type: string; }
export interface CatalogCourse { key: string; module: string; term: string; entries: CatalogEntry[]; }
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hash = /^[a-f\d]{64}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid catalog response.");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid catalog text.");
  return value;
}
function count(value: unknown, max = 10000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error("Invalid catalog count.");
  return value;
}
export function safeCatalogPath(value: unknown): string {
  const path = string(value);
  if (path.startsWith("/") || /[\\\x00-\x1f\x7f%?#]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe catalog path.");
  return path;
}
export function parseRelease(value: unknown): CatalogRelease {
  const r = record(value);
  if (!uuid.test(string(r.id)) || !Number.isFinite(Date.parse(string(r.published_at)))) throw new Error("Invalid catalog release.");
  return { id: r.id as string, catalog_key: string(r.catalog_key, 100), version: string(r.version, 100), title: string(r.title, 240), published_at: r.published_at as string };
}
export function parseEntry(value: unknown): CatalogEntry {
  const r = record(value);
  if (!uuid.test(string(r.release_id)) || !/^[a-zA-Z\d_-]{1,150}$/.test(string(r.id))) throw new Error("Invalid catalog identity.");
  if (r.kind !== "template" && r.kind !== "bank") throw new Error("Unknown catalog entry type.");
  const q = count(r.question_count), images = count(r.image_question_count), activities = count(r.activity_count);
  if (images > q || (r.kind === "bank" ? q < 1 || activities !== 0 : activities < 1 || q !== 0)) throw new Error("Catalog counts contradict its content type.");
  const week = r.week == null ? null : count(r.week, 104);
  if (week === 0) throw new Error("Invalid catalog week.");
  return { release_id: r.release_id as string, id: r.id as string, kind: r.kind, title: string(r.title, 300),
    module: string(r.module, 100), term: string(r.term, 100), week, question_count: q, image_question_count: images,
    activity_count: activities, payload_path: safeCatalogPath(r.payload_path), source_label: string(r.source_label) };
}
export function parseCatalogFile(value: unknown): CatalogFile {
  const r = record(value), path = safeCatalogPath(r.path), release = string(r.release_id);
  if (!uuid.test(release) || !hash.test(string(r.sha256)) || r.storage_path !== `${release}/${path}`) throw new Error("Invalid catalog asset identity.");
  const bytes = count(r.byte_size, MAX_CATALOG_FILE_BYTES);
  if (!bytes || !["application/json","text/plain","image/png","image/jpeg","image/webp","image/gif"].includes(string(r.mime_type))) throw new Error("Unsupported catalog asset.");
  return { release_id: release, path, storage_path: r.storage_path as string, sha256: r.sha256 as string, byte_size: bytes, mime_type: r.mime_type as string };
}
export function currentReleases(releases: readonly CatalogRelease[]): CatalogRelease[] {
  const result = new Map<string, CatalogRelease>();
  for (const release of [...releases].sort((a,b) => b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id))) {
    if (!result.has(release.catalog_key)) result.set(release.catalog_key, release);
  }
  return [...result.values()];
}
export function catalogCourses(entries: readonly CatalogEntry[]): CatalogCourse[] {
  const courses = new Map<string, CatalogCourse>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.term, entry.module]);
    const course = courses.get(key) ?? { key, term: entry.term, module: entry.module, entries: [] };
    if (!course.entries.some(e => e.id === entry.id && e.release_id === entry.release_id)) course.entries.push(entry);
    courses.set(key, course);
  }
  return [...courses.values()].sort((a,b) => a.term.localeCompare(b.term, undefined, { numeric: true }) || a.module.localeCompare(b.module));
}
export function selectedBanks(course: CatalogCourse, ids: readonly string[]): CatalogEntry[] {
  const selected = new Set(ids);
  const result = course.entries.filter(e => e.kind === "bank" && selected.has(`${e.release_id}:${e.id}`));
  if (!result.length) throw new Error("Select at least one question set. An empty selection never means the whole bank.");
  return result;
}
export async function verifyCatalogBytes(file: CatalogFile, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== file.byte_size || bytes.byteLength > MAX_CATALOG_FILE_BYTES) throw new Error("Catalog file size check failed.");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  const actual = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,"0")).join("");
  if (actual !== file.sha256) throw new Error("Catalog integrity check failed. No study content was changed.");
}
