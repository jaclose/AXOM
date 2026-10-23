import { useAccount } from "./account/accountStore";
import { useStore } from "./store";
import { assertVaultWrite, assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "./localVault";
import type { QuestionImageAttachment } from "./questionAttachments";

/** An account switch away and back still invalidates an in-flight edit. */
export function captureQuestionWorkspace() {
  const account = useAccount.getState().user?.id;
  const profile = useStore.getState().profile.userId;
  let changed = false;
  const releaseAccount = useAccount.subscribe(state => { if (state.user?.id !== account) changed = true; });
  const releaseStore = useStore.subscribe(state => { if (state.profile.userId !== profile) changed = true; });
  return {
    assertCurrent() {
      if (changed) throw new Error("The workspace changed. Reopen the question before attaching images.");
    },
    dispose() { releaseAccount(); releaseStore(); },
  };
}

/** Confirm metadata on disk before the UI reports success or removes any bytes. */
export async function saveQuestionNoteImages(questionId: string, notes: QuestionImageAttachment[]) {
  const scope = captureQuestionWorkspace();
  try {
    const state = useStore.getState();
    const question = state.questions.find(item => item.id === questionId);
    if (!question) throw new Error("This question is no longer in the current workspace.");
    const attachments = [...(question.attachments ?? []).filter(item => item.role), ...notes];
    const checkpoint = getVaultWriteCheckpoint();
    scope.assertCurrent();
    state.updateQuestion(questionId, { attachments: attachments.length ? attachments : undefined });
    await flushLocalVaultWrites();
    scope.assertCurrent();
    assertVaultWrite(checkpoint + 1);
    assertVaultWritesSince(checkpoint);
    return attachments;
  } finally { scope.dispose(); }
}
