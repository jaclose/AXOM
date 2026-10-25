import { assessBank } from "../question-content/assessBank";
import { sha256 } from "../question-content/assets";
import type { ImportPackage, QuestionAsset } from "../question-content/package";
import { readCatalog, readPreparedBank, safeLibraryPath } from "../privateLibrary/install";
import type { PreparedBank, PrivateLibraryCatalog } from "../privateLibrary/types";
import {
  academicAssetPath,
  assertAcademicQuestionsInstallable,
  type AcademicUpload,
  verifiedAcademicUploadSnapshot,
} from "./upload";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const basename = (value: string) => value.split(/[\\/]/).at(-1) || "source";
const comparePath = (left: { path: string }, right: { path: string }) => left.path.localeCompare(right.path);
const forbiddenSegment = /(^|\/)(audit|audits|original|originals|private|recovery|reference|references|source|sources)(\/|$)/i;

export interface AcademicReleaseProjectionFile {
  path: string;
  sha256: string;
  byte_size: number;
  mime_type: "application/json" | "text/plain" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  bytes: Uint8Array;
}

export interface AcademicReleaseProjection {
  sourceRevisionHash: string;
  projectionHash: string;
  readyQuestions: number;
  heldQuestions: 0;
  files: AcademicReleaseProjectionFile[];
}

function assertReleasePath(path: string): string {
  safeLibraryPath(path);
  if (path.length > 500 || (path !== "catalog.json" && !/^(templates|banks)\//.test(path))
    || forbiddenSegment.test(path)) {
    throw new Error("The learner release contains a reserved or private file path.");
  }
  return path;
}

function sanitizeAsset(asset: QuestionAsset): QuestionAsset {
  if (asset.filename !== basename(asset.filename)) {
    throw new Error("A learner release image needs a canonical file name.");
  }
  return {
    ...asset,
    ...(asset.sourceFile ? { sourceFile: basename(asset.sourceFile) } : {}),
  };
}
function sanitizePackage(bank: PreparedBank): ImportPackage {
  return {
    manifest: {
      ...bank.pkg.manifest,
      source: { ...bank.pkg.manifest.source, filename: basename(bank.pkg.manifest.source.filename) },
      questionsFile: "questions.json",
      assetsDirectory: "assets",
    },
    questions: bank.pkg.questions.map(question => ({
      ...question,
      source: { ...question.source, filename: basename(question.source.filename) },
      assets: question.assets.map(sanitizeAsset),
      provenance: {
        method: question.provenance.method,
        ...(question.provenance.tool ? { tool: question.provenance.tool } : {}),
        ...(question.provenance.createdAt ? { createdAt: question.provenance.createdAt } : {}),
        ...(question.provenance.sourceChecksum ? { sourceChecksum: question.provenance.sourceChecksum } : {}),
      },
    })),
  };
}
async function projectedFile(
  path: string,
  bytes: Uint8Array,
  mime_type: AcademicReleaseProjectionFile["mime_type"],
): Promise<AcademicReleaseProjectionFile> {
  assertReleasePath(path);
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) {
    throw new Error("A learner release file exceeds the supported size.");
  }
  return {
    path,
    bytes: new Uint8Array(bytes),
    sha256: (await sha256(bytes)).slice(7),
    byte_size: bytes.length,
    mime_type,
  };
}

/** Derive a new learner-safe object set from a fully verified private revision.
 * Private originals and extracted source text stay in the source revision;
 * answer keys, explanations and referenced figures remain in the projection. */
