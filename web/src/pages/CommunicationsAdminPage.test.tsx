// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommunicationsAdminPage } from "./CommunicationsAdminPage";

const mocks = vi.hoisted(() => ({ communicationsRequest: vi.fn(), userId: "admin-a" as string | null }));

vi.mock("../lib/store", () => ({ useStore: () => ({ profile: { name: "Alex Morgan" } }) }));
vi.mock("../lib/account/accountStore", () => ({
  useAccount: Object.assign(
    (select: (s: { user: { id: string } | null }) => unknown) =>
      select({ user: mocks.userId ? { id: mocks.userId } : null }),
    { getState: () => ({ user: mocks.userId ? { id: mocks.userId } : null }) },
  ),
}));
vi.mock("../lib/communications/client", () => ({
  communicationsRequest: mocks.communicationsRequest,
  useCommunications: () => ({ data: { admin: true }, loading: false, error: "" }),
}));
vi.mock("../lib/communications/presentation", () => ({
  downloadBlob: vi.fn(),
  localEmailContext: (_state: unknown, _type: unknown, theme: "dark" | "light") => ({
    displayName: "Alex Morgan", accent: "#c8a96a", theme, locale: "en", timezone: "America/Grenada", orbUrl: "https://axom.info/icons/axom-orb-512.png",
  }),
}));
vi.mock("../lib/communications/useOpticalMotion", () => ({ useOpticalMotion: () => ({ current: null }) }));

beforeEach(() => {
  mocks.userId = "admin-a";
  mocks.communicationsRequest.mockReset();
  mocks.communicationsRequest.mockResolvedValue({ campaigns: [], failures: [], deliveryMode: "disabled" });
});
afterEach(cleanup);

it("changes the default CTA with the template while preserving an edited label", async () => {
  const user = userEvent.setup();
  render(<CommunicationsAdminPage />);
  const template = screen.getByLabelText("Template");
  const cta = screen.getByLabelText("CTA label") as HTMLInputElement;
  expect(cta.value).toBe("Read essay");

  await user.selectOptions(template, "product_update");
  expect(cta.value).toBe("See what’s new");

  await user.clear(cta);
  await user.type(cta, "Read the change record");
  await user.selectOptions(template, "research");
  expect(cta.value).toBe("Read the change record");
});

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function campaign(id: string, title: string) {
  return {
    id, type: "essay", status: "draft", recipient_count: 0,
    audience: { kind: "subscribers" },
    content: {
      title, excerpt: "Source-provided draft", body: "Text", url: "https://axom.info",
      subject: title, preview: "", cta: "Read essay", readingMinutes: 5,
    },
  };
}
const adminResponse = (owner: string) => ({
  campaigns: [campaign(owner + "-draft", owner + " editorial")],
  failures: [],
  deliveryMode: "disabled",
});

it("does not carry A's selected draft or audience into B's admin session", async () => {
  mocks.communicationsRequest.mockImplementation(async (action: string) =>
    action === "admin" ? adminResponse(mocks.userId ?? "unknown") : undefined);
  const user = userEvent.setup();
  const { rerender } = render(<CommunicationsAdminPage />);
  await screen.findByText("admin-a editorial");
  await user.click(screen.getByRole("button", { name: "Open draft" }));
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("admin-a editorial");

  // Both accounts are authorized admins; the permissions Boolean never changes.
  mocks.userId = "admin-b";
  rerender(<CommunicationsAdminPage />);
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("admin-a editorial")).toBeNull();
  await screen.findByText("admin-b editorial");
  expect(screen.queryByText("admin-a editorial")).toBeNull();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
});

it("ignores a late A admin-history response after B loads", async () => {
  const oldHistory = pending<ReturnType<typeof adminResponse>>();
  mocks.communicationsRequest.mockImplementation((action: string) => {
    if (action !== "admin") throw new Error("Unexpected write in read-only test");
    return mocks.userId === "admin-a" ? oldHistory.promise : Promise.resolve(adminResponse("admin-b"));
  });
  const { rerender } = render(<CommunicationsAdminPage />);
  await waitFor(() => expect(mocks.communicationsRequest).toHaveBeenCalledTimes(1));
  mocks.userId = "admin-b";
  rerender(<CommunicationsAdminPage />);
  await screen.findByText("admin-b editorial");
  await act(async () => { oldHistory.resolve(adminResponse("admin-a")); await oldHistory.promise; });
  expect(screen.queryByText("admin-a editorial")).toBeNull();
  expect(screen.getByText("admin-b editorial")).toBeTruthy();
});

it("a pending A save cannot publish its UI receipt or reload history after A→B→A", async () => {
  const oldSave = pending<{ id: string; content: ReturnType<typeof campaign>["content"] }>();
  mocks.communicationsRequest.mockImplementation((action: string) => {
    if (action === "admin") return Promise.resolve(adminResponse(mocks.userId ?? "unknown"));
    if (action === "campaign-save") return oldSave.promise;
    throw new Error("Unexpected editor action: " + action);
  });
  const user = userEvent.setup();
  const { rerender } = render(<CommunicationsAdminPage />);
  await screen.findByText("admin-a editorial");
  await user.type(screen.getByLabelText("Title"), "A unfinished title");
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mocks.communicationsRequest.mock.calls.some(c => c[0] === "campaign-save")).toBe(true));

  mocks.userId = "admin-b";
  rerender(<CommunicationsAdminPage />);
  await screen.findByText("admin-b editorial");
  mocks.userId = "admin-a";
  rerender(<CommunicationsAdminPage />);
  await screen.findByText("admin-a editorial");

  await act(async () => {
    oldSave.resolve({ id: "old-a-draft", content: campaign("old-a-draft", "old-a private editor").content });
    await oldSave.promise;
    await Promise.resolve();
  });
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Draft saved.")).toBeNull();
  expect(mocks.communicationsRequest.mock.calls.filter(c => c[0] === "admin")).toHaveLength(3);
});
