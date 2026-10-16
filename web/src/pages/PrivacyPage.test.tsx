// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "../lib/communications/client";
import { PrivacyPage } from "./PrivacyPage";

const mocks = vi.hoisted(() => ({
  exportStateWithAttachments: vi.fn(),
  communicationsRequest: vi.fn(),
  reload: vi.fn(),
}));

let remote: {
  data: CommunicationsSettings | null;
  loading: boolean;
  error: string;
  reload: typeof mocks.reload;
};

vi.mock("../lib/backup", async () => {
  const actual = await vi.importActual<typeof import("../lib/backup")>("../lib/backup");
  return { ...actual, exportStateWithAttachments: mocks.exportStateWithAttachments };
});

vi.mock("../lib/communications/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/communications/client")>("../lib/communications/client");
  return {
    ...actual,
    communicationsRequest: mocks.communicationsRequest,
    useCommunications: () => remote,
  };
});

vi.mock("../lib/communications/useOpticalMotion", () => ({
  useOpticalMotion: () => ({ current: null }),
}));

function settings(privacy: CommunicationsSettings["privacy"] = []): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history: [],
    privacy,
    admin: false,
    deliveryMode: "live",
    deletionEnabled: false,
    hasProtectedCopy: true,
  };
}

beforeEach(() => {
  mocks.exportStateWithAttachments.mockReset();
  mocks.communicationsRequest.mockReset();
  mocks.reload.mockReset();
  remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrivacyPage", () => {
  it("marks a portable backup incomplete when originals or deferred sources are missing", async () => {
    mocks.exportStateWithAttachments.mockResolvedValue({
      attachmentCount: 2,
      missingBlobKeys: [],
      originalCount: 1,
      missingOriginalIds: ["original-1"],
      deferredSourceCount: 3,
    });
    const user = userEvent.setup();
    render(<PrivacyPage />);

    await user.click(screen.getByRole("button", { name: "Download local backup" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not a complete offline copy/i);
    expect(alert.textContent).toMatch(/1 original file is unavailable/i);
    expect(alert.textContent).toMatch(/3 sources remain as account download references/i);
    expect(alert.textContent).toMatch(/2 image attachments and 1 original file/i);
  });

  it("distinguishes loading, unavailable, signed-out, and empty request histories", () => {
    remote = { data: null, loading: true, error: "", reload: mocks.reload };
    const view = render(<PrivacyPage />);
    let history = screen.getByRole("heading", { name: "Your requests" }).closest("section")!;
    expect(within(history).getByRole("status").textContent).toMatch(/loading request history/i);
    expect(within(history).queryByText(/no account data requests/i)).toBeNull();

    remote = { data: null, loading: false, error: "Offline", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    history = screen.getByRole("heading", { name: "Your requests" }).closest("section")!;
    expect(within(history).getByRole("alert").textContent).toMatch(/request history is unavailable/i);

    remote = { data: null, loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    history = screen.getByRole("heading", { name: "Your requests" }).closest("section")!;
    expect(within(history).getByText(/sign in to view account data requests/i)).toBeTruthy();

    remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
    view.rerender(<PrivacyPage />);
    history = screen.getByRole("heading", { name: "Your requests" }).closest("section")!;
    expect(within(history).getByText(/no account data requests yet/i)).toBeTruthy();
  });

  it("renders loaded account requests only after the remote state is available", async () => {
    remote = {
      data: settings([{ id: "export-1", kind: "export", status: "ready" }]),
      loading: false,
      error: "",
      reload: mocks.reload,
    };
    render(<PrivacyPage />);

    const history = screen.getByRole("heading", { name: "Your requests" }).closest("section")!;
    await waitFor(() => expect(within(history).getByText("Account export")).toBeTruthy());
    expect(within(history).queryByText(/no account data requests/i)).toBeNull();
  });
});
