import { useEffect, useRef } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { useStore } from "../../lib/store";
import { isoDate } from "../../lib/scoring";
import { addDays, dayProgress } from "../../lib/community/progressBoard";
import {
  reportCommunityShare, resetCommunityShare, setCommunityShareMode, shareModeFor, useCommunityShare,
} from "../../lib/community/shareStore";

const QUIET_MS = 15_000;
const FIRST_MS = 1_500;
const FOCUS_RESYNC_MS = 5 * 60_000;
/** Totals the server last confirmed, per account, mode and day, so an unchanged day
 * costs no request, and whether that day is actually shared (not empty or private). */
const confirmed = new Map<string, { signature: string; shared: boolean }>();

/** Reads the account's sharing choice, also used to retry after a failed check. */
export async function refreshCommunityShareMode(accountId: string): Promise<void> {
  try {
    const { readShareMode } = await import("../../lib/community/community");
    const mode = await readShareMode(accountId);
    if (useAccount.getState().user?.id === accountId) setCommunityShareMode(accountId, mode);
  } catch (cause) {
    if (useAccount.getState().user?.id !== accountId) return;
    setCommunityShareMode(accountId, null);
    reportCommunityShare(accountId, "error", cause instanceof Error ? cause.message : "Your sharing choice could not be checked. Retry when connected.");
  }
}

/** Keeps today's and yesterday's shared totals current while automatic sharing is
 * on. It runs app-wide, so friends see today's study without a manual post, and it
 * shares only the daily totals the learner already logged in AXOM. */
export function CommunityProgressSync() {
  const accountId = useAccount(state => state.user?.id);
  const mode = useCommunityShare(state => shareModeFor(state, accountId));
  const logs = useStore(state => state.logs);
  const lastRun = useRef({ key: "", at: 0 });

  useEffect(() => {
    if (!accountId) { resetCommunityShare(); return; }
    setCommunityShareMode(accountId, null);
    void refreshCommunityShareMode(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || (mode !== "friends" && mode !== "community")) return;
    const runKey = `${accountId}:${mode}`;
    let cancelled = false;
    const run = async () => {
      lastRun.current = { key: runKey, at: Date.now() };
      const today = isoDate(new Date());
      const entries = [addDays(today, -1), today].map(day => ({ day, ...dayProgress(useStore.getState().logs, day) }));
      const signature = (entry: (typeof entries)[number]) => `${entry.minutes}/${entry.cards}/${entry.questions}`;
      const pending = entries.filter(entry => confirmed.get(`${runKey}:${entry.day}`)?.signature !== signature(entry));
      if (!pending.length) return;
      reportCommunityShare(accountId, "sharing");
      try {
        const { syncSharedProgress } = await import("../../lib/community/community");
        const outcomes = await syncSharedProgress(accountId, mode, pending);
        for (const entry of pending) {
          const action = outcomes.find(outcome => outcome.day === entry.day)?.action;
          confirmed.set(`${runKey}:${entry.day}`, { signature: signature(entry), shared: action === "inserted" || action === "updated" || action === "unchanged" });
        }
        // "Shared" only when today's row is on the server; an empty or private day stays idle.
        if (!cancelled) reportCommunityShare(accountId, confirmed.get(`${runKey}:${today}`)?.shared ? "shared" : "idle");
      } catch (cause) {
        if (cancelled) return;
        const missingProfile = cause instanceof Error && cause.name === "CommunityProfileMissingError";
        reportCommunityShare(accountId, missingProfile ? "needs-profile" : "error",
          cause instanceof Error && cause.message ? cause.message : "Your daily totals could not be shared right now.");
      }
    };
    const timer = window.setTimeout(() => void run(), lastRun.current.key === runKey ? QUIET_MS : FIRST_MS);
    const onFocus = () => { if (Date.now() - lastRun.current.at > FOCUS_RESYNC_MS) void run(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [accountId, mode, logs]);

  return null;
}

/** Test hook: forget which totals were confirmed. */
export function resetCommunityProgressSyncForTests() { confirmed.clear(); }
