import type { CurriculumTemplate } from "../curricula";
import type { Course, Resource, Term, TrackerItem } from "../types";
import type { CourseActivity } from "./activity";
import { canonicalModuleKey } from "./vocabulary.ts";

/**
 * Course bookmark references are metadata from the learner's own browser.
 * They are not course schedules, official week evidence, or proof of access
 * to a protected recording. User approval is required before saving them.
 */
export interface AcademicBookmarkOwner {
  term: string;
  course: string;
  module: string;
  /** An account-independent identity used only to filter private Resources. */
  key: string;
}
export interface AcademicBookmarkEvidence {
  url: string;
  title: string;
  provider: "sgu-panopto";
  moduleToken?: string;
  activity?: CourseActivity;
  activityNumber?: number;
  part?: string;
  /** Optional learner-created browser folder path, not a verified school calendar. */
  folderPath?: string[];
  /** A uniquely matching folder path suggests a module but cannot approve it. */
  suggestedOwnerKey?: string;
  /** A week mentioned in the title is not an official school calendar. */
  mentionedWeek?: number;
  candidates: AcademicBookmarkOwner[];
  assignment: "unique-candidate" | "needs-course-review" | "unassigned";
}
export interface AcademicBookmarkIndex {
  totalLinks: number;
  providerLinks: number;
  excludedProviderLinks: number;
  duplicateVideoLinks: number;
  videos: AcademicBookmarkEvidence[];
}

const MAX_HTML_LENGTH = 6_000_000;
const MAX_BOOKMARKS = 10_000;
const PANOPTO_HOST = "sgu1.hosted.panopto.com";
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

const keyOfTerm = (value: string): string => {
  const matched = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return matched ? `term${Number(matched[1])}` : value.toLowerCase().replace(/[^a-z0-9]+/g, "");
};
const keyOfCourse = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const academicBookmarkOwnerKey = (term: string, course: string, module: string): string =>
  `${keyOfTerm(term)}/${keyOfCourse(course)}/${canonicalModuleKey(module)}`;

/** Only a known viewer UUID; never retain arbitrary bookmark query tokens. */
export function canonicalPanoptoVideoUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.hostname !== PANOPTO_HOST || url.port
      || url.username || url.password || url.pathname.toLowerCase() !== "/panopto/pages/viewer.aspx") return undefined;
    const ids = url.searchParams.getAll("id");
    if (ids.length !== 1 || !UUID.test(ids[0])) return undefined;
    return `https://${PANOPTO_HOST}/Panopto/Pages/Viewer.aspx?id=${ids[0].toLowerCase()}`;
  } catch {
    return undefined;
  }
}

function decodeBookmarkText(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (full, entity: string) => {
    const term = entity.toLowerCase();
    if (term.startsWith("#")) {
      const value = term.startsWith("#x") ? Number.parseInt(term.slice(2), 16) : Number.parseInt(term.slice(1), 10);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
        ? String.fromCodePoint(value) : "";
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", } as Record<string, string>)[term] ?? full;
  }).trim().replace(/\s+/g, " ").slice(0, 240);
}

/** Read Chrome/Safari Netscape HTML exports as inert text, never executable DOM. */
export function parseBookmarkHtml(html: string): Array<{ title: string; url: string; folderPath?: string[] }> {
  if (html.length > MAX_HTML_LENGTH) throw new Error("Bookmark export exceeds AXOM's 6 MB review limit.");
  const anchors: Array<{ title: string; url: string; folderPath?: string[] }> = [];
  // Netscape bookmark exports nest folders as <H3> followed by <DL>. Read
  // tags only; never instantiate an HTML DOM or execute linked resources.
  const tokens = /<\/?dl\b[^>]*>|<h3\b[^>]*>[\s\S]*?<\/h3\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  const folders: string[] = [];
  let pendingFolder: string | undefined;
  for (const match of html.matchAll(tokens)) {
    const token = match[0];
    if (/^<h3\b/i.test(token)) {
      pendingFolder = decodeBookmarkText(token.replace(/^<h3\b[^>]*>/i, "").replace(/<\/h3\s*>$/i, ""));
      continue;
    }
    if (/^<dl\b/i.test(token)) { folders.push(pendingFolder ?? ""); pendingFolder = undefined; continue; }
    if (/^<\/dl\b/i.test(token)) { folders.pop(); pendingFolder = undefined; continue; }
    if (anchors.length >= MAX_BOOKMARKS) throw new Error("Review the export in smaller batches (10,000 links maximum).");
    const link = token.match(/^<a\b([^>]*)>([\s\S]*?)<\/a\s*>$/i);
    if (!link) continue;
    const href = link[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!href) continue;
    const title = decodeBookmarkText(link[2]);
    const url = decodeBookmarkText(href[1] ?? href[2] ?? "");
    const folderPath = folders.filter(Boolean);
    if (title && url) anchors.push({ title, url, ...(folderPath.length ? { folderPath } : {}) });
  }
  return anchors;
}

