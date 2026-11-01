/** Apply the owner's unfiled source review without changing source evidence. */
import { SGU_CURRICULUM } from "../curricula";
import { sha256 } from "../question-content/assets";
import { hasUniformUnfiledSourceScope, readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { PreparedBank, ReviewedFiling } from "../privateLibrary/types";
import { reviewedTermNumber } from "./coursePlan";

export const FILING_DECISIONS_FORMAT = "axom-private-filing-decisions";
export const FILING_PROPOSALS_FORMAT = "axom-private-filing-proposals";
type Term = ReviewedFiling["term"];
export type FilingAction = "accept" | "correct" | "keep-unfiled";

export interface FilingDecision {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string;
  action: FilingAction;
  term: Term | null;
  module: string | null;
  note: string;
}
export interface FilingDecisions {
  catalogSha256: string;
  sourceCount: number;
  decisions: FilingDecision[];
}
interface FilingProposal {
  sourceId: string;
  sourceChecksum: string;
  bankFile: string;
  bankSha256: string;
  originalFile: string | null;
  proposedTerm: string | null;
  proposedModule: string | null;
}
export interface FilingProposals {
  catalogSha256: string;
  sources: FilingProposal[];
}
export interface FilingSummary {
  filed: number;
  keptUnfiled: number;
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
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

// The curriculum names the Term 3 sections within BPM 502. The owner's
// review export uses full labels for those two destinations.
const modulesByTerm = new Map<string, Set<string>>(SGU_CURRICULUM.terms
  .filter(term => reviewedTermNumber(term.name) !== undefined)
  .map(term => [term.name, new Set(term.courses.flatMap(course => course.modules))]));
modulesByTerm.set("Term 3", new Set(["BPM502 Pre-Midterm", "BPM502 Post-Midterm"]));
const destinationIsCurrent = (term: unknown, module: unknown): term is Term =>
  typeof term === "string" && typeof module === "string" && modulesByTerm.get(term)?.has(module) === true;

/** The review worksheet is evidence for Accept, never a decision. */
export function readFilingProposals(value: unknown): FilingProposals {
  const file = record(value);
  if (!file || file.format !== FILING_PROPOSALS_FORMAT || file.schemaVersion !== 1
    || typeof file.catalogSha256 !== "string" || !HEX64.test(file.catalogSha256)
    || !Array.isArray(file.sources) || file.sources.length > MAX_DECISIONS)
    throw new Error("This is not the matching unfiled source review worksheet.");
  const seen = new Set<string>();
  const sources = file.sources.map((entry): FilingProposal => {
    const item = record(entry);
    if (!item || typeof item.sourceId !== "string" || !item.sourceId || seen.has(item.sourceId)
      || typeof item.sourceChecksum !== "string" || !HEX64.test(item.sourceChecksum)
      || typeof item.bankSha256 !== "string" || !HEX64.test(item.bankSha256)
      || typeof item.bankFile !== "string" || (item.originalFile !== null && typeof item.originalFile !== "string"))
      throw new Error("The review worksheet has an invalid or repeated source.");
    safeLibraryPath(item.bankFile);
    if (item.originalFile !== null) safeLibraryPath(item.originalFile);
    seen.add(item.sourceId);
    return { sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, bankFile: item.bankFile,
      bankSha256: item.bankSha256, originalFile: item.originalFile,
      proposedTerm: typeof item.proposedTerm === "string" ? item.proposedTerm : null,
      proposedModule: typeof item.proposedModule === "string" ? item.proposedModule : null };
  });
  return { catalogSha256: file.catalogSha256, sources };
}

/** Read the review UI's v2 export, including correction notes. */
export function readFilingDecisions(value: unknown): FilingDecisions {
  const file = record(value);
  if (!file || file.format !== FILING_DECISIONS_FORMAT || file.schemaVersion !== 2)
    throw new Error("This is not a filing decisions file from the unfiled source review.");
  if (typeof file.catalogSha256 !== "string" || !HEX64.test(file.catalogSha256)
    || !Number.isSafeInteger(file.sourceCount) || (file.sourceCount as number) < 0
    || !timestamp(file.exportedAtUtc) || !Array.isArray(file.decisions)
    || file.decisions.length > MAX_DECISIONS || file.decisions.length > (file.sourceCount as number))
    throw new Error("The filing decisions file is incomplete. Export it again from the review page.");
  const seen = new Set<string>();
  const decisions = file.decisions.map((entry): FilingDecision => {
    const item = record(entry);
    const action = item?.action as FilingAction;
    if (!item || typeof item.sourceId !== "string" || !item.sourceId || item.sourceId.length > 200 || seen.has(item.sourceId)
      || typeof item.sourceChecksum !== "string" || !HEX64.test(item.sourceChecksum)
      || typeof item.bankSha256 !== "string" || !HEX64.test(item.bankSha256)
      || !ACTIONS.includes(action) || !timestamp(item.decidedAtUtc)
      || typeof item.note !== "string" || item.note.length > 4000)
      throw new Error("A filing decision is incomplete or repeats a source. Export the decisions again from the review page.");
    seen.add(item.sourceId);
    if (action === "keep-unfiled") {
      if (item.term !== null || item.module !== null) throw new Error("A source kept unfiled cannot also name a term or module.");
      return { sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, bankSha256: item.bankSha256,
        action, term: null, module: null, note: item.note };
    }
    if (!destinationIsCurrent(item.term, item.module))
      throw new Error("A filing decision needs an exact module and Term 1 to 5 pair from AXOM's current curriculum.");
    if (action === "correct" && !item.note.trim())
      throw new Error("A corrected filing needs a source-evidence note in the review export.");
    return { sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, bankSha256: item.bankSha256,
      action, term: item.term, module: item.module as string, note: item.note };
  });
  return { catalogSha256: file.catalogSha256, sourceCount: file.sourceCount as number, decisions };
}

/** The virtual reader preserves original bank bytes and question scopes. */
export async function applyFilingDecisions(
  read: LibraryReader, decisions: FilingDecisions, proposals: FilingProposals,
): Promise<{ read: LibraryReader; summary: FilingSummary }> {
  const catalogBytes = await read("catalog.json");
  const catalogSha = await hex(catalogBytes);
  if (catalogSha !== decisions.catalogSha256 || catalogSha !== proposals.catalogSha256)
    throw new Error("The worksheet or decisions were made for a different version of this library.");
  if (decisions.sourceCount !== proposals.sources.length)
    throw new Error("The decisions and review worksheet cover different numbers of sources.");
  const catalog = readCatalog(JSON.parse(decode(catalogBytes)));
  const byId = new Map<string, typeof catalog.sources[number]>();
  const repeatedIds = new Set<string>();
  const checksumCounts = new Map<string, number>();
  for (const source of catalog.sources) {
    if (byId.has(source.id)) repeatedIds.add(source.id);
    byId.set(source.id, source);
    checksumCounts.set(source.checksum, (checksumCounts.get(source.checksum) ?? 0) + 1);
  }
  const proposed = new Map(proposals.sources.map(row => [row.sourceId, row]));
  for (const row of proposals.sources) {
    const source = byId.get(row.sourceId);
    if (!source || repeatedIds.has(row.sourceId) || source.checksum !== row.sourceChecksum
      || source.bankFile !== row.bankFile || (source.originalFile ?? null) !== row.originalFile)
      throw new Error("The review worksheet does not match this library's source catalog.");
  }
  const virtualCatalog = structuredClone(catalog);
  const virtualById = new Map(virtualCatalog.sources.map(source => [source.id, source]));
  const replaced = new Map<string, Uint8Array>();
  const courses: FilingSummary["courses"] = [];
  let keptUnfiled = 0;
  for (const decision of decisions.decisions) {
    const source = byId.get(decision.sourceId);
    const proposal = proposed.get(decision.sourceId);
    if (!source || !proposal || source.checksum !== decision.sourceChecksum
      || proposal.sourceChecksum !== decision.sourceChecksum || proposal.bankSha256 !== decision.bankSha256)
      throw new Error("A filing decision does not match the reviewed worksheet and library source.");
    if (decision.action === "keep-unfiled") { keptUnfiled += 1; continue; }
    if (decision.action === "accept" && (decision.term !== proposal.proposedTerm || decision.module !== proposal.proposedModule))
      throw new Error("Accept must match the reviewed proposal exactly; use Correct for a different destination.");
    if (checksumCounts.get(source.checksum) !== 1 || !source.bankFile || !source.originalFile)
      throw new Error("A filed source needs one unique bank and a verifiable original file.");
    const original = await read(safeLibraryPath(source.originalFile));
    if (await hex(original) !== source.checksum)
      throw new Error("The original source file changed after review. Recheck its filing before publishing.");
    const bankPath = safeLibraryPath(source.bankFile);
    const bankBytes = await read(bankPath);
    if (await hex(bankBytes) !== decision.bankSha256)
      throw new Error("A question package changed after it was reviewed. Review its filing again before publishing.");
    const rawBank = JSON.parse(decode(bankBytes)) as PreparedBank;
    if (rawBank.reviewedFiling !== undefined || !Array.isArray(rawBank.pkg?.questions))
      throw new Error("A selected source is already filed or its question package is invalid.");
    const bank = readPreparedBank(structuredClone(rawBank));
    if (bank.pkg.manifest.course.name !== "Unfiled" || bank.pkg.manifest.course.term !== 0
      || bank.pkg.manifest.course.week !== 0 || !hasUniformUnfiledSourceScope(bank.pkg.manifest, bank.pkg.questions)
      || rawBank.pkg.questions.some(question => question.course !== "Unfiled" || question.term !== 0
        || question.week !== 0 || question.provenance?.sourceChecksum !== `sha256:${source.checksum}`))
      throw new Error("The reviewed bank mixes original scopes or source identities. Split and review it before filing.");
    const reviewedFiling: ReviewedFiling = { term: decision.term!, module: decision.module!,
      evidence: "human-reviewed", weekAssignment: "unassigned" };
    readPreparedBank({ ...rawBank, reviewedFiling });
    const reviewedPath = safeLibraryPath(bankPath.replace(/\.json$/, `.owner-reviewed-${source.checksum.slice(0, 12)}.json`));
    if (reviewedPath === bankPath || replaced.has(reviewedPath))
      throw new Error("Two reviewed banks would share one output path.");
    // The virtual sibling resolves image paths identically to the original.
    replaced.set(reviewedPath, encode({ ...rawBank, reviewedFiling }));
    const virtualSource = virtualById.get(source.id)!;
    virtualSource.bankFile = reviewedPath;
    virtualSource.module = decision.module!;
    const course = courses.find(entry => entry.term === decision.term && entry.module === decision.module);
    if (course) course.sources += 1;
    else courses.push({ term: decision.term!, module: decision.module!, sources: 1 });
  }
  replaced.set("catalog.json", encode(virtualCatalog));
  const filed = decisions.decisions.length - keptUnfiled;
  return { read: async path => replaced.get(path) ?? read(path), summary: { filed, keptUnfiled, courses } };
}
