// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "../lib/communications/client";
import { PrivacyPage } from "./PrivacyPage";

// Synthetic account identities only. No Supabase session, live deletion or provider call.
const mocks = vi.hoisted(() => ({
  userId: "owner-a" as string | null,
  request: vi.fn(),
  reload: vi.fn(),
}));

let remote: {
  data: CommunicationsSettings | null;
  loading: boolean;
  error: string;
  reload: typeof mocks.reload;
};

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("../lib/communications/client", () => ({
  communicationsRequest: mocks.request,
  useCommunications: () => remote,
}));
vi.mock("../lib/communications/useOpticalMotion", () => ({
  useOpticalMotion: () => ({ current: null }),
}));

function settings(deletionEnabled: boolean): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history: [],
    privacy: [],
    admin: false,
    deliveryMode: "disabled",
    deletionEnabled,
    hasProtectedCopy: true,
  };
}

async function enterDeletionConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  await user.click(screen.getByRole("button", { name: "Continue without backup" }));
  await user.type(screen.getByRole("textbox", { name: /Type DELETE MY ACCOUNT/ }), "DELETE MY ACCOUNT");
  expect(screen.getByRole("button", { name: "Schedule deletion in 7 days" }))
    .not.toHaveProperty("disabled", true);
}

beforeEach(() => {
  mocks.userId = "owner-a";
  mocks.request.mockReset();
  mocks.reload.mockReset();
  mocks.request.mockResolvedValue({});
  mocks.reload.mockResolvedValue(undefined);
  remote = { data: settings(true), loading: false, error: "", reload: mocks.reload };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrivacyPage deletion confirmation account-generation isolation", () => {
  it("removes A's typed confirmation immediately on sign-out while the page stays mounted", async () => {
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await enterDeletionConfirmation(user);

    mocks.userId = null;
    remote = { data: null, loading: false, error: "Sign in to manage your account.", reload: mocks.reload };
    view.rerender(<PrivacyPage />);

    expect(screen.queryByRole("button", { name: "Schedule deletion in 7 days" })).toBeNull();
    expect(screen.queryByDisplayValue("DELETE MY ACCOUNT")).toBeNull();
    expect(mocks.request).not.toHaveBeenCalledWith("request-deletion", expect.anything());
  });

  it("never submits A's already-typed phrase under freshly signed-in B even when B is eligible", async () => {
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await enterDeletionConfirmation(user);

    mocks.userId = "owner-b";
    remote = { data: settings(true), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    const staleSubmit = screen.queryByRole("button", { name: "Schedule deletion in 7 days" });
    if (staleSubmit) await user.click(staleSubmit);

    expect(mocks.request).not.toHaveBeenCalledWith(
      "request-deletion", { confirmation: "DELETE MY ACCOUNT" },
    );
    expect(screen.queryByRole("button", { name: "Schedule deletion in 7 days" })).toBeNull();
  });

  it("does not let stale A confirmation bypass B's disabled deletion capability", async () => {
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await enterDeletionConfirmation(user);

    mocks.userId = "owner-b";
    remote = { data: settings(false), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    const staleSubmit = screen.queryByRole("button", { name: "Schedule deletion in 7 days" });
    if (staleSubmit) await user.click(staleSubmit);

    expect(mocks.request).not.toHaveBeenCalledWith("request-deletion", expect.anything());
    expect(screen.queryByRole("button", { name: "Schedule deletion in 7 days" })).toBeNull();
  });

  it("requires a new confirmation after a same-route A→B→A transition", async () => {
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await enterDeletionConfirmation(user);

    mocks.userId = "owner-b";
    remote = { data: settings(true), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    mocks.userId = "owner-a";
    remote = { data: settings(true), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);

    expect(screen.queryByDisplayValue("DELETE MY ACCOUNT")).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule deletion in 7 days" })).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("still allows an explicitly confirmed same-owner request through mocked transport", async () => {
    const user = userEvent.setup();
    render(<PrivacyPage />);
    await enterDeletionConfirmation(user);
    await user.click(screen.getByRole("button", { name: "Schedule deletion in 7 days" }));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "request-deletion", { confirmation: "DELETE MY ACCOUNT" },
    ));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(
      "Deletion scheduled. You can cancel below before processing begins.",
    )).toBeTruthy());
  });
});
