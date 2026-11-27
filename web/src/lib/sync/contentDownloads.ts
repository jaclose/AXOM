import { workspaceMedia, downloadCloudMediaAsset } from "./cloudMedia";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { accountOperationClient } from "../account/supabase";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent } from "../questionAttachmentScope";
import { useStore } from "../store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { NoctyriumState } from "../types";
import { hydrateCloudContent, splitCloudContent, mergeSourceFields } from "./cloudContent";
import { admitContentIdentities } from "./deferredContent";
import { downloadAcademicAsset, storedAcademicBindings } from "../academicLibrary/contentReferences";
import { readSourceOriginal, saveSourceOriginal } from "../decode/sources";
import { downloadCloudOriginal } from "./cloudOriginals";
import { sha256Hex } from "../checksum";

export interface ContentSelection { questionIds?: string[]; documentIds?: string[] }

/** Explicit downloads are additive. Account switches or edits during I/O never
 * replace the current workspace, and failure leaves every reference retryable. */
export async function materializeState(state: NoctyriumState, selection?: ContentSelection): Promise<NoctyriumState> {
  const deferred = admitContentIdentities(state);
  if (!deferred) return state;
  // Capture the local generation before the first asynchronous account lookup.
  const scope = getQuestionAttachmentScope();
  const { client, userId, assertCurrent } = await accountOperationClient();
  if (userId !== deferred.accountId) throw new Error("Sign in to the account that saved this content before downloading it.");
  const access = { scope, accountId: userId };
  const assertScope = () => {
    if (scope.accountId !== userId || !isQuestionAttachmentScopeCurrent(scope)) {
      throw new Error("The account changed during the download. Retry from the current account.");
    }
  };
  const ensureCurrent = async () => {
    assertScope();
    await assertCurrent();
    assertScope();
  };
  await ensureCurrent();
  const questions = deferred.questions.filter(record => !selection || selection.questionIds?.includes(record.id));
  const documents = deferred.documents.filter(record => !selection || selection.documentIds?.includes(record.id));
  const qids = new Set(questions.map(record => record.id));
  const dids = new Set(documents.map(record => record.id));
  const sources = deferred.sources.filter(ref => (ref.collection === "questions" ? qids : dids).has(ref.id));
  const partial = { ...state, questions, documents, deferredContent: undefined } as NoctyriumState;
  const restored = await hydrateCloudContent(client, userId, partial, sources, ensureCurrent);
  await ensureCurrent();
  // Validate the selected subset before any original or figure storage writes.
  // A digest-addressed image shared with an unselected record can legitimately
  // have an earlier manifest timestamp; mutable keys require exact equality.
  const media = new Map(deferred.media.map(entry => [entry.blobKey, entry]));
  const figures = [...workspaceMedia(restored).entries()];
  for (const [blobKey, { attachment, checksum }] of figures) {
    const reference = media.get(blobKey);
    if (!reference) throw new Error("This source has no protected image reference. Keep its original file and retry from a complete backup.");
    const immutable = /^private-library:sha256:[a-f0-9]{64}$/.test(blobKey);
    const timestampMatches = immutable
      ? Number.isFinite(Date.parse(attachment.updatedAt)) && Date.parse(reference.updatedAt) <= Date.parse(attachment.updatedAt)
      : reference.updatedAt === attachment.updatedAt;
    if (reference.byteSize !== attachment.byteSize || !timestampMatches) {
      throw new Error("The protected image index does not match this source. Your saved work is unchanged.");
    }
    if (checksum && reference.hash !== checksum) throw new Error("This image does not match its immutable question source.");
  }
  // Original PDF/DOCX files belong to the same protected course revision.
  // Keep only verified copies in Decode's existing original-file cache.
  const originals = storedAcademicBindings(state).originals ?? [];
  for (const document of restored.documents) {
    await ensureCurrent();
    await downloadCloudOriginal(client, userId, document, ensureCurrent);
    await ensureCurrent();
    const original = originals.find(item => item.documentId === document.id);
    if (!original) continue;
    if (original.asset.sha256 !== document.checksum?.replace(/^sha256:/, "")) throw new Error("The original document does not match its saved source identity.");
    await ensureCurrent();
    if (await readSourceOriginal(document.id, document.checksum, access)) {
      await ensureCurrent();
      continue;
    }
    await ensureCurrent();
    const blob = await downloadAcademicAsset(client, original.asset);
    await ensureCurrent();
    await saveSourceOriginal(document, blob, access);
    await ensureCurrent();
  }
  // Explicit downloads include their original figures so the resulting bank
  // is actually usable offline. Source metadata alone is never called downloaded.
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const localAccess = { ...access, localOnly: true };
  async function worker(): Promise<void> {
    while (cursor < figures.length && !failed) {
      const [blobKey, { questionId, attachment }] = figures[cursor++];
      try {
        await ensureCurrent();
        if (failed) return;
        const reference = media.get(blobKey)!; // All selected references passed preflight.
        const local = await getQuestionAttachmentBlob(blobKey, localAccess);
        await ensureCurrent();
        if (failed) return;
        if (local) {
          if (local.blob.size !== attachment.byteSize) throw new Error("An existing image has a different size. AXOM did not replace it.");
          if (await sha256Hex(await local.blob.arrayBuffer()) !== reference.hash) throw new Error("An existing image failed its checksum. AXOM did not replace it.");
          await ensureCurrent();
          if (failed) return;
          continue;
        }
        const blob = await downloadCloudMediaAsset(client, userId, reference);
        await ensureCurrent();
        if (failed) return;
        // Recheck after the network wait. Do not knowingly replace a local copy.
        // Atomic add-only protection against cross-tab insertion is a separate store contract.
        const concurrent = await getQuestionAttachmentBlob(blobKey, localAccess);
        await ensureCurrent();
        if (failed) return;
        if (concurrent) {
          if (concurrent.blob.size !== attachment.byteSize) throw new Error("An existing image has a different size. AXOM did not replace it.");
          if (await sha256Hex(await concurrent.blob.arrayBuffer()) !== reference.hash) throw new Error("An existing image failed its checksum. AXOM did not replace it.");
          await ensureCurrent();
          if (failed) return;
          continue;
        }
        await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId, blob }, access);
        await ensureCurrent();
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  }
  // A failed worker must not release the operation while another worker is
  // still downloading or writing. Already committed same-account bytes remain.
  await Promise.all(Array.from({ length: Math.min(4, figures.length) }, worker));
  if (failed) throw failure;
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
  const scope = getQuestionAttachmentScope();
  const before = useStore.getState();
  const restored = await materializeState(before, selection);
  if (restored === before) return;
  // A bank download includes the existing study UI, including its lazy chunk.
  if (typeof window !== "undefined") await import("../../pages/QuestionWorkspacePage");
  if (useStore.getState() !== before || !isQuestionAttachmentScopeCurrent(scope)) throw new Error("Your workspace changed during the download. Your work is safe; retry to apply the downloaded content.");
  const checkpoint = getVaultWriteCheckpoint();
  useStore.setState({ questions: restored.questions, documents: restored.documents, deferredContent: restored.deferredContent });
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
}

/** Keep already downloaded bytes on this device while adopting remote learner
 * metadata. Only exact immutable digest matches can supply the source fields. */
export async function retainDownloadedContent(remote: NoctyriumState, local: NoctyriumState): Promise<NoctyriumState> {
  const admitted = admitContentIdentities(remote);
  if (!admitted) return remote;
  admitContentIdentities(local);
  const split = await splitCloudContent({ ...local, deferredContent: undefined });
  const known = new Map(split.objects.map(object => [`${object.reference.collection}:${object.reference.id}`, object]));
  const matches = admitted.sources.filter(ref => (ref.academic ? known.get(`${ref.collection}:${ref.id}`)?.canonicalHash : known.get(`${ref.collection}:${ref.id}`)?.reference.hash) === ref.hash);
  const deferred = { ...admitted };
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
