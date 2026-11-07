import { describe, expect, it } from "vitest";
import { createAnkiClient } from "../ankiConnect";
import { newSchedule, type AnkiCard } from "../ankiCards";
import type { Course } from "../types";
import { buildCourseCatalog } from "./courseAdapter";
import { DEFAULT_DECK_LAYOUT } from "./deckLayout";
import { createFakeFetch, FakeAnkiConnect } from "./fake/fakeAnkiConnect";
import {
  acceptAnkiVersion, emptyLinkState, excludeFromAnki, includeInAnki, keepAxomVersion, normalizeLinkState, recordAxomDeletion, type LinkState,
} from "./linkStore";
import { ankiHtmlToText, fieldsHash } from "./noteBuilder";
import { cardSyncStatus, desiredNotes, pendingChangeCount, syncCardsToAnki, type SyncInput } from "./sync";

const courses: Course[] = [
  { id: "c501", termId: "t2", code: "BPM 501", name: "Basic Principles II", files: 0, modules: [{ id: "m-nb3", name: "NB3" }, { id: "m-er", name: "ER" }] },
];
const catalog = buildCourseCatalog({ courses, terms: [{ id: "t2", name: "Term 2" }] });

function card(id: string, patch: Partial<AnkiCard> = {}): AnkiCard {
  return {
    id, type: "basic", front: `Question ${id}?`, back: `Answer ${id}`, tags: [], aiGenerated: false,
    schedule: newSchedule(new Date("2026-09-01T00:00:00Z")), createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...patch,
  };
}

function harness(options: ConstructorParameters<typeof FakeAnkiConnect>[0] = {}) {
  const fake = new FakeAnkiConnect(options);
  const client = createAnkiClient({ fetchImpl: createFakeFetch(fake), apiKey: options.apiKey ?? undefined });
  let state: LinkState = emptyLinkState();
  const run = async (cards: AnkiCard[], extra: Partial<SyncInput> = {}) => {
    const result = await syncCardsToAnki({
      client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
      now: () => new Date(fake.nowMs()), ...extra,
    });
    state = result.state;
    return result.report;
  };
  const noteOf = (axomId: string) => {
    const [nid] = fake.call<number[]>("findNotes", { query: `"AxomId:${axomId}"` });
    return nid ? fake.call<Array<{ noteId: number; tags: string[]; fields: Record<string, { value: string }>; cards: number[]; modelName: string }>>("notesInfo", { notes: [nid] })[0] : undefined;
  };
  const deckOf = (cardId: number) => Object.keys(fake.call<Record<string, number[]>>("getDecks", { cards: [cardId] }))[0];
  return { fake, client, run, noteOf, deckOf, get state() { return state; }, set state(next: LinkState) { state = next; } };
}

function interruptedRetirement(mode: "before" | "after") {
  const fake = new FakeAnkiConnect();
  const realFetch = createFakeFetch(fake);
  let interrupt = true;
  const fetchImpl: typeof fetch = async (input, init) => {
    const action = JSON.parse(String(init?.body)) as { action?: string };
    if (interrupt && mode === "before" && action.action === "suspend") {
      interrupt = false;
      throw new TypeError("Anki disconnected before suspension");
    }
    const reply = await realFetch(input, init);
    if (interrupt && mode === "after" && action.action === "suspend") {
      interrupt = false;
      throw new TypeError("Anki lost the response after suspension");
    }
    return reply;
  };
  const client = createAnkiClient({ fetchImpl });
  const run = (cards: AnkiCard[], state: LinkState) => syncCardsToAnki({
    client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
  });
  return { fake, run };
}

