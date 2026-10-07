import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fingerprintFile } from "./fingerprints";
import type { MediaProvenance } from "./model";

export type MediaAuditType = "audio" | "background-image" | "background-video" | "preview" | "unknown";

export interface MediaAuditFinding {
  path: string;
  size: number;
  mediaType: MediaAuditType;
  referenced: boolean;
  duplicate: boolean;
  duplicateKind?: "exact-duplicate" | "same-filename-different-content" | "same-content-different-filename";
  provenance: MediaProvenance;
  recommendedAction: string;
  hash?: string;
  source?: string;
}

export interface MediaAuditSummary {
  audioFiles: number;
  backgroundImages: number;
  backgroundVideos: number;
  previewFiles: number;
  totalBytes: number;
  referencedAssets: number;
  unreferencedAssets: number;
  missingReferences: number;
  probableDuplicates: number;
  sameNameCollisions: number;
  oversizedFiles: number;
  optimizationCandidates: number;
  unknownProvenance: number;
  externalLicenseUnknown: number;
}

export interface MediaMissingReference {
  path: string;
  /** Files containing the unresolved literal reference. */
  sources: string[];
}

export interface MediaAuditReport {
  generatedAt: string;
  roots: string[];
  summary: MediaAuditSummary;
  missingReferences: MediaMissingReference[];
  findings: MediaAuditFinding[];
}

export const DEFAULT_MEDIA_ROOTS = [
  "web/public",
  "web/src/data",
  "data",
  "artifacts",
  "Resources",
  "Resource",
  "axom",
];

export const DEFAULT_REFERENCE_ROOTS = [
  "web",
  "scripts",
  "data",
  "design",
  "src-tauri",
  "web/src-tauri",
];

const MEDIA_EXTENSIONS = {
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".aiff"]),
  image: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]),
  video: new Set([".mp4", ".webm", ".mov", ".m4v"]),
  preview: new Set([".png", ".jpg", ".jpeg", ".webp"]),
};

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

function mediaTypeFromPath(filePath: string): MediaAuditType {
  const ext = extname(filePath).toLowerCase();
  if (MEDIA_EXTENSIONS.audio.has(ext)) return "audio";
  if (MEDIA_EXTENSIONS.video.has(ext)) return "background-video";
  if (MEDIA_EXTENSIONS.image.has(ext)) {
    const base = basename(filePath).toLowerCase();
    if (/preview|thumb|thumbnail|cover|poster|icon/.test(base)) return "preview";
    return "background-image";
  }
  if (/preview|thumb|thumbnail|cover|poster|icon/.test(filePath.toLowerCase())) return "preview";
  return "unknown";
}

function fileSizeBytes(filePath: string): number {
  return statSync(filePath).size;
}

function shouldTreatAsAsset(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return new Set([
    ...MEDIA_EXTENSIONS.audio,
    ...MEDIA_EXTENSIONS.image,
    ...MEDIA_EXTENSIONS.video,
    ...MEDIA_EXTENSIONS.preview,
  ]).has(ext);
}

function crawlDirectory(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const items = readdirSync(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const item of items) {
    const resolved = join(directory, item.name);
    if (item.isDirectory()) {
      results.push(...crawlDirectory(resolved));
      continue;
    }
    if (shouldTreatAsAsset(resolved)) results.push(resolved);
  }
  return results;
}

function shouldScanSource(filePath: string): boolean {
  return !/(?:^|\/)(?:__tests__|test|tests|e2e|artifacts|node_modules|dist|coverage|test-results|playwright-report|\.vite)(?:\/|$)/i.test(normalizePath(filePath))
    && !/\.(?:test|spec)\.[^.]+$/i.test(filePath);
}

function stripComments(fileText: string): string {
  return fileText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const UNKNOWN_PROVENANCE: MediaProvenance = { category: "unknown" };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function provenanceForManifestEntry(value: unknown): MediaProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const explicit = nonEmptyString(entry.provenance ?? entry.category)?.toLowerCase();
  const sourceName = nonEmptyString(entry.sourceName ?? entry.credit ?? entry.creatorName ?? entry.source);
  const sourceUrl = nonEmptyString(entry.sourceUrl ?? entry.originUrl);
  const creator = nonEmptyString(entry.creator ?? entry.author);
  const license = nonEmptyString(entry.license ?? entry.licenseName);
  const retrievedAt = nonEmptyString(entry.retrievedAt ?? entry.retrievalDate);
  const modifications = nonEmptyString(entry.modifications ?? entry.modified);
  const generatedBy = nonEmptyString(entry.generatedBy);
  const userSupplied = entry.userSupplied === true || explicit?.includes("user");
  const category: MediaProvenance["category"] = userSupplied
    ? "user-supplied"
    : generatedBy || explicit?.includes("generated")
      ? "generated"
      : explicit?.includes("first-party") || explicit === "axom"
        ? "first-party"
        : sourceName || sourceUrl || creator || license
          ? "external"
          : "unknown";
  if (category === "unknown" && !retrievedAt && !modifications) return undefined;
  return { category, sourceName, sourceUrl, creator, license, retrievedAt, modifications };
}