export async function prepareAcademicReleaseProjection(value: AcademicUpload): Promise<AcademicReleaseProjection> {
  const upload = await verifiedAcademicUploadSnapshot(value);
  if (upload.metadata.review_questions !== 0) {
    throw new Error("Only a zero-review academic revision can become a learner release.");
  }

  const privateFiles = new Map(upload.files.map(file => [file.path, file]));
  const catalogFile = privateFiles.get("catalog.json");
  if (!catalogFile) throw new Error("The private revision is missing its catalog.");
  const catalog = readCatalog(JSON.parse(decode(catalogFile.bytes)));
  const files: AcademicReleaseProjectionFile[] = [];
  const releasedSources: PrivateLibraryCatalog["sources"] = [];

  const template = catalog.templates[0];
  const releasedTemplates: PrivateLibraryCatalog["templates"] = [];
  if (template) {
    const source = privateFiles.get(template.file);
    if (!source || source.mime_type !== "text/plain") {
      throw new Error("The reviewed course plan is unavailable for release.");
    }
    const path = "templates/course.txt";
    files.push(await projectedFile(path, source.bytes, "text/plain"));
    releasedTemplates.push({ file: path, name: basename(template.name), checksum: source.sha256 });
  }

  let readyQuestions = 0;
  for (const [index, source] of catalog.sources.entries()) {
    if (source.review !== 0) {
      throw new Error("A source with held or review questions cannot enter a learner release.");
    }
    // Source-only audit/reference entries are retained in the private revision.
    if (!source.bankFile) continue;
    const privateBankFile = privateFiles.get(source.bankFile);
    if (!privateBankFile || privateBankFile.mime_type !== "application/json") {
      throw new Error("A reviewed question bank is unavailable for release.");
    }
    const bank = readPreparedBank(JSON.parse(decode(privateBankFile.bytes)));
    const assetFiles = new Map<string, AcademicUpload["files"][number]>();
    for (const question of bank.pkg.questions) {
      for (const asset of question.assets) {
        if (asset.filename !== basename(asset.filename)) {
          throw new Error("A learner release image needs a canonical file name.");
        }
        const privateAsset = privateFiles.get(academicAssetPath(source.bankFile, asset.filename));
        if (!privateAsset || !privateAsset.mime_type.startsWith("image/")) {
          throw new Error("A learner release is missing a referenced question image.");
        }
        assetFiles.set(asset.filename, privateAsset);
      }
    }
    const assessment = assessBank(bank.pkg, bank.issues,
      [...assetFiles].map(([name, file]) => ({ name, size: file.byte_size })));
    const held = assessment.counts["needs-review"] + assessment.counts.unresolved
      + (bank.unreadableQuestions ?? 0);
    if (held !== 0 || assessment.counts.ready !== source.ready) {
      throw new Error("The learner release contains a held, unreadable or unresolved question.");
    }
    assertAcademicQuestionsInstallable(bank, assessment.issues, source.ready, 0);

    const directory = `banks/${String(index + 1).padStart(4, "0")}-${source.checksum.slice(0, 12)}`;
    const bankPath = `${directory}/bank.json`;
    for (const [filename, privateAsset] of assetFiles) {
      files.push(await projectedFile(`${directory}/assets/${filename}`, privateAsset.bytes,
        privateAsset.mime_type as AcademicReleaseProjectionFile["mime_type"]));
    }
    const releasedBank: PreparedBank = {
      pkg: sanitizePackage(bank),
      issues: [],
      sourceText: { rawText: "" },
      sourceBytes: 0,
      notes: [],
      ...(bank.reviewedFiling ? { reviewedFiling: bank.reviewedFiling } : {}),
      unreadableQuestions: 0,
    };
    files.push(await projectedFile(bankPath, encode(releasedBank), "application/json"));
    releasedSources.push({
      id: source.id,
      name: basename(source.name),
      sourcePath: basename(source.name),
      checksum: source.checksum,
      ...(source.module ? { module: source.module } : {}),
      status: "prepared",
      reason: "Ready for practice",
      bankFile: bankPath,
      ready: source.ready,
      review: 0,
    });
    readyQuestions += source.ready;
  }

  if (readyQuestions !== upload.metadata.ready_questions) {
    throw new Error("The learner release ready count differs from its private source revision.");
  }
  const releaseCatalog: PrivateLibraryCatalog = {
    format: catalog.format,
    schemaVersion: catalog.schemaVersion,
    id: catalog.id,
    version: catalog.version,
    ...(catalog.preparerVersion !== undefined ? { preparerVersion: catalog.preparerVersion } : {}),
    templates: releasedTemplates,
    sources: releasedSources,
  };
  files.push(await projectedFile("catalog.json", encode(releaseCatalog), "application/json"));
  files.sort(comparePath);
  const portablePaths = new Set(files.map(file => file.path.normalize("NFC").toLowerCase()));
  const totalBytes = files.reduce((sum, file) => sum + file.byte_size, 0);
  if (portablePaths.size !== files.length || files.length > 1500 || totalBytes > 512 * 1024 * 1024) {
    throw new Error("The learner release has duplicate paths or exceeds supported bounds.");
  }
  const manifest = files.map(({ path, sha256: digest, byte_size, mime_type }) => ({
    path, sha256: digest, byte_size, mime_type,
  }));
  const projectionHash = (await sha256(encode({
    format: "axom-academic-release-projection",
    schemaVersion: 1,
    sourceRevisionHash: upload.hash,
    files: manifest,
  }))).slice(7);
  return {
    sourceRevisionHash: upload.hash,
    projectionHash,
    readyQuestions,
    heldQuestions: 0,
    files,
  };
}
