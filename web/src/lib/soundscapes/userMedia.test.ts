import { afterEach, describe, expect, it } from "vitest";
import { labelFromFileName, validateUserFile, MAX_USER_SOUND_BYTES } from "./userMedia";
import { SOUNDSCAPES, applyUserSounds, isPlayable, versionOf } from "./presets";
import { SCENES, applyUserScenes, sceneById, sceneUrl } from "./scenes";

describe("your own sounds and backgrounds", () => {
  afterEach(() => {
    applyUserSounds([]);
    applyUserScenes([]);
  });

  it("turns file names into readable labels", () => {
    expect(labelFromFileName("Super_Focus_Flow.mp3")).toBe("Super Focus Flow");
    expect(labelFromFileName(".m4a")).toBe("Untitled");
  });

  it("accepts audio up to the limit and explains refusals plainly", () => {
    expect(validateUserFile({ type: "audio/mpeg", size: 1024 }, "sound")).toBeNull();
    expect(validateUserFile({ type: "image/png", size: 1024 }, "sound")).toMatch(/audio file/);
    expect(validateUserFile({ type: "audio/mpeg", size: MAX_USER_SOUND_BYTES + 1 }, "sound")).toMatch(/limit/);
    expect(validateUserFile({ type: "image/jpeg", size: 2048 }, "scene")).toBeNull();
  });

  it("puts a file in front of the preset it belongs to, and restores the preset when removed", () => {
    const before = SOUNDSCAPES["alpha-10"].versions.length;
    applyUserSounds([{ id: "a1", name: "Alpha mix", presetId: "alpha-10", url: "blob:alpha" }]);
    expect(SOUNDSCAPES["alpha-10"].versions[0]).toMatchObject({ id: "user-a1", label: "Alpha mix", src: "blob:alpha", userFile: true });
    expect(versionOf(SOUNDSCAPES["alpha-10"]).id).toBe("user-a1");
    applyUserSounds([]);
    expect(SOUNDSCAPES["alpha-10"].versions).toHaveLength(before);
  });

  it("keeps an empty Your sounds shelf unplayable and files without a home on it", () => {
    expect(isPlayable("yours")).toBe(false);
    applyUserSounds([{ id: "b2", name: "Mix", presetId: "nope", url: "blob:mix" }]);
    expect(isPlayable("yours")).toBe(true);
    expect(SOUNDSCAPES.yours.versions[0].id).toBe("user-b2");
  });

  it("adds your backgrounds first and resolves blob URLs untouched", () => {
    applyUserScenes([{ id: "s1", name: "My desk", url: "blob:desk", image: true }]);
    expect(SCENES[0]).toMatchObject({ id: "user-s1", genre: "yours", image: true });
    expect(sceneById("user-s1")?.label).toBe("My desk");
    expect(sceneUrl("blob:desk")).toBe("blob:desk");
  });
});
