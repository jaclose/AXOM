// ===========================================================================
// Files the learner chose to skip in mass import. Importing the same folder
// again should not put a skipped file back in front of them as if it were new,
// so the choice is remembered by the file's checksum (its bytes, not its
// name) and the queue shows it as skipped, with a way to review it anyway.
//
// Kept on this device only. It is a convenience about a queue, not part of the
// learner's work: losing it puts a skipped file back in the queue, nothing more.
// ===========================================================================

export interface SkippedImport {
  checksum: string;
  fileName: string;
  skippedAt: string;
}

const KEY = "axom.import.skipped.v1";
/** Old entries go first: a folder is re-imported within a term, not years later. */
const LIMIT = 2000;

function read(): SkippedImport[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SkippedImport => (
      typeof entry === "object" && entry !== null
      && typeof (entry as SkippedImport).checksum === "string"
      && typeof (entry as SkippedImport).fileName === "string"
      && typeof (entry as SkippedImport).skippedAt === "string"
    ));
  } catch {
    return [];
  }
}

function write(entries: SkippedImport[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT)));
  } catch {
    // Storage is full or unavailable: the file is skipped for this session only.
  }
}

export function skippedImports(): SkippedImport[] {
  return read();
}

export function skippedImport(checksum: string | undefined): SkippedImport | undefined {
  return checksum ? read().find((entry) => entry.checksum === checksum) : undefined;
}

export function skipImport(file: { checksum?: string; fileName: string }, now = new Date().toISOString()): void {
  if (!file.checksum) return;
  write([...read().filter((entry) => entry.checksum !== file.checksum), { checksum: file.checksum, fileName: file.fileName, skippedAt: now }]);
}

export function unskipImport(checksum: string | undefined): void {
  if (!checksum) return;
  write(read().filter((entry) => entry.checksum !== checksum));
}