function findManifestProvenance(value: unknown, alias: string): MediaProvenance | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findManifestProvenance(item, alias);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const normalizedAlias = normalizePath(alias).toLowerCase();
  const hasAssetReference = Object.entries(entry).some(([key, raw]) => {
    if (typeof raw !== "string" || !/(?:src|poster|path|asset|file)/i.test(key)) return false;
    const normalized = normalizePath(raw).replace(/^\.\//, "").toLowerCase();
    return normalized === normalizedAlias || normalized.endsWith(`/${normalizedAlias}`)
      || (normalized === basename(normalizedAlias) && !normalized.includes("${"));
  });
  if (hasAssetReference) return provenanceForManifestEntry(entry) ?? UNKNOWN_PROVENANCE;
  for (const nested of Object.values(entry)) {
    const found = findManifestProvenance(nested, alias);
    if (found) return found;
  }
  return undefined;
}

function provenanceFromSourceText(context: string): MediaProvenance {
  const sourceName = context.match(/\b(Pixabay|Pexels|Unsplash|Wikimedia Commons|Internet Archive)\b/i)?.[1];
  const license = context.match(/\b(CC0(?:\s+1\.0)?|CC BY(?:-NC|-SA)?(?:\s+4\.0)?|Public Domain|Pixabay Content License)\b/i)?.[1];
  if (!sourceName && !license) return UNKNOWN_PROVENANCE;
  return { category: "external", sourceName, license };
}

function collectReferencedAssetPaths(
  candidates: string[],
  assetRoots: string[],
  sourceRoots: string[],
): Map<string, { source: string; referenced: boolean; provenance: MediaProvenance }> {
  const references = new Map<string, { source: string; referenced: boolean; provenance: MediaProvenance }>();
  const basenameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const name = basename(candidate).toLowerCase();
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
    references.set(resolve(candidate), { source: "", referenced: false, provenance: UNKNOWN_PROVENANCE });
  }

  const aliases = new Map<string, string[]>();
  for (const candidate of candidates) {
    const values = new Set([normalizePath(relative(resolve("."), resolve(candidate))).toLowerCase()]);
    for (const root of assetRoots) {
      const relativePath = relative(resolve(root), resolve(candidate));
      if (relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/")) {
        values.add(normalizePath(relativePath).toLowerCase());
      }
    }
    const name = basename(candidate).toLowerCase();
    if (basenameCounts.get(name) === 1) values.add(name);
    for (const value of values) {
      if (!value) continue;
      const matches = aliases.get(value) ?? [];
      matches.push(resolve(candidate));
      aliases.set(value, matches);
    }
  }

  const searchableAliases = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const textExtensions = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|txt|yml|yaml)$/i;
  for (const root of sourceRoots.filter(existsSync)) {
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const children = readdirSync(current, { withFileTypes: true });
      for (const child of children) {
        const full = join(current, child.name);
        if (child.isDirectory()) {
          if (!shouldScanSource(full)) continue;
          queue.push(full);
          continue;
        }
        if (!textExtensions.test(full) || !shouldScanSource(full)) continue;
        const rawContent = readFileSync(full, "utf8");
        const content = stripComments(rawContent).toLowerCase();
        let manifest: unknown;
        if (extname(full).toLowerCase() === ".json") {
          try { manifest = JSON.parse(rawContent) as unknown; } catch { /* Non-JSON text is still searchable. */ }
        }
        for (const alias of searchableAliases) {
          let at = content.indexOf(alias);
          while (at !== -1) {
            const source = normalizePath(relative(resolve("."), full));
            const surrounding = content.slice(Math.max(0, at - 240), at + alias.length + 240);
            const provenance = findManifestProvenance(manifest, alias)
              ?? provenanceFromSourceText(surrounding);
            for (const candidate of aliases.get(alias) ?? []) {
              const existing = references.get(candidate);
              if (existing && (!existing.referenced || (existing.provenance.category === "unknown" && provenance.category !== "unknown"))) {
                references.set(candidate, { source, referenced: true, provenance });
              }
            }
            at = content.indexOf(alias, at + alias.length);
          }
        }
      }
    }
  }

  return references;
}

