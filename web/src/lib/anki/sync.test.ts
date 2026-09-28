import { describe, expect, it } from "vitest";
import { createAnkiClient } from "../ankiConnect";
import { newSchedule, type AnkiCard } from "../ankiCards";
import type { Course } from "../types";
import { buildCourseCatalog } from "./courseAdapter";
import { DEFAULT_DECK_LAYOUT } from "./deckLayout";
import { createFakeFetch, FakeAnkiConnect } from "./fake/fakeAnkiConnect";
import {
  acceptAnkiVersion, emptyLinkState, excludeFromAnki, includeInAnki, keepAxomVersion, recordAxomDeletion, type LinkState,
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
    expect(a).toMatchObject({ modelName: "AXOM Basic", tags: ["AXOM", "AXOM::bpm-501::nb3", "high_yield"] });
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
