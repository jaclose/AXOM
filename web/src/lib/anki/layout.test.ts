import { describe, expect, it } from "vitest";
import type { Course, Term, TrackerItem } from "../types";
import { newSchedule, type AnkiCard } from "../ankiCards";
import { buildCourseCatalog, placeTrackerItem } from "./courseAdapter";
import {
  ankiDeckPathFor, buildDeckTree, DEFAULT_DECK_LAYOUT, normalizeDeckLayout, previewDeckTree, sanitizeDeckRoot, sanitizeDeckSegment,
} from "./deckLayout";
import {
  ankiHtmlToText, axomTagsFor, buildDesiredNote, fieldsHash, noteFingerprint, sanitizeTag, tagSlug, textToAnkiHtml,
} from "./noteBuilder";

const terms: Term[] = [{ id: "t1", name: "Term 1" }, { id: "t2", name: "Term 2" }];
const courses: Course[] = [
  { id: "c500", termId: "t1", code: "BPM 500", name: "Basic Principles of Medicine I", files: 0, modules: [{ id: "m-ftm1", name: "FTM 1" }, { id: "m-msk", name: "MSK" }] },
  { id: "c501", termId: "t2", code: "BPM 501", name: "Basic Principles of Medicine II", files: 0, modules: [{ id: "m-nb3", name: "NB3" }, { id: "m-bsce", name: "BSCE" }] },
  { id: "c-other", termId: "t1", code: "", name: "Anatomy \"Lab\" *", files: 0, modules: [{ id: "m-bsce1", name: "BSCE" }] },
];
const tracker: TrackerItem[] = [
  { id: "l-emotions", path: "T2/NB3/Lectures", label: "NB 58 Emotions", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "" },
  { id: "l-full", path: "Term 1/BPM 500/MSK/Lectures", label: "Rotator cuff", kind: "Lecture", passes: 0, ankiPasses: 1, yield: "none", updated: "" },
  { id: "l-ambiguous", path: "BSCE/Cases", label: "Case 1", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "" },
  { id: "l-term", path: "Term 2/BSCE/Cases", label: "Case 2", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "" },
];
const catalog = buildCourseCatalog({ courses, terms, tracker });

function card(patch: Partial<AnkiCard> = {}): AnkiCard {
  return {
    id: "card-1", type: "basic", front: "Loop diuretic target?", back: "NKCC2", tags: [], aiGenerated: false,
    schedule: newSchedule(new Date("2026-09-01T00:00:00Z")), createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...patch,
  };
}

describe("course adapter", () => {
  it("places tracker items by course code, module name and term", () => {
    expect(catalog.lecture("l-emotions")).toMatchObject({ courseId: "c501", moduleId: "m-nb3" });
    expect(catalog.lecture("l-full")).toMatchObject({ courseId: "c500", moduleId: "m-msk" });
    // "BSCE" exists in two courses; with no term hint the item stays unplaced.
    expect(catalog.lecture("l-ambiguous")?.courseId).toBeUndefined();
    expect(catalog.lecture("l-ambiguous")?.moduleId).toBeUndefined();
    expect(catalog.lecture("l-term")).toMatchObject({ courseId: "c501", moduleId: "m-bsce" });
    expect(catalog.lectures("m-nb3").map((lecture) => lecture.id)).toEqual(["l-emotions"]);
    expect(placeTrackerItem({ path: "" }, catalog.courses)).toEqual({});
  });
});

describe("AXOM deck layout", () => {
  it("files cards by course and module, with an Unsorted fallback", () => {
    expect(ankiDeckPathFor({ courseId: "c501", moduleId: "m-nb3" }, catalog, DEFAULT_DECK_LAYOUT)).toBe("AXOM::BPM 501::NB3");
    expect(ankiDeckPathFor({ courseId: "c501" }, catalog, DEFAULT_DECK_LAYOUT)).toBe("AXOM::BPM 501");
    expect(ankiDeckPathFor({}, catalog, DEFAULT_DECK_LAYOUT)).toBe("AXOM::Unsorted");
    expect(ankiDeckPathFor({ courseId: "gone" }, catalog, DEFAULT_DECK_LAYOUT)).toBe("AXOM::Unsorted");
    // A module from another course is ignored rather than mis-filed.
    expect(ankiDeckPathFor({ courseId: "c500", moduleId: "m-nb3" }, catalog, DEFAULT_DECK_LAYOUT)).toBe("AXOM::BPM 500");
  });

  it("supports names, terms and lecture subdecks, and sanitizes every segment", () => {
    const layout = { root: "Med::AXOM", courseLabel: "code-name" as const, includeTerm: true, lectureDecks: true };
    expect(ankiDeckPathFor({ courseId: "c501", moduleId: "m-nb3", trackerItemId: "l-emotions" }, catalog, layout))
      .toBe("Med::AXOM::Term 2::BPM 501 - Basic Principles of Medicine II::NB3::NB 58 Emotions");
    expect(ankiDeckPathFor({ courseId: "c501", moduleId: "m-nb3", lectureLabel: "Sleep::stages" }, catalog, layout))
      .toBe("Med::AXOM::Term 2::BPM 501 - Basic Principles of Medicine II::NB3::Sleep - stages");
    expect(ankiDeckPathFor({ courseId: "c-other" }, catalog, { ...DEFAULT_DECK_LAYOUT, courseLabel: "name" })).toBe("AXOM::Anatomy Lab");
    expect(sanitizeDeckSegment("  a\u0000b \"c\" * :: d ")).toBe("a b c - d");
    expect(sanitizeDeckSegment("::")).toBe("Untitled");
    expect(sanitizeDeckRoot(' "::"  ')).toBe("AXOM");
    expect(normalizeDeckLayout({ root: "X*", courseLabel: "weird", lectureDecks: 1 })).toEqual({ root: "X", courseLabel: "code", includeTerm: false, lectureDecks: false });
  });

  it("previews the deck tree with counts, Unsorted last", () => {
    const tree = previewDeckTree(catalog, [{ courseId: "c501", moduleId: "m-nb3" }, { courseId: "c501", moduleId: "m-nb3" }, {}], DEFAULT_DECK_LAYOUT, { includeEmptyModules: true });
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root).toMatchObject({ name: "AXOM", total: 3 });
    expect(root.children.map((node) => node.name)).toEqual(["Anatomy Lab", "BPM 500", "BPM 501", "Unsorted"]);
    const bpm501 = root.children[2];
    expect(bpm501.children.map((node) => [node.name, node.count])).toEqual([["BSCE", 0], ["NB3", 2]]);
    expect(buildDeckTree([{ path: "A::b", count: 1 }, { path: "a::B", count: 2 }])[0]).toMatchObject({ total: 3, children: [{ count: 3 }] });
  });
});

