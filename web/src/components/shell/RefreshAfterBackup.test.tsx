// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshAfterBackup } from "./RefreshAfterBackup";
import { exportStateWithAttachments } from "../../lib/backup";
import { backupCoversOpenWorkspace, resetRefreshRecoveryForTests } from "../../lib/refreshRecovery";
import { resetQuestionAttachmentScopeForTests } from "../../lib/questionAttachmentScope";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";

vi.mock("../../lib/backup", () => ({ exportStateWithAttachments: vi.fn() }));

const complete = { attachmentCount: 0, missingBlobKeys: [], originalCount: 0, missingOriginalIds: [], deferredSourceCount: 0 };

beforeEach(() => {
  resetQuestionAttachmentScopeForTests();
  resetRefreshRecoveryForTests();
  useStore.setState({ ...makeSeed(), tasks: [] });
  vi.mocked(exportStateWithAttachments).mockReset();
});
afterEach(() => {
  cleanup();
  resetRefreshRecoveryForTests();
  resetQuestionAttachmentScopeForTests();
});

describe("RefreshAfterBackup", () => {
  it.each([
    { missingBlobKeys: ["image"] },
    { missingOriginalIds: ["original"] },
    { deferredSourceCount: 1 },
  ])("keeps Refresh now disabled for an incomplete download: %j", async (gap) => {
    vi.mocked(exportStateWithAttachments).mockResolvedValueOnce({ ...complete, ...gap });
    render(<RefreshAfterBackup />);
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("incomplete"));
    expect(screen.getByRole("button", { name: "Refresh now" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/^Backup downloaded at /)).toBeNull();
    expect(backupCoversOpenWorkspace()).toBe(false);
    expect(exportStateWithAttachments).toHaveBeenCalledOnce();
    expect(vi.mocked(exportStateWithAttachments).mock.calls[0]?.[1]).toBe("complete");
  });

  it("revokes a previous receipt on a rejected retry and grants coverage on a new complete export", async () => {
    vi.mocked(exportStateWithAttachments)
      .mockResolvedValueOnce(complete)
      .mockRejectedValueOnce(new Error("Export unavailable"))
      .mockResolvedValueOnce(complete);
    render(<RefreshAfterBackup />);
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh now" }).hasAttribute("disabled")).toBe(false));
    expect(backupCoversOpenWorkspace()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Download again" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Export unavailable"));
    expect(screen.getByRole("button", { name: "Refresh now" }).hasAttribute("disabled")).toBe(true);
    expect(backupCoversOpenWorkspace()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh now" }).hasAttribute("disabled")).toBe(false));
    expect(backupCoversOpenWorkspace()).toBe(true);
  });
});
