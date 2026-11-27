// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStateWithAttachments } from "../../lib/backup";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../../lib/questionAttachmentScope";
import { pushToast, useToasts } from "../../lib/toast";
import { VAULT_WRITE_FAILURE_EVENT } from "../../lib/vaultActivity";
import { Toaster } from "./Toaster";
import { VaultSaveWatcher } from "./VaultSaveWatcher";

vi.mock("../../lib/backup", () => ({ exportStateWithAttachments: vi.fn() }));
vi.mock("../../lib/vaultActivity", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/vaultActivity")>(),
  readVaultWriteFailure: () => null,
}));

const complete: Awaited<ReturnType<typeof exportStateWithAttachments>> = {
  attachmentCount: 0, missingBlobKeys: [], originalCount: 0, missingOriginalIds: [], deferredSourceCount: 0,
};
const warning = () => useToasts.getState().toasts.find(toast => toast.dedupe === "vault-write-failure");
const button = () => screen.getByRole("button", { name: "Export backup" });
function failSave() {
  act(() => { window.dispatchEvent(new CustomEvent(VAULT_WRITE_FAILURE_EVENT)); });
}
function mount() {
  render(<><VaultSaveWatcher /><Toaster /></>);
  failSave();
}

beforeEach(() => {
  resetQuestionAttachmentScopeForTests();
  vi.mocked(exportStateWithAttachments).mockReset();
});
afterEach(() => {
  cleanup();
  for (const toast of useToasts.getState().toasts) useToasts.getState().dismiss(toast.id);
  resetQuestionAttachmentScopeForTests();
});

describe("VaultSaveWatcher backup recovery", () => {
  it("retains a focusable warning, prevents repeat export and permits retry after rejection", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(exportStateWithAttachments)
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce(complete);
    mount();
    const id = warning()?.id;
    act(() => button().focus());
    fireEvent.click(button());
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    failSave();
    expect(exportStateWithAttachments).toHaveBeenCalledTimes(1);
    expect(warning()?.id).toBe(id);
    await act(async () => { reject(new Error("export unavailable")); });
    expect(warning()?.body).toContain("could not be prepared");
    expect(button().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button());
    await waitFor(() => expect(warning()?.body).toContain("Check that the file arrived"));
    expect(warning()?.id).toBe(id);
    expect(exportStateWithAttachments).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(button());
  });

  it.each([
    { missingBlobKeys: ["image"] }, { missingOriginalIds: ["original"] }, { deferredSourceCount: 1 },
  ])("keeps a partial backup warning with retry available: %j", async gap => {
    vi.mocked(exportStateWithAttachments).mockResolvedValueOnce({ ...complete, ...gap });
    mount();
    fireEvent.click(button());
    await waitFor(() => expect(warning()?.body).toContain("some files or account content are missing"));
    expect(button().getAttribute("aria-disabled")).toBeNull();
  });

  it.each([false, true])("invalidates stale actions and results after an account transition: %s", async returnToA => {
    setQuestionAttachmentAccount("a");
    let finish!: (result: typeof complete) => void;
    vi.mocked(exportStateWithAttachments).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount();
    const oldAction = warning()?.actions?.[0]?.onAction;
    fireEvent.click(button());
    act(() => {
      setQuestionAttachmentAccount("b");
      if (returnToA) setQuestionAttachmentAccount("a");
    });
    expect(warning()).toBeUndefined();
    act(() => oldAction?.());
    expect(exportStateWithAttachments).toHaveBeenCalledTimes(1);
    failSave();
    const nextId = warning()?.id;
    await act(async () => { finish({ ...complete, missingBlobKeys: ["old"] }); });
    expect(warning()?.id).toBe(nextId);
    expect(warning()?.body).toContain("not stored yet");
    expect(button().getAttribute("aria-disabled")).toBeNull();
  });

  it("does not resurrect an explicitly dismissed warning on completion", async () => {
    let finish!: (result: typeof complete) => void;
    vi.mocked(exportStateWithAttachments).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount();
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss AXOM could not save on this device" }));
    await act(async () => { finish(complete); });
    expect(warning()).toBeUndefined();
  });

  it("preserves automatic dismissal for ordinary toast actions", () => {
    render(<Toaster />);
    const onAction = vi.fn();
    act(() => pushToast({ title: "Ordinary notice", duration: 0, actions: [{ label: "Continue", onAction }] }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
