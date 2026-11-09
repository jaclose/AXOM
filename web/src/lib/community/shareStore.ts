import { create } from "zustand";
import type { ShareMode } from "./progressBoard";

export type ShareSyncStatus = "idle" | "sharing" | "shared" | "error" | "needs-profile" | "needs-device";

interface CommunityShareState {
  /** Account the values below belong to; anything for another account is ignored. */
  accountId?: string;
  /** null while the account's choice is still being read. */
  mode: ShareMode | null;
  revision?: number;
  retryVersion: number;
  status: ShareSyncStatus;
  lastSharedAt?: string;
  message: string;
}

const initial: CommunityShareState = { accountId: undefined, mode: null, revision: undefined, retryVersion: 0, status: "idle", lastSharedAt: undefined, message: "" };
export const useCommunityShare = create<CommunityShareState>(() => initial);

export function resetCommunityShare() { useCommunityShare.setState(initial, true); }
export function setCommunityShareMode(accountId: string, mode: ShareMode | null, revision?: number) {
  if (useCommunityShare.getState().accountId !== accountId) {
    useCommunityShare.setState({ ...initial, accountId, mode, revision }, true);
    return;
  }
  const current = useCommunityShare.getState();
  // A read started before a settings save cannot roll the local UI backwards.
  // Off without a returned revision (profile removal) still fences an old read
  // of the previous generation; a genuinely newer server generation may win.
  if (mode !== null && revision !== undefined && current.revision !== undefined
    && (revision < current.revision || (revision === current.revision && current.mode !== null && mode !== current.mode))) return;
  const nextRevision = revision ?? (mode === "off" || mode === null ? current.revision : undefined);
  useCommunityShare.setState(mode === "off" ? { mode, revision: nextRevision, status: "idle", message: "", lastSharedAt: undefined }
    : { mode, revision: nextRevision });
}
export function reportCommunityShare(accountId: string, status: ShareSyncStatus, message = "") {
  if (useCommunityShare.getState().accountId !== accountId) return;
  useCommunityShare.setState({ status, message, ...(status === "shared" ? { lastSharedAt: new Date().toISOString() } : {}) });
}
/** The current account's choice, or null while it is unknown. */
export function shareModeFor(state: CommunityShareState, accountId: string | undefined): ShareMode | null {
  return accountId && state.accountId === accountId ? state.mode : null;
}