describe("pushing AXOM cards to Anki", () => {
  it("adds notes with note types, decks and tags, then does nothing on a second run", async () => {
    const h = harness();
    const cards = [
      card("a", { courseId: "c501", moduleId: "m-nb3", tags: ["high yield"], source: "NB 58" }),
      card("b", { type: "cloze", front: "{{c1::Serotonin}} is low in depression", back: "", courseId: "c501" }),
      card("c"),
    ];
    const first = await h.run(cards);
    expect(first).toMatchObject({ added: 3, failed: 0, pending: 0, offline: false, createdNoteTypes: ["AXOM Basic", "AXOM Cloze"] });
    expect(h.fake.call("deckNames")).toEqual(expect.arrayContaining(["AXOM::BPM 501::NB3", "AXOM::BPM 501", "AXOM::Unsorted"]));
    const a = h.noteOf("a")!;
    expect(a).toMatchObject({ modelName: "AXOM Basic" });
    expect(a.tags).toEqual(["AXOM", "AXOM::bpm-501::nb3", "AXOM::term-2", "AXOM::term-2::bpm-501", "AXOM::term-2::bpm-501::nb3", "high_yield"]);
    expect(a.fields.Front.value).toBe("Question a?");
    expect(a.fields.Source.value).toBe("NB 58");
    expect(h.deckOf(a.cards[0])).toBe("AXOM::BPM 501::NB3");
    expect(h.noteOf("b")!.modelName).toBe("AXOM Cloze");

    const writesBefore = h.fake.log.length;
    const second = await h.run(cards);
    expect(second).toMatchObject({ added: 0, updated: 0, unchanged: 3, pending: 0 });
    expect(h.fake.log.length).toBe(writesBefore); // no request at all
    expect(h.fake.call<number[]>("findNotes", { query: "tag:AXOM" })).toHaveLength(3);
    for (const c of cards) expect(cardSyncStatus(c.id, desiredNotes([c], catalog, DEFAULT_DECK_LAYOUT).get(c.id)!.fingerprint, h.state)).toBe("synced");
  });

  it("updates edited text and AXOM tags but keeps tags the learner added in Anki", async () => {
    const h = harness();
    await h.run([card("a", { tags: ["renal", "old"] })]);
    const nid = h.noteOf("a")!.noteId;
    h.fake.call("addTags", { notes: [nid], tags: "leech marked" });
    const report = await h.run([card("a", { back: "NKCC2 in the TAL\nloop", tags: ["renal", "new"] })]);
    expect(report).toMatchObject({ updated: 1, added: 0 });
    const note = h.noteOf("a")!;
    expect(note.fields.Back.value).toBe("NKCC2 in the TAL<br>loop");
    expect(note.tags.sort()).toEqual(["AXOM", "leech", "marked", "new", "renal"]);
  });

  it("moves notes when the course or module changes, and mirrors suspension", async () => {
    const h = harness();
    await h.run([card("a", { courseId: "c501", moduleId: "m-nb3" })]);
    const report = await h.run([card("a", { courseId: "c501", moduleId: "m-er", suspended: true })]);
    expect(report).toMatchObject({ moved: 1, suspended: 1 });
    const note = h.noteOf("a")!;
    expect(h.deckOf(note.cards[0])).toBe("AXOM::BPM 501::ER");
    expect(note.tags).toContain("AXOM::bpm-501::er");
    expect(note.tags).not.toContain("AXOM::bpm-501::nb3");
    expect(note.tags).not.toContain("AXOM::term-2::bpm-501::nb3");
    expect(h.fake.call("areSuspended", { cards: note.cards })).toEqual([true]);
    await h.run([card("a", { courseId: "c501", moduleId: "m-er", suspended: false })]);
    expect(h.fake.call("areSuspended", { cards: note.cards })).toEqual([false]);
  });

  it("queues changes while Anki is closed and applies them once it is back", async () => {
    const h = harness();
    await h.run([card("a")]);
    h.fake.offline = true;
    const cards = [card("a", { back: "changed offline" }), card("b")];
    expect(pendingChangeCount(cards, catalog, DEFAULT_DECK_LAYOUT, h.state)).toBe(2);
    const offline = await h.run(cards);
    expect(offline).toMatchObject({ offline: true, pending: 2, added: 0 });
    expect(h.state.lastSync).toMatchObject({ offline: true, pending: 2 });
    h.fake.offline = false;
    const online = await h.run(cards);
    expect(online).toMatchObject({ added: 1, updated: 1, pending: 0, offline: false });
    expect(h.noteOf("a")!.fields.Back.value).toBe("changed offline");
  });

  it("re-links existing notes by AxomId when the mapping is lost, without duplicates", async () => {
    const h = harness();
    const cards = [card("a", { courseId: "c501", moduleId: "m-nb3" }), card("b", { type: "cloze", front: "{{c1::x}} y", back: "" })];
    await h.run(cards);
    h.state = emptyLinkState(); // new device / cleared storage
    const report = await h.run(cards);
    expect(report).toMatchObject({ recovered: 2, added: 0 });
    expect(h.fake.call<number[]>("findNotes", { query: "tag:AXOM" })).toHaveLength(2);
    expect(h.state.links.a.noteId).toBe(h.noteOf("a")!.noteId);
    expect(await h.run(cards)).toMatchObject({ unchanged: 2, added: 0 });
  });

  it("turns an Anki-side edit into a conflict instead of overwriting it", async () => {
    const h = harness();
    await h.run([card("a")]);
    const nid = h.noteOf("a")!.noteId;
    h.fake.call("updateNoteFields", { note: { id: nid, fields: { Back: "Fixed in <b>Anki</b>" } } });
    // Unchanged in AXOM: a verify pass notices the drift and flags it.
    const verify = await h.run([card("a")], { verify: true });
    expect(verify).toMatchObject({ conflicts: 1, conflictIds: ["a"], updated: 0 });
    expect(h.state.links.a.issue?.ankiFields?.Back).toBe("Fixed in <b>Anki</b>");
    expect(h.noteOf("a")!.fields.Back.value).toBe("Fixed in <b>Anki</b>");

    // Choosing Anki's version: AXOM takes the text; nothing is written to Anki.
    const ankiText = ankiHtmlToText(h.state.links.a.issue!.ankiFields!.Back);
    h.state = acceptAnkiVersion(h.state, "a", fieldsHash(h.state.links.a.issue!.ankiFields!, "basic"));
    const accepted = await h.run([card("a", { back: ankiText })]);
    expect(accepted).toMatchObject({ conflicts: 0, updated: 1 }); // HTML → text normalizes the note once
    expect(h.noteOf("a")!.fields.Back.value).toBe("Fixed in Anki");

    // Edit both sides again, then keep AXOM's version.
    h.fake.call("updateNoteFields", { note: { id: nid, fields: { Back: "Anki again" } } });
    expect(await h.run([card("a", { back: "AXOM again" })])).toMatchObject({ conflicts: 1 });
    h.state = keepAxomVersion(h.state, "a");
    expect(await h.run([card("a", { back: "AXOM again" })])).toMatchObject({ conflicts: 0, updated: 1 });
    expect(h.noteOf("a")!.fields.Back.value).toBe("AXOM again");
  });

  it("reports notes deleted in Anki and re-adds them only when asked", async () => {
    const h = harness();
    await h.run([card("a")]);
    h.fake.notes.delete(h.noteOf("a")!.noteId);
    for (const id of [...h.fake.cards.keys()]) h.fake.cards.delete(id);
    const report = await h.run([card("a")], { verify: true });
    expect(report).toMatchObject({ missing: 1, missingIds: ["a"], added: 0 });
    expect(await h.run([card("a", { back: "edited" })])).toMatchObject({ missing: 1, added: 0 });
    h.state = excludeFromAnki(h.state, "a");
    expect(await h.run([card("a")])).toMatchObject({ added: 0, missing: 0 });
    h.state = includeInAnki(h.state, "a");
    expect(await h.run([card("a")])).toMatchObject({ added: 1 });
  });

  it("never deletes in Anki: deleted AXOM cards are left, or suspended when chosen", async () => {
    const h = harness();
    await h.run([card("a"), card("b"), card("c")]);
    const cardsA = h.noteOf("a")!.cards;
    const cardsB = h.noteOf("b")!.cards;
    h.state = recordAxomDeletion(h.state, "a", "suspend");
    const report = await h.run([card("c")]); // b deleted elsewhere, policy "ask" → leave
    expect(report).toMatchObject({ deletedSuspended: 1, deletedLeft: 1 });
    expect(h.fake.call("areSuspended", { cards: [...cardsA, ...cardsB] })).toEqual([true, false]);
    expect(h.fake.notes.size).toBe(3);
    expect(h.fake.actionsCalled("deleteNotes")).toEqual([]);
    expect(Object.keys(h.state.links)).toEqual(["c"]);

    const policy = harness();
    await policy.run([card("x")]);
    const cardsX = policy.noteOf("x")!.cards;
    expect(await policy.run([], { deletePolicy: "suspend" })).toMatchObject({ deletedSuspended: 1 });
    expect(policy.fake.call("areSuspended", { cards: cardsX })).toEqual([true]);
  });

  it("holds deletion suspension when an Anki note is replaced under the same numeric ID", async () => {
    const h = harness();
    await h.run([card("a")]);
    const former = h.state.links.a;
    h.state = recordAxomDeletion(h.state, "a", "suspend");
    h.fake.call("updateNoteFields", { note: { id: former.noteId, fields: { AxomId: "a-different-profile" } } });
    const held = await h.run([]);
    expect(held).toMatchObject({ deletedSuspended: 0, pending: 1 });
    expect(held.error).toMatch(/identity changed/);
    expect(h.state.pendingSuspends).toHaveLength(1);
    expect(h.fake.call("areSuspended", { cards: former.cardIds })).toEqual([false]);
    expect(h.fake.actionsCalled("suspend")).toHaveLength(0);
  });

  it("does not clear a deleted-card receipt when Anki acknowledges but does not suspend", async () => {
    const fake = new FakeAnkiConnect();
    const realFetch = createFakeFetch(fake);
    let suppressOnce = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const action = JSON.parse(String(init?.body)) as { action?: string };
      if (suppressOnce && action.action === "suspend") {
        suppressOnce = false;
        return new Response(JSON.stringify({ result: true, error: null }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    };
    const client = createAnkiClient({ fetchImpl });
    const run = (cards: AnkiCard[], state: LinkState) => syncCardsToAnki({
      client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
    });
    const initial = await run([card("a")], emptyLinkState());
    const ids = initial.state.links.a.cardIds;
    const deletion = recordAxomDeletion(initial.state, "a", "suspend");
    const held = await run([], deletion);
    expect(held.report).toMatchObject({ deletedSuspended: 0, pending: 1, offline: false });
    expect(held.report.error).toMatch(/did not confirm suspension/);
    expect(held.state.pendingSuspends).toHaveLength(1);
    expect(fake.call("areSuspended", { cards: ids })).toEqual([false]);
    const recovered = await run([], normalizeLinkState(JSON.parse(JSON.stringify(held.state))));
    expect(recovered.report).toMatchObject({ deletedSuspended: 1, pending: 0, offline: false });
    expect(recovered.state.pendingSuspends).toEqual([]);
    expect(fake.call("areSuspended", { cards: ids })).toEqual([true]);
    expect(fake.actionsCalled("deleteNotes")).toEqual([]);
  });

  it("persists only the unfinished deletion receipt after partial multi-note disconnection", async () => {
    const fake = new FakeAnkiConnect();
    const realFetch = createFakeFetch(fake);
    const interruptCard = { value: -1 };
    let interrupted = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body)) as { action?: string; params?: { cards?: number[] } };
      if (!interrupted && request.action === "suspend" &&
          request.params?.cards?.includes(interruptCard.value)) {
        interrupted = true;
        throw new TypeError("Anki disconnected before the second deleted note was suspended");
      }
      return realFetch(input, init);
    };
    const client = createAnkiClient({ fetchImpl });
    const run = (cards: AnkiCard[], state: LinkState) => syncCardsToAnki({
      client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
    });
    const initial = await run([card("a"), card("b")], emptyLinkState());
    const aCards = initial.state.links.a.cardIds;
    const bCards = initial.state.links.b.cardIds;
    interruptCard.value = bCards[0];
    const deletion = recordAxomDeletion(recordAxomDeletion(initial.state, "a", "suspend"), "b", "suspend");
    const partial = await run([], deletion);
    expect(partial.report).toMatchObject({ deletedSuspended: 1, pending: 1, offline: true });
    expect(partial.state.pendingSuspends).toMatchObject([{ axomId: "b" }]);
    expect(fake.call("areSuspended", { cards: aCards })).toEqual([true]);
    expect(fake.call("areSuspended", { cards: bCards })).toEqual([false]);
    const resumed = await run([], normalizeLinkState(JSON.parse(JSON.stringify(partial.state))));
    expect(resumed.report).toMatchObject({ deletedSuspended: 1, pending: 0, offline: false });
    expect(resumed.state.pendingSuspends).toEqual([]);
    expect(fake.call("areSuspended", { cards: bCards })).toEqual([true]);
    expect(fake.actionsCalled("deleteNotes")).toEqual([]);
  });

  it("rejects linked-note identity mismatch for both field updates and kind switches, even when forced", async () => {
    for (const convert of [false, true]) {
      const h = harness();
      await h.run([card("a")]);
      const previous = h.state.links.a;
      h.fake.call("updateNoteFields", { note: { id: previous.noteId, fields: { AxomId: "different-card" } } });
      const desired = convert
        ? card("a", { type: "cloze", front: "{{c1::Different}} content", back: "" })
        : card("a", { back: "Do not overwrite a different Anki note" });
      const held = await h.run([desired]);
      expect(held).toMatchObject({ updated: 0, replaced: 0, added: 0, conflicts: 1, offline: false });
      expect(h.state.links.a).toMatchObject({ noteId: previous.noteId, kind: "basic", issue: { kind: "conflict" } });
      expect(h.fake.call<Array<{ fields: Record<string, { value: string }> }>>("notesInfo", { notes: [previous.noteId] })[0].fields.AxomId.value)
        .toBe("different-card");
      expect(h.fake.actionsCalled("addNotes")).toHaveLength(1);
      expect(h.fake.actionsCalled("updateNoteFields")).toHaveLength(1); // only simulated outside edit
      expect(h.fake.actionsCalled("suspend")).toEqual([]);
      h.state = keepAxomVersion(h.state, "a");
      const forced = await h.run([desired]);
      expect(forced).toMatchObject({ updated: 0, replaced: 0, conflicts: 1 });
      expect(h.fake.actionsCalled("addNotes")).toHaveLength(1);
    }
  });

  it("holds a Basic-to-Cloze conversion if the learner edited the original note in Anki", async () => {
    const h = harness();
    await h.run([card("a")]);
    const previous = h.state.links.a;
    h.fake.call("updateNoteFields", { note: { id: previous.noteId, fields: { Back: "learner-edited answer" } } });
    const cloze = card("a", { type: "cloze", front: "{{c1::Kidney}} anatomy", back: "" });
    const held = await h.run([cloze]);
    expect(held).toMatchObject({ conflicts: 1, replaced: 0, added: 0, offline: false });
    expect(h.state.links.a.issue).toMatchObject({ kind: "conflict", ankiFields: { Back: "learner-edited answer" } });
    expect(h.fake.notes.size).toBe(1);
    expect(h.fake.call("areSuspended", { cards: previous.cardIds })).toEqual([false]);
    expect(h.fake.actionsCalled("addNotes")).toHaveLength(1);

    h.state = keepAxomVersion(h.state, "a");
    const approved = await h.run([cloze]);
    expect(approved).toMatchObject({ replaced: 1, conflicts: 0, pending: 0, offline: false });
    expect(h.fake.call("areSuspended", { cards: previous.cardIds })).toEqual([true]);
    expect(h.fake.call<Array<{ fields: Record<string, { value: string }> }>>("notesInfo", { notes: [previous.noteId] })[0].fields.Back.value)
      .toBe("learner-edited answer"); // historical note preserved intact
    expect(h.fake.notes.size).toBe(2);
  });

  it("replaces the note when a card switches between Basic and Cloze, keeping the old one suspended", async () => {
    const h = harness();
    await h.run([card("a")]);
    const old = h.noteOf("a")!;
    const report = await h.run([card("a", { type: "cloze", front: "{{c1::Question}} a", back: "" })]);
    expect(report).toMatchObject({ replaced: 1, added: 0 });
    expect(h.fake.call("areSuspended", { cards: old.cards })).toEqual([true]);
    expect(h.state.links.a.retiredNoteIds).toEqual([old.noteId]);
    expect(h.state.links.a.kind).toBe("cloze");
    expect(h.fake.notes.has(old.noteId)).toBe(true);
  });

  it("never re-adds a kind-switch replacement after Anki applied it but its reply was lost", async () => {
    const fake = new FakeAnkiConnect();
    const realFetch = createFakeFetch(fake);
    let loseReplacementReply = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const action = JSON.parse(String(init?.body)) as { action?: string };
      const reply = await realFetch(input, init);
      if (loseReplacementReply && action.action === "addNotes") {
        loseReplacementReply = false;
        // Anki performed the mutation; the caller cannot know that its HTTP
        // response was lost. A future sync must discover the existing note.
        throw new TypeError("the response vanished after addNotes committed");
      }
      return reply;
    };
    const client = createAnkiClient({ fetchImpl });
    const run = (cards: AnkiCard[], state: LinkState) => syncCardsToAnki({
      client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
    });
    const initial = await run([card("a")], emptyLinkState());
    expect(initial.report).toMatchObject({ added: 1, offline: false });

    const converted = [card("a", { type: "cloze", front: "{{c1::Renal}} clearance", back: "" })];
    loseReplacementReply = true;
    const uncertain = await run(converted, initial.state);
    expect(uncertain.report).toMatchObject({ offline: true, added: 0 });
    expect(fake.notes.size).toBe(2); // original Basic plus committed Cloze
    expect(uncertain.state.links.a.noteId).toBe(initial.state.links.a.noteId);

    const retry = await run(converted, uncertain.state);
    expect(retry.report).toMatchObject({ added: 0, conflicts: 1, offline: false });
    expect(retry.state.links.a.issue?.kind).toBe("conflict");
    expect(fake.notes.size).toBe(2); // no third note with the same AxomId
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
  });

  it("does not relink the old Basic note as a new Cloze when an addNotes batch partially fails", async () => {
    const h = harness({ addNotesFailure: "throw" });
    const original = card("a");
    expect(await h.run([original])).toMatchObject({ added: 1 });
    const originalId = h.state.links.a.noteId;
    const invalidCloze = card("a", { type: "cloze", front: "missing a cloze deletion", back: "" });

    const report = await h.run([invalidCloze]);
    expect(report).toMatchObject({ replaced: 0, failed: 1 });
    expect(h.state.links.a).toMatchObject({ noteId: originalId, kind: "basic" });
    expect(h.fake.notes.size).toBe(1); // invalid replacement never existed
    expect(h.fake.call("areSuspended", { cards: h.state.links.a.cardIds })).toEqual([false]);
  });

  it("does not mistake intentionally retired note types for an uncertain new replacement", async () => {
    const h = harness();
    const basic = card("a");
    const cloze = card("a", { type: "cloze", front: "{{c1::Card}} A", back: "" });
    const first = await h.run([basic]);
    expect(first.added).toBe(1);
    const originalId = h.state.links.a.noteId;

    const second = await h.run([cloze]);
    expect(second).toMatchObject({ replaced: 1, conflicts: 0 });
    const clozeId = h.state.links.a.noteId;
    expect(h.state.links.a.retiredNoteIds).toEqual([originalId]);

    const third = await h.run([basic]);
    expect(third).toMatchObject({ replaced: 1, conflicts: 0 });
    expect(h.state.links.a.noteId).not.toBe(originalId);
    expect(h.state.links.a.retiredNoteIds).toEqual([originalId, clozeId]);
    expect(h.fake.notes.size).toBe(3); // historical notes remain, but no accidental conflict
  });

  it("persists and retries unfinished old-note retirement after a suspension fails before applying", async () => {
    const { fake, run } = interruptedRetirement("before");
    const original = await run([card("a")], emptyLinkState());
    const old = original.state.links.a;
    const converted = [card("a", { type: "cloze", front: "{{c1::Kidney}} function", back: "" })];

    const interrupted = await run(converted, original.state);
    expect(interrupted.report).toMatchObject({ replaced: 1, offline: true, pending: 1, deletedSuspended: 0 });
    expect(interrupted.state.links.a.kind).toBe("cloze");
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([false]);
    const restored = normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state)));
    expect(restored.pendingRetirements).toEqual([{
      axomId: "a", noteId: old.noteId, cardIds: old.cardIds, at: expect.any(String),
    }]);
    expect(cardSyncStatus("a", desiredNotes(converted, catalog, DEFAULT_DECK_LAYOUT).get("a")!.fingerprint, restored)).toBe("pending");

    const resumed = await run(converted, restored);
    expect(resumed.report).toMatchObject({ replaced: 0, pending: 0, offline: false, deletedSuspended: 0 });
    expect(resumed.state.pendingRetirements).toEqual([]);
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([true]);
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
    expect(fake.notes.size).toBe(2);
  });

  it("confirms an applied suspension after its HTTP response vanished without replaying the write", async () => {
    const { fake, run } = interruptedRetirement("after");
    const original = await run([card("a")], emptyLinkState());
    const old = original.state.links.a;
    const converted = [card("a", { type: "cloze", front: "{{c1::Kidney}} function", back: "" })];
    const interrupted = await run(converted, original.state);
    expect(interrupted.report).toMatchObject({ replaced: 1, offline: true, pending: 1 });
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([true]);
    const suspendCount = fake.actionsCalled("suspend").length;

    const recovered = await run(converted, normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state))));
    expect(recovered.report).toMatchObject({ replaced: 0, pending: 0, deletedSuspended: 0 });
    expect(recovered.state.pendingRetirements).toEqual([]);
    expect(fake.actionsCalled("suspend")).toHaveLength(suspendCount);
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
  });

  it("holds a corrupted duplicate-card retirement receipt without suspending a different card, then recovers", async () => {
    const { fake, run } = interruptedRetirement("before");
    const original = await run([card("a", { type: "basic-reversed" })], emptyLinkState());
    const old = original.state.links.a;
    expect(old.cardIds).toHaveLength(2);
    const converted = [card("a", { type: "cloze", front: "{{c1::Kidney}} function", back: "" })];
    const interrupted = await run(converted, original.state);
    expect(interrupted.report).toMatchObject({ replaced: 1, offline: true, pending: 1 });
    const duplicate = normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state)));
    duplicate.pendingRetirements![0].cardIds = [old.cardIds[0], old.cardIds[0]];
    const before = fake.actionsCalled("suspend").length;
    const held = await run(converted, duplicate);
    expect(held.report.error).toMatch(/old note\/card identity changed/);
    expect(held.report).toMatchObject({ pending: 1, deletedSuspended: 0 });
    expect(held.state.pendingRetirements).toHaveLength(1);
    expect(fake.actionsCalled("suspend")).toHaveLength(before);
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([false, false]);

    // Recover from intact persisted state; retry does not add another note.
    const restored = normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state)));
    const resumed = await run(converted, restored);
    expect(resumed.report).toMatchObject({ pending: 0, deletedSuspended: 0, replaced: 0, offline: false });
    expect(resumed.state.pendingRetirements).toEqual([]);
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([true, true]);
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
  });

  it("quarantines corrupted persisted old-note receipts before Anki can suspend or clear them", async () => {
    const { fake, run } = interruptedRetirement("before");
    const original = await run([card("a")], emptyLinkState());
    const old = original.state.links.a;
    const converted = [card("a", { type: "cloze", front: "{{c1::Kidney}} function", back: "" })];
    const interrupted = await run(converted, original.state);
    expect(interrupted.report).toMatchObject({ replaced: 1, offline: true, pending: 1 });

    // These were persisted JSON, not mutations after normalizeLinkState. The
    // previous normalizer silently discarded invalid IDs and even empty rows.
    for (const malformed of [[old.cardIds[0], "bad"], [], [old.cardIds[0], old.cardIds[0]], ["bad"]]) {
      const saved = JSON.parse(JSON.stringify(interrupted.state)) as LinkState;
      (saved.pendingRetirements![0] as unknown as { cardIds: unknown[] }).cardIds = malformed;
      const restored = normalizeLinkState(saved);
      expect(restored.pendingRetirements).toHaveLength(1);
      expect(restored.pendingRetirements![0].quarantinedCardIds).toEqual(malformed);
      expect(cardSyncStatus("a", desiredNotes(converted, catalog, DEFAULT_DECK_LAYOUT).get("a")!.fingerprint, restored)).toBe("pending");

      const suspendsBefore = fake.actionsCalled("suspend").length;
      const held = await run(converted, restored);
      expect(held.report.error).toMatch(/corrupt.*card.*receipt/i);
      expect(held.report).toMatchObject({ pending: 1, deletedSuspended: 0, replaced: 0 });
      expect(fake.actionsCalled("suspend")).toHaveLength(suspendsBefore);
      expect(fake.actionsCalled("addNotes")).toHaveLength(2);
      expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([false]);
      const resaved = normalizeLinkState(JSON.parse(JSON.stringify(held.state)));
      expect(resaved.pendingRetirements).toHaveLength(1);
      expect(resaved.pendingRetirements![0].quarantinedCardIds).toEqual(malformed);
    }

    // Intact receipt resumes without adding another replacement note.
    const valid = normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state)));
    const resumed = await run(converted, valid);
    expect(resumed.report).toMatchObject({ pending: 0, replaced: 0, offline: false });
    expect(resumed.state.pendingRetirements).toEqual([]);
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([true]);
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
  });

  it("keeps only the incomplete receipt when a multi-note replacement stops midway", async () => {
    const fake = new FakeAnkiConnect();
    const realFetch = createFakeFetch(fake);
    let suspendCount = 0;
    const client = createAnkiClient({ fetchImpl: (async (input, init) => {
      const action = JSON.parse(String(init?.body)) as { action?: string };
      if (action.action === "suspend" && ++suspendCount === 2)
        throw new TypeError("Anki disconnected between retirements");
      return realFetch(input, init);
    }) as typeof fetch });
    const run = (cards: AnkiCard[], state: LinkState) => syncCardsToAnki({
      client, cards, catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state,
    });
    const original = await run([card("a"), card("b")], emptyLinkState());
    const converted = [
      card("a", { type: "cloze", front: "{{c1::A}} card", back: "" }),
      card("b", { type: "cloze", front: "{{c1::B}} card", back: "" }),
    ];
    const interrupted = await run(converted, original.state);
    expect(interrupted.report).toMatchObject({ replaced: 2, offline: true, pending: 1 });
    expect(interrupted.state.pendingRetirements?.map((item) => item.axomId)).toEqual(["b"]);
    expect(fake.call("areSuspended", { cards: original.state.links.a.cardIds })).toEqual([true]);
    expect(fake.call("areSuspended", { cards: original.state.links.b.cardIds })).toEqual([false]);
    const restored = normalizeLinkState(JSON.parse(JSON.stringify(interrupted.state)));
    const resolved = await run(converted, restored);
    expect(resolved.report).toMatchObject({ replaced: 0, pending: 0, deletedSuspended: 0 });
    expect(resolved.state.pendingRetirements).toEqual([]);
    expect(fake.call("areSuspended", { cards: original.state.links.b.cardIds })).toEqual([true]);
    expect(fake.actionsCalled("addNotes")).toHaveLength(2);
  });

  it("holds retirement when a reused note ID has a different AXOM ID; deletion keeps receipts", async () => {
    const { fake, run } = interruptedRetirement("before");
    const original = await run([card("a")], emptyLinkState());
    const old = original.state.links.a;
    const converted = [card("a", { type: "cloze", front: "{{c1::A}} card", back: "" })];
    const interrupted = await run(converted, original.state);
    const deleted = recordAxomDeletion(interrupted.state, "a", "leave");
    expect(deleted.pendingRetirements).toHaveLength(1);
    fake.call("updateNoteFields", { note: { id: old.noteId, fields: { AxomId: "another-profile" } } });

    const held = await run([], normalizeLinkState(JSON.parse(JSON.stringify(deleted))));
    expect(held.report.error).toMatch(/identity changed/);
    expect(held.report).toMatchObject({ deletedSuspended: 0, pending: 1 });
    expect(held.state.pendingRetirements).toHaveLength(1);
    expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([false]);
    expect(fake.actionsCalled("suspend")).toHaveLength(0);
  });

  it("retires the former note after AXOM deletion without double-counting delete suspension", async () => {
    for (const policy of ["leave", "suspend"] as const) {
      const { fake, run } = interruptedRetirement("before");
      const original = await run([card("a")], emptyLinkState());
      const old = original.state.links.a;
      const converted = [card("a", { type: "cloze", front: "{{c1::Tubule}} transport", back: "" })];
      const interrupted = await run(converted, original.state);
      expect(interrupted.report).toMatchObject({ offline: true, replaced: 1, pending: 1 });
      const replacementCards = interrupted.state.links.a.cardIds;
      const deleted = recordAxomDeletion(interrupted.state, "a", policy);
      const restored = normalizeLinkState(JSON.parse(JSON.stringify(deleted)));

      const resolved = await run([], restored);
      expect(resolved.report).toMatchObject({
        offline: false, replaced: 0, pending: 0, deletedSuspended: policy === "suspend" ? 1 : 0,
      });
      expect(resolved.state.pendingRetirements).toEqual([]);
      expect(resolved.state.pendingSuspends).toEqual([]);
      expect(fake.call("areSuspended", { cards: old.cardIds })).toEqual([true]);
      expect(fake.call("areSuspended", { cards: replacementCards })).toEqual([policy === "suspend"]);
      expect(fake.notes.size).toBe(2); // both kept, never deleted
      expect(fake.actionsCalled("deleteNotes")).toEqual([]);
    }
  });

  it("creates the reverse card for basic-reversed cards", async () => {
    const h = harness();
    await h.run([card("a")]);
    expect(h.state.links.a.cardIds).toHaveLength(1);
    await h.run([card("a", { type: "basic-reversed" })]);
    expect(h.state.links.a.cardIds).toHaveLength(2);
    expect(h.noteOf("a")!.cards).toEqual(h.state.links.a.cardIds);
  });

  it("records per-card failures with Anki's reason, in both addNotes styles", async () => {
    for (const addNotesFailure of ["nulls", "throw"] as const) {
      const h = harness({ addNotesFailure });
      // A cloze note with no deletion would make an empty card; Anki refuses it.
      const bad = card("bad", { type: "cloze", front: "no deletion here", back: "" });
      const report = await h.run([card("ok"), bad, card("ok2", { front: "Question ok?" })]);
      expect(report).toMatchObject({ added: 2, failed: 1 });
      expect(report.failures[0]).toMatchObject({ cardId: "bad", message: expect.stringMatching(/empty/) });
      expect(h.fake.call<number[]>("findNotes", { query: "tag:AXOM" })).toHaveLength(2);
      const fp = desiredNotes([bad], catalog, DEFAULT_DECK_LAYOUT).get("bad")!.fingerprint;
      expect(cardSyncStatus("bad", fp, h.state)).toBe("failed");
      // Unchanged failures are not retried on every automatic sync.
      const adds = h.fake.actionsCalled("addNotes").length;
      await h.run([card("ok"), bad, card("ok2", { front: "Question ok?" })]);
      expect(h.fake.actionsCalled("addNotes").length).toBe(adds);
    }
  });

  it("works through an API key and an origin Anki had to approve", async () => {
    const fake = new FakeAnkiConnect({ apiKey: "k", webCorsOriginList: [] });
    const client = createAnkiClient({ apiKey: "k", fetchImpl: createFakeFetch(fake, { origin: "tauri://localhost" }) });
    await client.call("requestPermission");
    const { report } = await syncCardsToAnki({ client, cards: [card("a")], catalog, layout: DEFAULT_DECK_LAYOUT, deletePolicy: "ask", state: emptyLinkState() });
    expect(report).toMatchObject({ added: 1, failed: 0 });
    expect(fake.permissionPrompts).toEqual(["tauri://localhost"]);
  });

  it("explains a same-named note type that lacks AXOM's fields", async () => {
    const h = harness();
    h.fake.call("createModel", { modelName: "AXOM Basic", inOrderFields: ["Front", "Back"], cardTemplates: [{ Front: "{{Front}}", Back: "{{Back}}" }] });
    const report = await h.run([card("a")]);
    expect(report.error).toMatch(/Rename that note type/);
    expect(report.added).toBe(0);
    expect(h.fake.notes.size).toBe(0);
  });
});
