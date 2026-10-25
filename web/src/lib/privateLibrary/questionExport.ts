import { blocksToPlainText } from "../question-content/blocks";
import { readImageInfo, sha256, SHOWABLE_IMAGE_TYPES } from "../question-content/assets";
import { BANK_ID_PATTERN, readQuestionsFile } from "../question-content/packageJson";
import { assessBank } from "../question-content/assessBank";
import {
  PACKAGE_SCHEMA_VERSION,
  QUESTION_FLAG_TYPES,
  type PackageIssue,
  type PackageManifest,
  type PackageTeaching,
} from "../question-content/package";
import type { PreparedBank, PrivateLibraryCatalog } from "./types";
import { safeInputPath } from "./inputRoot";

type Json = Record<string, unknown>;
type Reader = (path: string) => Promise<Uint8Array>;
const record = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hex = (value: string) => value.replace(/^sha256:/, "");
const text = (value: unknown) => typeof value === "string" ? value : "";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Some source-audit exports predate package schema v2 and keep their teaching
 * fields beside the immutable question. Lift that exact, explicit shape into
 * the canonical envelope. A correctAnswer claim is deliberately insufficient:
 * the audit must name the already-verified label separately.
 */
function teachingFromFlatRow(row: Json): PackageTeaching | Json | undefined {
  if (record(row.teaching)) return row.teaching;
  const answerLabel = text(row.verifiedExistingAnswer);
  const whyCorrect = text(row.whyCorrect);
  const mechanism = text(row.mechanism);
  const highYieldRule = text(row.highYieldPrinciple) || text(row.highYieldRule);
  if (!answerLabel || !whyCorrect || !mechanism || !highYieldRule
    || !Array.isArray(row.distractors) || !Array.isArray(row.sourceReferences)
    || !record(row.factCheck)) return undefined;
  return {
    version: 1,
    answerLabel,
    ...(text(row.topic) ? { concept: text(row.topic) } : {}),
    whyCorrect,
    mechanism,
    highYieldRule,
    distractors: row.distractors,
    sourceReferences: row.sourceReferences,
    factCheck: row.factCheck,
  };
}

