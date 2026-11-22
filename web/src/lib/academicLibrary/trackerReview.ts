import { accountOperationClient } from "../account/supabase";
import { sha256 } from "../question-content/assets";
import { readCatalog, safeLibraryPath } from "../privateLibrary/install";
import { academicLibraryReader } from "./client";
import { academicCoursePlan, joinAcademicPlanSections, moduleIdentity, splitAcademicPlanSections } from "./coursePlan";
import type { ReviewedFilingTerm } from "../privateLibrary/types";

const encode = (value: string) => new TextEncoder().encode(value);
const hash = async (value: Uint8Array) => (await sha256(value)).slice(7);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
const hasControl = (value: string) => [...value].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
const fail = () => new Error("This exact stored tracker is unavailable or changed. Refresh the queue and check its plan again.");

export interface TrackerPlanObservation {
  activities: number;
  statedWeekActivities: number;
  unstatedWeekActivities: number;
  sections: number;
  warnings: string[];
}

export interface TrackerReviewReceipt extends TrackerPlanObservation {
  reviewerId: string;
  collectionId: string;
  revisionId: string;
  contentHash: string;
  templateHash: string;
  manifestHash: string;
  templateText: string;
  module: string;
  term: string;
}

/** Observe the submitted plan only. Blank groups and lecture order never
 * become verified week assignments, and uncertainty notes remain unchanged. */
export function inspectTrackerPlan(text: string, expected: { module: string; term: string }): TrackerPlanObservation {
  if (typeof text !== "string" || !text.trim() || encode(text).length > 262144
    || !/^Term [1-5]$/.test(expected.term) || !moduleIdentity(expected.module)) throw fail();
  const texts = splitAcademicPlanSections(text);
  if (texts.length > 24) throw fail();
  for (const section of texts) {
    const heading = section.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim())
      .find(line => line && !line.startsWith("@"));
    if (!heading || heading.includes("[") || heading.includes("]") || !/\s[-–]\s/.test(heading)
      || /^(?:week|wk|unscheduled)(?:\s|:|$)/i.test(heading)
      || !heading.replace(/^.*\s[-–]\s/, "").replace(/:\s*$/, "").trim()) throw fail();
    // The canonical parser accepts Week 0/61 headings, so this approval
    // boundary explicitly rejects out-of-range source and activity weeks.
    for (const line of section.split(/\r?\n/)) {
      if (hasControl(line.trim())) throw fail();
      const week = line.match(/^(?:week|wk)\s*0*(\d+)\s*:?\s*$/i);
      if (week && (Number(week[1]) < 1 || Number(week[1]) > 60)) throw fail();
      if (/\[[^\]]+\]\s*$/.test(line)) {
        const named = line.match(/(?:^|[^a-z0-9])(?:week|wk)\s*0*(\d+)(?!\d)/i);
        if (named && (Number(named[1]) < 1 || Number(named[1]) > 60)) throw fail();
      }
    }
  }
  const plan = academicCoursePlan(texts, { term: expected.term as ReviewedFilingTerm, evidence: "human-reviewed" });
  if (moduleIdentity(plan.module) !== moduleIdentity(expected.module) || plan.term !== expected.term) throw fail();
  const items = plan.sections.flatMap(section => section.items);
  if (!items.length || items.length > 10000 || items.some(item => item.statedWeek !== undefined
    && (!Number.isInteger(item.statedWeek) || item.statedWeek < 1 || item.statedWeek > 60))) throw fail();
  const statedWeekActivities = items.filter(item => item.statedWeek !== undefined).length;
  const warnings = /unverified|unconfirmed|requires? review|unknown|unresolved/i.test(text)
    ? ["The submitted source flags uncertainty. This approval preserves those notes and does not certify week placement."] : [];
  return { activities: items.length, statedWeekActivities, unstatedWeekActivities: items.length - statedWeekActivities,
    sections: texts.length, warnings };
}

