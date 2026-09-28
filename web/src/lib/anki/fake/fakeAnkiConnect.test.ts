import { describe, expect, it } from "vitest";
import { createFakeFetch, FakeAnkiConnect, needsPreflight } from "./fakeAnkiConnect";
import { deckQuery, escapeSearchValue, fieldQuery, mappedTagsQuery, tagQuery } from "../query";

function basicModel(fake: FakeAnkiConnect, name = "Plain") {
  fake.call("createModel", {
    modelName: name,
    inOrderFields: ["Front", "Back", "Reverse"],
    cardTemplates: [
      { Name: "Card 1", Front: "{{Front}}", Back: "{{FrontSide}}<hr>{{Back}}" },
      { Name: "Reverse", Front: "{{#Reverse}}{{Back}}{{/Reverse}}", Back: "{{Front}}" },
    ],
  });
}

describe("fake AnkiConnect collection", () => {
  it("creates nested decks case-insensitively and reuses existing ones", () => {
    const fake = new FakeAnkiConnect();
    const id = fake.call<number>("createDeck", { deck: "AXOM::BPM 501::NB3" });
    expect(fake.call("deckNames")).toEqual(["AXOM", "AXOM::BPM 501", "AXOM::BPM 501::NB3", "Default"]);
    expect(fake.call("createDeck", { deck: "axom::bpm 501::nb3" })).toBe(id);
  });

  it("generates cards from templates, cloze numbers and conditional reverse fields", () => {
    const fake = new FakeAnkiConnect();
    basicModel(fake);
    fake.call("createModel", { modelName: "Clz", inOrderFields: ["Text", "Extra"], isCloze: true, cardTemplates: [{ Front: "{{cloze:Text}}", Back: "{{cloze:Text}} {{Extra}}" }] });
    fake.call("createDeck", { deck: "D" });
    const [one, two, cloze] = fake.call<number[]>("addNotes", { notes: [
      { deckName: "D", modelName: "Plain", fields: { Front: "Q1", Back: "A1" } },
      { deckName: "D", modelName: "Plain", fields: { Front: "Q2", Back: "A2", Reverse: "y" } },
      { deckName: "D", modelName: "Clz", fields: { Text: "{{c1::C3b}} opsonizes; {{c2::MAC}} lyses" } },
    ] });
    const info = fake.call<Array<{ cards: number[] }>>("notesInfo", { notes: [one, two, cloze] });
    expect(info.map((note) => note.cards.length)).toEqual([1, 2, 2]);
    const [card] = fake.call<Array<{ question: string; answer: string }>>("cardsInfo", { cards: [info[2].cards[1]] });
    expect(card.question).toContain("C3b");
    expect(card.question).toContain("[...]");
    expect(card.answer).toContain('<span class="cloze">MAC</span>');
  });

  it("rejects empty and duplicate first fields unless duplicates are allowed", () => {
    const fake = new FakeAnkiConnect();
    basicModel(fake);
    fake.call("createDeck", { deck: "D" });
    fake.call("addNote", { note: { deckName: "D", modelName: "Plain", fields: { Front: "Same", Back: "1" } } });
    expect(() => fake.call("addNote", { note: { deckName: "D", modelName: "Plain", fields: { Front: "<b>Same</b>", Back: "2" } } })).toThrow(/duplicate/);
    expect(() => fake.call("addNote", { note: { deckName: "D", modelName: "Plain", fields: { Front: " ", Back: "2" } } })).toThrow(/empty/);
    expect(() => fake.call("addNote", { note: { deckName: "Nope", modelName: "Plain", fields: { Front: "x" } } })).toThrow(/deck was not found/);
    expect(fake.call("addNote", { note: { deckName: "D", modelName: "Plain", fields: { Front: "Same", Back: "2" }, options: { allowDuplicate: true } } })).toEqual(expect.any(Number));
    expect(fake.call("canAddNotesWithErrorDetail", { notes: [{ deckName: "D", modelName: "Plain", fields: { Front: "Same" } }] }))
      .toEqual([{ canAdd: false, error: "cannot create note because it is a duplicate" }]);
  });

  it("reports failed notes as null, or throws in the newer add-on mode", () => {
    const nulls = new FakeAnkiConnect();
    basicModel(nulls);
    nulls.call("createDeck", { deck: "D" });
    expect(nulls.call("addNotes", { notes: [{ deckName: "D", modelName: "Plain", fields: { Front: "a" } }, { deckName: "D", modelName: "Missing", fields: { Front: "b" } }] }))
      .toEqual([expect.any(Number), null]);
    const throwing = new FakeAnkiConnect({ addNotesFailure: "throw" });
    basicModel(throwing);
    throwing.call("createDeck", { deck: "D" });
    expect(() => throwing.call("addNotes", { notes: [{ deckName: "D", modelName: "Plain", fields: { Front: "a" } }, { deckName: "D", modelName: "Missing", fields: { Front: "b" } }] }))
      .toThrow(/model was not found/);
    // The newer add-on keeps the notes that did succeed.
    expect(throwing.call("findNotes", { query: "deck:D" })).toHaveLength(1);
  });

  it("reads cardReviews for the exact deck only, like the add-on", () => {
    const fake = new FakeAnkiConnect();
    basicModel(fake);
    fake.call("createDeck", { deck: "P::Child" });
    const nid = fake.call<number>("addNote", { note: { deckName: "P::Child", modelName: "Plain", fields: { Front: "q", Back: "a" } } });
    const [cid] = fake.call<Array<{ cards: number[] }>>("notesInfo", { notes: [nid] })[0].cards;
    fake.addReview({ cid, ease: 3, atMs: fake.nowMs() - 1000, lastIvl: 5, ivl: 12 });
    expect(fake.call("cardReviews", { deck: "P", startID: 0 })).toEqual([]);
    expect(fake.call<unknown[]>("cardReviews", { deck: "P::Child", startID: 0 })).toHaveLength(1);
  });
});

