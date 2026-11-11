// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { AccountDevice, RevisionSummary } from "../sync/syncTypes";

// Real Zustand account store and its real auth-subscription path. All sessions,
// metadata, profile responses, and device IDs are synthetic; no cloud requests.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const auth = {
  onAuthStateChange: vi.fn((handler: (event: string, session: Session | null) => void) => {
    emitAuth = handler;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
};
const mockClient = {
  auth,
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }),
};
vi.mock("./supabase", () => ({
  accountOperationClient: async () => ({
    userId: "synthetic-a",
    assertCurrent: async () => undefined,
    client: mockClient,
  }),
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => mockClient,
  loadSupabase: async () => mockClient,
  readStoredSession: () => null,
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

const oldRevision: RevisionSummary = {
  id: "synthetic-a-private-revision", revision: 7, schemaVersion: 35,
  contentHash: "a".repeat(64), reason: "manual", createdAt: "2026-11-01T12:00:00Z",
};
const oldDevice: AccountDevice = {
  deviceId: "synthetic-a-device", label: "Owner A laptop",
  lastSeenAt: "2026-11-01T12:00:00Z", current: true,
};
const userA = {
  id: "synthetic-a", email: "a@example.test", displayName: "A", emailConfirmed: true,
};
function sessionFor(id: string): Session {
  return {
    user: {
      id, email: id + "@example.test", user_metadata: { display_name: id },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}

async function subscribeToRealAuthEvents() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1));
  expect(emitAuth).toBeTypeOf("function");
}

beforeEach(() => {
  resetAccountInitForTests();
  auth.onAuthStateChange.mockClear();
  emitAuth = undefined;
  localStorage.clear();
  useAccount.setState({
    phase: "signed-in",
    user: userA,
    link: "linked",
    protection: "protected",
    history: [oldRevision],
    devices: [oldDevice],
    restoreOffer: oldRevision,
    busy: false,
    message: "",
    error: "",
  });
});

describe("account auth-epoch metadata isolation", () => {
  it("does not render A history, devices or restore candidate under newly signed-in B even while refresh is unavailable", async () => {
    await subscribeToRealAuthEvents();
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    const state = useAccount.getState();

    expect(state.user?.id).toBe("synthetic-b");
    expect(state.phase).toBe("signed-in");
    // An async refresh or network availability must not be required to hide A.
    expect(state.history).toEqual([]);
    expect(state.devices).toEqual([]);
    expect(state.restoreOffer).toBeUndefined();
  });

  it("clears A metadata on SDK SIGNED_OUT even without the explicit signOut button", async () => {
    await subscribeToRealAuthEvents();
    emitAuth!("SIGNED_OUT", null);
    const state = useAccount.getState();

    expect(state.user).toBeNull();
    expect(state.phase).toBe("signed-out");
    expect(state.history).toEqual([]);
    expect(state.devices).toEqual([]);
    expect(state.restoreOffer).toBeUndefined();
  });

  it("keeps the current account's records on an unchanged-owner session refresh", async () => {
    await subscribeToRealAuthEvents();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    const state = useAccount.getState();

    expect(state.user?.id).toBe("synthetic-a");
    expect(state.history).toEqual([oldRevision]);
    expect(state.devices).toEqual([oldDevice]);
    expect(state.restoreOffer).toEqual(oldRevision);
  });
});
