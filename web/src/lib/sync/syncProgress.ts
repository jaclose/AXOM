import { create } from "zustand";
import type { SyncUploadPhase } from "./syncTypes";

export interface SyncProgress {
  accountId: string;
  phase: SyncUploadPhase;
  completed?: number;
  total?: number;
}

export interface MissingSyncImage {
  questionId: string;
  questionLabel: string;
  fileName: string;
}

// Transient progress belongs to one upload, never to a saved workspace.
export const useSyncProgress = create<{
  current: SyncProgress | null;
  attention: { accountId: string; images: MissingSyncImage[] } | null;
}>(() => ({ current: null, attention: null }));
let currentUpload = 0;

export function beginSyncProgress(accountId: string) {
  const upload = ++currentUpload;
  let finished = false;
  useSyncProgress.setState({ attention: null });
  const report = (phase: SyncUploadPhase, completed?: number, total?: number) => {
    if (finished || upload !== currentUpload) return;
    useSyncProgress.setState({ current: { accountId, phase, completed, total } });
  };
  report("preflight");
  return {
    report,
    attention(images: MissingSyncImage[]) {
      if (!finished && upload === currentUpload) useSyncProgress.setState({ attention: { accountId, images } });
    },
    finish() {
      finished = true;
      if (upload === currentUpload) useSyncProgress.setState({ current: null });
    },
  };
}

export const SYNC_PHASE_LABELS: Record<SyncUploadPhase, string> = {
  preflight: "Checking your account",
  content: "Saving questions and source text",
  originals: "Saving original files",
  media: "Checking and saving question images",
  revision: "Saving your progress",
  receipt: "Verifying your protected version",
};
