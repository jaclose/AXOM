import { workspaceMedia, downloadCloudMediaAsset } from "./cloudMedia";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { accountOperationClient } from "../account/supabase";
import { useStore } from "../store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { NoctyriumState } from "../types";
import { hydrateCloudContent, splitCloudContent, mergeSourceFields } from "./cloudContent";
import { readDeferredContent } from "./deferredContent";

export interface ContentSelection { questionIds?: string[]; documentIds?: string[] }

/** Explicit downloads are additive. Account switches or edits during I/O never
 * replace the current workspace, and failure leaves every reference retryable. */
export async function materializeState(state: NoctyriumState, selection?: ContentSelection): Promise<NoctyriumState> {
  const deferred = readDeferredContent(state.deferredContent);
  if (!deferred) return state;
  const { client, userId, assertCurrent } = await accountOperationClient();
  if (userId !== deferred.accountId) throw new Error("Sign in to the account that saved this content before downloading it.");
  const questions = deferred.questions.filter(record => !selection || selection.questionIds?.includes(record.id));
  const documents = deferred.documents.filter(record => !selection || selection.documentIds?.includes(record.id));
  const qids = new Set(questions.map(record => record.id));
  const dids = new Set(documents.map(record => record.id));
  const sources = deferred.sources.filter(ref => (ref.collection === "questions" ? qids : dids).has(ref.id));
  const partial = { ...state, questions, documents, deferredContent: undefined } as NoctyriumState;
  const restored = await hydrateCloudContent(client, userId, partial, sources, assertCurrent);
  // Explicit downloads include their original figures so the resulting bank
  // is actually usable offline. Source metadata alone is never called downloaded.
  const media = new Map(deferred.media.map(entry => [entry.blobKey, entry]));
  const figures = [...workspaceMedia(restored).entries()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, figures.length) }, async () => {
    while (cursor < figures.length) {
      const [blobKey, { questionId, attachment, checksum }] = figures[cursor++];
      await assertCurrent();
      const reference = media.get(blobKey);
      if (checksum && reference?.hash !== checksum) throw new Error("This image does not match its immutable question source.");
      const local = await getQuestionAttachmentBlob(blobKey);
      if (local && local.blob.size === attachment.byteSize) continue;
      if (!reference) throw new Error("This source has no protected image reference. Keep its original file and retry from a complete backup.");
      const blob = await downloadCloudMediaAsset(client, userId, reference);
      await assertCurrent();
      await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId, blob });
    }
  }));
  await assertCurrent();
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
