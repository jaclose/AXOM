import { AXOM_CORRESPONDENTS, type CorrespondentId } from "./correspondents";
import {
  beginPassiveFirstRun, capturePassiveFirstRun, proposePassiveAtlas, restorePassiveFirstRun,
  serializePassiveFirstRun, type PassiveAction, type PassiveProposal, type StartPassiveOptions,
} from "./passiveFirstRun";

// The observation lasts for a single tab's initial workspace visit, never a hidden analytics stream.
export const PASSIVE_ATLAS_SESSION_KEY = "axom.atlas.first-run-session.v1";
export const PASSIVE_ATLAS_CHOICE_KEY = "axom.atlas.confirmed-choice.v1";

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
export function readPassiveAtlasSession() {
  try { return restorePassiveFirstRun(sessionStore()?.getItem(PASSIVE_ATLAS_SESSION_KEY) ?? ""); }
  catch { return null; }
}
export function notePassiveAtlasAction(action: PassiveAction, now = Date.now()): void {
  const storage = sessionStore();
  if (!storage) return;
  const before = readPassiveAtlasSession();
  const after = capturePassiveFirstRun(before, action, now);
  if (!after || after === before) return;
  try { storage.setItem(PASSIVE_ATLAS_SESSION_KEY, serializePassiveFirstRun(after)); }
  catch { /* Fail closed, without network or permanent event history. */ }
}
export function readPassiveAtlasProposal(now = Date.now()): PassiveProposal {
  const session = readPassiveAtlasSession();
  return proposePassiveAtlas(session, now);
}
export function dismissPassiveAtlas(): void {
  try { sessionStore()?.removeItem(PASSIVE_ATLAS_SESSION_KEY); } catch { /* no-op */ }
}
export function readConfirmedAtlasCompanion(): CorrespondentId | null {
  try {
    const raw = JSON.parse(localStore()?.getItem(PASSIVE_ATLAS_CHOICE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!raw || raw.version !== 1 || raw.userConfirmed !== true || typeof raw.id !== "string") return null;
    return AXOM_CORRESPONDENTS.some(card => card.id === raw.id) ? raw.id as CorrespondentId : null;
  } catch { return null; }
}
/**
 * This saves ONLY the learner-confirmed companion ID on this device.
 * Production account-scoped persistence requires a separate reviewed migration.
 */
export function confirmAtlasCompanion(id: CorrespondentId, now = Date.now()): boolean {
  if (!AXOM_CORRESPONDENTS.some(card => card.id === id)) return false;
  try {
    localStore()?.setItem(PASSIVE_ATLAS_CHOICE_KEY, JSON.stringify({
      version: 1, id, selectedAt: new Date(now).toISOString(), userConfirmed: true,
    }));
    dismissPassiveAtlas();
    return true;
  } catch { return false; }
}
export function disableAtlasCompanion(): void {
  try { localStore()?.removeItem(PASSIVE_ATLAS_CHOICE_KEY); } catch { /* no-op */ }
  dismissPassiveAtlas();
}
