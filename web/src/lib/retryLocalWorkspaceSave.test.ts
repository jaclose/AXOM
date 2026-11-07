// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { localVaultStorage, resetLocalVaultRuntimeForTests } from "./localVault";
import { useStore } from "./store";
import { retryLocalWorkspaceSave } from "./retryLocalWorkspaceSave";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetLocalVaultRuntimeForTests();
  useStore.setState(makeSeed());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retryLocalWorkspaceSave", () => {
  it("confirms the unchanged live workspace after a durable retry", async () => {
    await expect(retryLocalWorkspaceSave()).resolves.toBeUndefined();
  });

  it("does not acknowledge older bytes if the learner edits during read-back", async () => {
    const originalRead = localVaultStorage.getItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "getItem").mockImplementationOnce(async (name) => {
      const recorded = await originalRead(name);
      useStore.getState().updateProfile({ tagline: "Edited during verification" });
      return recorded;
    });

    await expect(retryLocalWorkspaceSave()).rejects.toThrow(/changed during verification/i);
    expect(useStore.getState().profile.tagline).toBe("Edited during verification");
  });
});
