// ===========================================================================
// Device-local record of what AXOM has put into this computer's Anki:
// AXOM card id → Anki note id, card ids, and hashes of what was pushed. It is
// the "queue" too: any card whose desired note no longer matches its record
// (or has no record) is waiting for Anki, so edits made while Anki is closed
// are never lost and never double-applied. Deletions made in AXOM wait here
// as explicit "suspend in Anki" requests when the learner chose that.
//
// Losing this store is safe: every AXOM note carries its card id in the
// AxomId field, and the next sync re-links notes by searching for it.
// ===========================================================================
import { useSyncExternalStore } from "react";
import { createDeviceStore } from "./deviceStore";
import type { AxomNoteKind } from "./noteTypes";

export type LinkIssueKind = "conflict" | "missing";

export interface LinkIssue {
  kind: LinkIssueKind;
  message: string;
  at: string;
  /** For conflicts: the note's managed fields as Anki has them now. */
  ankiFields?: Record<string, string>;
}

export interface NoteLink {
  noteId: number;
  cardIds: number[];
  kind: AxomNoteKind;
  /** Deck AXOM last filed the note into. */
  deck: string;
  /** Tags AXOM added; tags the learner adds in Anki are never touched. */
  tags: string[];
  /** Managed fields as pushed; differs from Anki's copy only after an Anki-side edit. */
  fieldsHash: string;
  /** Desired-note fingerprint at the last successful push. */
  fingerprint: string;
  suspended: boolean;
  syncedAt: string;
  /** Notes replaced when the card changed between Basic and Cloze (suspended, kept). */
  retiredNoteIds?: number[];
  issue?: LinkIssue;
  /** The learner chose AXOM's version for a conflict: overwrite Anki once. */
  force?: boolean;
}

export interface UploadFailure {
  message: string;
  fingerprint: string;
  at: string;
}

export interface PendingSuspend {
  axomId: string;
  noteId: number;
  cardIds: number[];
  at: string;
}

export interface SyncSummary {
  at: string;
  added: number;
  updated: number;
  moved: number;
  recovered: number;
  replaced: number;
  unchanged: number;
  suspended: number;
  unsuspended: number;
  deletedLeft: number;
  deletedSuspended: number;
  conflicts: number;
  missing: number;
  failed: number;
  /** Changes still waiting because Anki was unreachable. */
  pending: number;
  offline: boolean;
  error?: string;
}

export interface LinkState {
  version: 1;
  links: Record<string, NoteLink>;
  failures: Record<string, UploadFailure>;
  /** Cards the learner chose to keep out of Anki (e.g. after deleting the note there). */
  excluded: string[];
  pendingSuspends: PendingSuspend[];
  lastSync?: SyncSummary;
}

export const ANKI_LINK_STATE_KEY = "axom-anki-notes.v1";

export function emptyLinkState(): LinkState {
  return { version: 1, links: {}, failures: {}, excluded: [], pendingSuspends: [] };
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function normalizeLink(raw: unknown): NoteLink | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.noteId !== "number") return null;
  const issue = record.issue && typeof record.issue === "object" ? record.issue as Record<string, unknown> : null;
  return {
    noteId: record.noteId,
    cardIds: numberList(record.cardIds),
    kind: record.kind === "cloze" ? "cloze" : "basic",
    deck: typeof record.deck === "string" ? record.deck : "",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    fieldsHash: typeof record.fieldsHash === "string" ? record.fieldsHash : "",
    fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : "",
    suspended: record.suspended === true,
    syncedAt: typeof record.syncedAt === "string" ? record.syncedAt : "",
    ...(numberList(record.retiredNoteIds).length ? { retiredNoteIds: numberList(record.retiredNoteIds) } : {}),
    ...(issue && (issue.kind === "conflict" || issue.kind === "missing")
      ? {
          issue: {
            kind: issue.kind,
            message: typeof issue.message === "string" ? issue.message : "",
            at: typeof issue.at === "string" ? issue.at : "",
            ...(issue.ankiFields && typeof issue.ankiFields === "object" ? { ankiFields: issue.ankiFields as Record<string, string> } : {}),
          },
        }
      : {}),
    ...(record.force === true ? { force: true } : {}),
  };
}

