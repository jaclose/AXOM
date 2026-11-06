// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingUrl } from "./engine";
import { DEFAULT_SOUNDSCAPE_ID, DEFAULT_SOUNDSCAPE_VERSION, SOUNDSCAPES, isSoundscapeId } from "./presets";
import { DEFAULT_MAIN_SOUND, readPrefs, SOUNDSCAPE_PREFS_KEY, useSoundscape } from "./store";

afterEach(() => localStorage.clear());

describe("main sound preferences", () => {
  it("initializes the bundled sound first without starting playback", () => {
    const prefs = readPrefs();
    expect(prefs.mainSound).toEqual(DEFAULT_MAIN_SOUND);
    expect(prefs.pinned[0]).toBe(DEFAULT_SOUNDSCAPE_ID);
    expect(SOUNDSCAPES[DEFAULT_SOUNDSCAPE_ID].versions[0]).toMatchObject({ id: DEFAULT_SOUNDSCAPE_VERSION, src: expect.stringContaining("axom-soundscape-1.m4a") });
    const version = SOUNDSCAPES[DEFAULT_SOUNDSCAPE_ID].versions[0];
    expect("src" in version && recordingUrl(version.src, "/")).toBe("/soundscapes/axom-soundscape-1.m4a");
    expect("src" in version && recordingUrl(version.src, "/axom/")).toBe("/axom/soundscapes/axom-soundscape-1.m4a");
    expect(useSoundscape.getState().status).toBe("idle");
  });

  it("migrates existing preferences once while preserving their choices", () => {
    localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ pinned: ["alpha-10"], lastPresetId: "beta-20", volume: 14 }));
    expect(readPrefs()).toMatchObject({ pinned: ["axom-1", "alpha-10"], lastPresetId: "beta-20", volume: 14, mainSound: DEFAULT_MAIN_SOUND });
    const migrated = JSON.parse(localStorage.getItem(SOUNDSCAPE_PREFS_KEY)!);
    migrated.pinned = ["alpha-10"];
    localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify(migrated));
    expect(readPrefs().pinned).toEqual(["alpha-10"]);
  });

  it("preserves an explicit main selection and does not play when changing it", () => {
    localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ mainSound: { presetId: "alpha-10", versionId: "ocean" } }));
    expect(readPrefs().mainSound).toEqual({ presetId: "alpha-10", versionId: "ocean" });
    const play = vi.spyOn(useSoundscape.getState(), "play");
    useSoundscape.getState().setMainSound("alpha-10", "ocean");
    expect(play).not.toHaveBeenCalled();
    expect(readPrefs().mainSound).toEqual({ presetId: "alpha-10", versionId: "ocean" });
    play.mockRestore();
  });

  it("rejects inherited object names in stored preset choices", () => {
    expect(isSoundscapeId("constructor")).toBe(false);
    expect(isSoundscapeId("__proto__")).toBe(false);
    localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ mainSound: { presetId: "constructor", versionId: "anything" }, lastPresetId: "__proto__", pinned: ["constructor", "alpha-10"] }));
    expect(readPrefs()).toMatchObject({ mainSound: DEFAULT_MAIN_SOUND, lastPresetId: DEFAULT_SOUNDSCAPE_ID, pinned: [DEFAULT_SOUNDSCAPE_ID, "alpha-10"] });
  });
});
