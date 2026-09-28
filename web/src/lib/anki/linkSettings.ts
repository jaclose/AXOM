// ===========================================================================
// Device-local settings for the Anki link: whether this device is linked,
// the optional AnkiConnect API key, the learner's premade decks, the AXOM
// deck layout, and how deletions and uploads behave. See deviceStore.ts for
// why none of this is part of the synced workspace or a backup.
// ===========================================================================
import { useSyncExternalStore } from "react";
import { createAnkiClient, getAnkiEndpoint, type AnkiClient, type AnkiClientOptions } from "../ankiConnect";
import { createDeviceStore } from "./deviceStore";
import { DEFAULT_DECK_LAYOUT, normalizeDeckLayout, type DeckLayoutOptions } from "./deckLayout";

/** What happens in Anki when a linked card is deleted in AXOM. Never "delete". */
export type DeletePolicy = "ask" | "leave" | "suspend";

export interface PremadeDeckRef {
  name: string;
  id?: number;
}

export interface AnkiLinkSettings {
  version: 1;
  /** Set when the Link Anki wizard finishes; unset means not linked. */
  linkedAt?: string;
  /** AnkiConnect's optional apiKey. Device-local; never synced or exported. */
  apiKey?: string;
  ankiConnectVersion?: number;
  usesPremadeDecks: boolean;
  premadeDecks: PremadeDeckRef[];
  layout: DeckLayoutOptions;
  /** Upload new and edited cards automatically (on save, focus, and start). */
  autoSync: boolean;
  deletePolicy: DeletePolicy;
}

export const ANKI_LINK_SETTINGS_KEY = "axom-anki-link.v1";

export function defaultLinkSettings(): AnkiLinkSettings {
  return {
    version: 1,
    usesPremadeDecks: false,
    premadeDecks: [],
    layout: { ...DEFAULT_DECK_LAYOUT },
    autoSync: true,
    deletePolicy: "ask",
  };
}

export function normalizeLinkSettings(raw: unknown): AnkiLinkSettings {
  const base = defaultLinkSettings();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  const premadeDecks = Array.isArray(record.premadeDecks)
    ? record.premadeDecks
      .filter((deck): deck is Record<string, unknown> => Boolean(deck) && typeof deck === "object" && typeof (deck as { name?: unknown }).name === "string")
      .map((deck) => ({ name: String(deck.name), ...(typeof deck.id === "number" ? { id: deck.id } : {}) }))
      .slice(0, 50)
    : [];
  const policy = record.deletePolicy;
  return {
    version: 1,
    linkedAt: typeof record.linkedAt === "string" ? record.linkedAt : undefined,
    apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
    ankiConnectVersion: typeof record.ankiConnectVersion === "number" ? record.ankiConnectVersion : undefined,
    usesPremadeDecks: record.usesPremadeDecks === true && premadeDecks.length > 0,
    premadeDecks,
    layout: normalizeDeckLayout(record.layout),
    autoSync: record.autoSync !== false,
    deletePolicy: policy === "leave" || policy === "suspend" ? policy : "ask",
  };
}

export const linkSettingsStore = createDeviceStore(ANKI_LINK_SETTINGS_KEY, normalizeLinkSettings, defaultLinkSettings);

export function loadLinkSettings(): AnkiLinkSettings {
  return linkSettingsStore.get();
}

export function saveLinkSettings(patch: Partial<AnkiLinkSettings>): AnkiLinkSettings {
  return linkSettingsStore.update((current) => normalizeLinkSettings({ ...current, ...patch }));
}

export function isAnkiLinked(settings: AnkiLinkSettings = loadLinkSettings()): boolean {
  return Boolean(settings.linkedAt);
}

/** The premade deck names the learner chose (empty unless they use premade decks). */
export function premadeDeckNames(settings: AnkiLinkSettings = loadLinkSettings()): string[] {
  return settings.usesPremadeDecks ? settings.premadeDecks.map((deck) => deck.name) : [];
}

/** A client for this device's AnkiConnect, with the saved endpoint and key. */
export function ankiClientFromSettings(settings: AnkiLinkSettings = loadLinkSettings(), options: AnkiClientOptions = {}): AnkiClient {
  return createAnkiClient({ endpoint: getAnkiEndpoint(), apiKey: settings.apiKey, ...options });
}

export function useAnkiLinkSettings(): AnkiLinkSettings {
  return useSyncExternalStore(linkSettingsStore.subscribe, linkSettingsStore.get, linkSettingsStore.get);
}
