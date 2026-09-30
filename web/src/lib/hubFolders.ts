import { invoke } from "@tauri-apps/api/core";
import { isTauriShell } from "./desktopShell";

export interface HubFolderInfo { entries: number; entriesCapped: boolean; modifiedAt?: number }

export function validFolderPath(path: string): boolean {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(path) && !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !path.split(/[\\/]/).includes("..");
}

export function safeFolderLink(link?: string): string | undefined {
  if (!link) return undefined;
  try { const url = new URL(link); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export async function openHubFolder(path: string, reveal = false): Promise<void> {
  if (!isTauriShell()) throw new Error("Local folders open in the AXOM desktop app. Copy the path on the web.");
  if (!validFolderPath(path)) throw new Error("Use an absolute local folder path without parent-directory shortcuts.");
  await invoke("hub_folder_open", { path, reveal });
}

export async function hubFolderInfo(path: string): Promise<HubFolderInfo> {
  if (!isTauriShell() || !validFolderPath(path)) throw new Error("Folder details are available in the desktop app.");
  return invoke<HubFolderInfo>("hub_folder_info", { path });
}
