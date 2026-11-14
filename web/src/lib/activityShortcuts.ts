import type { StudyLog } from "./types";

export interface ActivityShortcut {
  signature: string;
  label: string;
  trackerId?: string;
  minutes: number;
  quantity: number;
  quantityKind?: StudyLog["quantityKind"];
  quantityLabel?: string;
  uses: number;
  lastUsedAt: string;
}

type SignatureLog = Pick<StudyLog, "type" | "trackerId" | "minutes" | "cards" | "quantity" | "quantityKind" | "quantityLabel">;

/** Notes are deliberately excluded: shortcuts must never surface private text. */
export function activitySignature(log: SignatureLog): string {
  return signatureFields(log).map(escapeSignatureField).join("|");
}

/** Read-only compatibility for previously stored, unescaped hidden preferences. */
function legacyActivitySignature(log: SignatureLog): string {
  return signatureFields(log).join("|");
}

function signatureFields(log: SignatureLog): string[] {
  const legacyCards = safeNumber(log.cards);
  const quantity = safeNumber(log.quantity) || legacyCards;
  const quantityKind = log.quantityKind ?? (legacyCards > 0 ? "cards" : "");
  return [
    normalize(log.type),
    log.trackerId ?? "",
    String(safeNumber(log.minutes)),
    String(quantity),
    quantityKind,
    normalize(log.quantityLabel ?? ""),
  ];
}

/** Keep signature fields unambiguous without changing ordinary legacy signatures. */
function escapeSignatureField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Legacy raw signatures may identify more than one activity. Preserve that
 * historical hide behavior, but let a current escaped key take precedence over
 * an unrelated activity whose old raw key happens to have the same bytes.
 * Never mutate the learner's stored preference list during interpretation.
 */
function legacyHiddenKeys(logs: StudyLog[], hidden: Set<string>): Set<string> {
  if (hidden.size === 0) return hidden;
  const currentKeys = new Set(logs.map(activitySignature));
  return new Set([...hidden].filter((key) => !currentKeys.has(key)));
}

export function recentActivityShortcuts(
  logs: StudyLog[],
  hidden: string[] = [],
  limit = 3,
): ActivityShortcut[] {
  if (limit <= 0) return [];
  const hiddenSet = new Set(hidden);
  const legacyHiddenSet = legacyHiddenKeys(logs, hiddenSet);
  const seen = new Set<string>();
  const sorted = [...logs].sort(compareLogRecency);
  const result: ActivityShortcut[] = [];
  for (const log of sorted) {
    const signature = activitySignature(log);
    if (seen.has(signature) || hiddenSet.has(signature) || legacyHiddenSet.has(legacyActivitySignature(log))) continue;
    seen.add(signature);
    result.push(toShortcut(log, signature, 1));
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}

export function frequentActivityShortcuts(
  logs: StudyLog[],
  hidden: string[] = [],
  limit = 2,
  threshold = 3,
  exclude: Iterable<string> = [],
): ActivityShortcut[] {
  if (limit <= 0) return [];
  const hiddenSet = new Set(hidden);
  const legacyHiddenSet = legacyHiddenKeys(logs, hiddenSet);
  const excludedSet = new Set(exclude);
  const grouped = new Map<string, { latest: StudyLog; uses: number }>();
  for (const log of logs) {
    const signature = activitySignature(log);
    if (hiddenSet.has(signature) || legacyHiddenSet.has(legacyActivitySignature(log))) continue;
    const current = grouped.get(signature);
    if (!current) grouped.set(signature, { latest: log, uses: 1 });
    else {
      current.uses += 1;
      if (compareLogRecency(log, current.latest) < 0) current.latest = log;
    }
  }
  return [...grouped.entries()]
    .filter(([signature, value]) => value.uses >= threshold && !excludedSet.has(signature))
    .map(([signature, value]) => toShortcut(value.latest, signature, value.uses))
    .sort((a, b) => b.uses - a.uses || compareActivityTimeDesc(a.lastUsedAt, b.lastUsedAt) || a.signature.localeCompare(b.signature))
    .slice(0, Math.max(0, limit));
}

/** Compare instants, not ISO text; imported logs can retain distinct UTC offsets. */
function compareActivityTimeDesc(a: string, b: string): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  // Keep valid instants ahead of malformed imports. Mixing epoch and lexical
  // comparisons within a pair creates non-transitive ordering (A < B < C < A).
  if (aValid !== bValid) return aValid ? -1 : 1;
  return aValid ? bTime - aTime : b.localeCompare(a);
}

function compareLogRecency(a: Pick<StudyLog, "ts" | "id">, b: Pick<StudyLog, "ts" | "id">): number {
  return compareActivityTimeDesc(a.ts, b.ts) || b.id.localeCompare(a.id);
}

function toShortcut(log: StudyLog, signature: string, uses: number): ActivityShortcut {
  return {
    signature,
    label: log.type,
    trackerId: log.trackerId,
    minutes: safeNumber(log.minutes),
    quantity: safeNumber(log.quantity) || safeNumber(log.cards),
    quantityKind: log.quantityKind ?? (log.cards > 0 ? "cards" : undefined),
    quantityLabel: log.quantityLabel,
    uses,
    lastUsedAt: log.ts,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
