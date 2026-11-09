import { useSyncExternalStore } from "react";
import { getQuestionAttachmentScope, subscribeQuestionAttachmentScope } from "../../lib/questionAttachmentScope";

export function useQuestionAttachmentScope() {
  return useSyncExternalStore(subscribeQuestionAttachmentScope, getQuestionAttachmentScope, getQuestionAttachmentScope);
}