interface ManifestFile { path: string; sha256: string; byte_size: number; mime_type: string; object_path: string }
/** Match PostgreSQL COLLATE C over UTF-8, including non-ASCII template names. */
function comparePath(left: ManifestFile, right: ManifestFile): number {
  const a = encode(left.path), b = encode(right.path);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

export async function trackerManifestHash(files: readonly ManifestFile[], collectionId: string): Promise<string> {
  if (files.length < 2 || files.length > 25 || new Set(files.map(file => file.path)).size !== files.length) throw fail();
  let catalogs = 0;
  for (const file of files) {
    safeLibraryPath(file.path);
    if (hasControl(file.path) || !digest(file.sha256)
      || !Number.isSafeInteger(file.byte_size) || file.byte_size < 1 || file.byte_size > 262144
      || file.object_path !== `${collectionId}/${file.sha256}`) throw fail();
    if (file.path === "catalog.json" && file.mime_type === "application/json") catalogs++;
    else if (!/^templates\/.+\.txt$/.test(file.path) || file.mime_type !== "text/plain") throw fail();
  }
  if (catalogs !== 1) throw fail();
  return hash(encode([...files].sort(comparePath).map(file =>
    `${file.path}\n${file.sha256}\n${file.byte_size}\n${file.mime_type}\n${file.object_path}\n`).join("")));
}

/** Read-only inspection through the initiating account's pinned session. No
 * import, local save, readiness changes or factual attestation happens here. */
export async function inspectStoredTrackerRevision(collectionId: string, revisionId: string, accountId: string): Promise<TrackerReviewReceipt> {
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen the review queue.");
  await operation.assertCurrent();
  const target = await operation.client.rpc("academic_tracker_review_target", { collection: collectionId, revision: revisionId });
  await operation.assertCurrent();
  const row: unknown = target.data;
  if (target.error || !record(row) || row.collection_id !== collectionId || row.revision_id !== revisionId || row.reviewer_id !== accountId
    || row.ready_questions !== 0 || row.review_questions !== 0 || !digest(row.content_hash)
    || !digest(row.template_hash) || !digest(row.manifest_hash) || typeof row.template_text !== "string"
    || typeof row.module !== "string" || typeof row.term !== "string" || !record(row.shape)) throw fail();
  const shape = row.shape;
  if (![shape.activities, shape.stated_week_activities, shape.unstated_week_activities, shape.sections].every(integer)) throw fail();
  const observation = inspectTrackerPlan(row.template_text, { module: row.module, term: row.term });
  if (observation.activities !== shape.activities || observation.statedWeekActivities !== shape.stated_week_activities
    || observation.unstatedWeekActivities !== shape.unstated_week_activities || observation.sections !== shape.sections
    || await hash(encode(row.template_text)) !== row.template_hash) throw fail();
  const reader = await academicLibraryReader(operation.client, revisionId);
  await operation.assertCurrent();
  if (await trackerManifestHash(reader.files, collectionId) !== row.manifest_hash) throw fail();
  const files = new Map(reader.files.map(file => [file.path, file]));
  const verifiedRead = async (path: string) => {
    const file = files.get(path);
    if (!file) throw fail();
    const bytes = await reader(path);
    await operation.assertCurrent();
    if (bytes.length !== file.byte_size || await hash(bytes) !== file.sha256) throw fail();
    return bytes;
  };
  const catalogValue: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await verifiedRead("catalog.json")));
  const catalog = readCatalog(catalogValue);
  // Closed tracker envelope: accepting unknown fields could hide an embedded
  // bank from readCatalog, which intentionally accepts legacy metadata.
  if (!record(catalogValue) || Object.keys(catalogValue).some(key => !["format", "schemaVersion", "id", "version", "preparerVersion", "templates", "sources"].includes(key))
    || catalog.sources.length !== 0 || catalog.templates.length < 1 || catalog.templates.length > 24
    || catalog.templates.length + 1 !== reader.files.length) throw fail();
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const template of catalog.templates) {
    if (!record(template) || Object.keys(template).some(key => !["file", "name", "checksum"].includes(key))
      || seen.has(template.file) || files.get(template.file)?.sha256 !== template.checksum) throw fail();
    seen.add(template.file);
    texts.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await verifiedRead(template.file)));
  }
  if (joinAcademicPlanSections(texts) !== row.template_text) throw fail();
  await operation.assertCurrent();
  return { collectionId, revisionId, reviewerId: accountId, contentHash: row.content_hash, templateHash: row.template_hash,
    manifestHash: row.manifest_hash, templateText: row.template_text, module: row.module, term: row.term, ...observation };
}

/** The single RPC rechecks hashes, shape, pending audience and both row locks;
 * it derives reviewer identity server-side and records approval atomically. */
export async function approveStoredTrackerRevision(receipt: TrackerReviewReceipt, accountId: string, planReviewed: boolean): Promise<void> {
  if (!planReviewed || receipt.reviewerId !== accountId || !digest(receipt.contentHash) || !digest(receipt.templateHash) || !digest(receipt.manifestHash)) throw fail();
  const observation = inspectTrackerPlan(receipt.templateText, receipt);
  if (observation.activities !== receipt.activities || observation.statedWeekActivities !== receipt.statedWeekActivities
    || observation.unstatedWeekActivities !== receipt.unstatedWeekActivities
    || await hash(encode(receipt.templateText)) !== receipt.templateHash) throw fail();
  const operation = await accountOperationClient();
  if (operation.userId !== accountId) throw new Error("The signed-in account changed. Reopen the review queue.");
  await operation.assertCurrent();
  const result = await operation.client.rpc("academic_approve_tracker", {
    collection: receipt.collectionId, revision: receipt.revisionId, content_hash: receipt.contentHash,
    template_hash: receipt.templateHash, manifest_hash: receipt.manifestHash,
    observed_activities: receipt.activities, observed_stated_week_activities: receipt.statedWeekActivities, plan_reviewed: true,
  });
  await operation.assertCurrent();
  const saved: unknown = result.data;
  if (result.error || !record(saved) || saved.collection_id !== receipt.collectionId || saved.revision_id !== receipt.revisionId
    || saved.reviewer_id !== accountId || saved.content_hash !== receipt.contentHash || saved.template_hash !== receipt.templateHash
    || saved.manifest_hash !== receipt.manifestHash || typeof saved.reviewed_at !== "string" || !Number.isFinite(Date.parse(saved.reviewed_at))) {
    throw new Error("The tracker review could not be confirmed. Refresh the queue before retrying; its revision or review status may have changed.");
  }
}
