// ===========================================================================
// Push AXOM cards into Anki: the heart of the link. Given the vault, the
// course catalog and the device-local link state, it adds new notes, updates
// edited ones, moves them when their course/module changes, and mirrors
// AXOM's suspend flag, all batched with AnkiConnect's `multi`.
//
// Rules it never breaks:
//  - Nothing is deleted in Anki. Deleted AXOM cards are left, or suspended
//    when the learner asked for that.
//  - An edit made in Anki is never silently overwritten: when Anki's copy
//    changed since AXOM's last push and AXOM's differs, the card becomes a
//    conflict for the learner to resolve.
//  - Tags the learner added in Anki (leech, marked, their own) are kept; only
//    tags AXOM itself added are ever removed.
//  - Idempotent: a card is re-linked by its AxomId before anything is added,
//    so a lost mapping, a retried batch or a second device never duplicates.
// When Anki becomes unreachable mid-sync, finished work is kept and the rest
// stays pending for the next attempt.
// ===========================================================================
import { AnkiError, isAnkiOffline, type AnkiAction, type AnkiClient } from "../ankiConnect";
import type { AnkiCard } from "../ankiCards";
import type { CourseCatalog } from "./courseAdapter";
import type { DeckLayoutOptions } from "./deckLayout";
import type { DeletePolicy } from "./linkSettings";
import type { LinkState, NoteLink, SyncSummary } from "./linkStore";
import { buildDesiredNote, fieldsHash, managedFieldNames, noteFingerprint, type DesiredNote } from "./noteBuilder";
import { AXOM_BASIC_MODEL, AXOM_CLOZE_MODEL, AXOM_ID_FIELD, ensureNoteTypes, noteTypeFor, NoteTypeConflictError } from "./noteTypes";
import { allOf, anyOf, fieldQuery, noteTypeQuery } from "./query";

const ADD_BATCH = 25;
const INFO_BATCH = 200;
const LOOKUP_BATCH = 40;

export interface SyncInput {
  client: AnkiClient;
  cards: readonly AnkiCard[];
  catalog: CourseCatalog;
  layout: DeckLayoutOptions;
  deletePolicy: DeletePolicy;
  state: LinkState;
  now?: () => Date;
  /** Re-read every linked note to catch notes deleted or edited in Anki. */
  verify?: boolean;
  /** Retry cards whose last upload failed, even if unchanged. */
  retryFailed?: boolean;
  onProgress?: (message: string) => void;
}

export interface SyncFailure {
  cardId: string;
  message: string;
}

export interface SyncReport extends SyncSummary {
  failures: SyncFailure[];
  conflictIds: string[];
  missingIds: string[];
  createdNoteTypes: string[];
}

export interface SyncResult {
  state: LinkState;
  report: SyncReport;
}

export type CardSyncStatus = "synced" | "pending" | "conflict" | "missing" | "failed" | "excluded";

interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards: number[];
  mod?: number;
}

