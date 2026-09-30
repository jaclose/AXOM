import type { HubFolder } from "./types";

/** Local file locations never travel through the account workspace. */
export const HUB_PATHS_KEY = "axom.hubFolderPaths.v1";
function readPaths(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HUB_PATHS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string")) : {};
  } catch { return {}; }
}
export function localHubFolderPath(folder: Pick<HubFolder, "id" | "localPath">): string | undefined {
  const paths = readPaths();
  return Object.hasOwn(paths, folder.id) ? paths[folder.id] || undefined : folder.localPath || undefined;
}
export function withoutLocalFolderPath(folder: HubFolder): HubFolder {
  const result = { ...folder };
  delete result.localPath;
  return result;
}
/** Additive migration: strip a legacy path only after the device copy saved. */
export function localizeHubFolder(folder: HubFolder, replace = false): HubFolder {
  if (typeof folder.localPath !== "string") return folder;
  const paths = readPaths();
  if (!replace && Object.hasOwn(paths, folder.id)) return withoutLocalFolderPath(folder);
  paths[folder.id] = folder.localPath;
  try {
    localStorage.setItem(HUB_PATHS_KEY, JSON.stringify(paths));
    return withoutLocalFolderPath(folder);
  } catch {
    // Keep the legacy local copy if storage failed; portable export still strips it.
    return folder;
  }
}
