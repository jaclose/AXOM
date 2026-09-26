import { STORAGE_KEYS } from "./brand";

/**
 * AXOM-level motion override. "system" follows the operating-system
 * `prefers-reduced-motion` setting; "reduce" calms AXOM even when the device
 * allows motion. There is deliberately no "force full motion" option — an OS
 * reduced-motion request is an accessibility need AXOM never overrides.
 */
export type MotionPreference = "system" | "reduce";

export const MOTION_PREFERENCE_EVENT = "axom:motion-change";

let volatilePreference: MotionPreference | undefined;

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "reduce";
}

export function readMotionPreference(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): MotionPreference {
  if (!storage) return volatilePreference ?? "system";
  try {
    const stored = storage.getItem(STORAGE_KEYS.motionPreference);
    return isMotionPreference(stored) ? stored : "system";
  } catch {
    return volatilePreference ?? "system";
  }
}

export function applyMotionPreference(
  preference: MotionPreference,
  targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!targetDocument) return;
  if (preference === "reduce") targetDocument.documentElement.dataset.motion = "reduce";
  else delete targetDocument.documentElement.dataset.motion;
}

export function setMotionPreference(preference: MotionPreference): MotionPreference {
  const safe = isMotionPreference(preference) ? preference : "system";
  volatilePreference = safe;
  try {
    browserStorage()?.setItem(STORAGE_KEYS.motionPreference, safe);
  } catch {
    // Applies for this session when storage is blocked.
  }
  applyMotionPreference(safe);
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent<MotionPreference>(MOTION_PREFERENCE_EVENT, { detail: safe }));
  }
  return safe;
}

/** True when AXOM itself has been asked to reduce motion (independent of the OS). */
export function motionOverrideReduces(): boolean {
  return readMotionPreference() === "reduce";
}

export function installMotionSync(
  targetWindow: Window | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!targetWindow) return () => {};
  applyMotionPreference(readMotionPreference(), targetWindow.document);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.motionPreference) return;
    const preference = isMotionPreference(event.newValue) ? event.newValue : "system";
    applyMotionPreference(preference, targetWindow.document);
    targetWindow.dispatchEvent(new CustomEvent<MotionPreference>(MOTION_PREFERENCE_EVENT, { detail: preference }));
  };
  targetWindow.addEventListener("storage", onStorage);
  return () => targetWindow.removeEventListener("storage", onStorage);
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