describe("fake Anki search", () => {
  function collection() {
    const fake = new FakeAnkiConnect();
    const ids = fake.seedPremadeDeck("AnKing Step 1", [
      { text: "{{c1::Troponin}} rises in MI", tags: ["#AK_Step1_v12::#B&B::Cardio::Ischemia"] },
      { text: "{{c1::Digoxin}} inhibits Na/K ATPase", tags: ["#AK_Step1_v12::#B&B::Cardio::Pharm", "leech"] },
      { text: "{{c1::Dopamine}} in reward", tags: ["#AK_Step1_v12::#B&B::Neuro"] },
      { text: "Under_score {{c1::literal}}", tags: ["AKxStep1"] },
    ]);
    fake.ensureDeck("AnKing Step 1::Sub");
    fake.call("changeDeck", { cards: [ids[3]], deck: "AnKing Step 1::Sub" });
    return { fake, ids };
  }

  it("matches decks with subdecks, tags with children, and escapes wildcards", () => {
    const { fake, ids } = collection();
    expect(fake.findCardIds(deckQuery("AnKing Step 1"))).toEqual(ids);
    expect(fake.findCardIds(deckQuery("AnKing Step 1::Sub"))).toEqual([ids[3]]);
    expect(fake.findCardIds(tagQuery("#AK_Step1_v12::#B&B::Cardio"))).toEqual([ids[0], ids[1]]);
    // "_" is a wildcard unless escaped: AK_Step1 would also match "AKxStep1".
    expect(fake.findCardIds('"tag:AK_Step1"')).toEqual([ids[3]]);
    expect(fake.findCardIds(tagQuery("AK_Step1"))).toEqual([]);
    expect(fake.findCardIds('"tag:#AK_Step1_v12::#B&B::*"')).toEqual([ids[0], ids[1], ids[2]]);
    expect(escapeSearchValue('a"b*c_d\\e')).toBe('a\\"b\\*c\\_d\\\\e');
  });

  it("combines OR, negation, parentheses, is:, prop: and rated:", () => {
    const { fake, ids } = collection();
    fake.makeReviewCard(ids[0], 30, 0);
    fake.makeReviewCard(ids[1], 5, 2, { lapses: 4 });
    fake.call("suspend", { cards: [ids[2]] });
    fake.addReview({ cid: ids[1], ease: 1, atMs: fake.nowMs() - 3 * 86_400_000, lastIvl: 10 });
    const deck = deckQuery("AnKing Step 1");
    expect(fake.findCardIds(`${deck} is:new`)).toEqual([ids[2], ids[3]]);
    expect(fake.findCardIds(`${deck} is:new -is:suspended`)).toEqual([ids[3]]);
    expect(fake.findCardIds(`${deck} prop:ivl>=21`)).toEqual([ids[0]]);
    expect(fake.findCardIds(`${deck} is:due`)).toEqual([ids[0]]);
    expect(fake.findCardIds(`${deck} prop:due=2`)).toEqual([ids[1]]);
    expect(fake.findCardIds(`${deck} prop:lapses>=3`)).toEqual([ids[1]]);
    expect(fake.findCardIds(`${deck} rated:7`)).toEqual([ids[1]]);
    expect(fake.findCardIds(`${deck} rated:2`)).toEqual([]);
    expect(fake.findCardIds(`${deck} (tag:leech OR is:suspended)`)).toEqual([ids[1], ids[2]]);
    expect(fake.findCardIds(mappedTagsQuery(["AnKing Step 1"], ["#AK_Step1_v12::#B&B::Neuro", "leech"]))).toEqual([ids[1], ids[2]]);
    expect(() => fake.call("findCards", { query: "deck:(unbalanced" })).toThrow(/Invalid search/);
  });

  it("finds notes by an exact field value", () => {
    const fake = new FakeAnkiConnect();
    fake.call("createModel", { modelName: "M", inOrderFields: ["Front", "AxomId"], cardTemplates: [{ Front: "{{Front}}", Back: "{{Front}}" }] });
    fake.call("createDeck", { deck: "D" });
    const nid = fake.call<number>("addNote", { note: { deckName: "D", modelName: "M", fields: { Front: "q", AxomId: "card_1" } } });
    fake.call("addNote", { note: { deckName: "D", modelName: "M", fields: { Front: "r", AxomId: "cardX1" } } });
    expect(fake.call("findNotes", { query: fieldQuery("AxomId", "card_1") })).toEqual([nid]);
    expect(fake.call("findNotes", { query: fieldQuery("AxomId", "CARD_1") })).toEqual([nid]);
  });
});

