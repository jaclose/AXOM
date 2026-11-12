// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "./client";
import { useCommunications } from "./client";

// Intentionally different identity sources: the UI has not caught up with the
// Supabase SDK. All identities/tokens/responses here are synthetic test data.
const mocks = vi.hoisted(() => ({
  uiId: "owner-a" as string | null,
  sdkId: "owner-a" as string | null,
  invoke: vi.fn(),
}));
function fakeSession(id: string) {
  const payload = btoa(JSON.stringify({ sub: id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return {
    user: { id },
    access_token: `e30.${payload}.synthetic-test-only`,
    refresh_token: "synthetic-test-only",
  };
}
vi.mock("../account/accountStore", () => {
  const state = () => ({ user: mocks.uiId ? { id: mocks.uiId } : null });
  const useAccount = Object.assign(
    (selector: (value: ReturnType<typeof state>) => unknown) => selector(state()),
    { getState: state, subscribe: () => () => {} },
  );
  return { useAccount };
});
vi.mock("../account/supabase", () => ({
  readStoredSession: () => mocks.sdkId ? fakeSession(mocks.sdkId) : null,
  loadSupabase: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: mocks.sdkId ? fakeSession(mocks.sdkId) : null },
        error: null,
      }),
    },
    functions: { invoke: mocks.invoke },
  }),
}));

function settings(id: string, admin: boolean): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history: [{ id: `history-${id}`, type: "security", status: "delivered", created_at: "2026-11-12T00:00:00Z" }],
    privacy: [],
    admin,
    deliveryMode: "disabled",
    deletionEnabled: false,
    hasProtectedCopy: false,
  };
}
function Probe() {
  const { data } = useCommunications();
  return <output data-testid="settings-identity">
    {data ? `${data.history[0]?.id ?? "empty"}|${data.admin ? "admin" : "learner"}` : "not-loaded"}
  </output>;
}
async function flushSettings() {
  // Permit the effect, lazy-client promise, response and React update to settle.
  // Do not wait for invoke(): a correct fail-closed fix may refuse dispatch.
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 25)); });
}

beforeEach(() => {
  mocks.uiId = "owner-a";
  mocks.sdkId = "owner-a";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async () => ({ data: settings(mocks.sdkId ?? "none", mocks.sdkId === "owner-b"), error: null }));
});
afterEach(cleanup);

describe("Communications settings: visible account versus SDK bearer", () => {
  it("still displays the same owner's settings when UI and SDK both identify A", async () => {
    render(<Probe />);
    await screen.findByText("history-owner-a|learner");
  });

  it("does not render account B's private history under a still-rendered A UI", async () => {
    mocks.sdkId = "owner-b";
    render(<Probe />);
    await flushSettings();
    expect(screen.getByTestId("settings-identity").textContent).not.toContain("history-owner-b");
  });

  it("does not label account A with B's administrator permission", async () => {
    mocks.sdkId = "owner-b";
    render(<Probe />);
    await flushSettings();
    expect(screen.getByTestId("settings-identity").textContent).not.toContain("|admin");
  });
});
