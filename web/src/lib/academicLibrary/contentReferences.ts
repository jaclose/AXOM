import { assessBank } from "../question-content/assessBank";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedBank } from "../privateLibrary/types";
import type { NoctyriumState } from "../types";
import { sha256 } from "../compressedText";
import { readCatalog, readPreparedBank, safeLibraryPath, type LibraryInstallation } from "../privateLibrary/install";
import { packageToReviewedImport } from "../question-content/toReviewedImport";
import { prepareReviewedImport } from "../questionImportSave";
import { validateQuestionRecord } from "../questions";
import { projectCloudRecord, type ContentReference } from "../sync/cloudContent";

export interface AcademicAssetReference { revisionId: string; path: string; sha256: string }
export interface AcademicRecordReference extends AcademicAssetReference {
  adapterVersion: 1;
  kind: "question" | "document" | "review";
  questionId?: string;
  reviewedAt?: string;
}
export interface AcademicBindings {
  sources: ContentReference[];
  assets: AcademicAssetReference[];
  originals?: Array<{ documentId: string; asset: AcademicAssetReference }>;
}
export function validAcademicAsset(value: unknown): value is AcademicAssetReference {
  const item = value as AcademicAssetReference;
  if (!item || !/^[a-f0-9-]{36}$/i.test(item.revisionId) || !/^[a-f0-9]{64}$/.test(item.sha256)) return false;
  try { return safeLibraryPath(item.path) === item.path; } catch { return false; }
}

/** Every read reuses actual revision/file RLS. No signed URL or service key is
 * persisted in a learner checkpoint. Hash-addressed objects stay canonical. */
export async function downloadAcademicAsset(client: SupabaseClient, reference: AcademicAssetReference): Promise<Blob> {
  if (!validAcademicAsset(reference)) throw new Error("Invalid academic content reference.");
  const { data: file, error } = await client.from("academic_files").select("object_path,sha256,byte_size,mime_type")
    .eq("revision_id", reference.revisionId).eq("path", reference.path).single();
  if (error || !file || file.sha256 !== reference.sha256) throw new Error("This course revision is unavailable to your account. Your progress and downloaded copy are preserved.");
  const result = await client.storage.from("academic-content").download(file.object_path);
  if (result.error || !result.data || result.data.size !== file.byte_size
    || await sha256(new Uint8Array(await result.data.arrayBuffer())) !== reference.sha256) throw new Error("The course source failed its download integrity check.");
  return result.data;
}

const adaptedBanks = new WeakMap<PreparedBank, ReturnType<typeof packageToReviewedImport>>();

/** Replay the existing reviewed-import adapter, never a parallel question parser. */
export function academicRecord(bank: PreparedBank, reference: AcademicRecordReference): object {
  if (reference.adapterVersion !== 1) throw new Error("This course content requires a compatible AXOM version.");
  if (reference.kind === "document") return bank.sourceText;
  if (reference.kind === "review") return { rawText: JSON.stringify(bank) };
  if (!reference.questionId || !reference.reviewedAt || !Number.isFinite(Date.parse(reference.reviewedAt))) throw new Error("Invalid academic question reference.");
  let adapted = adaptedBanks.get(bank);
  if (!adapted) {
    const assessed = assessBank(bank.pkg, bank.issues, bank.pkg.questions.flatMap(question => question.assets.filter(asset => asset.checksum).map(asset => ({ name: asset.filename }))));
    adapted = packageToReviewedImport(bank.pkg, assessed.issues, { sourceText: bank.sourceText, sourceBytes: bank.sourceBytes, notes: bank.notes });
    adaptedBanks.set(bank, adapted);
  }
  for (const section of adapted.imports) {
    const draft = section.request.drafts.find(item => item.content?.id === reference.questionId);
    if (!draft) continue;
    const prepared = prepareReviewedImport({ ...section.request, drafts: [draft] }, { questions: [], questionSets: [], documents: [] }, { id: () => "source", now: () => reference.reviewedAt! });
    if (!prepared.ok) break;
    const input = prepared.plan.questions.find(question => question.content?.id === reference.questionId);
    const validated = validateQuestionRecord(input, new Date(reference.reviewedAt));
    if (validated.ok && validated.value) return validated.value;
  }
  throw new Error("This source question cannot be reconstructed by this version of AXOM. Keep your downloaded copy.");
}

