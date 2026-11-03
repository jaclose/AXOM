import { describe, expect, it } from "vitest";
import { createAnkiClient } from "../ankiConnect";
import type { Course, Term, TrackerItem } from "../types";
import { buildCourseCatalog } from "./courseAdapter";
import { createFakeFetch, FakeAnkiConnect } from "./fake/fakeAnkiConnect";
import {
  availableModuleWeeks, createTermDecks, previewPremadeUnsuspend, termDeckPaths, unsuspendPreviewedCards,
  validateAnkiScope, type PremadeScopeLink,
} from "./termLinks";

const terms: Term[] = [{ id: "t1", name: "Term 1" }, { id: "t2", name: "Term 2" }];
const courses: Course[] = [
  { id: "c1", termId: "t1", code: "BPM 500", name: "Principles I", files: 0, modules: [{ id: "ftm", name: "FTM 1" }] },
  { id: "c2", termId: "t2", code: "BPM 501", name: "Principles II", files: 0, modules: [{ id: "nb3", name: "NB3" }] },
];
const tracker: TrackerItem[] = [2, 3].map((week) => ({
  id: `week-${week}`, path: `Term 2/BPM 501/NB3/Week ${week}`, label: `Lecture ${week}`,
  kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "",
}));
const catalog = buildCourseCatalog({ terms, courses, tracker });
const link: PremadeScopeLink = {
  scope: { kind: "week", termId: "t2", courseId: "c2", moduleId: "nb3", week: 2 },
  deckName: "AnKing Step 1", tag: "#AK_Step1::AXOM::NB3::Week2",
};

function harness() {
  const fake = new FakeAnkiConnect();
  const client = createAnkiClient({ fetchImpl: createFakeFetch(fake) });
  return { fake, client };
}

describe("AXOM term decks and AnKing links", () => {
  it("uses real tracker weeks and creates only empty AXOM term decks", async () => {
    expect(availableModuleWeeks(catalog, "nb3")).toEqual([2, 3]);
    expect(() => validateAnkiScope(catalog, { kind: "week", termId: "t2", courseId: "c2", moduleId: "nb3", week: 4 })).toThrow(/not in this module/);
    expect(termDeckPaths(catalog, "t2")).toEqual(["AXOM::Term 2", "AXOM::Term 2::BPM 501", "AXOM::Term 2::BPM 501::NB3"]);
    const { fake, client } = harness();
    const [cardId] = fake.seedPremadeDeck("AnKing Step 1", [{ text: "{{c1::Sample}}", tags: [link.tag] }]);
    const before = fake.call<Array<{ deckName: string; interval: number; factor: number; reps: number }>>("cardsInfo", { cards: [cardId] });
    const result = await createTermDecks(client, catalog, "t2", "User 1");
    expect(result.created).toEqual(result.paths);
    expect((await createTermDecks(client, catalog, "t2", "User 1")).created).toEqual([]);
    expect(fake.call("cardsInfo", { cards: [cardId] })).toMatchObject(before);
    await expect(createTermDecks(client, catalog, "t2", "Another profile")).rejects.toThrow(/changed profiles/);
  });

  it("previews exact suspended IDs and unsuspends only matching premade cards with readback", async () => {
    const { fake, client } = harness();
    const ids = fake.seedPremadeDeck("AnKing Step 1", [
      { text: "{{c1::A}}", tags: [link.tag] },
      { text: "{{c1::B}}", tags: [`${link.tag}::extra`] },
      { text: "{{c1::C}}", tags: ["#AK_Step1::AXOM::NB3::Week3"] },
      { text: "{{c1::D}}", tags: [link.tag] },
    ]);
    fake.call("suspend", { cards: ids.slice(0, 3) });
    const before = fake.call<Array<{ deckName: string; interval: number; factor: number; reps: number; note: number }>>("cardsInfo", { cards: ids });
    const preview = await previewPremadeUnsuspend(client, catalog, link);
    expect(preview.cardIds).toEqual(ids.slice(0, 2).sort((a, b) => a - b));
    expect(preview.axomTag).toBe("AXOM::term-2::bpm-501::nb3::week-2");
    const receipt = await unsuspendPreviewedCards(client, catalog, preview);
    expect(receipt).toMatchObject({ profile: "User 1", axomTag: preview.axomTag, complete: true, requestedCardIds: preview.cardIds, stillSuspendedCardIds: [] });
    expect(fake.call("areSuspended", { cards: ids })).toEqual([false, false, true, false]);
    const after = fake.call<typeof before>("cardsInfo", { cards: ids });
    expect(after.map(({ deckName, interval, factor, reps, note }) => ({ deckName, interval, factor, reps, note })))
      .toEqual(before.map(({ deckName, interval, factor, reps, note }) => ({ deckName, interval, factor, reps, note })));
    await expect(unsuspendPreviewedCards(client, catalog, preview)).rejects.toThrow(/changed/);
  });

  it("refuses a stale or invalid scope before any mutation", async () => {
    const { fake, client } = harness();
    const ids = fake.seedPremadeDeck("AnKing Step 1", [
      { text: "{{c1::A}}", tags: [link.tag] },
      { text: "{{c1::B}}", tags: [link.tag] },
    ]);
    fake.call("suspend", { cards: ids });
    const preview = await previewPremadeUnsuspend(client, catalog, link);
    fake.call("unsuspend", { cards: [ids[0]] });
    await expect(unsuspendPreviewedCards(client, catalog, preview)).rejects.toThrow(/changed/);
    await expect(unsuspendPreviewedCards(client, catalog, { ...preview, query: "is:suspended" })).rejects.toThrow(/no longer matches/);
    await expect(unsuspendPreviewedCards(client, catalog, { ...preview, axomTag: "AXOM::other" })).rejects.toThrow(/scope tag changed/);
    expect(fake.call("areSuspended", { cards: ids })).toEqual([false, true]);
    await expect(previewPremadeUnsuspend(client, catalog, { ...link, scope: { kind: "week", termId: "t2", courseId: "c2", moduleId: "nb3", week: 9 } })).rejects.toThrow(/not in this module/);
    await expect(previewPremadeUnsuspend(client, catalog, { ...link, tag: "two tags" })).rejects.toThrow(/one exact Anki tag/);
    await expect(previewPremadeUnsuspend(client, catalog, { ...link, deckName: "Missing" })).rejects.toThrow(/not in the current Anki profile/);
  });
});
