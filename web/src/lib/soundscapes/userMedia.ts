// ===========================================================================
// Your own sounds and backgrounds. Files you add stay on this device: bytes
// live in their own IndexedDB database (never in the workspace JSON, never in
// cloud backups) and play through blob: URLs. A sound can lead one of the
// presets (e.g. your alpha-waves track becomes the first 10 Hz version) or sit
// under "Your sounds"; a background joins the scene picker.
//
// What you can change about a file (its name, what it plays for) is kept
// apart from the bytes, as a small device preference. Renaming or reassigning
// a 100 MB track therefore never rewrites the track: it is instant and cannot
// fail for lack of space.
// ===========================================================================
import { create } from "zustand";

export const USER_MEDIA_DB = "axom-user-media";
const DB_VERSION = 1;
const STORE = "files";
/** Largest single file accepted (long study mixes run to a few hundred MB). */
export const MAX_USER_SOUND_BYTES = 600 * 1024 * 1024;
export const MAX_USER_SCENE_BYTES = 250 * 1024 * 1024;
export const USER_SOUND_TYPES = /^audio\/|^video\/(mp4|webm|quicktime)$/;
export const USER_SCENE_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$|^video\/(mp4|webm|quicktime)$/;

export type UserMediaKind = "sound" | "scene";

export interface UserMediaMeta {
  id: string;
  kind: UserMediaKind;
  name: string;
  mime: string;
  size: number;
  addedAt: string;
  /** Sounds: which preset it leads ("yours" = its own shelf). */
  presetId?: string;
}

interface UserMediaRecord extends UserMediaMeta {
  blob: Blob;
}

type UserMediaDetails = Partial<Pick<UserMediaMeta, "name" | "presetId">>;
export const USER_MEDIA_DETAILS_KEY = "axom.soundscapes.userMediaDetails.v1";

function readDetails(): Record<string, UserMediaDetails> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(USER_MEDIA_DETAILS_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, UserMediaDetails> : {};
  } catch {
    return {};
  }
}

/** False when the browser refuses the write (the change then lasts for this visit only). */
function writeDetails(details: Record<string, UserMediaDetails>): boolean {
  try {
    window.localStorage.setItem(USER_MEDIA_DETAILS_KEY, JSON.stringify(details));
    return true;
  } catch {
    return false;
  }
}

function cleanName(value: unknown, fallback: string): string {
  return (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "") || fallback;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser can’t store files."));
      return;
    }
    const request = indexedDB.open(USER_MEDIA_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn’t open local file storage."));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("Local file storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local file storage was full or blocked."));
    });
  } finally {
    db.close();
  }
}

/** A readable label from a file name: no extension, no underscores, trimmed. */
export function labelFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled").slice(0, 60);
}

export function validateUserFile(file: { type: string; size: number }, kind: UserMediaKind): string | null {
  const types = kind === "sound" ? USER_SOUND_TYPES : USER_SCENE_TYPES;
  const max = kind === "sound" ? MAX_USER_SOUND_BYTES : MAX_USER_SCENE_BYTES;
  if (!types.test(file.type)) {
    return kind === "sound" ? "Choose an audio file (MP3, M4A, WAV, AAC, OGG) or a video with sound." : "Choose an image (JPG, PNG, WebP, GIF) or a video (MP4, WebM, MOV).";
  }
  if (file.size > max) return `That file is ${Math.round(file.size / 1_048_576)} MB; the limit is ${Math.round(max / 1_048_576)} MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface UserMediaState {
  loaded: boolean;
  items: UserMediaMeta[];
  /** Object URLs for loaded files, created lazily. */
  urls: Record<string, string>;
  error?: string;
  load: () => Promise<void>;
  add: (file: File, kind: UserMediaKind, presetId?: string) => Promise<UserMediaMeta | null>;
  /** Applies at once (no awaiting), so callers can change the player in the same tick. */
  update: (id: string, patch: Partial<Pick<UserMediaMeta, "name" | "presetId">>) => void;
  remove: (id: string) => Promise<void>;
  urlFor: (id: string) => Promise<string | null>;
}

export const useUserMedia = create<UserMediaState>((set, get) => ({
  loaded: false,
  items: [],
  urls: {},

  async load() {
    if (get().loaded) return;
    try {
      const records = await tx<UserMediaRecord[]>("readonly", (store) => store.getAll() as IDBRequest<UserMediaRecord[]>);
      const urls: Record<string, string> = {};
      for (const record of records) urls[record.id] = URL.createObjectURL(record.blob);
      const details = readDetails();
      const items = records
        .map(({ blob: _blob, ...meta }) => {
          const saved = details[meta.id];
          return saved ? { ...meta, name: cleanName(saved.name, meta.name), presetId: typeof saved.presetId === "string" ? saved.presetId : meta.presetId } : meta;
        })
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
      set({ loaded: true, items, urls, error: undefined });
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : "Couldn’t read your files." });
    }
  },

  async add(file, kind, presetId) {
    const invalid = validateUserFile(file, kind);
    if (invalid) {
      set({ error: invalid });
      return null;
    }
    const meta: UserMediaMeta = { id: newId(), kind, name: labelFromFileName(file.name), mime: file.type, size: file.size, addedAt: new Date().toISOString(), presetId: kind === "sound" ? presetId ?? "yours" : undefined };
    try {
      await tx("readwrite", (store) => store.put({ ...meta, blob: file } satisfies UserMediaRecord));
    } catch (error) {
      set({ error: error instanceof Error && /quota/i.test(error.message) ? "Your browser ran out of space for files. Remove one and try again." : "Couldn’t save that file on this device." });
      return null;
    }
    set((state) => ({ items: [...state.items, meta], urls: { ...state.urls, [meta.id]: URL.createObjectURL(file) }, error: undefined }));
    return meta;
  },

  update(id, patch) {
    const current = get().items.find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, ...patch, name: cleanName(patch.name, current.name) };
    // Shown at once; the audio file itself is never rewritten for this.
    set((state) => ({ items: state.items.map((item) => (item.id === id ? next : item)), error: undefined }));
    const saved = writeDetails({ ...readDetails(), [id]: { name: next.name, presetId: next.presetId } });
    if (!saved) set({ error: "That change is showing, but this browser would not save it. It may be gone after a reload." });
  },

  async remove(id) {
    await tx("readwrite", (store) => store.delete(id));
    const details = readDetails();
    if (id in details) {
      delete details[id];
      writeDetails(details);
    }
    const url = get().urls[id];
    if (url) URL.revokeObjectURL(url);
    set((state) => {
      const urls = { ...state.urls };
      delete urls[id];
      return { items: state.items.filter((item) => item.id !== id), urls };
    });
  },

  async urlFor(id) {
    if (!get().loaded) await get().load();
    return get().urls[id] ?? null;
  },
}));
