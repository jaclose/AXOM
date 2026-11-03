/** Apply JD's exact MI to NMI decision without rewriting the original sources. */
import { sha256 } from "../question-content/assets";
import { questionScope } from "../question-content/package";
import { parseCourseTemplate } from "../course-engine/templateParse";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { PrivateLibraryCatalog, ReviewedFiling } from "../privateLibrary/types";

export const MI_NMI_DECISION_FORMAT = "axom-private-mi-nmi-decision";

interface DecisionSource {
  sourceId: string;
  sourceChecksum: string;
  bankSha256: string | null;
}

interface DecisionPlan {
  templateFile: string;
  templateSha256: string;
}

export interface MiNmiDecision {
  catalogSha256: string;
  sources: DecisionSource[];
  plans: DecisionPlan[];
}

export interface MiNmiSummary {
  sources: number;
  banks: number;
  questionRows: number;
  planSections: number;
  activities: number;
}

const hex64 = /^[0-9a-f]{64}$/;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** A private, hash-bound record of the owner's MI belongs under NMI decision. */
export function readMiNmiDecision(value: unknown): MiNmiDecision {
  const file = record(value);
  if (!file || file.format !== MI_NMI_DECISION_FORMAT || file.schemaVersion !== 2
    || typeof file.catalogSha256 !== "string" || !hex64.test(file.catalogSha256)
    || file.fromModule !== "MI" || file.toModule !== "NMI" || file.term !== "Term 5"
    || file.ownerDecision !== "MI belongs under NMI"
    || typeof file.decidedAtUtc !== "string" || !/^\d{4}-\d\d-\d\dT/.test(file.decidedAtUtc)
    || !Number.isFinite(Date.parse(file.decidedAtUtc))
    || !Array.isArray(file.sources) || !file.sources.length || file.sources.length > 10_000
    || !Array.isArray(file.plans) || file.plans.length > 1000)
    throw new Error("This is not the exact MI to NMI owner decision file.");
  const seen = new Set<string>();
  const sources = file.sources.map((value): DecisionSource => {
    const source = record(value);
    if (!source || typeof source.sourceId !== "string" || !source.sourceId || source.sourceId.length > 200
      || seen.has(source.sourceId) || typeof source.sourceChecksum !== "string" || !hex64.test(source.sourceChecksum)
      || (source.bankSha256 !== null && (typeof source.bankSha256 !== "string" || !hex64.test(source.bankSha256))))
      throw new Error("The MI to NMI decision has an invalid or repeated source identity.");
    seen.add(source.sourceId);
    return { sourceId: source.sourceId, sourceChecksum: source.sourceChecksum, bankSha256: source.bankSha256 as string | null };
  });
  const planPaths = new Set<string>();
  const plans = file.plans.map((value): DecisionPlan => {
    const plan = record(value);
    if (!plan || typeof plan.templateFile !== "string" || planPaths.has(plan.templateFile)
      || typeof plan.templateSha256 !== "string" || !hex64.test(plan.templateSha256))
      throw new Error("The MI to NMI decision has an invalid or repeated course plan.");
    safeLibraryPath(plan.templateFile);
    planPaths.add(plan.templateFile);
    return { templateFile: plan.templateFile, templateSha256: plan.templateSha256 };
  });
  return { catalogSha256: file.catalogSha256, sources, plans };
}

