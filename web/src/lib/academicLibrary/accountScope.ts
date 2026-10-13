import { useAccount } from "../account/accountStore";

/** A switch away and back still invalidates the operation. */
export function academicAccountScope(accountId: string) {
  let changed = false;
  const unsubscribe = useAccount.subscribe(state => { if (state.user?.id !== accountId) changed = true; });
  const assertCurrent = () => {
    if (changed || useAccount.getState().user?.id !== accountId) throw new Error("The account changed. Reopen this course in your current account.");
  };
  return { key: accountId, assertCurrent, dispose: unsubscribe };
}
