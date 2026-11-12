// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "../lib/communications/client";
import { PrivacyPage } from "./PrivacyPage";

// Synthetic users and a deferred transport. Never issue a real deletion request.
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
  useAccount: Object.assign(
    (select: (state: { user: { id: string } | null }) => unknown) =>
      select({ user: mocks.userId ? { id: mocks.userId } : null }),
    { getState: () => ({ user: mocks.userId ? { id: mocks.userId } : null }) },
  ),
}));
vi.mock("../lib/communications/client", () => ({
  communicationsRequest: mocks.request,
  useCommunications: () => remote,
}));
vi.mock("../lib/communications/useOpticalMotion", () => ({
  useOpticalMotion: () => ({ current: null }),
}));

function settings(enabled = true): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history: [],
    privacy: [],
    admin: false,
    deliveryMode: "disabled",
    deletionEnabled: enabled,
    hasProtectedCopy: true,
  };
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  await user.click(screen.getByRole("button", { name: "Continue without backup" }));
  await user.type(screen.getByRole("textbox", { name: /Type DELETE MY ACCOUNT/ }), "DELETE MY ACCOUNT");
}

beforeEach(() => {
  mocks.userId = "owner-a";
  mocks.request.mockReset();
  mocks.reload.mockReset().mockResolvedValue(undefined);
  remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PrivacyPage identity-bound destructive workflow", () => {
  it("ignores a late account-A deletion result after B mounts on the same route", async () => {
    let complete!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await confirm(user);
    await user.click(screen.getByRole("button", { name: "Schedule deletion in 7 days" }));
    expect(mocks.request).toHaveBeenCalledTimes(1);

    mocks.userId = "owner-b";
    remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    await act(async () => { complete({}); });
    expect(screen.queryByText(/Deletion scheduled\. You can cancel below/)).toBeNull();
    expect(screen.queryByDisplayValue("DELETE MY ACCOUNT")).toBeNull();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("rejects stale deletion clicks when account changes before React rerenders", async () => {
    const user = userEvent.setup();
    render(<PrivacyPage />);
    await confirm(user);
    mocks.userId = "owner-b"; // Store changed, old A click handler has not rerendered yet.
    await user.click(screen.getByRole("button", { name: "Schedule deletion in 7 days" }));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("invalidates an entered phrase when permission revalidation becomes unavailable", async () => {
    const user = userEvent.setup();
    const view = render(<PrivacyPage />);
    await confirm(user);
    remote = { data: null, loading: true, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    expect(screen.queryByRole("button", { name: "Schedule deletion in 7 days" })).toBeNull();
    remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy());
    expect(screen.queryByDisplayValue("DELETE MY ACCOUNT")).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