describe("note builder", () => {
  it("maps cloze cards to AXOM Cloze and everything else to AXOM Basic", () => {
    const cloze = buildDesiredNote(card({ type: "cloze", front: "{{c1::C3b}} opsonizes", back: "", extra: "Complement", courseId: "c501", moduleId: "m-nb3" }), catalog, DEFAULT_DECK_LAYOUT);
    expect(cloze).toMatchObject({ kind: "cloze", modelName: "AXOM Cloze", deckName: "AXOM::BPM 501::NB3" });
    expect(cloze.fields).toEqual({ Text: "{{c1::C3b}} opsonizes", "Back Extra": "", Extra: "Complement", Source: "", AxomId: "card-1" });
    const reversed = buildDesiredNote(card({ type: "basic-reversed" }), catalog, DEFAULT_DECK_LAYOUT);
    expect(reversed).toMatchObject({ modelName: "AXOM Basic", fields: { Reverse: "y", AxomId: "card-1" } });
    expect(buildDesiredNote(card({ type: "clinical-vignette" }), catalog, DEFAULT_DECK_LAYOUT).fields.Reverse).toBe("");
  });

  it("escapes text as HTML and reads Anki edits back as text", () => {
    expect(textToAnkiHtml("a < b & c\nnext")).toBe("a &lt; b &amp; c<br>next");
    expect(ankiHtmlToText("a &lt; b &amp; c<br>next<div>more&nbsp;text</div>")).toBe("a < b & c\nnext\nmore text");
    expect(ankiHtmlToText(textToAnkiHtml("x > y\n{{c1::z}}"))).toBe("x > y\n{{c1::z}}");
  });

  it("tags notes with AXOM, a course/module slug, and the card's own tags", () => {
    expect(axomTagsFor({ courseId: "c501", moduleId: "m-nb3", trackerItemId: "l-emotions", tags: ["high yield", "Renal", "renal", "leech", "a\"b"] }, catalog))
      .toEqual(["AXOM", "AXOM::bpm-501::nb3::nb-58-emotions", "high_yield", "Renal", "ab"]);
    expect(axomTagsFor({ tags: [] }, catalog)).toEqual(["AXOM"]);
    expect(tagSlug("Émotions & Sleep")).toBe("emotions-and-sleep");
    expect(sanitizeTag(" ::a b:: ")).toBe("a_b");
  });

  it("fingerprints only what reaches Anki", () => {
    const base = buildDesiredNote(card(), catalog, DEFAULT_DECK_LAYOUT);
    const same = buildDesiredNote(card({ updatedAt: "2027-01-01T00:00:00Z", schedule: { ...newSchedule(), reps: 9 } }), catalog, DEFAULT_DECK_LAYOUT);
    expect(noteFingerprint(same)).toBe(noteFingerprint(base));
    expect(noteFingerprint(buildDesiredNote(card({ back: "NKCC2 (TAL)" }), catalog, DEFAULT_DECK_LAYOUT))).not.toBe(noteFingerprint(base));
    expect(noteFingerprint(buildDesiredNote(card({ courseId: "c501" }), catalog, DEFAULT_DECK_LAYOUT))).not.toBe(noteFingerprint(base));
    expect(noteFingerprint(buildDesiredNote(card({ suspended: true }), catalog, DEFAULT_DECK_LAYOUT))).not.toBe(noteFingerprint(base));
    // Decomposed and composed accents hash the same (Anki stores NFC).
    expect(fieldsHash({ Front: "é" }, "basic")).toBe(fieldsHash({ Front: "é" }, "basic"));
  });
});
