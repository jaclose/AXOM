// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUNDSCAPES, applyUserSounds, lookFor, versionOf } from "./presets";
import { DEFAULT_MAIN_SOUND, useSoundscape } from "./store";
import { USER_MEDIA_DB, USER_MEDIA_DETAILS_KEY, useUserMedia } from "./userMedia";
import { assignUserSound, homeOf, renameUserSound, syncUserSoundCatalog, userVersionId } from "./userSounds";

const mp3 = (name: string) => new File([new Uint8Array(64)], name, { type: "audio/mpeg" });

/** What the audio database itself holds for a file (never rewritten by edits). */
function storedRecord(id: string): Promise<{ name: string; presetId?: string; blob: Blob } | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(USER_MEDIA_DB, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction("files", "readonly").objectStore("files").get(id);
      request.onsuccess = () => { open.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  });
}

/** A new visit: nothing in memory, everything read back from the device. */
async function reload() {
  useUserMedia.setState({ loaded: false, items: [], urls: {} });
  await useUserMedia.getState().load();
}

beforeEach(async () => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => `blob:test-${Math.random().toString(36).slice(2)}`);
  URL.revokeObjectURL = vi.fn();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(USER_MEDIA_DB);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  useUserMedia.setState({ loaded: true, items: [], urls: {}, error: undefined });
  useSoundscape.setState({ status: "idle", presetId: null, versions: {}, lastPresetId: "gamma-40", mainSound: DEFAULT_MAIN_SOUND });
});

afterEach(() => applyUserSounds([]));

