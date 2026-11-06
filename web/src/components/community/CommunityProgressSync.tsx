import { useEffect, useRef } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { useStore } from "../../lib/store";
import { isoDate } from "../../lib/scoring";
import { addDays, dayProgress } from "../../lib/community/progressBoard";
import { resetCommunityProgressRevisionsForTests } from "../../lib/community/progressSync";
import {
  reportCommunityShare, resetCommunityShare, setCommunityShareMode, shareModeFor, useCommunityShare,
} from "../../lib/community/shareStore";

const QUIET_MS = 15_000;
const FIRST_MS = 1_500;
const FOCUS_RESYNC_MS = 5 * 60_000;
/** Totals the server last confirmed, per account, mode and day, so an unchanged day
 * costs no request, and whether that day is actually shared (not empty or private). */
const confirmed = new Map<string, { signature: string; shared: boolean }>();
const refreshRequests = new Map<string, number>();

/** Reads the account's sharing choice, also used to retry after a failed check. */
export async function refreshCommunityShareMode(accountId: string): Promise<void> {
  const request = (refreshRequests.get(accountId) ?? 0) + 1;
  const startedRevision = useCommunityShare.getState().accountId === accountId ? useCommunityShare.getState().revision : undefined;
  refreshRequests.set(accountId, request);
  try {
    const { readCommunityPreferences } = await import("../../lib/community/community");
    const preferences = await readCommunityPreferences(accountId);
    if (useAccount.getState().user?.id === accountId && refreshRequests.get(accountId) === request)
      setCommunityShareMode(accountId, preferences.shareMode, preferences.revision);
  } catch (cause) {
    if (useAccount.getState().user?.id !== accountId || refreshRequests.get(accountId) !== request) return;
    const current = useCommunityShare.getState();
    if (current.accountId === accountId && current.revision !== undefined && current.revision > (startedRevision ?? -1)) return;
    setCommunityShareMode(accountId, null);
    reportCommunityShare(accountId, "error", cause instanceof Error ? cause.message : "Your sharing choice could not be checked. Retry when connected.");
  }
}

/** Retry failed network work even when consent itself did not change. Keep the
 * per-day compare-and-swap revisions so a valid correction remains possible. */
export async function retryCommunityProgress(accountId: string): Promise<void> {
  for (const key of confirmed.keys()) if (key.startsWith(`${accountId}:`)) confirmed.delete(key);
  await refreshCommunityShareMode(accountId);
  if (useAccount.getState().user?.id === accountId && useCommunityShare.getState().accountId === accountId)
    useCommunityShare.setState(state => ({ retryVersion: state.retryVersion + 1 }));
}

/** Keeps today's and yesterday's shared totals current while automatic sharing is
 * on. It runs app-wide, so friends see today's study without a manual post, and it
 * shares only the daily totals the learner already logged in AXOM. */
export function CommunityProgressSync() {
  const accountId = useAccount(state => state.user?.id);
  const link = useAccount(state => state.link);
  const applyingRemote = useAccount(state => state.applyingRemote);
  const mode = useCommunityShare(state => shareModeFor(state, accountId));
  const revision = useCommunityShare(state => state.accountId === accountId ? state.revision : undefined);
  const retryVersion = useCommunityShare(state => state.retryVersion);
  const logs = useStore(state => state.logs);
  const lastRun = useRef({ key: "", at: 0 });

  useEffect(() => {
    if (!accountId) { resetCommunityShare(); return; }
    setCommunityShareMode(accountId, null);
    void refreshCommunityShareMode(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || (mode !== "friends" && mode !== "community")) return;
    if (link !== "linked") {
      reportCommunityShare(accountId, "needs-device", "Link this device in Account settings before automatic sharing can use its study logs.");
      return;
    }
    if (applyingRemote) return;
    if (revision === undefined) { void refreshCommunityShareMode(accountId); return; }
    const runKey = `${accountId}:${mode}:${revision}`;
    const controller = new AbortController();
    const isCurrent = () => {
      const sharing = useCommunityShare.getState();
      const account = useAccount.getState();
      return !controller.signal.aborted && account.user?.id === accountId && account.link === "linked" && !account.applyingRemote
        && sharing.accountId === accountId && sharing.mode === mode && sharing.revision === revision;
    };
    let running = false;
    const run = async () => {
      if (!isCurrent() || running) return;
      running = true;
      lastRun.current = { key: runKey, at: Date.now() };
      const today = isoDate(new Date());
      const entries = [addDays(today, -1), today].map(day => ({ day, ...dayProgress(useStore.getState().logs, day) }));
      const signature = (entry: (typeof entries)[number]) => `${entry.minutes}/${entry.cards}/${entry.questions}`;
      const pending = entries.filter(entry => confirmed.get(`${runKey}:${entry.day}`)?.signature !== signature(entry));
      if (!pending.length) { running = false; return; }
      reportCommunityShare(accountId, "sharing");
      try {
        const { syncSharedProgress } = await import("../../lib/community/community");
        if (!isCurrent()) return;
        const outcomes = await syncSharedProgress(accountId, mode, pending, { signal: controller.signal, consentRevision: revision });
        if (!isCurrent()) return;
        for (const entry of pending) {
          const action = outcomes.find(outcome => outcome.day === entry.day)?.action;
          confirmed.set(`${runKey}:${entry.day}`, { signature: signature(entry), shared: action === "inserted" || action === "updated" || action === "unchanged" });
        }
        // "Shared" only when today's row is on the server; an empty or private day stays idle.
        reportCommunityShare(accountId, confirmed.get(`${runKey}:${today}`)?.shared ? "shared" : "idle");
      } catch (cause) {
        if (!isCurrent()) return;
        const missingProfile = cause instanceof Error && cause.name === "CommunityProfileMissingError";
        reportCommunityShare(accountId, missingProfile ? "needs-profile" : "error",
          cause instanceof Error && cause.message ? cause.message : "Your daily totals could not be shared right now.");
      } finally { running = false; }
    };
    const timer = window.setTimeout(() => void run(), lastRun.current.key === runKey && retryVersion === 0 ? QUIET_MS : FIRST_MS);
    const onFocus = () => {
      if (Date.now() - lastRun.current.at > FOCUS_RESYNC_MS) void retryCommunityProgress(accountId);
    };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [accountId, mode, revision, retryVersion, link, applyingRemote, logs]);

  return null;
}

/** Test hook: forget which totals were confirmed. */
export function resetCommunityProgressSyncForTests() { confirmed.clear(); refreshRequests.clear(); resetCommunityProgressRevisionsForTests(); resetCommunityShare(); }
