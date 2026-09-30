// Sidebar layout rules (JD, Ideas 1 + 3): Tools holds daily-use tools with
// Soundscapes first; Tasks, Study methods, Prompts and Hub folders start
// hidden and live in a Misc folder when enabled; Daily games stay on; any
// section can be reordered. Existing profiles are upgraded once, by version,
// and whatever the learner re-enables afterwards stays enabled.

export const NAV_LAYOUT_VERSION = 2;
export const NAV_V2_HIDDEN = ["tasks", "methods", "prompts", "folders"] as const;
export const NAV_V2_SHOWN = ["soundscapes", "daily-games", "daily-word", "doctordle"] as const;

export function upgradeNavLayout(hiddenNav: readonly string[], version: unknown): { hiddenNav: string[]; navLayoutVersion: number } {
  const from = typeof version === "number" && Number.isFinite(version) ? version : 1;
  if (from >= NAV_LAYOUT_VERSION) return { hiddenNav: [...hiddenNav], navLayoutVersion: from };
  const next = new Set(hiddenNav);
  NAV_V2_HIDDEN.forEach((id) => next.add(id));
  NAV_V2_SHOWN.forEach((id) => next.delete(id));
  return { hiddenNav: [...next], navLayoutVersion: NAV_LAYOUT_VERSION };
}

/** A section in the learner's order; ids they never moved keep their default place after. */
export function applyNavOrder<T extends string>(section: readonly T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return [...section];
  const rank = (id: T, index: number) => {
    const at = order.indexOf(id);
    return at >= 0 ? at : order.length + index;
  };
  return section.map((id, index) => ({ id, key: rank(id, index) })).sort((a, b) => a.key - b.key).map((entry) => entry.id);
}

/** Move `id` onto `targetId`'s place within one section; returns the new global order. */
export function moveNavItem(section: readonly string[], order: readonly string[] | undefined, id: string, targetId: string): string[] {
  const current = applyNavOrder(section, order);
  const from = current.indexOf(id);
  const to = current.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...(order ?? [])];
  const moved = [...current];
  moved.splice(from, 1);
  moved.splice(to, 0, id);
  const members = new Set(section);
  return [...(order ?? []).filter((item) => !members.has(item)), ...moved];
}

/**
 * Alt+Up / Alt+Down in Customize: swap with the neighbour the learner can
 * see. `visible` excludes gated items (e.g. Habit Tracker behind its early-
 * feature flag), which would otherwise absorb the step invisibly.
 */
export function stepNavItem(section: readonly string[], order: readonly string[] | undefined, id: string, delta: -1 | 1, visible?: readonly string[]): string[] {
  const shown = new Set(visible ?? section);
  const current = applyNavOrder(section, order).filter((item) => shown.has(item));
  const target = current[current.indexOf(id) + delta];
  return target ? moveNavItem(section, order, id, target) : [...(order ?? [])];
}

export function normalizeNavOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length < 40))];
  return ids.length ? ids.slice(0, 80) : undefined;
}