function isNoteInfo(value: unknown): value is AnkiNoteInfo {
  return Boolean(value) && typeof value === "object" && typeof (value as AnkiNoteInfo).noteId === "number";
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function lower(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function fieldValues(info: AnkiNoteInfo): Record<string, string> {
  return Object.fromEntries(Object.entries(info.fields).map(([name, field]) => [name, field.value]));
}

function managedFieldsOf(info: AnkiNoteInfo, kind: DesiredNote["kind"]): Record<string, string> {
  const values = fieldValues(info);
  return Object.fromEntries(managedFieldNames(kind).map((name) => [name, values[name] ?? ""]));
}

/** Where a vault card stands with this device's Anki (no network). */
export function cardSyncStatus(cardId: string, fingerprint: string, state: LinkState): CardSyncStatus {
  if (state.excluded.includes(cardId)) return "excluded";
  const link = state.links[cardId];
  if (link?.issue) return link.issue.kind;
  if (link) return link.fingerprint === fingerprint && !link.force ? "synced" : "pending";
  const failure = state.failures[cardId];
  if (failure && failure.fingerprint === fingerprint) return "failed";
  return "pending";
}

/** Fingerprints for every card, for status badges and pending counts. */
export function desiredNotes(cards: readonly AnkiCard[], catalog: CourseCatalog, layout: DeckLayoutOptions): Map<string, { note: DesiredNote; fingerprint: string }> {
  const out = new Map<string, { note: DesiredNote; fingerprint: string }>();
  for (const card of cards) {
    const note = buildDesiredNote(card, catalog, layout);
    out.set(card.id, { note, fingerprint: noteFingerprint(note) });
  }
  return out;
}

/** How many changes are waiting for Anki. */
export function pendingChangeCount(cards: readonly AnkiCard[], catalog: CourseCatalog, layout: DeckLayoutOptions, state: LinkState): number {
  return countStillPending(cards, desiredNotes(cards, catalog, layout), state);
}

function emptyReport(at: string): SyncReport {
  return {
    at, added: 0, updated: 0, moved: 0, recovered: 0, replaced: 0, unchanged: 0, suspended: 0, unsuspended: 0,
    deletedLeft: 0, deletedSuspended: 0, conflicts: 0, missing: 0, failed: 0, pending: 0, offline: false,
    failures: [], conflictIds: [], missingIds: [], createdNoteTypes: [],
  };
}

async function notesInfo(client: AnkiClient, noteIds: readonly number[]): Promise<Map<number, AnkiNoteInfo>> {
  const out = new Map<number, AnkiNoteInfo>();
  for (const ids of chunk([...new Set(noteIds)], INFO_BATCH)) {
    const infos = await client.call<unknown[]>("notesInfo", { notes: ids });
    infos.forEach((info) => { if (isNoteInfo(info)) out.set(info.noteId, info); });
  }
  return out;
}

/** Find AXOM notes by AxomId. Returns the oldest note per id. */
async function findByAxomId(client: AnkiClient, axomIds: readonly string[]): Promise<Map<string, AnkiNoteInfo>> {
  const found = new Map<string, AnkiNoteInfo>();
  if (!axomIds.length) return found;
  const models = anyOf([noteTypeQuery(AXOM_BASIC_MODEL), noteTypeQuery(AXOM_CLOZE_MODEL)]);
  const noteIds = new Set<number>();
  const batches = chunk(axomIds, LOOKUP_BATCH);
  const replies = await client.multi(batches.map((ids) => ({
    action: "findNotes",
    params: { query: allOf([models, anyOf(ids.map((id) => fieldQuery(AXOM_ID_FIELD, id)))]) },
  })));
  replies.forEach((reply) => {
    if (!reply.ok) throw new AnkiError(reply.error, "anki", "findNotes");
    for (const id of reply.result as number[]) noteIds.add(id);
  });
  const wanted = lower(axomIds);
  const infos = await notesInfo(client, [...noteIds].sort((a, b) => a - b));
  for (const info of infos.values()) {
    const axomId = info.fields[AXOM_ID_FIELD]?.value?.trim();
    if (!axomId || !wanted.has(axomId.toLowerCase())) continue;
    const key = axomIds.find((id) => id.toLowerCase() === axomId.toLowerCase())!;
    if (!found.has(key)) found.set(key, info);
  }
  return found;
}

export async function syncCardsToAnki(input: SyncInput): Promise<SyncResult> {
  const now = input.now ?? (() => new Date());
  const at = now().toISOString();
  const { client } = input;
  const report = emptyReport(at);
  const state: LinkState = {
    ...input.state,
    links: { ...input.state.links },
    failures: { ...input.state.failures },
    pendingSuspends: [...input.state.pendingSuspends],
    excluded: [...input.state.excluded],
  };
  const progress = input.onProgress ?? (() => {});
  const desired = desiredNotes(input.cards, input.catalog, input.layout);
  const cardById = new Map(input.cards.map((card) => [card.id, card]));
  const excluded = new Set(state.excluded);

  // --- plan ---------------------------------------------------------------------
  const toAdd: string[] = [];
  const toCheck: string[] = [];
  for (const card of input.cards) {
    if (excluded.has(card.id)) continue;
    const { fingerprint } = desired.get(card.id)!;
    const link = state.links[card.id];
    if (!link) {
      const failure = state.failures[card.id];
      if (!failure || failure.fingerprint !== fingerprint || input.retryFailed) toAdd.push(card.id);
      else report.failed += 1;
      continue;
    }
    if (link.issue?.kind === "missing") { report.missing += 1; report.missingIds.push(card.id); continue; }
    const changed = link.fingerprint !== fingerprint || link.force === true;
    if (changed || input.verify || link.issue?.kind === "conflict") toCheck.push(card.id);
    else report.unchanged += 1;
  }
  const deleted = Object.keys(state.links).filter((id) => !cardById.has(id));

  const remaining = () => toAdd.length + toCheck.length + deleted.length + state.pendingSuspends.length;
  if (!remaining()) {
    return { state: { ...state, lastSync: summarize(report) }, report };
  }

  try {
    // --- note types (only when something will be written) -------------------------
    if (toAdd.length || toCheck.length) {
      progress("Checking AXOM note types…");
      const ensured = await ensureNoteTypes(client);
      report.createdNoteTypes = ensured.created;
    }

    // --- re-link notes that already exist (lost mapping, other device) ------------
    const adds: string[] = [];
    if (toAdd.length) {
      progress("Looking for cards already in Anki…");
      const existing = await findByAxomId(client, toAdd);
      const adoptedCards = [...existing.values()].flatMap((info) => info.cards);
      const decks = adoptedCards.length ? await client.call<Record<string, number[]>>("getDecks", { cards: adoptedCards }) : {};
      const deckOfCard = new Map<number, string>();
      for (const [deck, ids] of Object.entries(decks)) ids.forEach((id) => deckOfCard.set(id, deck));
      for (const id of toAdd) {
        const info = existing.get(id);
        if (!info) { adds.push(id); continue; }
        const definition = noteTypeFor(info.modelName);
        const { note } = desired.get(id)!;
        const kind = definition?.kind ?? note.kind;
        const noteTags = lower(info.tags);
        const card = cardById.get(id)!;
        const ankiHash = fieldsHash(managedFieldsOf(info, kind), kind);
        // Anki's copy is newer than the AXOM card: keep it as the baseline so a
        // differing AXOM version becomes a conflict instead of an overwrite.
        const ankiNewer = typeof info.mod !== "number" || info.mod * 1000 > Date.parse(card.updatedAt);
        state.links[id] = {
          noteId: info.noteId,
          cardIds: info.cards,
          kind,
          deck: deckOfCard.get(info.cards[0]) ?? note.deckName,
          tags: note.tags.filter((tag) => noteTags.has(tag.toLowerCase())),
          fieldsHash: ankiNewer ? ankiHash : fieldsHash(note.fields, note.kind),
          fingerprint: "",
          suspended: note.suspended,
          syncedAt: at,
        };
        delete state.failures[id];
        report.recovered += 1;
        toCheck.push(id);
      }
    }

    // --- read the linked notes that may need work ---------------------------------
    const updateActions: Array<{ cardId: string; action: AnkiAction; kind: "fields" | "move" | "suspend" | "unsuspend" | "tags" }> = [];
    const decksNeeded = new Set<string>();
    const replaceAfterAdd = new Map<string, NoteLink>();
    const nextLinks = new Map<string, NoteLink>();
    const refreshCards = new Set<string>();
    if (toCheck.length) {
      progress("Comparing with Anki…");
      const infos = await notesInfo(client, toCheck.map((id) => state.links[id].noteId));
      for (const id of toCheck) {
        const link = state.links[id];
        const { note, fingerprint } = desired.get(id)!;
        const info = infos.get(link.noteId);
        if (!info) {
          state.links[id] = { ...link, issue: { kind: "missing", message: "This card's note was deleted in Anki.", at } };
          report.missing += 1;
          report.missingIds.push(id);
          continue;
        }
        if (note.kind !== link.kind) {
          // Basic ↔ Cloze needs a different note type: add a new note and
          // suspend the old one (its review history stays in Anki).
          replaceAfterAdd.set(id, { ...link, cardIds: info.cards });
          adds.push(id);
          continue;
        }
        const ankiFields = managedFieldsOf(info, link.kind);
        const ankiHash = fieldsHash(ankiFields, link.kind);
        const desiredHash = fieldsHash(note.fields, note.kind);
        const editedInAnki = ankiHash !== link.fieldsHash;
        const fieldsDiffer = ankiHash !== desiredHash;
        if (editedInAnki && fieldsDiffer && !link.force) {
          state.links[id] = {
            ...link,
            cardIds: info.cards,
            issue: {
              kind: "conflict",
              message: "Edited in Anki since AXOM last uploaded it, and the AXOM version differs.",
              at,
              ankiFields,
            },
          };
          report.conflicts += 1;
          report.conflictIds.push(id);
          continue;
        }
        const next: NoteLink = { ...link, cardIds: info.cards, fieldsHash: desiredHash, fingerprint, suspended: note.suspended, syncedAt: at, deck: note.deckName, tags: note.tags };
        delete next.issue;
        delete next.force;
        if (fieldsDiffer) {
          updateActions.push({ cardId: id, kind: "fields", action: { action: "updateNoteFields", params: { note: { id: link.noteId, fields: note.fields } } } });
          refreshCards.add(id);
        }
        const noteTags = lower(info.tags);
        const wanted = lower(note.tags);
        const addTags = note.tags.filter((tag) => !noteTags.has(tag.toLowerCase()));
        const removeTags = link.tags.filter((tag) => !wanted.has(tag.toLowerCase()) && noteTags.has(tag.toLowerCase()));
        if (addTags.length) updateActions.push({ cardId: id, kind: "tags", action: { action: "addTags", params: { notes: [link.noteId], tags: addTags.join(" ") } } });
        if (removeTags.length) updateActions.push({ cardId: id, kind: "tags", action: { action: "removeTags", params: { notes: [link.noteId], tags: removeTags.join(" ") } } });
        if (note.deckName.toLowerCase() !== link.deck.toLowerCase() && info.cards.length) {
          decksNeeded.add(note.deckName);
          updateActions.push({ cardId: id, kind: "move", action: { action: "changeDeck", params: { cards: info.cards, deck: note.deckName } } });
        }
        if (note.suspended !== link.suspended && info.cards.length) {
          updateActions.push({ cardId: id, kind: note.suspended ? "suspend" : "unsuspend", action: { action: note.suspended ? "suspend" : "unsuspend", params: { cards: info.cards } } });
        }
        nextLinks.set(id, next);
      }
    }

    // --- decks ------------------------------------------------------------------------
    for (const id of adds) decksNeeded.add(desired.get(id)!.note.deckName);
    if (decksNeeded.size) {
      progress("Creating AXOM decks…");
      const replies = await client.multi([...decksNeeded].map((deck) => ({ action: "createDeck", params: { deck } })));
      const failedDeck = replies.find((reply) => !reply.ok);
      if (failedDeck && !failedDeck.ok) throw new AnkiError(failedDeck.error, "anki", "createDeck");
    }

    // --- updates ----------------------------------------------------------------------
    if (updateActions.length) {
      progress(`Updating ${new Set(updateActions.map((item) => item.cardId)).size} cards in Anki…`);
      const failedCards = new Map<string, string>();
      for (const batch of chunk(updateActions, 100)) {
        const replies = await client.multi(batch.map((item) => item.action));
        replies.forEach((reply, index) => {
          if (!reply.ok && !failedCards.has(batch[index].cardId)) failedCards.set(batch[index].cardId, reply.error);
        });
      }
      const touched = new Map<string, Set<string>>();
      for (const item of updateActions) {
        const kinds = touched.get(item.cardId) ?? new Set<string>();
        kinds.add(item.kind);
        touched.set(item.cardId, kinds);
      }
      for (const [id, kinds] of touched) {
        const message = failedCards.get(id);
        if (message) {
          report.failed += 1;
          report.failures.push({ cardId: id, message });
          nextLinks.delete(id);
          refreshCards.delete(id);
          continue;
        }
        if (kinds.has("fields") || kinds.has("tags")) report.updated += 1;
        if (kinds.has("move")) report.moved += 1;
        if (kinds.has("suspend")) report.suspended += 1;
        if (kinds.has("unsuspend")) report.unsuspended += 1;
      }
    }
    for (const [id, next] of nextLinks) {
      const before = state.links[id];
      if (before.fingerprint === next.fingerprint && !before.force && !updateActions.some((item) => item.cardId === id)) report.unchanged += 1;
      state.links[id] = next;
    }
    // A field change can create a card (the reverse of a basic-reversed card).
    if (refreshCards.size) {
      const infos = await notesInfo(client, [...refreshCards].map((id) => state.links[id].noteId));
      for (const id of refreshCards) {
        const info = infos.get(state.links[id].noteId);
        if (info) state.links[id] = { ...state.links[id], cardIds: info.cards };
      }
    }

    // --- adds -------------------------------------------------------------------------
    if (adds.length) {
      progress(`Adding ${adds.length} card${adds.length === 1 ? "" : "s"} to Anki…`);
      for (const batch of chunk(adds, ADD_BATCH)) {
        await addBatch(client, batch, desired, state, report, at, replaceAfterAdd);
      }
    }

    // --- deletions --------------------------------------------------------------------
    for (const id of deleted) {
      const link = state.links[id];
      delete state.links[id];
      delete state.failures[id];
      if (input.deletePolicy === "suspend") {
        state.pendingSuspends.push({ axomId: id, noteId: link.noteId, cardIds: link.cardIds, at });
      } else {
        report.deletedLeft += 1;
      }
    }
    if (state.pendingSuspends.length) {
      progress("Suspending deleted cards in Anki…");
      const cardIds = [...new Set(state.pendingSuspends.flatMap((item) => item.cardIds))];
      const existing = cardIds.length ? await client.call<Array<boolean | null>>("areSuspended", { cards: cardIds }) : [];
      const toSuspend = cardIds.filter((_id, index) => existing[index] === false);
      if (toSuspend.length) await client.call("suspend", { cards: toSuspend });
      report.deletedSuspended += state.pendingSuspends.length;
      state.pendingSuspends = [];
    }
  } catch (error) {
    if (error instanceof NoteTypeConflictError) {
      report.error = error.message;
    } else if (isAnkiOffline(error)) {
      report.offline = true;
      report.error = error instanceof Error ? error.message : String(error);
    } else {
      report.error = error instanceof Error ? error.message : String(error);
    }
    report.pending = countStillPending(input.cards, desired, state);
  }
  report.conflicts = Object.values(state.links).filter((link) => link.issue?.kind === "conflict").length;
  report.conflictIds = Object.entries(state.links).filter(([, link]) => link.issue?.kind === "conflict").map(([id]) => id);
  if (!report.offline && !report.error) report.pending = countStillPending(input.cards, desired, state);
  return { state: { ...state, lastSync: summarize(report) }, report };
}

function countStillPending(cards: readonly AnkiCard[], desired: Map<string, { fingerprint: string }>, state: LinkState): number {
  let pending = state.pendingSuspends.length;
  const ids = new Set(cards.map((card) => card.id));
  for (const card of cards) if (cardSyncStatus(card.id, desired.get(card.id)!.fingerprint, state) === "pending") pending += 1;
  for (const id of Object.keys(state.links)) if (!ids.has(id)) pending += 1;
  return pending;
}

function summarize(report: SyncReport): SyncSummary {
  const summary: SyncSummary = {
    at: report.at, added: report.added, updated: report.updated, moved: report.moved, recovered: report.recovered, replaced: report.replaced,
    unchanged: report.unchanged, suspended: report.suspended, unsuspended: report.unsuspended, deletedLeft: report.deletedLeft,
    deletedSuspended: report.deletedSuspended, conflicts: report.conflicts, missing: report.missing, failed: report.failed,
    pending: report.pending, offline: report.offline,
  };
  if (report.error) summary.error = report.error;
  return summary;
}

async function addBatch(
  client: AnkiClient,
  batch: string[],
  desired: Map<string, { note: DesiredNote; fingerprint: string }>,
  state: LinkState,
  report: SyncReport,
  at: string,
  replaced: Map<string, NoteLink>,
): Promise<void> {
  const notes = batch.map((id) => {
    const { note } = desired.get(id)!;
    // AXOM flags duplicate fronts itself; Anki's first-field check would
    // otherwise refuse the second of two cards the learner kept on purpose.
    return { deckName: note.deckName, modelName: note.modelName, fields: note.fields, tags: note.tags, options: { allowDuplicate: true } };
  });
  const created = new Map<string, number>();
  const failed = new Map<string, string>();
  try {
    const results = await client.call<Array<number | string | null>>("addNotes", { notes });
    results.forEach((result, index) => {
      if (result === null || result === undefined) failed.set(batch[index], "");
      else created.set(batch[index], Number(result));
    });
  } catch (error) {
    if (!(error instanceof AnkiError) || isAnkiOffline(error)) throw error;
    // Newer AnkiConnect throws after trying every note, keeping the ones that
    // worked: find those by AxomId, then add the rest one by one for reasons.
    const found = await findByAxomId(client, batch);
    for (const [id, info] of found) created.set(id, info.noteId);
    for (const id of batch) {
      if (created.has(id)) continue;
      const index = batch.indexOf(id);
      try {
        created.set(id, Number(await client.call("addNote", { note: notes[index] })));
      } catch (single) {
        if (isAnkiOffline(single)) throw single;
        failed.set(id, single instanceof Error ? single.message : String(single));
      }
    }
  }
  // The older add-on reports a failed note as null without a reason: adding
  // it alone surfaces Anki's own message (and succeeds if it was transient).
  for (const [id, message] of [...failed]) {
    if (message) continue;
    try {
      created.set(id, Number(await client.call("addNote", { note: notes[batch.indexOf(id)] })));
      failed.delete(id);
    } catch (single) {
      if (isAnkiOffline(single)) throw single;
      failed.set(id, single instanceof Error ? single.message : "Anki refused this note.");
    }
  }
  const infos = created.size ? await notesInfo(client, [...created.values()]) : new Map<number, AnkiNoteInfo>();
  const suspendNow: number[] = [];
  const suspendOld: number[] = [];
  for (const [id, noteId] of created) {
    const { note, fingerprint } = desired.get(id)!;
    const info = infos.get(noteId);
    const cardIds = info?.cards ?? [];
    const previous = replaced.get(id);
    state.links[id] = {
      noteId,
      cardIds,
      kind: note.kind,
      deck: note.deckName,
      tags: note.tags,
      fieldsHash: info ? fieldsHash(managedFieldsOf(info, note.kind), note.kind) : fieldsHash(note.fields, note.kind),
      fingerprint,
      suspended: note.suspended,
      syncedAt: at,
      ...(previous ? { retiredNoteIds: [...(previous.retiredNoteIds ?? []), previous.noteId] } : {}),
    };
    delete state.failures[id];
    if (note.suspended) suspendNow.push(...cardIds);
    if (previous) {
      suspendOld.push(...previous.cardIds);
      report.replaced += 1;
    } else {
      report.added += 1;
    }
  }
  if (suspendNow.length || suspendOld.length) await client.call("suspend", { cards: [...suspendNow, ...suspendOld] });
  for (const [id, message] of failed) {
    state.failures[id] = { message, fingerprint: desired.get(id)!.fingerprint, at };
    report.failed += 1;
    report.failures.push({ cardId: id, message });
  }
}