function parseTitle(title: string): Pick<AcademicBookmarkEvidence, "moduleToken" | "activity" | "activityNumber" | "part" | "mentionedWeek"> {
  const mention = title.match(/\b(?:week|wk)\s*0*(\d{1,2})\b/i);
  const mentionedWeek = mention ? Number(mention[1]) : undefined;
  const prefix = title.match(/^([A-Z]{2,8}(?:\s*[- ]?\s*[1-5])?)\s+(lecture|lec|dlas?|small\s+groups?|sg|imcq|esoft|lab)\b\s*#?\s*(\d{1,3})([A-Z])?(?=\s|[:;,_.-]|$)/i);
  const partial = prefix || title.match(/^([A-Z]{2,8}(?:\s*[- ]?\s*[1-5])?)\s+(lecture|lec|dlas?|small\s+groups?|sg|imcq|esoft|lab)\b/i);
  if (!partial) return mentionedWeek ? { mentionedWeek } : {};
  const type = partial[2].toLowerCase();
  const activity: CourseActivity = /^(lecture|lec)$/.test(type) ? "lecture"
    : type.startsWith("dla") ? "dla"
      : type.startsWith("small") || type === "sg" ? "small-group"
        : type === "imcq" ? "imcq"
          : type === "esoft" ? "esoft" : "lab";
  const activityNumber = prefix ? Number(prefix[3]) : undefined;
  return {
    moduleToken: partial[1].replace(/\s+/g, "").replace(/-/g, "").toUpperCase(),
    activity,
    ...(activityNumber ? { activityNumber } : {}),
    ...(prefix?.[4] ? { part: prefix[4].toUpperCase() } : {}),
    ...(mentionedWeek ? { mentionedWeek } : {}),
  };
}

function academicModuleOwners(curriculum: CurriculumTemplate): AcademicBookmarkOwner[] {
  return curriculum.terms.filter((term) => /^Term\s+[1-5]$/i.test(term.name)).flatMap((term) =>
    term.courses.flatMap((course) => course.modules.map((module) => ({
      term: term.name, course: course.code, module,
      key: academicBookmarkOwnerKey(term.name, course.code, module),
    }))));
}
function ownersForPrefix(token: string | undefined, owners: AcademicBookmarkOwner[]): AcademicBookmarkOwner[] {
  if (!token) return [];
  const key = canonicalModuleKey(token);
  const exact = owners.filter((owner) => canonicalModuleKey(owner.module) === key);
  if (exact.length) return exact;
  // "NB" is NOT "NB2": treat all NB1, NB2, NB3 as candidates,
  // including modules whose lecture schedules have not been imported yet.
  return /^[A-Z]{2,8}$/.test(token) ? owners.filter((owner) =>
    new RegExp(`^${key}[1-9]$`).test(canonicalModuleKey(owner.module))) : [];
}

/** A learner folder may suggest which NB or FTM module they meant. It never certifies a calendar week. */
function folderSuggestedOwner(folderPath: readonly string[] | undefined, candidates: readonly AcademicBookmarkOwner[]): string | undefined {
  if (!folderPath?.length || candidates.length < 2) return undefined;
  const terms = [...new Set(folderPath.filter((part) => /^(?:t|term)\s*[1-5]$/i.test(part.trim())).map(keyOfTerm))];
  if (terms.length > 1) return undefined;
  const moduleNames = new Set(folderPath.map(canonicalModuleKey));
  const matched = candidates.filter((candidate) =>
    moduleNames.has(canonicalModuleKey(candidate.module))
    && (!terms.length || keyOfTerm(candidate.term) === terms[0]));
  return matched.length === 1 ? matched[0].key : undefined;
}

export function indexAcademicBookmarks(
  input: readonly { title: string; url: string; folderPath?: readonly string[] }[],
  curriculum: CurriculumTemplate,
): AcademicBookmarkIndex {
  const owners = academicModuleOwners(curriculum);
  const seen = new Set<string>();
  const videos: AcademicBookmarkEvidence[] = [];
  let providerLinks = 0;
  let excludedProviderLinks = 0;
  let duplicateVideoLinks = 0;
  for (const source of input) {
    let domain: string;
    try { domain = new URL(source.url).hostname; } catch { continue; }
    if (domain !== PANOPTO_HOST) continue;
    providerLinks += 1;
    const url = canonicalPanoptoVideoUrl(source.url);
    if (!url || !source.title.trim()) { excludedProviderLinks += 1; continue; }
    if (seen.has(url)) { duplicateVideoLinks += 1; continue; }
    seen.add(url);
    const evidence = parseTitle(source.title);
    const candidates = ownersForPrefix(evidence.moduleToken, owners);
    const suggestedOwnerKey = folderSuggestedOwner(source.folderPath, candidates);
    videos.push({
      title: source.title.trim().slice(0, 240),
      url,
      provider: "sgu-panopto",
      ...evidence,
      ...(source.folderPath?.length ? { folderPath: [...source.folderPath] } : {}),
      ...(suggestedOwnerKey ? { suggestedOwnerKey } : {}),
      candidates,
      assignment: candidates.length === 1 ? "unique-candidate"
        : candidates.length ? "needs-course-review" : "unassigned",
    });
  }
  return { totalLinks: input.length, providerLinks, excludedProviderLinks, duplicateVideoLinks, videos };
}

/** Exact, human-reviewable activity candidates. A number is NOT proof of a recording's week. */
export function bookmarkActivityCandidates(
  bookmark: AcademicBookmarkEvidence, owner: AcademicBookmarkOwner,
  tracker: readonly Pick<TrackerItem, "id" | "path" | "label" | "templateKey" | "activity">[],
): Array<Pick<TrackerItem, "id" | "path" | "label">> {
  if (!bookmark.activityNumber || !bookmark.activity || !bookmark.candidates.some((candidate) => candidate.key === owner.key)) return [];
  return tracker.filter((item) => {
    if (!item.templateKey || !item.activity) return false;
    const parts = item.path.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    const moduleIndex = parts.length - (/^(?:week\s*\d+|unscheduled)$/i.test(last) ? 2 : 1);
    // Refuse old module-only paths: without the course segment the same NB2
    // number could belong to a different school course or a personal plan.
    if (moduleIndex < 2 || keyOfTerm(parts[0]) !== keyOfTerm(owner.term)
      || keyOfCourse(parts[1]) !== keyOfCourse(owner.course)
      || canonicalModuleKey(parts[moduleIndex]) !== canonicalModuleKey(owner.module)) return false;
    const kind = item.activity === "flipped-lecture" ? "lecture" : item.activity;
    const expectedKind = bookmark.activity === "flipped-lecture" ? "lecture" : bookmark.activity;
    if (kind !== expectedKind) return false;
    const identity = item.templateKey.split("|");
    return identity.at(-2) === kind && identity.at(-1) === String(bookmark.activityNumber);
  }).map(({ id, label, path }) => ({ id, label, path }));
}

/** Activity association is opt-in and backed by an exact template identity. */
export function asActivityLinkedBookmarkResource(
  bookmark: AcademicBookmarkEvidence, owner: AcademicBookmarkOwner,
  trackerItem: Pick<TrackerItem, "id" | "path" | "label" | "templateKey" | "activity">,
): Omit<Resource, "id" | "created"> {
  if (!bookmarkActivityCandidates(bookmark, owner, [trackerItem]).some((candidate) => candidate.id === trackerItem.id)) {
    throw new Error("Selected study recording no longer matches the source activity; review before saving.");
  }
  const base = asAcademicResource(bookmark, owner);
  return { ...base, tags: [...base.tags, `academic:tracker:${trackerItem.id}`],
    note: `${base.note} The learner manually linked it to one tracker activity; this is not source-verified school timing.` };
}

export function asAcademicResource(
  item: AcademicBookmarkEvidence,
  owner?: AcademicBookmarkOwner,
): Omit<Resource, "id" | "created"> {
  if (owner && !item.candidates.some((entry) => entry.key === owner.key)) {
    throw new Error("The selected module does not match the bookmark's original title evidence.");
  }
  return {
    title: item.title, url: item.url,
    category: "Academic videos",
    tags: ["axom:academic-panopto", "axom:unverified-school-week", "axom:bookmark-title-evidence",
      ...(owner ? [`academic:owner:${owner.key}`] : ["axom:unassigned-course"])],
    note: "Personally bookmarked SGU recording; access may require authorization. The bookmark title alone does not prove official academic term, week, or activity identity.",
  };
}

export function academicResourcesForTrackerScope(
  scope: string, resources: readonly Resource[], terms: readonly Term[], courses: readonly Course[],
): Resource[] {
  const parts = scope.split("/").filter(Boolean);
  const term = parts[0];
  const hasWeek = /^(?:week\s*\d+|unscheduled)$/i.test(parts.at(-1) ?? "");
  const moduleIndex = parts.length - (hasWeek ? 2 : 1);
  if (!term || moduleIndex < 1) return [];
  const module = parts[moduleIndex];
  const explicitCourse = moduleIndex > 1 ? parts[1] : undefined;
  const termIds = new Set(terms.filter((entry) => keyOfTerm(entry.name) === keyOfTerm(term)).map((entry) => entry.id));
  const matchingOwners = courses.filter((course) => termIds.has(course.termId)
    && course.modules.some((entry) => canonicalModuleKey(entry.name) === canonicalModuleKey(module))
    && (!explicitCourse || keyOfCourse(course.code) === keyOfCourse(explicitCourse)));
  if (matchingOwners.length !== 1) return [];
  const wanted = `academic:owner:${academicBookmarkOwnerKey(term, matchingOwners[0].code, module)}`;
  return resources.filter((item) =>
    item.tags.includes("axom:academic-panopto")
    && item.tags.includes(wanted)
    && canonicalPanoptoVideoUrl(item.url) !== undefined);
}
