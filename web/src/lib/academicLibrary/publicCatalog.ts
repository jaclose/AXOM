import { loadSupabase } from "../account/supabase";
import { academicClient, type AcademicCourse } from "./client";

/** A course a reviewer offers to visitors without an account. Catalog metadata only. */
export interface PublicCourse {
  id: string;
  title: string;
  module: string;
  term: string;
  academic_term?: string;
  cohort?: string;
  current_revision_id: string;
  ready_questions: number;
  has_plan: boolean;
}
/** The offered course with its plan text, for a weekly preview. */
export interface PublicCoursePreview extends Omit<PublicCourse, "has_plan"> {
  source_revision?: string;
  template_text: string;
}
export type PublicOfferState = "offered" | "not-offered" | "unavailable";

const MAX_PLAN_BYTES = 262_144;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const label = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const optionalLabel = (value: unknown): boolean => value == null || (typeof value === "string" && value.length <= 80);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
/** PostgREST answers PGRST202 when a function is absent: the catalog is not enabled on this backend yet. */
const notEnabled = (error: { code?: string }): boolean => error.code === "PGRST202";

function readShared(row: Record<string, unknown>): Omit<PublicCourse, "has_plan"> {
  if (!uuid(row.id) || !uuid(row.current_revision_id) || !label(row.title, 180) || !label(row.module, 80) || !label(row.term, 80)
    || !optionalLabel(row.academic_term) || !optionalLabel(row.cohort) || !count(row.ready_questions)) throw new Error("The catalog response is invalid.");
  return {
    id: row.id, title: row.title, module: row.module, term: row.term, current_revision_id: row.current_revision_id, ready_questions: row.ready_questions,
    ...(typeof row.academic_term === "string" && row.academic_term ? { academic_term: row.academic_term } : {}),
    ...(typeof row.cohort === "string" && row.cohort ? { cohort: row.cohort } : {}),
  };
}

/**
 * Courses offered to everyone, in curriculum order, 24 to a page. Works signed
 * out. A backend that does not have the visitor catalog yet answers as an
 * empty catalog, so an older database never shows a visitor an error.
 */
export async function listPublicCourses(search = "", term = "", afterId?: string): Promise<PublicCourse[]> {
  const client = await loadSupabase();
  if (!client) return [];
  const { data, error } = await client.rpc("academic_public_catalog", { search, term_filter: term, after_id: afterId ?? null });
  if (error) {
    if (notEnabled(error)) return [];
    throw new Error("The course catalog could not be loaded. Check your connection and retry.");
  }
  if (!Array.isArray(data) || data.length > 24) throw new Error("The catalog response is invalid.");
  return data.map(row => {
    if (!row || typeof row !== "object" || typeof (row as { has_plan?: unknown }).has_plan !== "boolean") throw new Error("The catalog response is invalid.");
    return { ...readShared(row as Record<string, unknown>), has_plan: (row as { has_plan: boolean }).has_plan };
  });
}

/** One offered course with its plan text, or null when it is not offered to visitors. */
export async function getPublicCourse(collection: string): Promise<PublicCoursePreview | null> {
  const client = await loadSupabase();
  if (!client) return null;
  const { data, error } = await client.rpc("academic_public_course", { collection });
  if (error) {
    if (notEnabled(error)) return null;
    throw new Error("This course could not be opened. Check your connection and retry.");
  }
  if (data == null) return null;
  const row = data as Record<string, unknown>;
  const shared = readShared(row);
  if (shared.id !== collection) throw new Error("The course identity did not match this link.");
  if (typeof row.template_text !== "string" || new TextEncoder().encode(row.template_text).length > MAX_PLAN_BYTES
    || !optionalLabel(row.source_revision)) throw new Error("The catalog response is invalid.");
  return { ...shared, template_text: row.template_text,
    ...(typeof row.source_revision === "string" && row.source_revision ? { source_revision: row.source_revision } : {}) };
}

/** The account catalog and the visitor catalog render through the same course cards. */
export function publicCatalogCourse(course: PublicCourse | PublicCoursePreview): AcademicCourse {
  return {
    id: course.id, title: course.title, module: course.module, term: course.term,
    ...(course.academic_term ? { academic_term: course.academic_term } : {}),
    ...(course.cohort ? { cohort: course.cohort } : {}),
    visibility: "shared", review_status: "approved", current_revision_id: course.current_revision_id,
    owned: false, ready_questions: course.ready_questions, review_questions: 0,
  };
}

/** Whether visitors can see this course now. "unavailable" covers any failure,
 * including a backend without the visitor catalog, and offers no control. */
export async function publicOfferState(collection: string, accountId: string): Promise<PublicOfferState> {
  try {
    const { data, error } = await (await academicClient(accountId)).rpc("academic_is_public", { collection });
    if (error || typeof data !== "boolean") return "unavailable";
    return data ? "offered" : "not-offered";
  } catch {
    return "unavailable";
  }
}

/**
 * Offer the course's current revision to visitors, or end the offer. The
 * server binds an offer to the revision named here and refuses it when the
 * course changed, lost its approval or is no longer shared.
 */
export async function offerCoursePublicly(course: Pick<AcademicCourse, "id" | "current_revision_id">, offered: boolean, accountId: string): Promise<void> {
  const { error } = await (await academicClient(accountId)).rpc("academic_offer_publicly",
    { collection: course.id, offered, expected_revision: course.current_revision_id });
  if (!error) return;
  if (error.code === "40001") throw new Error("This course changed. Refresh it, check its current revision, then decide again.");
  if (error.code === "42501") throw new Error(offered
    ? "Only the reviewer who owns an approved, shared course can offer it to visitors."
    : "Only the course owner or a reviewer can end this offer.");
  throw new Error("The decision could not be saved. Refresh the course to check what visitors see, then retry.");
}
