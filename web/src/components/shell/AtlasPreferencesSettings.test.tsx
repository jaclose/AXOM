// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAccount } from "../../lib/account/accountStore";
import {
  confirmAtlasCompanion, readConfirmedAtlasCompanion, startPassiveAtlasOnboarding,
  PASSIVE_ATLAS_SESSION_KEY,
} from "../../lib/communications/passiveFirstRunClient";
import { AtlasPreferencesSettings } from "./AtlasPreferencesSettings";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const user = (id: string) => ({ id, email: "learner@example.com", displayName: "Learner", emailConfirmed: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAccount.setState({ phase: "signed-out", user: null });
});
afterEach(() => cleanup());

describe("Living Atlas Settings control is user-owned", () => {
  it("lets a signed-out learner opt into one of the twenty-five companions without a questionnaire", () => {
    render(<AtlasPreferencesSettings />);
    const chooser = screen.getByRole("combobox", { name: "Choose your Atlas companion" });
    expect(chooser.querySelectorAll("option")).toHaveLength(26);
    fireEvent.change(chooser, { target: { value: "juniper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Atlas companion" }));
    expect(readConfirmedAtlasCompanion()).toBe("juniper");
    expect(screen.getByRole("status").textContent).toMatch(/saved on this device/i);
  });

  it("keeps account selections isolated and never imports a prior guest companion", () => {
    confirmAtlasCompanion("atlas");
    useAccount.setState({ phase: "signed-in", user: user(accountA) });
    const { rerender } = render(<AtlasPreferencesSettings />);
    expect((screen.getByRole("combobox", { name: "Choose your Atlas companion" }) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "Choose your Atlas companion" }), { target: { value: "fathom" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Atlas companion" }));
    expect(readConfirmedAtlasCompanion(accountA)).toBe("fathom");
    useAccount.setState({ user: user(accountB) });
    rerender(<AtlasPreferencesSettings />);
    expect((screen.getByRole("combobox", { name: "Choose your Atlas companion" }) as HTMLSelectElement).value).toBe("");
    expect(readConfirmedAtlasCompanion(accountB)).toBeNull();
    expect(readConfirmedAtlasCompanion()).toBe("atlas");
  });

  it("offers a control to erase on-device first-run observation aggregates", () => {
    startPassiveAtlasOnboarding({ consent: true, changedFields: ["tools"], tools: ["questions"] });
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).not.toBeNull();
    render(<AtlasPreferencesSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Discard Atlas observation" }));
    expect(sessionStorage.getItem(PASSIVE_ATLAS_SESSION_KEY)).toBeNull();
  });

  it("allows disabling a chosen correspondent without changing unrelated account data", () => {
    useAccount.setState({ phase: "signed-in", user: user(accountA) });
    confirmAtlasCompanion("juniper", Date.now(), accountA);
    render(<AtlasPreferencesSettings />);
    expect(screen.getByText(/Juniper is your companion/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off Atlas companion" }));
    expect(readConfirmedAtlasCompanion(accountA)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/turned off/i);
  });
});
