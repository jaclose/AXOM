// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommunicationsAdminPage } from "./CommunicationsAdminPage";

const mocks = vi.hoisted(() => ({ communicationsRequest: vi.fn() }));

vi.mock("../lib/store", () => ({ useStore: () => ({ profile: { name: "Alex Morgan" } }) }));
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
