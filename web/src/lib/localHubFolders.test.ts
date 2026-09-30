// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { localHubFolderPath, localizeHubFolder } from "./localHubFolders";
import { toPortableState } from "./backup";
import { makeSeed } from "./seed";
import { useStore } from "./store";
beforeEach(() => localStorage.clear());
it("migrates legacy paths additively and keeps the workspace portable", () => {
  const legacy = { id: "study", name: "Study", localPath: "/Users/jafar/Documents/Study" };
  const migrated = localizeHubFolder(legacy);
  expect(migrated.localPath).toBeUndefined();
  expect(localHubFolderPath(migrated)).toBe(legacy.localPath);
  expect(localizeHubFolder({ ...legacy, localPath: "/Other/Machine" })).toEqual(migrated);
  expect(localHubFolderPath(migrated)).toBe(legacy.localPath);
  expect(toPortableState({ ...makeSeed(), folders: [legacy] }).folders[0].localPath).toBeUndefined();
});
it("allows intentional path changes and removal without restoring an old synced location", () => {
  const folder = { id: "study", name: "Study", localPath: "/Users/jafar/Study" };
  localizeHubFolder(folder);
  localizeHubFolder({ ...folder, localPath: "/Volumes/Study" }, true);
  expect(localHubFolderPath(folder)).toBe("/Volumes/Study");
  localizeHubFolder({ ...folder, localPath: "" }, true);
  expect(localHubFolderPath(folder)).toBeUndefined();
});
it("migrates same-schema vault hydration without losing a path on storage failure", () => {
  const folder = { id: "same-schema", name: "Study", localPath: "/Users/jafar/Study" };
  const merge = useStore.persist.getOptions().merge!;
  const restored = merge({ ...makeSeed(), folders: [folder] }, useStore.getState());
  expect(restored.folders[0].localPath).toBeUndefined();
  expect(localHubFolderPath(restored.folders[0])).toBe(folder.localPath);
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try {
    const blocked = { ...folder, id: "blocked" };
    expect(localizeHubFolder(blocked)).toEqual(blocked);
    expect(toPortableState({ ...makeSeed(), folders: [blocked] }).folders[0].localPath).toBeUndefined();
  } finally { failure.mockRestore(); }
});
