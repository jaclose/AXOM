import { workspaceMedia, downloadCloudMediaAsset } from "./cloudMedia";
import { sha256 } from "../compressedText";
import { getQuestionAttachmentBlob } from "../questionAttachments";
import { addQuestionAttachmentBlobIfAbsent } from "./atomicMediaWrite";
import { accountOperationClient } from "../account/supabase";
import { useStore } from "../store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { NoctyriumState } from "../types";
import { hydrateCloudContent, splitCloudContent, mergeSourceFields } from "./cloudContent";
import { readDeferredContent } from "./deferredContent";
import { downloadAcademicAsset, storedAcademicBindings } from "../academicLibrary/contentReferences";
import { readSourceOriginal, saveSourceOriginal } from "../decode/sources";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent } from "../questionAttachmentScope";
import { downloadCloudOriginal } from "./cloudOriginals";

export interface ContentSelection { questionIds?: string[]; documentIds?: string[] }

/** Explicit downloads are additive. Account switches or edits during I/O never
 * replace the current workspace, and failure leaves every reference retryable. */
export async function materializeState(state: NoctyriumState, selection?: ContentSelection): Promise<NoctyriumState> {
  const deferred = readDeferredContent(state.deferredContent);
  if (!deferred) return state;
  const { client, userId, assertCurrent } = await accountOperationClient();
  // Pin the account generation before any cloud I/O. The authenticated
  // session may be unchanged while the local attachment scope cycles A-B-A.
  const originalScope = getQuestionAttachmentScope();
  const assertAccountGeneration = () => {
    if (originalScope.accountId !== userId || !isQuestionAttachmentScopeCurrent(originalScope)) {
      throw new Error("The account changed during original-file recovery. Reopen the course in its original account and retry.");
    }
  };
  // Session identity alone cannot detect a local A → B → A transition.
  // Bind every protected-media read/write to the same originating generation.
  const ensureCurrent = async (): Promise<void> => {
    assertAccountGeneration();
    await assertCurrent();
    assertAccountGeneration();
  };
  if (userId !== deferred.accountId) throw new Error("Sign in to the account that saved this content before downloading it.");
  const questions = deferred.questions.filter(record => !selection || selection.questionIds?.includes(record.id));
  const documents = deferred.documents.filter(record => !selection || selection.documentIds?.includes(record.id));
  const qids = new Set(questions.map(record => record.id));
  const dids = new Set(documents.map(record => record.id));
  const sources = deferred.sources.filter(ref => (ref.collection === "questions" ? qids : dids).has(ref.id));
  const partial = { ...state, questions, documents, deferredContent: undefined } as NoctyriumState;
  await ensureCurrent();
  const restored = await hydrateCloudContent(client, userId, partial, sources, ensureCurrent);
  await ensureCurrent();
  // Original PDF/DOCX files belong to the same protected course revision.
  // Keep only verified copies in Decode's existing original-file cache.
  const originals = storedAcademicBindings(state).originals ?? [];
  for (const document of restored.documents) {
    assertAccountGeneration();
    await downloadCloudOriginal(client, userId, document, ensureCurrent);
    assertAccountGeneration();
    const original = originals.find(item => item.documentId === document.id);
    if (!original) continue;
    if (original.asset.sha256 !== document.checksum?.replace(/^sha256:/, "")) throw new Error("The original document does not match its saved source identity.");
    await ensureCurrent();
    assertAccountGeneration();
    if (await readSourceOriginal(document.id, document.checksum, { scope: originalScope, accountId: userId })) continue;
    const blob = await downloadAcademicAsset(client, original.asset);
    await ensureCurrent();
    assertAccountGeneration();
    await saveSourceOriginal(document, blob, { scope: originalScope, accountId: userId });
  }
  // Explicit downloads include their original figures so the resulting bank
  // is actually usable offline. Source metadata alone is never called downloaded.
  const media = new Map(deferred.media.map(entry => [entry.blobKey, entry]));
  const figures = [...workspaceMedia(restored).entries()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, figures.length) }, async () => {
    while (cursor < figures.length) {
      const [blobKey, { questionId, attachment, checksum }] = figures[cursor++];
      await ensureCurrent();
      const reference = media.get(blobKey);
      if (!reference || reference.byteSize !== attachment.byteSize || reference.updatedAt !== attachment.updatedAt) {
        throw new Error("This source has no matching protected image reference. Keep its original file and retry from a complete backup.");
      }
      if (checksum && reference.hash !== checksum) throw new Error("This image does not match its immutable question source.");
      // The device's cached original is not an integrity receipt. A same-sized
      // corrupt image must never be accepted as downloaded course content.
      // Read only this account's current local store, not the lazy cloud loader.
      const local = await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: userId });
      await ensureCurrent();
      if (local) {
        if (local.blob.size !== reference.byteSize || local.byteSize !== reference.byteSize
          || local.mimeType !== attachment.mimeType
          || await sha256(new Uint8Array(await local.blob.arrayBuffer())) !== reference.hash) {
          throw new Error("A saved image conflicts with its protected original. AXOM did not replace the local image. Export your work and restore the original before retrying.");
        }
        await ensureCurrent();
        continue;
      }
      const blob = await downloadCloudMediaAsset(client, userId, reference);
      await ensureCurrent();
      // Recheck after remote I/O. The subsequent add-only transaction is
      // essential: a second tab can still create the key after this read.
      const raced = await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: userId });
      await ensureCurrent();
      if (raced) {
        if (raced.blob.size !== reference.byteSize || raced.byteSize !== reference.byteSize
          || raced.mimeType !== attachment.mimeType
          || await sha256(new Uint8Array(await raced.blob.arrayBuffer())) !== reference.hash) {
          throw new Error("A saved image conflicts with its protected original. AXOM did not replace the local image. Export your work and restore the original before retrying.");
        }
        await ensureCurrent();
        continue;
      }
      // A competing tab can win between the final read and this write.
      // Never use a blind put: atomic add preserves the first saved original.
      await addQuestionAttachmentBlobIfAbsent(blobKey, { ...attachment, questionId, blob }, { accountId: userId, scope: originalScope });
      await ensureCurrent();
      // A successful add OR a lost race is not an integrity receipt. Confirm
      // the exact bytes currently retained by this account before returning.
      const retained = await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: userId });
      await ensureCurrent();
      if (!retained || retained.blob.size !== reference.byteSize || retained.byteSize !== reference.byteSize
        || retained.mimeType !== attachment.mimeType
        || await sha256(new Uint8Array(await retained.blob.arrayBuffer())) !== reference.hash) {
        throw new Error("A saved image conflicts with its protected original. AXOM did not replace the local image. Export your work and restore the original before retrying.");
      }
      await ensureCurrent();
    }
  }));
  await ensureCurrent();
  const remaining = {
    ...deferred, questions: deferred.questions.filter(record => !qids.has(record.id)),
    documents: deferred.documents.filter(record => !dids.has(record.id)),
    sources: deferred.sources.filter(ref => !(ref.collection === "questions" ? qids : dids).has(ref.id)),
  };
  return { ...state, questions: [...state.questions, ...restored.questions], documents: [...state.documents, ...restored.documents],
    deferredContent: remaining.sources.length ? remaining : undefined };
}

