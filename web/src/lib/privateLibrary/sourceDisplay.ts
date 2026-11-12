/** Source names shown in the QBank review UI. Presentation metadata is not authority. */
export interface PreparedSourcePresentation {
  title: string;
  scope: string;
  originalName: string;
}
interface CatalogSource {
  readonly name: string;
  readonly module?: string;
}
function label(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return undefined;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
/** Keep the original name/checksum/held state intact; use bank metadata only for a visible label. */
export function preparedSourcePresentation(source: CatalogSource, rawReview?: string): PreparedSourcePresentation {
  const fallback: PreparedSourcePresentation = {
    title: source.name,
    scope: source.module || "Unfiled",
    originalName: source.name,
  };
  if (!rawReview) return fallback;
  try {
    const record = JSON.parse(rawReview) as {
      pkg?: { manifest?: {
        bank?: { title?: unknown; discipline?: unknown };
        course?: { name?: unknown; term?: unknown; week?: unknown };
        source?: { filename?: unknown; sourceWeekDeclared?: unknown };
      } };
    };
    const manifest = record?.pkg?.manifest;
    const title = label(manifest?.bank?.title);
    const original = label(manifest?.source?.filename);
    const module = label(manifest?.course?.name);
    if (!title || original !== source.name || !module || (source.module && module.toLowerCase() !== source.module.toLowerCase())) {
      return fallback;
    }
    const scope = [module];
    const term = manifest?.course?.term;
    if (typeof term === "number" && Number.isInteger(term) && term >= 1 && term <= 5) scope.push(`Term ${term} (package-assigned)`);
    const week = manifest?.course?.week;
    if (typeof week === "number" && Number.isInteger(week) && week >= 1 && week <= 99) {
      scope.push(`Week ${week}${manifest?.source?.sourceWeekDeclared === true ? "" : " (provisional)"}`);
    }
    const discipline = label(manifest?.bank?.discipline);
    if (discipline) scope.push(discipline);
    return { title, scope: scope.join(" · "), originalName: source.name };
  } catch {
    return fallback;
  }
}
