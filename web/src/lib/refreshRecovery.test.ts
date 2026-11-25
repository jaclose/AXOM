// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "./questionAttachmentScope";
import {
  backupCoversOpenWorkspace,
  isUnloadAllowedForRefresh,
  lastPortableBackupAt,
  beginPortableBackupAttempt,
  refreshAfterPortableBackup,
  resetRefreshRecoveryForTests,
  subscribePortableBackup,
  takeRefreshAfterBackupNotice,
} from "./refreshRecovery";

const completeReceipt = { attachmentCount: 0, missingBlobKeys: [], originalCount: 0, missingOriginalIds: [], deferredSourceCount: 0 };
const recordPortableBackup = (state: ReturnType<typeof useStore.getState>, at?: Date) => beginPortableBackupAttempt(state)(completeReceipt, at);

beforeEach(() => {
  resetQuestionAttachmentScopeForTests();
  resetRefreshRecoveryForTests();
  sessionStorage.clear();
  useStore.setState({ ...makeSeed(), tasks: [] });
});

afterEach(() => { resetRefreshRecoveryForTests(); resetQuestionAttachmentScopeForTests(); });

describe("refresh after a portable backup", () => {
  it.each([
    { missingBlobKeys: ["unavailable-image"] },
    { missingOriginalIds: ["unavailable-original"] },
    { deferredSourceCount: 1 },
    { missingBlobKeys: ["image"], missingOriginalIds: ["original"], deferredSourceCount: 1 },
  ])("does not grant coverage for an incomplete export: %j", async (gap) => {
    recordPortableBackup(useStore.getState());
    expect(backupCoversOpenWorkspace()).toBe(true);
    const finish = beginPortableBackupAttempt(useStore.getState());
    expect(lastPortableBackupAt()).toBeNull();
    expect(finish({ ...completeReceipt, ...gap })).toBe(false);
    const reload = vi.fn();
    await expect(refreshAfterPortableBackup(async () => undefined, reload)).rejects.toThrow(/Download a new backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
  });

  it("revokes prior coverage at the start of a rejected download and allows a later complete retry", () => {
    recordPortableBackup(useStore.getState());
    beginPortableBackupAttempt(useStore.getState());
    expect(backupCoversOpenWorkspace()).toBe(false);
    expect(lastPortableBackupAt()).toBeNull();
    expect(recordPortableBackup(useStore.getState())).toBe(true);
  });

  it("does not let older concurrent downloads replace the latest attempt", () => {
    const first = beginPortableBackupAttempt(useStore.getState());
    const second = beginPortableBackupAttempt(useStore.getState());
    expect(first(completeReceipt)).toBe(false);
    expect(lastPortableBackupAt()).toBeNull();
    expect(second(completeReceipt)).toBe(true);
    expect(second(completeReceipt)).toBe(false);
    expect(backupCoversOpenWorkspace()).toBe(true);
  });

  it("rejects a completed export after the workspace changed during the download", () => {
    const finish = beginPortableBackupAttempt(useStore.getState());
    useStore.setState({ tasks: [{ id: "new", title: "New work", done: false } as never] });
    expect(finish(completeReceipt)).toBe(false);
    expect(lastPortableBackupAt()).toBeNull();
  });

  it("rejects stale receipt and coverage across account A to B to A even with identical workspace JSON", () => {
    setQuestionAttachmentAccount("account-a");
    const finish = beginPortableBackupAttempt(useStore.getState());
    setQuestionAttachmentAccount("account-b");
    setQuestionAttachmentAccount("account-a");
    expect(finish(completeReceipt)).toBe(false);
    expect(recordPortableBackup(useStore.getState())).toBe(true);
    setQuestionAttachmentAccount("account-b");
    expect(lastPortableBackupAt()).toBeNull();
    expect(backupCoversOpenWorkspace()).toBe(false);
    setQuestionAttachmentAccount("account-a");
    expect(lastPortableBackupAt()).toBeNull();
    expect(backupCoversOpenWorkspace()).toBe(false);
  });

  it("does not let a replacement receipt authorize an earlier pending refresh", async () => {
    recordPortableBackup(useStore.getState());
    let settle!: () => void;
    const activation = new Promise<void>((resolve) => { settle = resolve; });
    const reload = vi.fn();
    const refresh = refreshAfterPortableBackup(() => activation, reload);
    expect(recordPortableBackup(useStore.getState())).toBe(true);
    settle();
    await expect(refresh).rejects.toThrow(/changed after the backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
  });

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

  it.each([
    ["is activated", false],
    ["cannot be activated", true],
  ])("does not refresh when the workspace changes while the update %s", async (_label, activationFails) => {
    recordPortableBackup(useStore.getState());
    let settle!: () => void;
    const activation = new Promise<void>((resolve, reject) => {
      settle = () => (activationFails ? reject(new Error("worker redundant")) : resolve());
    });
    const reload = vi.fn();
    const refresh = refreshAfterPortableBackup(() => activation, reload);
    // Activating takes seconds; the learner (or a running timer) can change
    // the workspace meanwhile, and that change is not in the backup.
    useStore.setState({ tasks: [{ id: "t2", title: "Typed while refreshing", done: false } as never] });
    settle();
    await expect(refresh).rejects.toThrow(/changed after the backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
  });

  it.each(["before refresh", "during activation"])("refuses distinct equal-length legacy hash collisions %s", async (when) => {
    // Isolate the persisted identity boundary with the independent QA's fixed
    // collision fixture. This is not a collision in the full AXOM store schema.
    const options = useStore.persist.getOptions();
    const partialize = vi.spyOn(useStore.persist, "getOptions").mockReturnValue({
      ...options, version: 1,
      partialize: (state) => ({ tasks: state.tasks } as ReturnType<NonNullable<typeof options.partialize>>),
    });
    const setTitle = (title: string) => useStore.setState({
      tasks: [{ id: "sample", title, done: false } as never],
    });
    try {
      setTitle("Study 2b4b9e76");
      expect(recordPortableBackup(useStore.getState())).toBe(true);
      expect(backupCoversOpenWorkspace()).toBe(true);
      const reload = vi.fn();
      if (when === "before refresh") {
        setTitle("Study 4e964cb6");
        expect(backupCoversOpenWorkspace()).toBe(false);
      }
      await expect(refreshAfterPortableBackup(async () => {
        if (when === "during activation") setTitle("Study 4e964cb6");
      }, reload)).rejects.toThrow(/changed after the backup/);
      expect(reload).not.toHaveBeenCalled();
      expect(isUnloadAllowedForRefresh()).toBe(false);
      expect(takeRefreshAfterBackupNotice()).toBeNull();
    } finally {
      partialize.mockRestore();
    }
  });

  it("revokes unload permission and the refresh notice if reload throws", async () => {
    expect(recordPortableBackup(useStore.getState())).toBe(true);
    await expect(refreshAfterPortableBackup(async () => undefined, () => {
      expect(isUnloadAllowedForRefresh()).toBe(true);
      throw new Error("reload refused");
    })).rejects.toThrow("reload refused");
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
    const reload = vi.fn();
    await refreshAfterPortableBackup(async () => undefined, reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not carry unload authorization into another backup attempt or account", async () => {
    setQuestionAttachmentAccount("account-a");
    expect(recordPortableBackup(useStore.getState())).toBe(true);
    await refreshAfterPortableBackup(async () => undefined, vi.fn());
    expect(isUnloadAllowedForRefresh()).toBe(true);
    setQuestionAttachmentAccount("account-b");
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(recordPortableBackup(useStore.getState())).toBe(true);
    expect(isUnloadAllowedForRefresh()).toBe(false);
    await refreshAfterPortableBackup(async () => undefined, vi.fn());
    beginPortableBackupAttempt(useStore.getState());
    expect(isUnloadAllowedForRefresh()).toBe(false);
  });

  it("refreshes after a slow activation when nothing changed meanwhile", async () => {
    recordPortableBackup(useStore.getState());
    let settle!: () => void;
    const activation = new Promise<void>((resolve) => { settle = resolve; });
    const reload = vi.fn();
    const refresh = refreshAfterPortableBackup(() => activation, reload);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
    settle();
    await refresh;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isUnloadAllowedForRefresh()).toBe(true);
    expect(takeRefreshAfterBackupNotice()).toBe(lastPortableBackupAt());
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
