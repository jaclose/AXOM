import { create } from "zustand";
import { SCENES } from "./scenes";
import { experienceById, nextExperience } from "./experiences";

export const FOCUS_SPACE_KEY = "axom.focus-space.v1";
export const WINDOW_SWAP_URL = "https://www.window-swap.com/";
export function validSpace(value: unknown): value is string {
  return typeof value === "string" && (value === "axom" || value === "local" || SCENES.some((scene) => scene.id === value) || Boolean(experienceById(value)));
}
function savedSpace(): string {
  try { const value = localStorage.getItem(FOCUS_SPACE_KEY); return validSpace(value) ? value : "axom"; }
  catch { return "axom"; }
}
export const useFocusSpace = create<{
  selected: string; open: boolean; immersive: boolean; compact: boolean; revision: number;
  select: (id: string, compact?: boolean) => void; close: () => void; next: (direction?: number) => void;
}>((set, get) => ({
  selected: savedSpace(), open: false, immersive: false, compact: false, revision: 0,
  select(id, compact = false) {
    if (!validSpace(id)) return;
    try { localStorage.setItem(FOCUS_SPACE_KEY, id); } catch { /* Selection can remain in memory. */ }
    set({ selected: id, open: true, compact });
  },
  close() { set({ open: false, immersive: false, compact: false }); },
  next(direction = 1) { const state = get(); state.select(`site:${nextExperience(state.selected, direction).id}`, state.compact); },
}));

interface LocalVideo { name: string; blob: Blob }
async function videoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("axom-device-focus-spaces", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("video");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Device storage is unavailable. Try an AXOM scene."));
  });
}
export function validateFocusVideo(file: Pick<File, "name" | "type" | "size">): void {
  if (!/\.(mp4|webm|m4v)$/i.test(file.name) || !["video/mp4", "video/webm", "video/x-m4v", ""].includes(file.type)) throw new Error("Choose an MP4 or WebM video.");
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("Choose a video between 1 byte and 100 MB.");
}
export async function saveFocusVideo(file: File): Promise<void> {
  validateFocusVideo(file);
  const db = await videoDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("video", "readwrite");
      transaction.objectStore("video").put({ name: file.name, blob: file }, "selected");
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("The video could not be saved. Your previous video is unchanged."));
    });
  } finally { db.close(); }
  useFocusSpace.setState((state) => ({ revision: state.revision + 1 }));
}
export async function readFocusVideo(): Promise<LocalVideo | undefined> {
  const db = await videoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("video").objectStore("video").get("selected");
      request.onsuccess = () => {
        const data = request.result;
        resolve(data?.blob instanceof Blob && typeof data.name === "string" ? data : undefined);
      };
      request.onerror = () => reject(new Error("Your saved video could not be opened."));
    });
  } finally { db.close(); }
}
