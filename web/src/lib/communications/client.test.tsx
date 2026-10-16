// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "./client";
import { useCommunications } from "./client";

const mocks = vi.hoisted(() => ({
  userId: "account-a",
  invoke: vi.fn(),
}));

vi.mock("../account/accountStore", () => ({
  useAccount: (selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: mocks.userId ? { id: mocks.userId } : null }),
}));

vi.mock("../account/supabase", () => ({
  loadSupabase: async () => ({ functions: { invoke: mocks.invoke } }),
}));

function settingsFor(userId: string): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history: [{ id: `history-${userId}`, type: "security", status: "delivered", created_at: "2026-10-15T10:00:00.000Z" }],
    privacy: [],
    admin: false,
    deliveryMode: "live",
    deletionEnabled: false,
    hasProtectedCopy: true,
  };
}

function Probe({ seen }: { seen: string[] }) {
  const remote = useCommunications();
  const visibleId = remote.data?.history[0]?.id ?? "no-history";
  seen.push(visibleId);
  return <span>{visibleId}</span>;
}

beforeEach(() => {
  mocks.userId = "account-a";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async () => ({ data: settingsFor(mocks.userId), error: null }));
});

afterEach(cleanup);

describe("useCommunications", () => {
  it("never renders communication history fetched for the prior account", async () => {
    const seen: string[] = [];
    const view = render(<Probe seen={seen} />);
    expect(await screen.findByText("history-account-a")).toBeTruthy();

    seen.length = 0;
    mocks.userId = "account-b";
    view.rerender(<Probe seen={seen} />);

    expect(seen).not.toContain("history-account-a");
    expect(await screen.findByText("history-account-b")).toBeTruthy();
  });
});