export function normalizeLinkState(raw: unknown): LinkState {
  const base = emptyLinkState();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  const links: Record<string, NoteLink> = {};
  if (record.links && typeof record.links === "object") {
    for (const [id, value] of Object.entries(record.links as Record<string, unknown>)) {
      const link = normalizeLink(value);
      if (link) links[id] = link;
    }
  }
  const failures: Record<string, UploadFailure> = {};
  if (record.failures && typeof record.failures === "object") {
    for (const [id, value] of Object.entries(record.failures as Record<string, unknown>)) {
      if (value && typeof value === "object" && typeof (value as UploadFailure).message === "string") {
        const failure = value as UploadFailure;
        failures[id] = { message: failure.message, fingerprint: String(failure.fingerprint ?? ""), at: String(failure.at ?? "") };
      }
    }
  }
  const pendingSuspends = Array.isArray(record.pendingSuspends)
    ? record.pendingSuspends.filter((item): item is PendingSuspend => Boolean(item) && typeof item === "object" && typeof (item as PendingSuspend).axomId === "string" && typeof (item as PendingSuspend).noteId === "number")
      .map((item) => ({ axomId: item.axomId, noteId: item.noteId, cardIds: numberList(item.cardIds), at: String(item.at ?? "") }))
    : [];
  return {
    version: 1,
    links,
    failures,
    excluded: Array.isArray(record.excluded) ? [...new Set(record.excluded.filter((id): id is string => typeof id === "string"))] : [],
    pendingSuspends,
    lastSync: record.lastSync && typeof record.lastSync === "object" ? record.lastSync as SyncSummary : undefined,
  };
}

export const linkStateStore = createDeviceStore(ANKI_LINK_STATE_KEY, normalizeLinkState, emptyLinkState);

export function useLinkState(): LinkState {
  return useSyncExternalStore(linkStateStore.subscribe, linkStateStore.get, linkStateStore.get);
}

/**
 * The learner deleted a linked card in AXOM. The note stays in Anki either
 * way; "suspend" also queues suspending its cards (applied now or when Anki
 * is next reachable). AXOM never deletes Anki notes.
 */
export function recordAxomDeletion(state: LinkState, axomId: string, choice: "leave" | "suspend", at = new Date().toISOString()): LinkState {
  const link = state.links[axomId];
  const links = { ...state.links };
  delete links[axomId];
  const failures = { ...state.failures };
  delete failures[axomId];
  const pendingSuspends = link && choice === "suspend"
    ? [...state.pendingSuspends.filter((item) => item.axomId !== axomId), { axomId, noteId: link.noteId, cardIds: link.cardIds, at }]
    : state.pendingSuspends;
  return { ...state, links, failures, pendingSuspends, excluded: state.excluded.filter((id) => id !== axomId) };
}

/** Keep a card out of Anki (the learner removed its note there on purpose). */
export function excludeFromAnki(state: LinkState, axomId: string): LinkState {
  const links = { ...state.links };
  delete links[axomId];
  return { ...state, links, excluded: [...new Set([...state.excluded, axomId])] };
}

/** Upload a card again: forget its missing note and any exclusion or failure. */
export function includeInAnki(state: LinkState, axomId: string): LinkState {
  const links = { ...state.links };
  if (links[axomId]?.issue?.kind === "missing") delete links[axomId];
  const failures = { ...state.failures };
  delete failures[axomId];
  return { ...state, links, failures, excluded: state.excluded.filter((id) => id !== axomId) };
}

/** Resolve a conflict in AXOM's favour: the next sync overwrites Anki's edit. */
export function keepAxomVersion(state: LinkState, axomId: string): LinkState {
  const link = state.links[axomId];
  if (!link) return state;
  const rest = { ...link, force: true };
  delete rest.issue;
  return { ...state, links: { ...state.links, [axomId]: rest } };
}

/**
 * Resolve a conflict in Anki's favour: AXOM has taken Anki's text, so Anki's
 * current fields become the new baseline.
 */
export function acceptAnkiVersion(state: LinkState, axomId: string, ankiFieldsHash: string): LinkState {
  const link = state.links[axomId];
  if (!link) return state;
  const rest = { ...link, fieldsHash: ankiFieldsHash, fingerprint: "" };
  delete rest.issue;
  delete rest.force;
  return { ...state, links: { ...state.links, [axomId]: rest } };
}