/** Flat exports retain their own provenance. A bare answer letter is never a reviewed key. */
export async function resolveQuestionExport(questionsPath: string, read: Reader): Promise<Reader> {
  const original = await read(questionsPath);
  if (original.length > 16 * 1024 * 1024) throw new Error("This question export exceeds 16 MiB. Split it into smaller exports.");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original)); }
  catch { throw new Error("questions.json is not readable JSON. Re-export the complete package."); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 20_000 || !raw.every(record))
    throw new Error("This questions.json needs a manifest or a nonempty flat list of question records.");
  const rows: Json[] = raw;
  const groups = new Map<string, Json[]>(), ids = new Set<string>();
  for (const row of rows) {
    if (!text(row.id) || ids.has(text(row.id))) throw new Error("Question export IDs must be present and unique. No records were removed.");
    ids.add(text(row.id));
    const bankId = text(row.bankId);
    if (!BANK_ID_PATTERN.test(bankId)) throw new Error("A question export record has no supported bank ID. Review its source mapping.");
    groups.set(bankId, [...(groups.get(bankId) ?? []), row]);
  }
  const base = questionsPath.slice(0, -"questions.json".length);
  const virtual = new Map<string, Uint8Array>(), aliases = new Map<string, string>();
  // Shared figures consume the ZIP expansion budget once during conversion.
  // Retain verified facts across banks, rather than every decoded file buffer.
  const verifiedAssets = new Map<string, { checksum: string; mimeType: string; width: number; height: number; byteSize: number }>();
  const exportHash = hex(await sha256(original));
  const sources: PrivateLibraryCatalog["sources"] = groups.size === 1 ? [] : [{ id: `export-${exportHash}`, name: "questions.json",
    sourcePath: "questions.json", checksum: exportHash, status: "reference/template-only",
    reason: "Exact original question export, including legacy metadata and source references.",
    originalFile: "_axom-export/original/questions.json", ready: 0, review: 0 }];
  virtual.set("_axom-export/original/questions.json", original);
  for (const [bankId, group] of groups) {
    const first = group[0], issues: PackageIssue[] = [];
    const module = text(first.course) || text(first.module);
    if (!module || !positive(first.term) || first.term > 5 || group.some(row => (text(row.course) || text(row.module)) !== module || row.term !== first.term))
      throw new Error(`${bankId} has inconsistent course or term metadata. Review its filing before importing.`);
    // Zero is the canonical unassigned week; do not turn a student review's title into a course week.
    const week = positive(first.week) ? first.week : 0;
    const exportName = `${bankId}.questions.json`, subset = groups.size === 1 ? original : encode(group), checksum = hex(await sha256(subset));
    const prefix = `_axom-export/${checksum}`;
    const manifest: PackageManifest = { schemaVersion: PACKAGE_SCHEMA_VERSION, course: { name: module, term: first.term, week },
      bank: { id: bankId, title: text(first.bankTitle) || bankId, discipline: text(first.discipline) || module },
      source: { filename: exportName, sourceWeekDeclared: false, axomAssignedWeek: week },
      questionsFile: "questions.json", assetsDirectory: "assets" };
    const assetOwners = new Map<string, Set<string>>(), assetPaths = new Map<string, string>();
    for (const row of group) for (const asset of Array.isArray(row.assets) ? row.assets : []) {
      if (!record(asset)) continue;
      const id = text(asset.id), path = text(asset.path) || `assets/${text(asset.filename)}`;
      if (assetPaths.has(id) && assetPaths.get(id) !== path) throw new Error(`The asset ID ${id} names conflicting files. Review its mappings.`);
      assetPaths.set(id, path);
      const owners = assetOwners.get(id) ?? new Set<string>(); owners.add(text(row.id)); assetOwners.set(id, owners);
    }
    const converted = [];
    for (const row of group) {
      const id = text(row.id), source = record(row.source) ? row.source : {};
      // Legacy exports reuse one figure across questions. Canonical assets have one owner.
      // Namespace only those shared aliases; keep the original file bytes and raw export intact.
      const assetId = (value: unknown) => (assetOwners.get(text(value))?.size ?? 0) > 1 ? `${id}--${text(value)}` : value;
      const filename = text(source.filename) || text(row.sourceRef);
      if (!filename) throw new Error(`${id} does not name its source. No source identity was guessed.`);
      const blocks = (value: unknown): unknown[] => Array.isArray(value) ? value.map(block => {
        if (!record(block)) return block;
        if (block.type === "table" && block.sourceImageAssetId) return { ...block, sourceImageAssetId: assetId(block.sourceImageAssetId) };
        if (block.type !== "image") return block;
        const { src: _src, sourcePage: _page, ...rest } = block;
        return { ...rest, assetId: assetId(block.assetId), ...(block.role === "table_reference" ? { role: "reference" } : {}) };
      }) : [];
      const assets = [];
      for (const rawAsset of Array.isArray(row.assets) ? row.assets : []) {
        if (!record(rawAsset) || !text(rawAsset.id)) throw new Error(`${id} has an unreadable image mapping.`);
        const path = safeInputPath(text(rawAsset.path) || `assets/${text(rawAsset.filename)}`);
        if (!path.startsWith("assets/")) throw new Error(`${id} has an image outside its assets folder.`);
        const name = path.slice("assets/".length), sourcePath = `${base}${path}`;
        let info = verifiedAssets.get(sourcePath);
        if (!info) {
          const bytes = await read(sourcePath), image = readImageInfo(bytes);
          if (!image || !SHOWABLE_IMAGE_TYPES.has(image.mimeType) || !image.width || !image.height || bytes.length > 8 * 1024 * 1024 || image.width * image.height > 64_000_000)
            throw new Error(`${name} is not a supported bounded image.`);
          info = { checksum: await sha256(bytes), mimeType: image.mimeType, width: image.width, height: image.height, byteSize: bytes.length };
          verifiedAssets.set(sourcePath, info);
        }
        const declared = text(rawAsset.sha256) || text(rawAsset.checksum);
        if ((declared && hex(declared) !== hex(info.checksum)) || (rawAsset.mimeType && rawAsset.mimeType !== info.mimeType))
          throw new Error(`${name} does not match its recorded image metadata.`);
        aliases.set(`${prefix}/assets/${name}`, sourcePath);
        assets.push({ id: assetId(rawAsset.id), filename: name, mimeType: info.mimeType, width: info.width, height: info.height,
          byteSize: info.byteSize, checksum: info.checksum, questionId: text(rawAsset.questionId) || id, sourceFile: text(rawAsset.sourceFile) || filename,
          ...(positive(rawAsset.sourcePage) ? { sourcePage: rawAsset.sourcePage } : {}),
          role: rawAsset.role === "table_reference" ? "reference" : rawAsset.role,
          ...(text(rawAsset.revealOf) ? { revealOf: assetId(rawAsset.revealOf) } : {}),
          ...(text(rawAsset.derivation) ? { derivation: rawAsset.derivation } : {}),
          ...(record(rawAsset.bounds) ? { bounds: rawAsset.bounds } : {}),
          ...(record(rawAsset.crop) ? { crop: rawAsset.crop } : {}) });
      }
      const flags = [];
      for (const flag of Array.isArray(row.flags) ? row.flags : []) {
        if (record(flag) && QUESTION_FLAG_TYPES.some(type => type === flag.type) && typeof flag.message === "string") flags.push(flag);
        else if (record(flag)) issues.push({ questionId: id, severity: "warning", code: "needs_review", message: `Unrecognized source review flag: ${JSON.stringify(flag)}. Check the original export before scoring.` });
        else if (flag === "WEEK_ASSIGNMENT_INFERRED") issues.push({ questionId: id, severity: "warning", code: "scope_mismatch", message: "The export inferred this week from lecture order; confirm filing separately." });
        else flags.push({ type: "answer_needs_review", message: `Source export flag: ${text(flag) || "unreadable review flag"}. Review against the original.` });
      }
      if (row.questionType && row.questionType !== "single_best_answer")
        issues.push({ questionId: id, severity: "error", code: "unsupported_content", message: `The export describes a ${text(row.questionType)} item. Preserve it for source review; it is not a single-best-answer question.` });
      const answer = record(row.correctAnswer) ? row.correctAnswer : text(row.correctAnswer) || text(row.answer);
      const correctAnswer = record(answer) ? answer : answer ? { labels: [answer] } : undefined;
      const choices = Array.isArray(row.choices) ? row.choices.map((choice, index) => record(choice)
        ? { id: text(choice.id) || `${id}-${text(choice.label) || index}`, label: choice.label, blocks: Array.isArray(choice.blocks) ? blocks(choice.blocks) : [{ type: "text", text: text(choice.text) }] } : choice)
        : "ABCDEFGHI".split("").flatMap(label => text(row[label.toLowerCase()]) ? [{ id: `${id}-${label}`, label, blocks: [{ type: "text", text: row[label.toLowerCase()] }] }] : []);
      const explanation = [...(typeof row.explanation === "string" && row.explanation ? [{ type: "text", text: row.explanation }] : blocks(row.explanation)), ...blocks(row.explanationBlocks)];
      const teaching = teachingFromFlatRow(row);
      converted.push({ id, bankId, course: module, term: first.term, week: positive(row.week) ? row.week : 0,
        topic: text(row.topic), source: { filename, ...Object.fromEntries(["page", "pageEnd", "questionNumber", "set", "setTitle"].filter(key => source[key] !== undefined).map(key => [key, source[key]])) },
        stem: Array.isArray(row.stem) ? blocks(row.stem) : Array.isArray(row.stemBlocks) ? blocks(row.stemBlocks) : [{ type: "text", text: text(row.stem) || text(row.question) }], choices,
        ...(row.choiceTable ? { choiceTable: blocks([row.choiceTable])[0] } : {}), ...(correctAnswer ? { correctAnswer } : {}),
        explanation, ...(teaching ? { teaching } : {}), assets, flags, provenance: { method: "manual-transcription", tool: "AXOM flat export adapter v2", sourceChecksum: `sha256:${checksum}`,
          notes: `Converted from a supplied JSON export; extraction method and answer verification were not established. Original metadata is retained in ${exportName}. The export checksum identifies that JSON subset, not the referenced PDF.` } });
    }
    const parsed = readQuestionsFile({ schemaVersion: PACKAGE_SCHEMA_VERSION, bankId, questions: converted }, issues);
    if (!parsed || parsed.questions.length !== group.length) throw new Error(`${bankId} contains unreadable records. No rows were silently dropped.`);
    const pkg = { manifest, questions: parsed.questions }, files = pkg.questions.flatMap(q => q.assets.map(asset => ({ name: asset.filename })));
    const assessment = assessBank(pkg, issues, files);
    if (assessment.issues.some(issue => issue.severity === "error" && !issue.questionId)) throw new Error(`${bankId} has a bank-level conflict.`);
    const bank: PreparedBank = { pkg, issues, sourceText: { rawText: parsed.questions.map(q => blocksToPlainText(q.stem)).join("\n\n") }, sourceBytes: subset.length,
      notes: ["Source is a losslessly retained subset of the supplied JSON export, not the original PDF. Bare answer letters require source review. No key was inferred."] };
    virtual.set(`${prefix}/bank.json`, encode(bank)); virtual.set(`${prefix}/source/${exportName}`, subset);
    sources.push({ id: `export-bank-${checksum}`, name: exportName, sourcePath: exportName, checksum, module,
      status: assessment.counts.ready ? "prepared" : "review-required", reason: bank.notes[0], bankFile: `${prefix}/bank.json`,
      originalFile: `${prefix}/source/${exportName}`, ready: assessment.counts.ready, review: group.length - assessment.counts.ready });
  }
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: `export-${exportHash.slice(0, 24)}`,
    version: `flat-export-v1-${exportHash.slice(0, 16)}`, templates: [], sources };
  virtual.set("catalog.json", encode(catalog));
  return async path => {
    const key = safeInputPath(path), bytes = virtual.get(key);
    if (bytes) return bytes.slice();
    const alias = aliases.get(key);
    if (!alias) throw new Error(`Missing mapped export file: ${key}`);
    return read(alias);
  };
}