describe("fake AnkiConnect over HTTP", () => {
  const body = (action: string, params: object = {}, key?: string) => JSON.stringify({ action, version: 6, params, ...(key ? { key } : {}) });

  it("trusts 127.0.0.1 origins by default and refuses unknown origins with 403", () => {
    const fake = new FakeAnkiConnect();
    expect(fake.handle({ method: "POST", origin: "http://127.0.0.1:5173", body: body("version") })).toMatchObject({ status: 200, body: '{"result":6,"error":null}' });
    const refused = fake.handle({ method: "POST", origin: "https://axom.example", body: body("version") });
    expect(refused.status).toBe(403);
    expect(refused.headers["Access-Control-Allow-Origin"]).toBe("http://localhost");
  });

  it("lets any origin ask permission; granting adds the origin to the allow-list", () => {
    const fake = new FakeAnkiConnect();
    const asked = fake.handle({ method: "POST", origin: "https://axom.example", body: body("requestPermission") });
    expect(asked.headers["Access-Control-Allow-Origin"]).toBe("https://axom.example");
    expect(JSON.parse(asked.body).result).toMatchObject({ permission: "granted", requireApiKey: false });
    expect(fake.permissionPrompts).toEqual(["https://axom.example"]);
    expect(fake.handle({ method: "POST", origin: "https://axom.example", body: body("version") }).status).toBe(200);
    const denied = new FakeAnkiConnect({ answerPermission: () => "no-and-ignore" });
    expect(JSON.parse(denied.handle({ method: "POST", origin: "https://x.example", body: body("requestPermission") }).body).result).toEqual({ permission: "denied" });
    expect(denied.ignoreOriginList).toEqual(["https://x.example"]);
  });

  it("blocks preflighted requests from untrusted origins, like a browser would", async () => {
    const fake = new FakeAnkiConnect();
    const pageFetch = createFakeFetch(fake, { origin: "https://axom.example" });
    expect(needsPreflight("POST", { "content-type": "application/json" })).toBe(true);
    expect(needsPreflight("POST", {})).toBe(false);
    await expect(pageFetch("http://127.0.0.1:8765", { method: "POST", headers: { "Content-Type": "application/json" }, body: body("requestPermission") })).rejects.toThrow(TypeError);
    const simple = await pageFetch("http://127.0.0.1:8765", { method: "POST", body: body("requestPermission") });
    expect(await simple.json()).toMatchObject({ result: { permission: "granted" } });
  });

  it("checks the API key on every action, including multi sub-actions", () => {
    const fake = new FakeAnkiConnect({ apiKey: "s3cret" });
    expect(JSON.parse(fake.handle({ method: "POST", origin: null, body: body("version") }).body)).toEqual({ result: null, error: "valid api key must be provided" });
    expect(JSON.parse(fake.handle({ method: "POST", origin: null, body: body("requestPermission") }).body).result).toMatchObject({ permission: "granted", requireApiKey: true });
    const multi = JSON.parse(fake.handle({ method: "POST", origin: null, body: body("multi", { actions: [{ action: "version", version: 6, key: "s3cret" }, { action: "version", version: 6 }] }, "s3cret") }).body);
    expect(multi.result).toEqual([{ result: 6, error: null }, { result: null, error: "valid api key must be provided" }]);
  });
});
