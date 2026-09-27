import { describe, expect, it } from "vitest";
import { SOUND_GENRES, VISUAL_GENRES, forYouOrder, normalizeTaste, preferFirst, sceneForTaste } from "./taste";
import { SCENES as PUBLISHED, type Scene } from "./scenes";

const scene = (id: string, genre: Scene["genre"]): Scene => ({ id, label: id, mood: "calm", genre, src: `scenes/${id}.mp4`, poster: `scenes/${id}.jpg` });
const SCENES = [scene("earth", "space"), scene("kelp", "nature"), scene("sea", "waves"), scene("tunnel", "future"), scene("storm", "nature")];

describe("soundscape taste", () => {
  it("normalizes stored picks and drops unknown genres", () => {
    expect(normalizeTaste({ sounds: ["noise", "bogus", "noise"], visuals: ["waves", "neon"], completedAt: "x" })).toEqual({ sounds: ["noise"], visuals: ["waves"], completedAt: "x" });
    expect(normalizeTaste(null)).toEqual({ sounds: [], visuals: [] });
  });

  it("orders For you as pinned first, then picks in pick order", () => {
    expect(forYouOrder({ sounds: ["water", "noise"], visuals: [] }, ["cafe", "ocean"])).toEqual(["cafe", "ocean", "soft-rain", "white-noise", "brown-noise", "fan"]);
    expect(preferFirst(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps a designed scene that fits the taste and otherwise picks from the chosen genres", () => {
    expect(sceneForTaste("alpha", "earth", ["space"], SCENES)).toBe("earth");
    expect(sceneForTaste("alpha", "earth", [], SCENES)).toBe("earth");
    const nature = sceneForTaste("alpha", "earth", ["nature"], SCENES);
    expect(["kelp", "storm"]).toContain(nature);
    expect(sceneForTaste("alpha", "earth", ["nature"], SCENES)).toBe(nature); // stable
    const randomA = sceneForTaste("alpha", "earth", ["random"], SCENES, "seed-1");
    expect(SCENES.map((item) => item.id)).toContain(randomA);
  });

  it("gives every opener tile a published scene, so it never renders blank", () => {
    const published = new Set(PUBLISHED.map((item) => item.id));
    for (const genre of VISUAL_GENRES.filter((option) => option.id !== "random")) {
      expect(genre.lead?.some((id) => published.has(id)), genre.id).toBe(true);
    }
    for (const genre of SOUND_GENRES) expect(published.has(genre.scene), genre.id).toBe(true);
  });
});
