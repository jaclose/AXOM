import type { SourceDocument } from "../library";
import { useStore } from "../store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";

export const COMMUNITY_REFERENCE_TYPE = "axom-community-reference";

interface CommunityReference {
  version: 1;
  accountId: string;
  revisionId: string;
  questionIds: string[];
  pending: boolean;
}

const referenceId = (revisionId: string) => `community-${revisionId}`;

function parseReference(document: SourceDocument): CommunityReference | undefined {
  if (document.fileType !== COMMUNITY_REFERENCE_TYPE) return;
  try {
    const value = JSON.parse(document.rawText) as Partial<CommunityReference>;
    if (value.version !== 1 || !value.accountId || !value.revisionId
      || document.id !== referenceId(value.revisionId)
      || !Array.isArray(value.questionIds)
      || value.questionIds.some(id => typeof id !== "string" || !id)
      || new Set(value.questionIds).size !== value.questionIds.length
      || typeof value.pending !== "boolean") return;
    return value as CommunityReference;
  } catch { return; }
}

/** Keep the Unreviewed label in the account's durable workspace, including
 * while a failed or partial download is waiting to be retried. */
export async function saveCommunityReference(
  revisionId: string, accountId: string, questionIds: readonly string[] | undefined, assertCurrent: () => void,
): Promise<void> {
  assertCurrent();
  const id = referenceId(revisionId);
  const existing = useStore.getState().documents.find(document => document.id === id);
  const previous = existing && parseReference(existing);
  const value: CommunityReference = {
    version: 1, accountId, revisionId,
    questionIds: [...new Set([...(previous?.accountId === accountId ? previous.questionIds : []), ...(questionIds ?? [])])],
    pending: questionIds === undefined,
  };
  const rawText = JSON.stringify(value);
  const checkpoint = getVaultWriteCheckpoint();
  useStore.getState().addDocument({ id, fileType: COMMUNITY_REFERENCE_TYPE, title: "Community review status",
    fileName: "community-reference.json", uploadedAt: new Date().toISOString(), rawText,
    sizeBytes: new TextEncoder().encode(rawText).length, tags: [], linkedQuestionSetIds: [], libraryOnly: true });
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
  assertCurrent();
}

export function communityReviewStatus(documents: readonly SourceDocument[], accountId?: string): {
  questionIds: ReadonlySet<string>; pending: boolean;
} {
  const ids = new Set<string>();
  let pending = false;
  for (const document of documents) {
    const reference = parseReference(document);
    if (!reference || (accountId && reference.accountId !== accountId)) continue;
    reference.questionIds.forEach(id => ids.add(id));
    pending ||= reference.pending;
  }
  return { questionIds: ids, pending };
}
