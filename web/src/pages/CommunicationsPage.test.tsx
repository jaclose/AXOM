// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "../lib/communications/client";
import { preferences } from "../lib/communications/model";
import { CommunicationsPage } from "./CommunicationsPage";

const mocks = vi.hoisted(() => ({
  communicationsRequest: vi.fn(),
  downloadBlob: vi.fn(),
  reload: vi.fn(),
}));

let remote: {
  data: CommunicationsSettings | null;
  loading: boolean;
  error: string;
  reload: typeof mocks.reload;
};

vi.mock("../lib/store", () => ({
  useStore: () => ({ profile: { name: "Alex Morgan" } }),
}));

vi.mock("../lib/communications/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/communications/client")>("../lib/communications/client");
  return {
    ...actual,
    communicationsRequest: mocks.communicationsRequest,
    useCommunications: () => remote,
  };
});

vi.mock("../lib/communications/email", () => ({
  renderAxomEmail: () => ({ subject: "Your week, Alex.", html: "<p>Preview</p>", text: "Preview", category: "weekly_report" }),
}));

vi.mock("../lib/communications/presentation", () => ({
  currentPresentation: () => ({ accent: "#c8a96a", theme: "dark" }),
  downloadBlob: mocks.downloadBlob,
  localEmailContext: (_state: unknown, _type: unknown, theme: "dark" | "light") => ({
    displayName: "Alex Morgan",
    accent: "#c8a96a",
    theme,
    locale: "en",
    timezone: "America/Grenada",
    orbUrl: "http://localhost/icons/axom-orb-512.png",
  }),
}));

vi.mock("../lib/communications/useOpticalMotion", () => ({
  useOpticalMotion: () => ({ current: null }),
}));

function settings(history: CommunicationsSettings["history"] = []): CommunicationsSettings {
  return {
    preferences: preferences("America/Grenada"),
    identity: { accent: "#c8a96a", theme: "dark" },
    history,
    privacy: [],
    admin: false,
    deliveryMode: "live",
    deletionEnabled: false,
    hasProtectedCopy: true,
  };
}

