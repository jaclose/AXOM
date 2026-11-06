import { create } from "zustand";
import type { ShareMode } from "./progressBoard";

export type ShareSyncStatus = "idle" | "sharing" | "shared" | "error" | "needs-profile";

interface CommunityShareState {
  /** Account the values below belong to; anything for another account is ignored. */
  accountId?: string;
  /** null while the account's choice is still being read. */
  mode: ShareMode | null;
  status: ShareSyncStatus;
  lastSharedAt?: string;
  message: string;
}

const initial: CommunityShareState = { accountId: undefined, mode: null, status: "idle", lastSharedAt: undefined, message: "" };
export const useCommunityShare = create<CommunityShareState>(() => initial);

export function resetCommunityShare() { useCommunityShare.setState(initial, true); }
export function setCommunityShareMode(accountId: string, mode: ShareMode | null) {
  if (useCommunityShare.getState().accountId !== accountId) {
    useCommunityShare.setState({ ...initial, accountId, mode }, true);
    return;
  }
  useCommunityShare.setState(mode === "off" ? { mode, status: "idle", message: "" } : { mode });
}
export function reportCommunityShare(accountId: string, status: ShareSyncStatus, message = "") {
  if (useCommunityShare.getState().accountId !== accountId) return;
  useCommunityShare.setState({ status, message, ...(status === "shared" ? { lastSharedAt: new Date().toISOString() } : {}) });
}
/** The current account's choice, or null while it is unknown. */
export function shareModeFor(state: CommunityShareState, accountId: string | undefined): ShareMode | null {
  return accountId && state.accountId === accountId ? state.mode : null;
}
