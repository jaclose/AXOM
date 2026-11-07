import { AXOM_CORRESPONDENTS, type CorrespondentId } from "./correspondents";
import { useAccount } from "../account/accountStore";
import {
  beginPassiveFirstRun, capturePassiveFirstRun, proposePassiveAtlas, restorePassiveFirstRun,
  serializePassiveFirstRun, type PassiveAction, type PassiveProposal, type StartPassiveOptions,
} from "./passiveFirstRun";

// The observation lasts for a single tab's initial workspace visit, never a hidden analytics stream.
export const PASSIVE_ATLAS_SESSION_KEY = "axom.atlas.first-run-session.v1";
const PASSIVE_ATLAS_SCOPE_KEY = "axom.atlas.first-run-owner-scope.v1";
export const PASSIVE_ATLAS_CHOICE_KEY = "axom.atlas.confirmed-choice.v1";
export const ATLAS_COMPANION_CHANGED_EVENT = "axom:atlas-companion-changed";
export type AtlasSavedDashboardPriority = "question-bank" | "course-tracker";
function notifySelectionChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ATLAS_COMPANION_CHANGED_EVENT));
}
const scopedChoiceKey = (accountId?: string | null) => accountId === undefined || accountId === null
  ? PASSIVE_ATLAS_CHOICE_KEY + ":device"
  : /^[0-9a-f-]{36}$/i.test(accountId) ? PASSIVE_ATLAS_CHOICE_KEY + ":" + accountId.toLowerCase() : null;

function sessionStore(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}
function localStore(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
/** An ephemeral session binding, separate from the observation aggregate. Never sent to a provider. */
function currentObservationScope(): string {
  const id = useAccount.getState().user?.id;
  return id ? "account:" + id.toLowerCase() : "guest";
}
function clearObservation(storage: Storage | null): void {
  try { storage?.removeItem(PASSIVE_ATLAS_SESSION_KEY); storage?.removeItem(PASSIVE_ATLAS_SCOPE_KEY); } catch { /* unavailable */ }
}
export function startPassiveAtlasOnboarding(input: Omit<StartPassiveOptions, "now">, now = Date.now()): void {
  const storage = sessionStore();
  if (!storage) return;
  const session = beginPassiveFirstRun({ ...input, now });
  try {
    if (session) {
      storage.setItem(PASSIVE_ATLAS_SCOPE_KEY, currentObservationScope());
      storage.setItem(PASSIVE_ATLAS_SESSION_KEY, serializePassiveFirstRun(session));
    } else clearObservation(storage);
  } catch { clearObservation(storage); /* Browser may deny storage. Never fall back to cloud telemetry. */ }
}
export function readPassiveAtlasSession(now = Date.now()) {
  try {
    const stored = sessionStore();
    if (!stored) return null;
    const raw = stored.getItem(PASSIVE_ATLAS_SESSION_KEY);
    if (!raw) { clearObservation(stored); return null; }
    // A guest observation must never be reused after signup, including on reload.
    if (stored.getItem(PASSIVE_ATLAS_SCOPE_KEY) !== currentObservationScope()) {
      clearObservation(stored); return null;
    }
    const session = restorePassiveFirstRun(raw);
    if (!session || now > session.expiresAt + 9 * 60_000) { clearObservation(stored); return null; }
    return session;
  } catch { return null; }
}
export function notePassiveAtlasAction(action: PassiveAction, now = Date.now()): void {
  const storage = sessionStore();
  if (!storage) return;
  const before = readPassiveAtlasSession(now);
  const after = capturePassiveFirstRun(before, action, now);
  if (!after || after === before) return;
  try { storage.setItem(PASSIVE_ATLAS_SESSION_KEY, serializePassiveFirstRun(after)); }
  catch { /* Fail closed, without network or permanent event history. */ }
}
export function readPassiveAtlasProposal(now = Date.now()): PassiveProposal {
  const session = readPassiveAtlasSession(now);
  return proposePassiveAtlas(session, now);
}
/**
 * Account transitions invalidate unaccepted observations. The two IDs are
 * compared only in memory; neither is serialized into the observation.
 */
export function discardAtlasObservationOnAccountChange(previousAccountId: string | null, nextAccountId: string | null): boolean {
  if (previousAccountId === nextAccountId) return false;
  dismissPassiveAtlas();
  return true;
}

export function dismissPassiveAtlas(): void {
  clearObservation(sessionStore());
}
/** A voluntary, stored *proposal*; no dashboard change was applied by storing this. */
export function readConfirmedAtlasPriority(accountId?: string | null): AtlasSavedDashboardPriority | null {
  try {
    const key = scopedChoiceKey(accountId);
    if (!key) return null;
    const saved = JSON.parse(localStore()?.getItem(key) ?? "null") as Record<string, unknown> | null;
    if (!saved || saved.version !== 1 || saved.userConfirmed !== true
      || !AXOM_CORRESPONDENTS.some(card => card.id === saved.id)) return null;
    return saved.dashboardPriority === "question-bank" || saved.dashboardPriority === "course-tracker"
      ? saved.dashboardPriority : null;
  } catch { return null; }
}
export function readConfirmedAtlasCompanion(accountId?: string | null): CorrespondentId | null {
  try {
    const key = scopedChoiceKey(accountId);
    if (!key) return null;
    const raw = JSON.parse(localStore()?.getItem(key) ?? "null") as Record<string, unknown> | null;
    if (!raw || raw.version !== 1 || raw.userConfirmed !== true || typeof raw.id !== "string") return null;
    return AXOM_CORRESPONDENTS.some(card => card.id === raw.id) ? raw.id as CorrespondentId : null;
  } catch { return null; }
}
/**
 * This saves ONLY the learner-confirmed companion ID on this device.
 * Production account-scoped persistence requires a separate reviewed migration.
 */
export function confirmAtlasCompanion(id: CorrespondentId, now = Date.now(), accountId?: string | null, dashboardPriority?: AtlasSavedDashboardPriority | "keep-current"): boolean {
  if (!AXOM_CORRESPONDENTS.some(card => card.id === id)) return false;
  try {
    const key = scopedChoiceKey(accountId);
    const storage = localStore();
    if (!key || !storage) return false;
    storage.setItem(key, JSON.stringify({
      version: 1, id, selectedAt: new Date(now).toISOString(), userConfirmed: true,
      ...(dashboardPriority === "question-bank" || dashboardPriority === "course-tracker"
        ? { dashboardPriority } : {}),
    }));
    dismissPassiveAtlas();
    notifySelectionChange();
    return true;
  } catch { return false; }
}
export function disableAtlasCompanion(accountId?: string | null): void {
  try { const key = scopedChoiceKey(accountId); if (key) localStore()?.removeItem(key); } catch { /* no-op */ }
  dismissPassiveAtlas();
  notifySelectionChange();
}
