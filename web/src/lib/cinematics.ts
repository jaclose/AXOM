// ===========================================================================
// Cinematics — the short brand films AXOM plays at startup, after an update,
// and while an update installs. Films are placeholders until final renders
// (Higgsfield / Blender) replace them: `npm run cinematic:import -- <video>
// --id <film> --final` transcodes, measures and records a new render.
//
// Policy: a film is decoration, never a gate. It plays at most once per
// trigger, never on reduced motion, and a device-only ledger decides when.
// ===========================================================================

import FILM_MEDIA from "../data/cinematics.json";

export type CinematicId = "slow-sweep" | "push-sweep" | "edge-glint" | "optical-luster";

export interface CinematicFilm {
  id: CinematicId;
  label: string;
  description: string;
  /** Relative to the Vite base (works on the web and in the desktop bundle). */
  src: string;
  poster: string;
  /** The film's edge color, so letterboxing never shows a seam. */
  background: string;
  durationMs: number;
  /** True while the film is a stand-in for the final render. */
  placeholder: boolean;
}

/** Copy lives here; measured media facts live in data/cinematics.json, which
 * `npm run cinematic:import` rewrites when a new render is dropped in. */
const FILM_COPY: Record<CinematicId, Pick<CinematicFilm, "label" | "description">> = {
  "slow-sweep": { label: "Slow sweep", description: "A single soft highlight drifts across the tile." },
  "push-sweep": { label: "Push sweep", description: "The camera eases in as the light passes. Used after updates." },
  "edge-glint": { label: "Edge glint", description: "A quick glint along the bevel. Used while an update installs." },
  "optical-luster": { label: "Classic mark", description: "The original ivory mark on black." },
};

type FilmMedia = Pick<CinematicFilm, "src" | "poster" | "background" | "durationMs" | "placeholder">;

export const CINEMATICS = Object.fromEntries(
  (Object.keys(FILM_COPY) as CinematicId[]).map((id) => {
    const media = (FILM_MEDIA as Record<string, FilmMedia>)[id];
    return [id, { id, ...FILM_COPY[id], ...media }];
  }),
) as Record<CinematicId, CinematicFilm>;

export const INTRO_FILM_ORDER: CinematicId[] = ["slow-sweep", "push-sweep", "edge-glint", "optical-luster"];

export type IntroFrequency = "daily" | "weekly" | "updates" | "always" | "never";

export const INTRO_FREQUENCY_LABELS: Record<IntroFrequency, { label: string; hint: string }> = {
  daily: { label: "First open of the day", hint: "Plus once after every update." },
  weekly: { label: "First open of the week", hint: "Plus once after every update." },
  updates: { label: "Only after updates", hint: "Once, the first time a new version opens." },
  always: { label: "Every launch", hint: "Each time the app opens (once per browser tab)." },
  never: { label: "Never", hint: "Skip every opening film. Update films still play only while installing." },
};

export interface CinematicPreferences {
  version: 1;
  frequency: IntroFrequency;
  /** The everyday intro, or "rotate" to cycle through every film. */
  intro: CinematicId | "rotate";
  /** Plays once on the first open after an update. */
  update: CinematicId;
  /** Plays while an update is being applied. */
  installing: CinematicId;
}

export const DEFAULT_CINEMATIC_PREFERENCES: CinematicPreferences = {
  version: 1,
  frequency: "daily",
  intro: "slow-sweep",
  update: "push-sweep",
  installing: "edge-glint",
};

export interface CinematicLedger {
  lastPlayedAt?: string;
  lastPlayedDay?: string;
  lastPlayedWeek?: string;
  /** The app version seen at the last startup; a change means "just updated". */
  lastSeenVersion?: string;
  rotateIndex?: number;
}

export type CinematicTrigger = "first-run" | "update" | "daily" | "weekly" | "always";

export type CinematicDecision =
  | { play: false; reason: "disabled" | "reduced-motion" | "already-played" | "not-an-update" }
  | { play: true; trigger: CinematicTrigger; film: CinematicFilm; caption?: string };

export const CINEMATIC_PREFS_KEY = "axom.cinematics.v1";
export const CINEMATIC_LEDGER_KEY = "axom.cinematics.ledger.v1";
/** Older builds stored only an on/off switch under this key. */
export const LEGACY_INTRO_ENABLED_KEY = "axom.startupIntro.enabled";
export const CINEMATIC_PREFS_EVENT = "axom:cinematic-preferences";

const FREQUENCIES = new Set<IntroFrequency>(["daily", "weekly", "updates", "always", "never"]);
const isFilm = (value: unknown): value is CinematicId => typeof value === "string" && value in CINEMATICS;