describe("your sounds: rename and what a sound plays for", () => {
  it("renames at once, keeps the name after a reload, and never rewrites the audio", async () => {
    const added = await useUserMedia.getState().add(mp3("Study_Mix.mp3"), "sound", "yours");
    expect(added?.name).toBe("Study Mix");
    renameUserSound(added!.id, "  Alpha   waves ");
    expect(useUserMedia.getState().items[0].name).toBe("Alpha waves");
    expect(SOUNDSCAPES.yours.versions[0]).toMatchObject({ id: userVersionId(added!.id), label: "Alpha waves" });

    expect((await storedRecord(added!.id))?.name).toBe("Study Mix");
    await reload();
    expect(useUserMedia.getState().items[0].name).toBe("Alpha waves");
  });

  it("ignores an empty name", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    renameUserSound(added!.id, "   ");
    expect(useUserMedia.getState().items[0].name).toBe("Mix");
  });

  it("assigning makes the file what that preset plays, even over an earlier pick, and survives a reload", async () => {
    const added = await useUserMedia.getState().add(mp3("Alpha.mp3"), "sound", "yours");
    const version = userVersionId(added!.id);
    // The learner has played 40 Hz Gamma before, so a pick is already saved for it.
    useSoundscape.setState({ versions: { "gamma-40": SOUNDSCAPES["gamma-40"].versions[0].id, yours: version } });

    expect(assignUserSound(added!.id, "gamma-40")).toEqual({ sound: "Alpha", preset: SOUNDSCAPES["gamma-40"].name });
    expect(homeOf(useUserMedia.getState().items[0])).toBe("gamma-40");
    expect(SOUNDSCAPES["gamma-40"].versions[0].id).toBe(version);
    expect(useSoundscape.getState().versions).toMatchObject({ "gamma-40": version });
    expect(useSoundscape.getState().versions.yours).toBeUndefined();

    await reload();
    expect(homeOf(useUserMedia.getState().items[0])).toBe("gamma-40");
    expect(JSON.parse(localStorage.getItem(USER_MEDIA_DETAILS_KEY)!)[added!.id]).toMatchObject({ presetId: "gamma-40" });
  });

  it("follows the file that is playing instead of restarting it", async () => {
    const added = await useUserMedia.getState().add(mp3("Alpha.mp3"), "sound", "yours");
    const version = userVersionId(added!.id);
    const play = vi.spyOn(useSoundscape.getState(), "play");
    useSoundscape.setState({ status: "playing", presetId: "yours", loadedVersionId: version, versions: { yours: version } });

    assignUserSound(added!.id, "beta-20");
    expect(useSoundscape.getState()).toMatchObject({ status: "playing", presetId: "beta-20", lastPresetId: "beta-20" });
    expect(useSoundscape.getState().versions["beta-20"]).toBe(version);
    expect(play).not.toHaveBeenCalled();

    // Back on its own shelf: still the same audio, still no restart.
    assignUserSound(added!.id, "yours");
    expect(useSoundscape.getState().presetId).toBe("yours");
    expect(useSoundscape.getState().versions["beta-20"]).toBeUndefined();
    expect(assignUserSound(added!.id, "yours")).toBeNull();
  });

  it("preserves the AXOM original when the last personal file moves away", async () => {
    const added = await useUserMedia.getState().add(mp3("Only.mp3"), "sound", "yours");
    useSoundscape.setState({ status: "idle", presetId: null, lastPresetId: "yours", versions: { yours: userVersionId(added!.id) } });
    assignUserSound(added!.id, "alpha-10");
    expect(SOUNDSCAPES.yours.versions.map((version) => version.id)).toEqual(["axom-afterlight"]);
    expect(useSoundscape.getState().lastPresetId).toBe("yours");
    // An actually empty preset still answers with a harmless placeholder.
    expect(versionOf({ ...SOUNDSCAPES.yours, versions: [] }).label).toBe("Nothing here yet");
    expect(lookFor(SOUNDSCAPES.yours).visual).toBe(SOUNDSCAPES.yours.visual);
  });

  it("keeps main identity when a file is renamed and moved", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    const version = userVersionId(added!.id);
    syncUserSoundCatalog();
    useSoundscape.getState().setMainSound("yours", version);
    renameUserSound(added!.id, "Evening");
    assignUserSound(added!.id, "alpha-10");
    expect(useSoundscape.getState().mainSound).toEqual({ presetId: "alpha-10", versionId: version });
    expect(JSON.parse(localStorage.getItem("axom.soundscapes.v1")!).mainSound).toEqual({ presetId: "alpha-10", versionId: version });
  });

  it("restores saved processing details on reload", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    useUserMedia.getState().update(added!.id, { durationSeconds: 93, provenance: "Local original", sourceSize: 64, optimizedSize: 64, percentSaved: 0 });
    await reload();
    expect(useUserMedia.getState().items[0]).toMatchObject({ durationSeconds: 93, provenance: "Local original", sourceSize: 64, optimizedSize: 64, percentSaved: 0 });
  });

  it("never lets optional saved details overwrite file identity or stored size", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    localStorage.setItem(USER_MEDIA_DETAILS_KEY, JSON.stringify({ [added!.id]: { id: "wrong", kind: "scene", size: -1, name: "Evening", durationSeconds: -9, percentSaved: 250 } }));
    await reload();
    expect(useUserMedia.getState().items[0]).toMatchObject({ id: added!.id, kind: "sound", size: 64, name: "Evening", percentSaved: 0 });
    expect(useUserMedia.getState().items[0].durationSeconds).toBeUndefined();
  });

  it("only falls back from a missing main after a successful catalog read", () => {
    const main = { presetId: "yours" as const, versionId: "user-missing" };
    useSoundscape.setState({ mainSound: main });
    useUserMedia.setState({ loaded: false, items: [], urls: {} });
    syncUserSoundCatalog();
    expect(useSoundscape.getState().mainSound).toEqual(main);
    useUserMedia.setState({ loaded: true, error: "Files are temporarily unavailable" });
    syncUserSoundCatalog();
    expect(useSoundscape.getState().mainSound).toEqual(main);
    useUserMedia.setState({ loaded: true, error: undefined });
    syncUserSoundCatalog();
    expect(useSoundscape.getState().mainSound).toEqual(DEFAULT_MAIN_SOUND);
    expect(useSoundscape.getState().status).toBe("idle");
  });

  it("preserves stored bytes and reports a failed delete", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    const fail = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("blocked"); });
    await expect(useUserMedia.getState().remove(added!.id)).rejects.toThrow();
    fail.mockRestore();
    expect(await storedRecord(added!.id)).toMatchObject({ name: "Mix", blob: expect.anything() });
    expect(useUserMedia.getState().items).toHaveLength(1);
    expect(useUserMedia.getState().error).toMatch(/remove/);
  });

  it("reports a quota error without adding a partial file", async () => {
    const fail = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    expect(await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours")).toBeNull();
    fail.mockRestore();
    expect(useUserMedia.getState().items).toEqual([]);
    expect(useUserMedia.getState().error).toMatch(/space/);
  });

  it("forgets the details of a removed sound", async () => {
    const added = await useUserMedia.getState().add(mp3("Mix.mp3"), "sound", "yours");
    renameUserSound(added!.id, "Evening mix");
    await useUserMedia.getState().remove(added!.id);
    expect(localStorage.getItem(USER_MEDIA_DETAILS_KEY)).toBe("{}");
    expect(useUserMedia.getState().items).toEqual([]);
  });
});