/** Only a byte-for-byte equivalent source projection earns a shared reference.
 * Personal source edits or Decode additions keep the private recovery path. */
export async function academicBindings(state: NoctyriumState, installation: LibraryInstallation, revisionId: string,
  files: Array<{ path: string; sha256: string; mime_type: string }>, captured: Map<string, Uint8Array>): Promise<AcademicBindings> {
  const sources: ContentReference[] = [];
  const bound = new Set<string>();
  for (const file of files) {
    const bytes = captured.get(file.path);
    if (!bytes || file.path === "catalog.json" || !file.path.endsWith(".json")) continue;
    let bank;
    try { bank = readPreparedBank(JSON.parse(new TextDecoder().decode(bytes))); } catch { continue; }
    const asset = { revisionId, path: file.path, sha256: file.sha256, adapterVersion: 1 as const };
    for (const collection of ["questions", "documents"] as const) {
      const ids = new Set(collection === "questions" ? installation.questionIds : installation.documentIds);
      for (const record of state[collection]) {
        if (!ids.has(record.id) || bound.has(`${collection}:${record.id}`)) continue;
        let academic: AcademicRecordReference;
        if (collection === "questions" && "stem" in record) {
          if (!record.content || !bank.pkg.questions.some(question => question.id === record.content!.id && question.provenance.sourceChecksum === record.content!.provenance.sourceChecksum)) continue;
          academic = { ...asset, kind: "question", questionId: record.content.id, reviewedAt: record.extraction?.reviewedAt };
        } else if ("fileType" in record) academic = { ...asset, kind: record.fileType === "axom-private-bank-review" ? "review" : "document" };
        else continue;
        let canonical;
        try { canonical = academicRecord(bank, academic); } catch { continue; }
        const [actual, expected] = await Promise.all([projectCloudRecord(record, collection), projectCloudRecord({ ...canonical, id: record.id }, collection)]);
        if (actual.canonicalHash !== expected.canonicalHash) continue;
        const bytes = new TextEncoder().encode(actual.canonicalText).length;
        sources.push({ ...actual.reference, hash: actual.canonicalHash, byteSize: bytes, expandedBytes: bytes, academic });
        bound.add(`${collection}:${record.id}`);
      }
    }
  }
  const catalogBytes = captured.get("catalog.json");
  const originalPaths = new Set(catalogBytes ? readCatalog(JSON.parse(new TextDecoder().decode(catalogBytes))).sources.flatMap(source => source.originalFile ? [source.originalFile] : []) : []);
  const originals = state.documents.filter(document => installation.documentIds.includes(document.id) && document.checksum && document.fileType !== "axom-course-template")
    .flatMap(document => {
      const file = files.find(item => originalPaths.has(item.path) && item.sha256 === document.checksum!.replace(/^sha256:/, "")
        && ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(item.mime_type));
      return file ? [{ documentId: document.id, asset: { revisionId, path: file.path, sha256: file.sha256 } }] : [];
    });
  return { sources, originals, assets: files.filter(file => file.mime_type.startsWith("image/")).map(file => ({ revisionId, path: file.path, sha256: file.sha256 })) };
}

export function storedAcademicBindings(state: NoctyriumState): AcademicBindings {
  const result: AcademicBindings = { sources: [], assets: [], originals: [] };
  for (const doc of state.documents) {
    if (doc.fileType !== "axom-academic-reference") continue;
    try {
      const value = JSON.parse(doc.rawText).bindings as AcademicBindings | undefined;
      if (!value || !Array.isArray(value.sources) || !Array.isArray(value.assets)) continue;
      result.sources.push(...value.sources.filter(ref => validAcademicAsset(ref.academic)));
      result.assets.push(...value.assets.filter(validAcademicAsset));
      if (Array.isArray(value.originals)) result.originals!.push(...value.originals.filter(item => typeof item?.documentId === "string" && validAcademicAsset(item.asset)));
    } catch { /* Legacy references have no shared-source mapping. Preserve their private recovery. */ }
  }
  return result;
}
