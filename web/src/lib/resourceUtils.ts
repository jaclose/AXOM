import type { Resource } from "./types";

export const RESOURCE_GROUPS = [
  "Personal Core",
  "Medical School / Course",
  "Anki / Boards",
  "MCAT",
  "Pre-Med",
  "Step 1",
  "Step 2 / Clinical",
  "Community Wikis",
  "Automation / AI Tools",
  "External Archives",
  "Reference",
  "Question Banks",
  "General",
] as const;

export const SOURCE_TYPES = ["Google Drive", "MEGA", "Notion", "Other"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export function normalizeResourceUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    ["usp", "pvs", "pli", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => {
      url.searchParams.delete(key);
    });
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return withProtocol;
  }
}

export function usableResourceHref(input: string): string | null {
  try {
    const parsed = new URL(normalizeResourceUrl(input));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function hostOfResource(input: string): string {
  try {
    return new URL(normalizeResourceUrl(input)).hostname.replace(/^www\./, "");
  } catch {
    return input;
  }
}

export function resourceSourceType(input: string): SourceType {
  const host = hostOfResource(input).toLowerCase();
  if (host.includes("drive.google.com")) return "Google Drive";
  if (host.includes("mega.nz")) return "MEGA";
  if (host.includes("notion.site") || host.includes("notion.so")) return "Notion";
  return "Other";
}

export function resourceGroup(resource: Pick<Resource, "category" | "tags" | "title">): string {
  if (resource.category === "Drives") {
    const first = resource.tags?.[0];
    if (first && !["sgu", "shared", "drive"].includes(first.toLowerCase())) return first;
    return "Medical School / Course";
  }
  if (/mcat/i.test(resource.category)) return "MCAT";
  if (/pre[-\s]?med|amcas|aacom/i.test(resource.category)) return "Pre-Med";
  if (/step\s*2|shelf|clinical/i.test(resource.category)) return "Step 2 / Clinical";
  if (/step\s*1|usmle/i.test(resource.category)) return "Step 1";
  if (/anki|board|step\s*2/i.test(resource.category)) return "Anki / Boards";
  if (/tool|ai|automation/i.test(resource.category)) return "Automation / AI Tools";
  return resource.category || "General";
}

export function resourceAudience(resource: Pick<Resource, "title" | "tags" | "favorite">): "Personal" | "Public" {
  const haystack = `${resource.title} ${resource.tags?.join(" ") ?? ""}`.toLowerCase();
  return resource.favorite || /\b(my|mine|personal|jd|claudfather)\b/.test(haystack) ? "Personal" : "Public";
}

export function resourceSortScore(resource: Resource): number {
  const title = resource.title.toLowerCase();
  if (title.startsWith("my drive") || title.includes("claudfather auto")) return -200;
  if (resourceAudience(resource) === "Personal") return -150;
  return -(resource.rating ?? 0);
}

// Which drives are personal (always shown), SGU-specific (hidden when the SGU
// toggle is off), or universally useful (board/step packs, shown to everyone).
const PERSONAL_DRIVE_TITLES = new Set(["my drive", "claudfather", "madcow"]);
const SGU_DRIVE_TITLES = new Set([
  "sgu materials",
  "sgu silly goose wiki",
  "last ditch pq's and review",
  "nana's practice questions",
  "schedules & anki",
]);

export type DriveScope = "personal" | "sgu" | "universal";

export function driveScope(resource: Pick<Resource, "title" | "tags">): DriveScope {
  const title = resource.title.trim().toLowerCase();
  if (PERSONAL_DRIVE_TITLES.has(title)) return "personal";
  const tags = (resource.tags ?? []).map((t) => t.toLowerCase());
  if (SGU_DRIVE_TITLES.has(title) || /\bsgu\b/.test(title) || tags.includes("sgu")) return "sgu";
  return "universal";
}

/** A drive is visible when it isn't SGU-scoped, or the SGU toggle is on. */
export function isDriveVisibleForTrack(
  resource: Pick<Resource, "title" | "tags">,
  showSgu: boolean,
): boolean {
  return showSgu || driveScope(resource) !== "sgu";
}
