// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, type AccountUser } from "../../lib/account/accountStore";
import * as auth from "../../lib/account/supabase";
import * as vault from "../../lib/localVault";
import type { LocalVaultRecoveryInspection } from "../../lib/localVault";
import { RecoveryCopiesExportPanel } from "./RecoveryCopiesExportPanel";

const userA: AccountUser = { id: "account-A", email: "a@example.test", displayName: "Account A", emailConfirmed: true };
const userB: AccountUser = { id: "account-B", email: "b@example.test", displayName: "Account B", emailConfirmed: true };
const rawA = JSON.stringify({ state: { profile: { userId: userA.id }, terms: [], notes: "private-A" }, version: 1 });
const rawB = JSON.stringify({ state: { profile: { userId: userB.id }, terms: [], notes: "private-B" }, version: 1 });

function inspection(raw = rawA, unverified = false): LocalVaultRecoveryInspection {
  return {
    copies: unverified ? [] : [{ source: "indexeddb-scoped", fingerprint: "v1:owner-A", value: raw }],
    unverifiedScopedFallback: unverified
      ? { source: "local-fallback-scoped-unverified", fingerprint: "unverified-A", value: raw }
      : null,
    indexedDbReadable: true,
    fallbackReadable: true,
    unverifiedOrOtherOwnerCopyPresent: unverified,
    divergent: false,
    reviewReasons: unverified ? ["unverified-owner-scoped-copy", "other-owner-or-unverifiable-bytes"] : [],
    requiresExplicitReview: unverified,
  };
}

let getUser: ReturnType<typeof vi.fn>;
let inspect: ReturnType<typeof vi.spyOn>;
let createUrl: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useAccount.setState({ phase: "signed-in", user: userA });
  getUser = vi.fn().mockResolvedValue({ data: { user: { id: "account-A" } }, error: null });
  vi.spyOn(auth, "loadSupabase").mockResolvedValue({ auth: { getUser } } as unknown as SupabaseClient);
  inspect = vi.spyOn(vault, "inspectLocalVaultRecoveryCopies").mockResolvedValue(inspection());
  createUrl = vi.fn(() => "blob:axom-recovery-test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  useAccount.setState({ phase: "signed-out", user: null });
  vi.restoreAllMocks();
});

describe("authenticated read-only recovery export", () => {
  it("requires two live identity checks before presenting owner-filtered copy metadata", async () => {
    render(<RecoveryCopiesExportPanel />);
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await waitFor(() => expect(screen.getByText("Retained account vault")).toBeTruthy());
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledWith("account-A");
    expect(screen.queryByText(rawA)).toBeNull();
    expect(screen.queryByText("private-A")).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/not standard portable backups/i)).toBeTruthy();
  });

  it("refuses a mismatched server user before inspecting any storage", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "account-B" } }, error: null });
    render(<RecoveryCopiesExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be verified/i));
    expect(inspect).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("does not offer snapshots after an account switch, even if inspection was completed for A", async () => {
    render(<RecoveryCopiesExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await screen.findByText("Retained account vault");
    useAccount.setState({ phase: "signed-in", user: userB });
    await waitFor(() => expect(screen.queryByText("Retained account vault")).toBeNull());
    expect(screen.queryByText("private-A")).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("requires a second explicit click and rechecks exact raw bytes before download", async () => {
    render(<RecoveryCopiesExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await screen.findByText("Retained account vault");
    fireEvent.click(screen.getByRole("button", { name: "Review export" }));
    expect(screen.getByRole("button", { name: "Download this copy" })).toBeTruthy();
    expect(createUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download this copy" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(getUser).toHaveBeenCalledTimes(4);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("never exports a copy changed by another tab between inspection and confirmation", async () => {
    inspect.mockResolvedValueOnce(inspection(rawA)).mockResolvedValueOnce(inspection(rawB));
    render(<RecoveryCopiesExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await screen.findByText("Retained account vault");
    fireEvent.click(screen.getByRole("button", { name: "Review export" }));
    fireEvent.click(screen.getByRole("button", { name: "Download this copy" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/changed in another tab/i));
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText("Retained account vault")).toBeNull();
  });

  it("labels unverified owner-scoped bytes without restoring, auto-exporting or trusting them", async () => {
    inspect.mockResolvedValue(inspection(rawA, true));
    render(<RecoveryCopiesExportPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved versions" }));
    await screen.findByText("Unverified account-local copy");
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(screen.getByText(/Manual review required/i)).toBeTruthy();
    expect(screen.getByText(/separate unverified local copy/i)).toBeTruthy();
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("renders no recovery actions when signed out", () => {
    useAccount.setState({ phase: "signed-out", user: null });
    render(<RecoveryCopiesExportPanel />);
    expect(screen.queryByRole("button", { name: "Inspect saved versions" })).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });
});