function collectMissingReferences(assetRoots: string[], sourceRoots: string[]): MediaMissingReference[] {
  const missing = new Map<string, Set<string>>();
  const textExtensions = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|txt|yml|yaml)$/i;
  const mediaReference = /["'`]([^"'`]+\.(?:mp3|wav|m4a|aac|ogg|flac|aiff|png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v))["'`]/gi;
  for (const root of sourceRoots.filter(existsSync)) {
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const child of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, child.name);
        if (child.isDirectory()) {
          if (!shouldScanSource(full)) continue;
          queue.push(full);
          continue;
        }
        if (!textExtensions.test(full) || !shouldScanSource(full)) continue;
        const content = stripComments(readFileSync(full, "utf8"));
        const matches = [...content.matchAll(mediaReference)];
        for (const match of matches) {
          const raw = match[1].replace(/\\/g, "/");
          const lineStart = content.lastIndexOf("\n", match.index ?? 0) + 1;
          const lineEnd = content.indexOf("\n", match.index ?? 0);
          const line = content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
          if (/\b(?:const|let|var)\s+[\w$]*(?:out|output|target|destination)[\w$]*\s*=/i.test(line)) continue;
          // Bare names are commonly examples, uploaded filenames, or test data.
          // Production asset references are path-shaped (e.g. scenes/rain.mp4).
          if (!raw.includes("/") || /^(https?:|data:|blob:|\/\/)/i.test(raw) || /[$<{]/.test(raw)) continue;
          if (/^\/(?:Users|tmp|private|var|home)\//i.test(raw)) continue;
          const appPath = raw.startsWith("/") ? raw.slice(1) : raw;
          const candidates = [
            ...(raw.startsWith("/") ? [] : [resolve(dirname(full), raw), resolve(raw)]),
            ...assetRoots.map((assetRoot) => resolve(assetRoot, appPath)),
          ];
          if (!candidates.some(existsSync)) {
            const sources = missing.get(raw) ?? new Set<string>();
            sources.add(normalizePath(relative(resolve("."), full)));
            missing.set(raw, sources);
          }
        }
      }
    }
  }
  return [...missing.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, sources]) => ({ path, sources: [...sources].sort() }));
}

export async function buildMediaAuditReport(
  rootPaths = DEFAULT_MEDIA_ROOTS,
  sourceRootPaths = DEFAULT_REFERENCE_ROOTS,
  lookupRootPaths: string[] = [],
): Promise<MediaAuditReport> {
  const roots = rootPaths.map((root) => normalizePath(root));
  const sourceRoots = sourceRootPaths.map((root) => normalizePath(root));
  const assets = [...new Set(roots.flatMap((root) => crawlDirectory(root)))];
  const referenceMap = collectReferencedAssetPaths(assets, roots, sourceRoots);
  const missingReferences = collectMissingReferences([...roots, ...lookupRootPaths], sourceRoots);

  const inventory: Array<{ path: string; size: number; hash: string }> = [];
  for (const path of assets) {
    const size = fileSizeBytes(path);
    const hash = await fingerprintFile(path);
    inventory.push({ path, size, hash });
  }

  const contentGroups = new Map<string, typeof inventory>();
  const nameGroups = new Map<string, typeof inventory>();
  for (const item of inventory) {
    const contentKey = `${item.size}:${item.hash}`;
    const contentGroup = contentGroups.get(contentKey) ?? [];
    contentGroup.push(item);
    contentGroups.set(contentKey, contentGroup);
    const nameKey = basename(item.path).toLowerCase();
    const nameGroup = nameGroups.get(nameKey) ?? [];
    nameGroup.push(item);
    nameGroups.set(nameKey, nameGroup);
  }
  const duplicateByPath = new Map<string, { duplicate: boolean; kind?: MediaAuditFinding["duplicateKind"] }>();
  for (const group of contentGroups.values()) {
    if (group.length < 2) continue;
    const kind = new Set(group.map((item) => basename(item.path).toLowerCase())).size === 1
      ? "exact-duplicate"
      : "same-content-different-filename";
    for (const item of group) duplicateByPath.set(resolve(item.path), { duplicate: true, kind });
  }
  for (const group of nameGroups.values()) {
    if (new Set(group.map((item) => item.hash)).size < 2) continue;
    for (const item of group) {
      if (!duplicateByPath.get(resolve(item.path))?.duplicate) {
        duplicateByPath.set(resolve(item.path), { duplicate: false, kind: "same-filename-different-content" });
      }
    }
  }

  const findings: MediaAuditFinding[] = inventory.map(({ path, size, hash }) => {
    const mediaType = mediaTypeFromPath(path);
    const pathValue = normalizePath(relative(resolve("."), resolve(path))) || normalizePath(path);
    const info = referenceMap.get(resolve(path));
    const duplicateInfo = duplicateByPath.get(resolve(path));
    const referenced = Boolean(info?.referenced);
    const provenance = info?.provenance ?? UNKNOWN_PROVENANCE;
    const recommendation = size > 20 * 1024 * 1024
      ? "Review size and playback needs before adding another copy."
      : duplicateInfo?.duplicate
        ? "Review the exact-content copy and keep one canonical original."
        : duplicateInfo?.kind === "same-filename-different-content"
          ? "Same-name files differ. Keep both until their references are checked."
          : provenance.category === "external" && !provenance.license
            ? "External source is known, but no license is recorded. Verify redistribution rights before shipping."
          : referenced
            ? "Keep and monitor; a source reference was found."
            : "No static source reference was found. Review before removing; dynamic references may not be visible.";

    return {
      path: pathValue,
      size,
      mediaType,
      referenced,
      duplicate: Boolean(duplicateInfo?.duplicate),
      duplicateKind: duplicateInfo?.kind,
      provenance,
      recommendedAction: recommendation,
      hash,
      source: info?.source || "not found by static scan",
    };
  });

  const summary: MediaAuditSummary = {
    audioFiles: findings.filter((item) => item.mediaType === "audio").length,
    backgroundImages: findings.filter((item) => item.mediaType === "background-image").length,
    backgroundVideos: findings.filter((item) => item.mediaType === "background-video").length,
    previewFiles: findings.filter((item) => item.mediaType === "preview").length,
    totalBytes: findings.reduce((sum, item) => sum + item.size, 0),
    referencedAssets: findings.filter((item) => item.referenced).length,
    unreferencedAssets: findings.filter((item) => !item.referenced).length,
    missingReferences: missingReferences.length,
    probableDuplicates: findings.filter((item) => item.duplicate).length,
    sameNameCollisions: findings.filter((item) => item.duplicateKind === "same-filename-different-content").length,
    oversizedFiles: findings.filter((item) => item.size > 20 * 1024 * 1024).length,
    optimizationCandidates: findings.filter((item) => item.size > 10 * 1024 * 1024 || item.mediaType === "background-video").length,
    unknownProvenance: findings.filter((item) => item.provenance.category === "unknown").length,
    externalLicenseUnknown: findings.filter((item) => item.provenance.category === "external" && !item.provenance.license).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    roots,
    summary,
    missingReferences,
    findings,
  };
}

export function formatMediaAuditReport(report: MediaAuditReport): string {
  const lines: string[] = [
    "AXOM Media Audit",
    "",
    "Audio files: " + report.summary.audioFiles,
    "Background images: " + report.summary.backgroundImages,
    "Background videos: " + report.summary.backgroundVideos,
    "Preview files: " + report.summary.previewFiles,
    "Total bytes: " + report.summary.totalBytes,
    "",
    "Referenced assets: " + report.summary.referencedAssets,
    "Unreferenced assets: " + report.summary.unreferencedAssets,
    "Missing references: " + report.summary.missingReferences,
    "Probable duplicates: " + report.summary.probableDuplicates,
    "Same-name collisions: " + report.summary.sameNameCollisions,
    "Oversized files: " + report.summary.oversizedFiles,
    "Optimization candidates: " + report.summary.optimizationCandidates,
    "Unknown provenance: " + report.summary.unknownProvenance,
    "External assets without a recorded license: " + report.summary.externalLicenseUnknown,
    ...(report.missingReferences.length
      ? ["", "Missing paths:", ...report.missingReferences.map(({ path, sources }) => `  ${path} · ${sources.join(", ")}`)]
      : []),
    "",
    ...report.findings.slice(0, 20).map((item) => [
      `${item.path} | size=${item.size} | type=${item.mediaType} | referenced=${item.referenced} | duplicate=${item.duplicate} | provenance=${item.provenance.category}${item.provenance.sourceName ? ` (${item.provenance.sourceName})` : ""}`,
      `  action: ${item.recommendedAction}`,
    ].join("\n")),
  ];
  return lines.join("\n");
}
