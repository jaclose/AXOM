/** Resolve user-selected packaging, not academic content. No network or writes. */
export interface LibraryInputEntry { path: string; byteSize: number; }
export type LibraryInputRoot =
  | { kind: "catalog"; prefix: string; catalogPath: string }
  | { kind: "native-packages"; manifestPaths: string[] }
  | { kind: "question-export"; questionsPath: string };
export const INPUT_MAX_FILES = 30_000;
export const INPUT_MAX_FILE_BYTES = 128 * 1024 * 1024;
/** Large originals can be retained and inspected one page at a time. Text extraction has its own page bounds. */
export const INPUT_MAX_PDF_BYTES = 256 * 1024 * 1024;
export const INPUT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** Filenames may contain spaces and #. This is a local path, never a URL. */
export function safeInputPath(value: string): string {
  if (typeof value !== "string" || !value || value.length > 1_024 || value.startsWith("/")
      || /^[a-z]:/i.test(value) || value.includes("\\")
      || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Unsafe input: this collection contains an unsafe file path. Choose an unmodified export.");
  }
  return value.normalize("NFC");
}
export function isPackagingMetadata(path: string): boolean {
  return path.split("/").some(part => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));
}

/** Shared bounded path validation for prepared packages and ordinary source folders. */
export function validateLibraryInputEntries(entries: readonly LibraryInputEntry[]): string[] {
  if (!entries.length) throw new Error("The selected folder is empty. Choose files or a collection to import.");
  if (entries.length > INPUT_MAX_FILES) throw new Error("This collection contains too many files. Split it into smaller collections.");
  const paths: string[] = [], seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const path = safeInputPath(entry.path);
    const limit = /\.pdf$/i.test(path) ? INPUT_MAX_PDF_BYTES : INPUT_MAX_FILE_BYTES;
    if (!Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0 || entry.byteSize > limit) {
      throw new Error(`A collection file exceeds the supported ${limit / 1024 / 1024} MiB size. Keep the original and prepare smaller source segments.`);
    }
    total += entry.byteSize;
    if (total > INPUT_MAX_TOTAL_BYTES) throw new Error("This expanded collection is too large. Split it into smaller collections.");
    const portableKey = path.toLowerCase();
    if (seen.has(portableKey)) throw new Error("This collection has duplicate or case-conflicting paths. Resolve them before importing.");
    seen.add(portableKey);
    if (!isPackagingMetadata(path)) paths.push(path);
  }
  return paths;
}

/** A single wrapping folder is harmless; multiple catalogs are not guessed. */
export function resolveLibraryInputRoot(entries: readonly LibraryInputEntry[]): LibraryInputRoot {
  const paths = validateLibraryInputEntries(entries);
  const catalogs = paths.filter(path => path.split("/").pop() === "catalog.json");
  if (catalogs.length > 1) throw new Error("Several prepared libraries were selected. Choose one collection folder or ZIP at a time.");
  if (catalogs.length === 1) {
    const catalogPath = catalogs[0], prefix = catalogPath.slice(0, -"catalog.json".length);
    // Do not choose one nested library and silently ignore another bank beside it.
    if (prefix && paths.some(path => !path.startsWith(prefix) && ["manifest.json", "questions.json"].includes(path.split("/").pop()!))) {
      throw new Error("A prepared library and separate question packages were selected together. Import the collections separately.");
    }
    return { kind: "catalog", prefix, catalogPath };
  }
  const manifestPaths = paths.filter(path => path.split("/").pop() === "manifest.json").sort();
  if (manifestPaths.length) return { kind: "native-packages", manifestPaths };
  const questionPaths = paths.filter(path => path.split("/").pop() === "questions.json");
  if (questionPaths.length > 1) throw new Error("Several question exports were selected. Import each complete export separately.");
  if (questionPaths.length === 1) return { kind: "question-export", questionsPath: questionPaths[0] };
  throw new Error("No prepared collection or AXOM question package was found. For PDFs, Word files or question text, use Question Bank > Import files. You do not need to create a catalog.json file.");
}