export function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO-8601 week key (weeks start Monday), e.g. "2026-W39". */
export function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function normalizeCinematicPreferences(raw: unknown): CinematicPreferences {
  const value = raw && typeof raw === "object" ? raw as Partial<CinematicPreferences> : {};
  return {
    version: 1,
    frequency: FREQUENCIES.has(value.frequency as IntroFrequency) ? value.frequency as IntroFrequency : DEFAULT_CINEMATIC_PREFERENCES.frequency,
    intro: value.intro === "rotate" || isFilm(value.intro) ? value.intro : DEFAULT_CINEMATIC_PREFERENCES.intro,
    update: isFilm(value.update) ? value.update : DEFAULT_CINEMATIC_PREFERENCES.update,
    installing: isFilm(value.installing) ? value.installing : DEFAULT_CINEMATIC_PREFERENCES.installing,
  };
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function readCinematicPreferences(): CinematicPreferences {
  const prefs = normalizeCinematicPreferences(readJson(CINEMATIC_PREFS_KEY));
  try {
    // Honor the old "Don't show again" until the learner picks a new setting.
    if (!window.localStorage.getItem(CINEMATIC_PREFS_KEY) && window.localStorage.getItem(LEGACY_INTRO_ENABLED_KEY) === "false") {
      return { ...prefs, frequency: "never" };
    }
  } catch { /* storage blocked: defaults */ }
  return prefs;
}

export function writeCinematicPreferences(patch: Partial<CinematicPreferences>): CinematicPreferences {
  const next = normalizeCinematicPreferences({ ...readCinematicPreferences(), ...patch });
  try {
    window.localStorage.setItem(CINEMATIC_PREFS_KEY, JSON.stringify(next));
    if (next.frequency === "never") window.localStorage.setItem(LEGACY_INTRO_ENABLED_KEY, "false");
    else window.localStorage.removeItem(LEGACY_INTRO_ENABLED_KEY);
  } catch { /* device preference only */ }
  try { window.dispatchEvent(new CustomEvent(CINEMATIC_PREFS_EVENT, { detail: next })); } catch { /* non-DOM */ }
  return next;
}

export function readCinematicLedger(): CinematicLedger {
  const raw = readJson(CINEMATIC_LEDGER_KEY);
  return raw && typeof raw === "object" ? raw as CinematicLedger : {};
}

export function writeCinematicLedger(ledger: CinematicLedger): void {
  try { window.localStorage.setItem(CINEMATIC_LEDGER_KEY, JSON.stringify(ledger)); } catch { /* best effort */ }
}

function introFilm(prefs: CinematicPreferences, ledger: CinematicLedger): CinematicFilm {
  if (prefs.intro !== "rotate") return CINEMATICS[prefs.intro];
  return CINEMATICS[INTRO_FILM_ORDER[(ledger.rotateIndex ?? 0) % INTRO_FILM_ORDER.length]];
}

/**
 * Decide whether a startup film plays. Pure: callers pass time, version and
 * stored state, then persist `nextLedger` whether or not a film plays (so the
 * current version is remembered and an update plays exactly once).
 */
export function decideStartupCinematic(input: {
  prefs: CinematicPreferences;
  ledger: CinematicLedger;
  version: string;
  now: Date;
  reducedMotion: boolean;
  /** Web tabs: "always" plays once per tab, not on every reload. */
  playedThisTab?: boolean;
}): { decision: CinematicDecision; nextLedger: CinematicLedger } {
  const { prefs, ledger, version, now, reducedMotion } = input;
  const seen: CinematicLedger = { ...ledger, lastSeenVersion: version };
  const skip = (reason: Extract<CinematicDecision, { play: false }>["reason"]) => ({ decision: { play: false, reason } as CinematicDecision, nextLedger: seen });
  if (prefs.frequency === "never") return skip("disabled");
  if (reducedMotion) return skip("reduced-motion");

  const day = localDayKey(now);
  const week = isoWeekKey(now);
  const updated = Boolean(ledger.lastSeenVersion && ledger.lastSeenVersion !== version);
  let trigger: CinematicTrigger | null = null;
  if (!ledger.lastSeenVersion && !ledger.lastPlayedAt) trigger = "first-run";
  else if (updated) trigger = "update";
  else if (prefs.frequency === "always" && !input.playedThisTab) trigger = "always";
  else if (prefs.frequency === "daily" && ledger.lastPlayedDay !== day) trigger = "daily";
  else if (prefs.frequency === "weekly" && ledger.lastPlayedWeek !== week) trigger = "weekly";
  if (!trigger) return skip(prefs.frequency === "updates" ? "not-an-update" : "already-played");

  const film = trigger === "update" ? CINEMATICS[prefs.update] : introFilm(prefs, ledger);
  return {
    decision: { play: true, trigger, film, caption: trigger === "update" ? `Updated to v${version}` : undefined },
    nextLedger: {
      ...seen,
      lastPlayedAt: now.toISOString(),
      lastPlayedDay: day,
      lastPlayedWeek: week,
      rotateIndex: prefs.intro === "rotate" && trigger !== "update" ? (ledger.rotateIndex ?? 0) + 1 : ledger.rotateIndex,
    },
  };
}
