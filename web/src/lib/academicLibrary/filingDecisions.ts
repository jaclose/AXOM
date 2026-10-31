/**
 * Filing decisions from the unfiled source review. A person decided, source by
 * source, which term and module a prepared bank belongs to. Publishing applies
 * those decisions while it reads the library: the decided banks are served as
 * filed there (catalog module, bank course and every question's scope), so the
 * existing planner and uploader treat them like any other filed source. The
 * library on disk never changes, and a decision applies only to the exact
 * catalog and bank bytes that were reviewed.
 */
import { sha256 } from "../question-content/assets";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { ReviewedFiling } from "../privateLibrary/types";
import { moduleIdentity, reviewedTermNumber } from "./coursePlan";

export const FILING_DECISIONS_FORMAT = "axom-private-filing-decisions";
type Term = ReviewedFiling["term"];
export type FilingAction = "accept" | "correct" | "keep-unfiled";

export interface FilingDecision {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  action: FilingAction;
  /** Set for accept and correct; null when the source stays unfiled. */
  term: Term | null;
  module: string | null;
}

export interface FilingDecisions {
  catalogSha256: string;
  decisions: FilingDecision[];
}

export interface FilingSummary {
  filed: number;
  keptUnfiled: number;
  /** Filed sources per course, in the order first decided. */
  courses: Array<{ term: Term; module: string; sources: number }>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ACTIONS: readonly FilingAction[] = ["accept", "correct", "keep-unfiled"];
const MAX_DECISIONS = 20_000;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Read a decisions file exported by the review page, refusing anything it would not have written. */
export function readFilingDecisions(value: unknown): FilingDecisions {
  const file = record(value);
  if (!file || file.format !== FILING_DECISIONS_FORMAT || file.schemaVersion !== 2)
    throw new Error("This is not a filing decisions file from the unfiled source review.");
  if (typeof file.catalogSha256 !== "string" || !HEX64.test(file.catalogSha256) || !Array.isArray(file.decisions) || file.decisions.length > MAX_DECISIONS)
    throw new Error("The filing decisions file is incomplete. Export it again from the review page.");
  const seen = new Set<string>();
  const decisions = file.decisions.map((entry): FilingDecision => {
    const item = record(entry);
    const action = item?.action as FilingAction;
    if (!item || typeof item.sourceId !== "string" || !item.sourceId || item.sourceId.length > 200 || seen.has(item.sourceId)
      || typeof item.sourceChecksum !== "string" || !HEX64.test(item.sourceChecksum)
      || typeof item.bankSha256 !== "string" || !HEX64.test(item.bankSha256) || !ACTIONS.includes(action))
      throw new Error("A filing decision is incomplete or repeats a source. Export the decisions again from the review page.");
    seen.add(item.sourceId);
    if (action === "keep-unfiled") {
      if (item.term !== null || item.module !== null) throw new Error("A source kept unfiled cannot also name a term or module.");
      return { sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, bankSha256: item.bankSha256, action, term: null, module: null };
    }
    if (typeof item.term !== "string" || !reviewedTermNumber(item.term) || typeof item.module !== "string" || !moduleIdentity(item.module))
      throw new Error("A filing decision needs Term 1 to 5 and a module. Correct it on the review page and export again.");
    return { sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, bankSha256: item.bankSha256, action,
      term: item.term as Term, module: item.module.trim() };
  });
  return { catalogSha256: file.catalogSha256, decisions };
}

/**
 * A reader that serves the library with every accepted or corrected source filed
 * where it was decided. Kept-unfiled and undecided sources are served unchanged.
 */
export async function applyFilingDecisions(read: LibraryReader, decisions: FilingDecisions): Promise<{ read: LibraryReader; summary: FilingSummary }> {
  const catalogBytes = await read("catalog.json");
  if (await hex(catalogBytes) !== decisions.catalogSha256)
    throw new Error("These decisions were made for a different version of this library. Open the library you reviewed, or review this one again.");
  const catalog = JSON.parse(decode(catalogBytes)) as { sources: Array<Record<string, unknown>> };
  readCatalog(structuredClone(catalog));
  const replaced = new Map<string, Uint8Array>();
  const courses: FilingSummary["courses"] = [];
  let keptUnfiled = 0;
  for (const decision of decisions.decisions) {
    const source = catalog.sources.find(entry => entry.id === decision.sourceId);
    if (!source || String(source.checksum).replace(/^sha256:/, "") !== decision.sourceChecksum)
      throw new Error("A filing decision names a source this library does not hold. Open the library you reviewed.");
    if (decision.action === "keep-unfiled") { keptUnfiled += 1; continue; }
    if (typeof source.bankFile !== "string") throw new Error("A filed source has no question package. Review it again on the review page.");
    const path = safeLibraryPath(source.bankFile);
    const bankBytes = await read(path);
    if (await hex(bankBytes) !== decision.bankSha256)
      throw new Error("A question package changed after it was reviewed. Review its filing again before publishing.");
    const bank = JSON.parse(decode(bankBytes)) as { pkg: { manifest: { course: Record<string, unknown> }; questions: Array<Record<string, unknown>> }; reviewedFiling?: unknown };
    readPreparedBank(structuredClone(bank));
    const term = reviewedTermNumber(decision.term ?? undefined)!;
    const module = decision.module!;
    // The person's decision is the scope: the bank, each question that names its
    // own scope, and the catalog row all say the same term and module.
    bank.pkg.manifest.course = { ...bank.pkg.manifest.course, name: module, term };
    for (const question of bank.pkg.questions) {
      if ("course" in question) question.course = module;
      if ("term" in question) question.term = term;
    }
    delete bank.reviewedFiling;
    readPreparedBank(structuredClone(bank));
    source.module = module;
    replaced.set(path, encode(bank));
    const course = courses.find(entry => entry.term === decision.term && moduleIdentity(entry.module) === moduleIdentity(module));
    if (course) course.sources += 1;
    else courses.push({ term: decision.term!, module, sources: 1 });
  }
  replaced.set("catalog.json", encode(catalog));
  const filed = decisions.decisions.length - keptUnfiled;
  return { read: async path => replaced.get(path) ?? read(path), summary: { filed, keptUnfiled, courses } };
}