export async function downloadAccountContent(selection?: ContentSelection): Promise<void> {
  const before = useStore.getState();
  const restored = await materializeState(before, selection);
  if (restored === before) return;
  // A bank download includes the existing study UI, including its lazy chunk.
  if (typeof window !== "undefined") await import("../../pages/QuestionWorkspacePage");
  if (useStore.getState() !== before) throw new Error("Your workspace changed during the download. Your work is safe; retry to apply the downloaded content.");
  const checkpoint = getVaultWriteCheckpoint();
  useStore.setState({ questions: restored.questions, documents: restored.documents, deferredContent: restored.deferredContent });
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
}

/** Keep already downloaded bytes on this device while adopting remote learner
 * metadata. Only exact immutable digest matches can supply the source fields. */
export async function retainDownloadedContent(remote: NoctyriumState, local: NoctyriumState): Promise<NoctyriumState> {
  if (!remote.deferredContent) return remote;
  const split = await splitCloudContent({ ...local, deferredContent: undefined });
  const known = new Map(split.objects.map(object => [`${object.reference.collection}:${object.reference.id}`, object]));
  const matches = remote.deferredContent.sources.filter(ref => (ref.academic ? known.get(`${ref.collection}:${ref.id}`)?.canonicalHash : known.get(`${ref.collection}:${ref.id}`)?.reference.hash) === ref.hash);
  const deferred = { ...remote.deferredContent };
  const result = { ...remote };
  for (const collection of ["questions", "documents"] as const) {
    const ids = new Set(matches.filter(ref => ref.collection === collection).map(ref => ref.id));
    const localById = new Map<string, object>(local[collection].map(record => [record.id, record]));
    Object.assign(result, { [collection]: [...remote[collection], ...deferred[collection].filter(record => ids.has(record.id)).map(record => mergeSourceFields(record, localById.get(record.id)!, collection))] });
    Object.assign(deferred, { [collection]: deferred[collection].filter(record => !ids.has(record.id)) });
  }
  const matched = new Set(matches.map(ref => `${ref.collection}:${ref.id}`));
  deferred.sources = deferred.sources.filter(ref => !matched.has(`${ref.collection}:${ref.id}`));
  result.deferredContent = deferred.sources.length ? deferred : undefined;
  return result;
}