/** This reader composes after Unfiled decisions; both review files bind the same original catalog. */
export async function applyMiNmiDecision(
  original: LibraryReader, current: LibraryReader, decision: MiNmiDecision,
): Promise<{ read: LibraryReader; summary: MiNmiSummary }> {
  const originalCatalogBytes = await original("catalog.json");
  if (await hex(originalCatalogBytes) !== decision.catalogSha256)
    throw new Error("The MI to NMI decision was made for a different version of this library.");
  const originalCatalog = readCatalog(JSON.parse(decode(originalCatalogBytes)));
  const currentCatalog = readCatalog(JSON.parse(decode(await current("catalog.json"))));
  if (originalCatalog.id !== currentCatalog.id || originalCatalog.version !== currentCatalog.version
    || originalCatalog.sources.length !== currentCatalog.sources.length)
    throw new Error("The library changed while applying the MI to NMI decision.");
  const originalMi = originalCatalog.sources.filter(source => source.module === "MI");
  if (!originalMi.length || originalMi.length !== decision.sources.length)
    throw new Error("The decision must cover every MI source in this exact library.");
  const currentById = new Map(currentCatalog.sources.map(source => [source.id, source]));
  for (const source of originalMi) {
    if (originalCatalog.sources.filter(row => row.id === source.id).length !== 1
      || currentCatalog.sources.filter(row => row.id === source.id).length !== 1)
      throw new Error("An MI source identity is repeated in this library.");
  }
  const reviewed = new Map(decision.sources.map(source => [source.sourceId, source]));
  const virtualCatalog: PrivateLibraryCatalog = structuredClone(currentCatalog);
  const virtualById = new Map(virtualCatalog.sources.map(source => [source.id, source]));
  const replaced = new Map<string, Uint8Array>();
  const referencedPaths = new Set([
    ...currentCatalog.templates.map(template => template.file),
    ...currentCatalog.sources.flatMap(source => [source.bankFile, source.originalFile].filter((path): path is string => Boolean(path))),
  ]);
  const filing: ReviewedFiling = { term: "Term 5", module: "NMI", evidence: "human-reviewed", weekAssignment: "unassigned" };
  let banks = 0;
  let questionRows = 0;
  for (const source of originalMi) {
    const entry = reviewed.get(source.id);
    const currentSource = currentById.get(source.id);
    if (!entry || !currentSource || currentSource.module !== "MI" || currentSource.checksum !== source.checksum
      || currentSource.bankFile !== source.bankFile || currentSource.originalFile !== source.originalFile
      || entry.sourceChecksum !== source.checksum || Boolean(entry.bankSha256) !== Boolean(source.bankFile))
      throw new Error("An MI source differs from the exact owner-reviewed library inventory.");
    if (!source.originalFile || await hex(await current(safeLibraryPath(source.originalFile))) !== source.checksum)
      throw new Error("An MI original file changed after the owner's review.");
    const virtual = virtualById.get(source.id)!;
    virtual.module = "NMI";
    if (!source.bankFile) continue;
    const bankPath = safeLibraryPath(source.bankFile);
    const bankBytes = await current(bankPath);
    if (await hex(bankBytes) !== entry.bankSha256)
      throw new Error("An MI question package changed after the owner's review.");
    const rawBank = JSON.parse(decode(bankBytes));
    if (rawBank.reviewedFiling !== undefined) throw new Error("An MI bank already has a reviewed filing. Review it separately.");
    const bank = readPreparedBank(rawBank);
    if (bank.pkg.manifest.course.name !== "MI" || bank.pkg.manifest.course.term !== 5
      || bank.pkg.manifest.course.week !== 0 || bank.pkg.questions.some(question => {
        const scope = questionScope(bank.pkg.manifest, question);
        return scope.course !== "MI" || scope.term !== 5 || scope.week !== 0
          || question.provenance?.sourceChecksum !== `sha256:${source.checksum}`;
      }))
      throw new Error("An MI bank mixes module, term, week or source identities. Review it separately.");
    readPreparedBank({ ...rawBank, reviewedFiling: filing });
    const reviewedPath = safeLibraryPath(bankPath.replace(/\.json$/, `.owner-reviewed-nmi-${source.checksum.slice(0, 12)}.json`));
    if (reviewedPath === bankPath || replaced.has(reviewedPath) || referencedPaths.has(reviewedPath))
      throw new Error("Two MI banks would share one reviewed output path.");
    replaced.set(reviewedPath, encode({ ...rawBank, reviewedFiling: filing }));
    virtual.bankFile = reviewedPath;
    banks += 1;
    questionRows += bank.pkg.questions.length + (bank.unreadableQuestions ?? 0);
  }
  const planDecisions = new Map(decision.plans.map(plan => [plan.templateFile, plan]));
  const planPaths = new Set<string>();
  let planSections = 0;
  let activities = 0;
  for (const template of originalCatalog.templates) {
    const path = safeLibraryPath(template.file);
    const originalBytes = await original(path);
    if (await hex(originalBytes) !== template.checksum)
      throw new Error("A course plan changed after the owner's review.");
    const originalSection = parseCourseTemplate(decode(originalBytes));
    if (originalSection.module !== "MI") continue;
    const entry = planDecisions.get(path);
    const currentTemplate = currentCatalog.templates.find(row => row.file === path);
    if (!entry || entry.templateSha256 !== template.checksum || currentTemplate?.checksum !== template.checksum
      || planPaths.has(path) || originalSection.term !== "Term 5" || originalSection.problems.length
      || !originalSection.items.length || !originalCatalog.sources.some(source => source.module === "MI"
        && source.checksum === template.checksum))
      throw new Error("An MI course plan differs from the exact owner-reviewed inventory.");
    planPaths.add(path);
    const originalText = decode(originalBytes);
    if (!originalText.startsWith("T5 - MI - "))
      throw new Error("An MI course plan has a heading that cannot be corrected without rewriting its activities.");
    const reviewedText = `T5 - NMI - ${originalText.slice("T5 - MI - ".length)}`;
    const reviewedSection = parseCourseTemplate(reviewedText);
    if (reviewedSection.module !== "NMI" || reviewedSection.term !== "Term 5"
      || reviewedSection.problems.length || reviewedSection.title !== originalSection.title
      || JSON.stringify(reviewedSection.items) !== JSON.stringify(originalSection.items)
      || JSON.stringify(reviewedSection.context) !== JSON.stringify(originalSection.context))
      throw new Error("The reviewed plan would change source activities or weeks. Keep it outside publishing.");
    const reviewedPath = safeLibraryPath(path.replace(/\.txt$/, `.owner-reviewed-nmi-${template.checksum.slice(0, 12)}.txt`));
    if (reviewedPath === path || replaced.has(reviewedPath) || referencedPaths.has(reviewedPath))
      throw new Error("Two MI plans would share one reviewed output path.");
    const reviewedBytes = new TextEncoder().encode(reviewedText);
    replaced.set(reviewedPath, reviewedBytes);
    const virtualTemplate = virtualCatalog.templates.find(row => row.file === path)!;
    virtualTemplate.file = reviewedPath;
    virtualTemplate.checksum = await hex(reviewedBytes);
    planSections += 1;
    activities += reviewedSection.items.length;
  }
  if (planPaths.size !== decision.plans.length)
    throw new Error("The decision must cover every MI course plan in this exact library.");
  replaced.set("catalog.json", encode(virtualCatalog));
  return { read: async path => replaced.get(path) ?? current(path),
    summary: { sources: originalMi.length, banks, questionRows, planSections, activities } };
}
