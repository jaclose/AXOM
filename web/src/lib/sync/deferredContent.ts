import type { NoctyriumState } from "../types";
import type { QuestionRecord } from "../questions";
import type { SourceDocument } from "../library";
import { readContentReferences, INLINE_CONTENT_TYPES, type ContentReference } from "./cloudContent";
import { readMediaManifest, type CloudMediaReference } from "./cloudMedia";

/** Wire metadata is deliberately not a QuestionRecord: it cannot enter practice. */
export interface DeferredContent {
  accountId: string;
  questions: Array<Partial<QuestionRecord> & { id: string }>;
  documents: Array<Partial<SourceDocument> & { id: string }>;
  sources: ContentReference[];
  media: CloudMediaReference[];
}

export function readDeferredContent(value: unknown): DeferredContent | undefined {
  if (value === undefined) return;
  const item = value as DeferredContent;
  if (!item || typeof item.accountId !== "string" || !item.accountId || !Array.isArray(item.questions)
    || !Array.isArray(item.documents) || !Array.isArray(item.media)) throw new Error("The saved content references are invalid.");
  const refs = readContentReferences(item.sources);
  readMediaManifest(item.media);
  for (const collection of ["questions", "documents"] as const) {
    const ids = item[collection].map(record => record?.id);
    const idSet = new Set(ids);
    if (ids.some(id => typeof id !== "string" || !id) || idSet.size !== ids.length
      || refs.filter(ref => ref.collection === collection).length !== ids.length
      || refs.some(ref => ref.collection === collection && !idSet.has(ref.id))) throw new Error("A saved content reference has no matching record.");
  }
  return item;
}

export function deferContent(state: NoctyriumState, accountId: string, sources: ContentReference[], media: CloudMediaReference[]): NoctyriumState {
  const inline = state.documents.filter(doc => INLINE_CONTENT_TYPES.has(doc.fileType));
  const inlineIds = new Set(inline.map(doc => doc.id));
  const deferredContent = readDeferredContent({ accountId, questions: state.questions, documents: state.documents.filter(doc => !inlineIds.has(doc.id)),
    sources: sources.filter(ref => ref.collection !== "documents" || !inlineIds.has(ref.id)), media });
  return { ...state, questions: [], documents: inline, deferredContent: deferredContent?.sources.length ? deferredContent : undefined };
}

/** Include deferred metadata for transfer/media checks only, never for study. */
export function contentMetadata(state: NoctyriumState): NoctyriumState {
  const deferred = readDeferredContent(state.deferredContent);
  if (!deferred) return state;
  const result = { ...state };
  delete result.deferredContent;
  for (const collection of ["questions", "documents"] as const) {
    const ids = new Set(state[collection].map(record => record.id));
    if (deferred[collection].some(record => ids.has(record.id))) throw new Error("Downloaded and deferred content overlap. Your saved work is unchanged.");
    Object.assign(result, { [collection]: [...state[collection], ...deferred[collection]] });
  }
  return result;
}
