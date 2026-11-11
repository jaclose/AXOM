// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { AccountDevice, RevisionSummary } from "../sync/syncTypes";

// The real account Zustand store and auth subscription are exercised. Only
// account service and cloud transport are synthetic. No remote account writes.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const mockClient = {
  auth: { onAuthStateChange },
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }),
};
vi.mock("./supabase", () => ({
  accountOperationClient: async () => ({ userId: "synthetic-a", assertCurrent: async () => undefined, client: mockClient }),
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => mockClient,
  loadSupabase: async () => mockClient,
  readStoredSession: () => null,
}));

const pendingSummaries: Array<{ resolve: (value: RevisionSummary[]) => void; reject: (error: Error) => void }> = [];
const summaries = vi.fn(() => new Promise<RevisionSummary[]>((resolve, reject) => {
  pendingSummaries.push({ resolve, reject });
}));
const devices = vi.fn(async (): Promise<AccountDevice[]> => []);
vi.mock("../sync/supabaseTransport", () => ({
  SupabaseSyncTransport: class {
    summaries = summaries;
    devices = devices;
  },
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

const aRevision: RevisionSummary = {
  id: "A-secret-revision", revision: 5, schemaVersion: 35,
  contentHash: "a".repeat(64), reason: "manual", createdAt: "2026-11-01T12:00:00Z",
};
const aDevice: AccountDevice = {
  deviceId: "A-secret-device", label: "A's laptop", lastSeenAt: "2026-11-01T12:00:00Z", current: true,
};
function sessionFor(id: string): Session {
  return {
    user: { id, email: `${id}@example.test`, user_metadata: { display_name: id }, email_confirmed_at: "2026-11-01T12:00:00Z" },
  } as unknown as Session;
}
async function subscribe() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
  expect(emitAuth).toBeTypeOf("function");
}

beforeEach(() => {
  resetAccountInitForTests();
  onAuthStateChange.mockClear();
  summaries.mockClear();
  devices.mockClear();
  pendingSummaries.length = 0;
  emitAuth = undefined;
  useAccount.setState({
    phase: "signed-in", user: {
      id: "synthetic-a", email: "synthetic-a@example.test",
      displayName: "A", emailConfirmed: true,
    },
    link: "linked", protection: "protected",
    lastProtectedAt: aRevision.createdAt, snapshotBytes: 123456,
    conflictServerRevision: 12,
    history: [aRevision], devices: [aDevice], restoreOffer: aRevision,
    busy: false, message: "", error: "",
    pendingCodeEmail: undefined, pendingCodeKind: undefined,
  });
});

describe("account identity generation protects cloud metadata", () => {
  it("does not restore stale A history after A → B → A while A's earlier refresh is pending", async () => {
    await subscribe();
    const oldRequest = useAccount.getState().refresh();
    expect(summaries).toHaveBeenCalledTimes(1);
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    pendingSummaries[0].resolve([aRevision]);
    await oldRequest;
    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(useAccount.getState().history).toEqual([]);
    expect(useAccount.getState().devices).toEqual([]);
    expect(useAccount.getState().restoreOffer).toBeUndefined();
  });

  it("discards the stale refresh error instead of showing an older account's failure after A → B → A", async () => {
    await subscribe();
    const oldRequest = useAccount.getState().refresh();
    expect(summaries).toHaveBeenCalledTimes(1);
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    pendingSummaries[0].reject(new Error("private A failure"));
    await oldRequest;
    expect(useAccount.getState().error).toBe("");
  });

  it("clears A history, devices, restore offer, and cloud receipt on B password recovery", async () => {
    await subscribe();
    emitAuth!("PASSWORD_RECOVERY", sessionFor("synthetic-b"));
    const state = useAccount.getState();
    expect(state.user?.id).toBe("synthetic-b");
    expect(state.phase).toBe("recovering-password");
    expect(state.history).toEqual([]);
    expect(state.devices).toEqual([]);
    expect(state.restoreOffer).toBeUndefined();
    expect(state.lastProtectedAt).toBeUndefined();
    expect(state.snapshotBytes).toBeUndefined();
    expect(state.conflictServerRevision).toBeUndefined();
    expect(state.link).not.toBe("linked");
  });

  it("removes A's pending recovery address and code kind on SDK A → B → signed-out", async () => {
    await subscribe();
    useAccount.setState({ pendingCodeEmail: "a-private@example.test", pendingCodeKind: "recovery" });
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    expect(useAccount.getState()).toMatchObject({
      phase: "signed-in", user: expect.objectContaining({ id: "synthetic-b" }),
      pendingCodeEmail: undefined, pendingCodeKind: undefined,
    });
    // Simulate a second code request belonging to B before B signs out.
    useAccount.setState({ pendingCodeEmail: "b-private@example.test", pendingCodeKind: "sign-in" });
    emitAuth!("SIGNED_OUT", null);
    expect(useAccount.getState()).toMatchObject({
      phase: "signed-out", user: null, pendingCodeEmail: undefined, pendingCodeKind: undefined,
    });
    // AuthCard receives pendingCodeEmail from this exact account state. The
    // previous owner's email can no longer appear in its signed-out OTP label.
    expect(JSON.stringify({
      email: useAccount.getState().pendingCodeEmail,
      kind: useAccount.getState().pendingCodeKind,
    })).not.toContain("private@example.test");
  });

  it("preserves a valid code through same-owner refresh and redundant signed-out SDK events", async () => {
    await subscribe();
    useAccount.setState({ pendingCodeEmail: "a-current@example.test", pendingCodeKind: "recovery" });
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    expect(useAccount.getState()).toMatchObject({
      pendingCodeEmail: "a-current@example.test", pendingCodeKind: "recovery",
    });
    emitAuth!("SIGNED_OUT", null);
    expect(useAccount.getState().pendingCodeEmail).toBeUndefined();
    // A fresh code requested while already signed out must not be lost when
    // the SDK replays an INITIAL_SESSION null notification.
    useAccount.setState({ pendingCodeEmail: "new-login@example.test", pendingCodeKind: "sign-in" });
    emitAuth!("INITIAL_SESSION", null);
    expect(useAccount.getState()).toMatchObject({
      phase: "signed-out", pendingCodeEmail: "new-login@example.test",
      pendingCodeKind: "sign-in",
    });
  });

  it("still admits a current-account refresh and protects existing linked account metadata", async () => {
    await subscribe();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    const currentRequest = useAccount.getState().refresh();
    expect(summaries).toHaveBeenCalledTimes(1);
    pendingSummaries[0].resolve([aRevision]);
    await currentRequest;
    expect(useAccount.getState().history).toEqual([aRevision]);
    expect(useAccount.getState().devices).toEqual([]);
    expect(useAccount.getState().restoreOffer).toEqual(aRevision);
  });
});
