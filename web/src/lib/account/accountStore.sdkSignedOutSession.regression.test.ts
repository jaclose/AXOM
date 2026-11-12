// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Synthetic SDK event-order adversary, not evidence that Supabase emits this
// sequence in production. The real Zustand account action/listener runs.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
let sdkCurrentSession: Session | null = null;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const signOut = vi.fn(async (_options?: { scope: "local" }) => ({ error: null as Error | null }));
const getSession = vi.fn(async () => ({ data: { session: sdkCurrentSession }, error: null }));
const supabase = {
  auth: { onAuthStateChange, signOut, getSession },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return { select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: null, error: null }),
    }) }) };
  },
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => supabase,
  loadSupabase: async () => supabase,
  readStoredSession: () => null,
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

function sessionFor(id: string): Session {
  return { user: {
    id, email: `${id}@example.test`,
    user_metadata: { display_name: `Name ${id}` },
    email_confirmed_at: "2026-11-01T12:00:00Z",
  } } as unknown as Session;
}
function deferred<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, finish };
}
async function startAsA() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
  sdkCurrentSession = sessionFor("synthetic-a");
  emitAuth!("INITIAL_SESSION", sdkCurrentSession);
  await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-a"));
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  sdkCurrentSession = null;
  onAuthStateChange.mockClear();
  signOut.mockReset().mockResolvedValue({ error: null });
  getSession.mockClear();
  useAccount.setState({
    phase: "signed-out", user: null, link: "unlinked", protection: "local-only",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("a delayed SDK SIGNED_OUT must not erase an independently verified newer session", () => {
  it("retains B if old A logout emits SIGNED_OUT after B became the current SDK session", async () => {
    await startAsA();
    const pending = deferred<{ error: Error | null }>();
    signOut.mockImplementationOnce(async () => pending.promise);
    const oldLogout = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signOut.mock.calls[0]).toEqual([{ scope: "local" }]);

    // Adversarial order: new B is already authoritative in the mocked SDK,
    // but a queued auth notification from A's old logout arrives afterward.
    sdkCurrentSession = sessionFor("synthetic-b");
    emitAuth!("SIGNED_IN", sdkCurrentSession);
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe("synthetic-b");
    emitAuth!("SIGNED_OUT", null);
    // Always settle the old transport before asserting, even when intentionally
    // RED, so no unresolved promise leaks into the following test.
    pending.finish({ error: null });
    await oldLogout;

    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
  });

  it("still clears A when SDK SIGNED_OUT agrees with its actual signed-out session", async () => {
    await startAsA();
    signOut.mockImplementationOnce(async () => {
      sdkCurrentSession = null;
      emitAuth!("SIGNED_OUT", null);
      return { error: null };
    });
    await useAccount.getState().signOut();
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().user).toBeNull();
    expect(useAccount.getState().message).toBe("Signed out. This device’s workspace is still here.");
  });

  it("accepts a real SDK sign-out outside the Account button when its session is absent", async () => {
    await startAsA();
    sdkCurrentSession = null;
    emitAuth!("SIGNED_OUT", null);
    await vi.waitFor(() => expect(useAccount.getState().user).toBeNull());
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(getSession).toHaveBeenCalled();
  });

  it("ignores an obsolete null verification if B signs in before its SDK lookup finishes", async () => {
    await startAsA();
    const pendingLookup = deferred<{ data: { session: Session | null }; error: Error | null }>();
    getSession.mockImplementationOnce(async () => pendingLookup.promise);
    sdkCurrentSession = null;
    emitAuth!("SIGNED_OUT", null);
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    sdkCurrentSession = sessionFor("synthetic-b");
    emitAuth!("SIGNED_IN", sdkCurrentSession);
    pendingLookup.finish({ data: { session: null }, error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect(useAccount.getState().phase).toBe("signed-in");
  });

  it("fails closed rather than retaining account access if SDK session verification rejects", async () => {
    await startAsA();
    getSession.mockRejectedValueOnce(new Error("synthetic SDK read failure"));
    emitAuth!("SIGNED_OUT", null);
    await vi.waitFor(() => expect(useAccount.getState().phase).toBe("signed-out"));
    expect(useAccount.getState().user).toBeNull();
    expect(useAccount.getState().error).toContain("could not verify this account session");
  });
});