beforeEach(() => {
  mocks.communicationsRequest.mockReset();
  mocks.downloadBlob.mockReset();
  mocks.reload.mockReset();
  remote = { data: settings(), loading: false, error: "", reload: mocks.reload };
  window.location.hash = "#communications";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommunicationsPage", () => {
  it("keeps account controls inert and distinguishes loading history from an empty inbox", () => {
    remote = { data: null, loading: true, error: "", reload: mocks.reload };
    render(<CommunicationsPage />);

    expect(screen.getByText("Loading your preferences…")).toBeTruthy();
    const history = screen.getByRole("heading", { name: "A quiet record." }).closest("section")!;
    expect(within(history).getByRole("status").textContent).toMatch(/loading email history/i);
    expect(within(history).queryByText(/no messages yet/i)).toBeNull();
    expect((screen.getByRole("switch", { name: /Daily learning/ }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Email timezone/) as HTMLInputElement).disabled).toBe(true);
  });

  it("announces connection errors and offers a retry without claiming an empty history", async () => {
    remote = { data: null, loading: false, error: "Communications could not be reached.", reload: mocks.reload };
    const user = userEvent.setup();
    render(<CommunicationsPage />);

    expect(screen.getByRole("alert").textContent).toMatch(/could not be reached/i);
    const history = screen.getByRole("heading", { name: "A quiet record." }).closest("section")!;
    expect(within(history).getByText(/history is unavailable until communications connect/i)).toBeTruthy();
    expect(within(history).queryByText(/no messages yet/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it("shows a deliberate empty state only after account history loads", async () => {
    render(<CommunicationsPage />);

    const history = screen.getByRole("heading", { name: "A quiet record." }).closest("section")!;
    await waitFor(() => expect(within(history).getByText(/No messages yet/i)).toBeTruthy());
    expect((screen.getByRole("switch", { name: /Daily learning/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it("announces a failed preference save as an alert and preserves the editable controls", async () => {
    mocks.communicationsRequest.mockRejectedValueOnce(new Error("Preferences could not be saved."));
    const user = userEvent.setup();
    render(<CommunicationsPage />);

    const dailyLearning = screen.getByRole("switch", { name: /Daily learning/ }) as HTMLInputElement;
    await user.click(dailyLearning);
    const sendTime = screen.getByLabelText("Send time") as HTMLInputElement;
    await user.clear(sendTime);
    await user.type(sendTime, "09:15");
    await user.clear(screen.getByLabelText(/Email timezone/));
    await user.type(screen.getByLabelText(/Email timezone/), "Europe/London");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Preferences could not be saved.");
    expect(dailyLearning.checked).toBe(true);
    expect(dailyLearning.disabled).toBe(false);
    expect(sendTime.value).toBe("09:15");
    expect((screen.getByLabelText(/Email timezone/) as HTMLInputElement).value).toBe("Europe/London");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("makes an acknowledged preference save authoritative without a settings readback", async () => {
    mocks.communicationsRequest.mockResolvedValueOnce({ saved: true });
    const user = userEvent.setup();
    render(<CommunicationsPage />);

    const dailyLearning = screen.getByRole("switch", { name: /Daily learning/ }) as HTMLInputElement;
    await user.click(dailyLearning);
    const sendTime = screen.getByLabelText("Send time") as HTMLInputElement;
    await user.clear(sendTime);
    await user.type(sendTime, "10:20");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(await screen.findByText("Email preferences saved.")).toBeTruthy();
    expect(dailyLearning.checked).toBe(true);
    expect(sendTime.value).toBe("10:20");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("turns every optional switch off immediately after acknowledged unsubscribe", async () => {
    const loaded = settings();
    loaded.preferences = loaded.preferences.map(preference => ({ ...preference, enabled: ["daily_learning", "weekly_report", "annual_pulse"].includes(preference.category) }));
    remote = { data: loaded, loading: false, error: "", reload: mocks.reload };
    mocks.communicationsRequest.mockResolvedValueOnce({ saved: true });
    const user = userEvent.setup();
    render(<CommunicationsPage />);

    expect((screen.getByRole("switch", { name: /Daily learning/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: /^Weekly Report/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Unsubscribe from all optional emails" }));

    expect(await screen.findByText("Optional emails are off. Essential account emails remain enabled.")).toBeTruthy();
    for (const control of screen.getAllByRole("switch")) expect((control as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("keeps dirty preferences on the page until route navigation is explicitly confirmed", async () => {
    remote = { data: { ...settings(), admin: true }, loading: false, error: "", reload: mocks.reload };
    const user = userEvent.setup();
    render(<CommunicationsPage />);

    await user.click(screen.getByRole("switch", { name: /Essays & Notes/ }));
    const destinations = [
      screen.getByRole("link", { name: /AXOM Pulse/ }),
      screen.getByRole("link", { name: "Privacy & Data" }),
      screen.getByRole("link", { name: "Communications studio" }),
    ];
    destinations[0].addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(destinations[0], { ctrlKey: true });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.location.hash).toBe("#communications");
    for (const [index, destination] of destinations.entries()) {
      await user.click(destination);
      const notice = screen.getByRole("alertdialog");
      expect(notice.textContent).toContain("Leave without saving?");
      expect(window.location.hash).toBe("#communications");
      if (index === 0) {
        await waitFor(() => expect(document.activeElement).toBe(notice));
        await user.keyboard("{Escape}");
      } else {
        await user.click(screen.getByRole("button", { name: "Stay and review" }));
      }
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(destination));
    }

    await user.click(screen.getByRole("link", { name: "Privacy & Data" }));
    await user.click(screen.getByRole("button", { name: "Discard changes and continue" }));
    expect(window.location.hash).toBe("#privacy");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});
