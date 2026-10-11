import { blocksToPlainText } from "../question-content/blocks";
import { readImageInfo, sha256, SHOWABLE_IMAGE_TYPES } from "../question-content/assets";
import { readManifest, readQuestionsFile } from "../question-content/packageJson";
import { assessBank } from "../question-content/assessBank";
import type { PackageIssue } from "../question-content/package";
import type { PreparedBank, PrivateLibraryCatalog } from "./types";
import { resolveLibraryInputRoot, safeInputPath, type LibraryInputEntry } from "./inputRoot";

type Reader = (path: string) => Promise<Uint8Array>;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const leaf = (path: string) => path.split("/").pop()!;
const parent = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
const hex = (value: string) => value.replace(/^sha256:/, "");
function parseJson(bytes: Uint8Array, name: string): unknown {
  if (bytes.length > 16 * 1024 * 1024) throw new Error(`${name} is too large to read as one question package.`);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${name} is not readable JSON. Re-export this question package.`); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The question package is not a supported object.");
  return value as Record<string, unknown>;
}

/**
 * Accept existing catalogs and canonical manifest/questions/assets packages.
 * The generated catalog exists only in memory. No user-authored index, network,
 * changes to answer evidence, or writes to the learner workspace happen here.
 */
export async function resolveLibraryReader(entries: readonly LibraryInputEntry[], read: Reader): Promise<Reader> {
  const root = resolveLibraryInputRoot(entries);
  const byPath = new Map(entries.map(entry => [safeInputPath(entry.path), entry]));
  const readSelected: Reader = async path => {
    const key = safeInputPath(path), entry = byPath.get(key);
    if (!entry) throw new Error(`Missing collection file: ${leaf(key)}. Keep its questions and image folders together.`);
    const bytes = await read(entry.path);
    if (bytes.length !== entry.byteSize) throw new Error(`The size of ${leaf(key)} changed while importing. Select the collection again.`);
    return bytes;
  };
  if (root.kind === "catalog") return async path => readSelected(`${root.prefix}${safeInputPath(path)}`);

  const virtual = new Map<string, Uint8Array>(), aliases = new Map<string, string>();
  const sources: PrivateLibraryCatalog["sources"] = [], fingerprints: string[] = [];
  const seenSource = new Map<string, string>();
  for (const manifestPath of root.manifestPaths) {
    const base = parent(manifestPath), issues: PackageIssue[] = [];
    const manifestBytes = await readSelected(manifestPath);
    const manifest = readManifest(parseJson(manifestBytes, "manifest.json"), issues);
    if (!manifest) throw new Error(`The package at ${base || "the selected root"} has an unsupported manifest.`);
    const questionPath = `${base}${safeInputPath(manifest.questionsFile)}`;
    const questionBytes = await readSelected(questionPath);
    const rawQuestions = parseJson(questionBytes, manifest.questionsFile);
    if (object(rawQuestions).bankId !== manifest.bank.id) throw new Error(`The questions do not belong to ${manifest.bank.title}. Re-export the package.`);
    const parsed = readQuestionsFile(rawQuestions, issues);
    if (!parsed || issues.some(issue => issue.severity === "error" && !issue.questionId)) {
      throw new Error(`The question package ${manifest.bank.title} could not be read safely.`);
    }
    const originalCount = Array.isArray(object(rawQuestions).questions) ? (object(rawQuestions).questions as unknown[]).length : 0;
    if (!originalCount || !parsed.questions.length) throw new Error(`${manifest.bank.title} contains no readable questions. Use source review rather than installing an empty bank.`);
    const sourceName = leaf(manifest.source.filename.replace(/\\/g, "/"));
    const sourceCandidates = [...new Set([`${base}source/${sourceName}`, `${base}${sourceName}`])].filter(path => byPath.has(safeInputPath(path)));
    if (sourceCandidates.length > 1) throw new Error(`${manifest.bank.title} contains two possible originals. Keep one exact source in its source folder.`);
    const sourceFile = sourceCandidates[0];
    const original = sourceFile ? await readSelected(sourceFile) : undefined;
    const declared = new Set(parsed.questions.map(question => question.provenance.sourceChecksum).filter((value): value is string => Boolean(value)).map(hex));
    if ([...declared].some(value => !/^[a-f0-9]{64}$/.test(value)) || declared.size > 1) {
      throw new Error(`${manifest.bank.title} has inconsistent source checksums. Review its provenance before importing.`);
    }
    const checksum = original ? hex(await sha256(original)) : [...declared][0];
    if (!checksum) throw new Error(`${manifest.bank.title} needs its original source file or a source checksum in its existing provenance. Use normal file import to prepare it.`);
    if (declared.size && !declared.has(checksum)) throw new Error(`The original for ${manifest.bank.title} does not match its recorded checksum.`);
    const fingerprint = hex(await sha256(encode([manifest, object(rawQuestions)])));
    if (seenSource.has(checksum)) {
      if (seenSource.get(checksum) !== fingerprint) throw new Error("Two different packages describe the same source. Import or reconcile those versions separately; one must not replace the other silently.");
      continue; // Exact source/package duplicates refer to the first copy, never add questions.
    }
    seenSource.set(checksum, fingerprint); fingerprints.push(fingerprint);
    const prefix = `_axom-input/${checksum}`, assetDirectory = safeInputPath(manifest.assetsDirectory);
    const assetChecks = new Map<string, { checksum: string; byteSize: number; mimeType: string; width?: number; height?: number }>();
    for (const question of parsed.questions) {
      if (original && !question.provenance.sourceChecksum) question.provenance.sourceChecksum = `sha256:${checksum}`;
      for (const asset of question.assets) {
        const name = safeInputPath(asset.filename), assetPath = `${base}${assetDirectory}/${name}`;
        let info = assetChecks.get(name);
        if (!info) {
          const bytes = await readSelected(assetPath), image = readImageInfo(bytes);
          if (!image || !SHOWABLE_IMAGE_TYPES.has(image.mimeType) || !image.width || !image.height
              || bytes.length > 8 * 1024 * 1024 || image.width * image.height > 64_000_000) {
            throw new Error(`The image ${leaf(name)} is unsupported or too large. Keep a readable original and review this image.`);
          }
          info = { checksum: await sha256(bytes), byteSize: bytes.length, mimeType: image.mimeType, width: image.width, height: image.height };
          assetChecks.set(name, info);
          aliases.set(`${prefix}/assets/${name}`, assetPath);
        }
        if ((asset.checksum && hex(asset.checksum) !== hex(info.checksum)) || asset.mimeType !== info.mimeType) {
          throw new Error(`The image ${leaf(name)} does not match its package. No answer or image mapping was changed.`);
        }
        Object.assign(asset, info); // Measured file metadata only, not source content or roles.
      }
    }
    const pkg = { manifest, questions: parsed.questions };
    const assessment = assessBank(pkg, issues, [...assetChecks.keys()].map(name => ({ name })));
    if (assessment.issues.some(issue => issue.severity === "error" && !issue.questionId)) {
      throw new Error(`${manifest.bank.title} has a bank-level identity or structural conflict. Review the package first.`);
    }
    const rawText = parsed.questions.map(question => [
      `Source: ${sourceName}${question.source.page ? `, page ${question.source.page}` : ""}`,
      blocksToPlainText(question.stem),
      ...question.choices.map(choice => `${choice.label}. ${blocksToPlainText(choice.blocks)}`),
      ...(question.choiceTable ? [blocksToPlainText([question.choiceTable])] : []),
      ...(question.correctAnswer ? [`Source answer: ${question.correctAnswer.labels.join(", ")}`] : []),
      ...(question.explanation?.length ? [`Explanation:\n${blocksToPlainText(question.explanation)}`] : []),
    ].join("\n")).join("\n\n");
    const bank: PreparedBank = { pkg, issues, sourceText: { rawText }, sourceBytes: original?.length ?? 0,
      unreadableQuestions: originalCount - parsed.questions.length,
      notes: ["Imported from a native AXOM question package. Its catalog was generated automatically; answer evidence and review gates are unchanged.",
        "Source text contains package excerpts, not a fresh extraction of the complete original.",
        ...(original ? [] : ["The original source bytes were not included. Source identity is the package's recorded checksum."])] };
    const bankFile = `${prefix}/prepared-bank.json`;
    virtual.set(bankFile, encode(bank));
    const originalFile = original && sourceFile ? `${prefix}/source/${sourceName}` : undefined;
    if (originalFile && sourceFile) aliases.set(originalFile, sourceFile);
    const ready = assessment.counts.ready, review = originalCount - ready;
    sources.push({ id: `source-${checksum}`, name: sourceName, sourcePath: sourceName, checksum, module: manifest.course.name,
      status: ready ? "prepared" : "review-required", reason: "Native package mapped automatically. Source answer evidence still requires the existing review rules.",
      bankFile, ...(originalFile ? { originalFile } : {}), ready, review });
  }
  const identity = hex(await sha256(encode([...fingerprints].sort())));
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: `native-${identity.slice(0, 24)}`,
    version: `native-input-v1-${identity.slice(0, 16)}`, templates: [], sources };
  virtual.set("catalog.json", encode(catalog));
  return async path => {
    const key = safeInputPath(path), bytes = virtual.get(key);
    if (bytes) return bytes.slice();
    const actual = aliases.get(key);
    if (!actual) throw new Error(`Missing mapped library file: ${leaf(key)}. Re-select the complete question package.`);
    return readSelected(actual);
  };
}
