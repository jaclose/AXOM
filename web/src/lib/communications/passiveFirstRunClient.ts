import { AXOM_CORRESPONDENTS, type CorrespondentId } from "./correspondents";
import {
  beginPassiveFirstRun, capturePassiveFirstRun, proposePassiveAtlas, restorePassiveFirstRun,
  serializePassiveFirstRun, type PassiveAction, type PassiveProposal, type StartPassiveOptions,
} from "./passiveFirstRun";

// The observation lasts for a single tab's initial workspace visit, never a hidden analytics stream.
export const PASSIVE_ATLAS_SESSION_KEY = "axom.atlas.first-run-session.v1";
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
export function startPassiveAtlasOnboarding(input: Omit<StartPassiveOptions, "now">, now = Date.now()): void {
  const storage = sessionStore();
  if (!storage) return;
  const session = beginPassiveFirstRun({ ...input, now });
  try {
    if (session) storage.setItem(PASSIVE_ATLAS_SESSION_KEY, serializePassiveFirstRun(session));
    else storage.removeItem(PASSIVE_ATLAS_SESSION_KEY);
  } catch { /* Browser may deny storage. Never fall back to cloud telemetry. */ }
}
export function readPassiveAtlasSession(now = Date.now()) {
  try {
    const stored = sessionStore();
    const session = restorePassiveFirstRun(stored?.getItem(PASSIVE_ATLAS_SESSION_KEY) ?? "");
    if (session && now > session.expiresAt + 9 * 60_000) { stored?.removeItem(PASSIVE_ATLAS_SESSION_KEY); return null; }
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
export function dismissPassiveAtlas(): void {
  try { sessionStore()?.removeItem(PASSIVE_ATLAS_SESSION_KEY); } catch { /* no-op */ }
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
