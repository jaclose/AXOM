// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import {
  backupCoversOpenWorkspace,
  isUnloadAllowedForRefresh,
  lastPortableBackupAt,
  recordPortableBackup,
  refreshAfterPortableBackup,
  resetRefreshRecoveryForTests,
  subscribePortableBackup,
  takeRefreshAfterBackupNotice,
} from "./refreshRecovery";

beforeEach(() => {
  resetRefreshRecoveryForTests();
  sessionStorage.clear();
  useStore.setState({ ...makeSeed(), tasks: [] });
});

afterEach(() => resetRefreshRecoveryForTests());

describe("refresh after a portable backup", () => {
  it("refuses to refresh before any backup and after the workspace changes", async () => {
    const reload = vi.fn();
    await expect(refreshAfterPortableBackup(async () => undefined, reload)).rejects.toThrow(/Download a new backup/);

    recordPortableBackup(useStore.getState(), new Date("2026-11-04T12:25:21Z"));
    expect(backupCoversOpenWorkspace()).toBe(true);
    useStore.setState({ tasks: [{ id: "t1", title: "Typed after the backup", done: false } as never] });
    expect(backupCoversOpenWorkspace()).toBe(false);
    await expect(refreshAfterPortableBackup(async () => undefined, reload)).rejects.toThrow(/changed after the backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
  });

  it("refreshes when the backup holds exactly what is open, even if activating the update fails", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePortableBackup(listener);
    recordPortableBackup(useStore.getState());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(lastPortableBackupAt()).not.toBeNull();
    const reload = vi.fn();
    await refreshAfterPortableBackup(async () => { throw new Error("worker redundant"); }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isUnloadAllowedForRefresh()).toBe(true);
    expect(takeRefreshAfterBackupNotice()).toBe(lastPortableBackupAt());
    expect(takeRefreshAfterBackupNotice()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
