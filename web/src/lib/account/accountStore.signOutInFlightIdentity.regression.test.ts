// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Real accountStore/Zustand. Only Supabase auth and profile transport are
// synthetic; no real account, cloud data, storage revision or image is touched.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const signOut = vi.fn(async () => ({ error: null as Error | null }));
const supabase = {
  auth: { onAuthStateChange, signOut },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    };
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
  return {
    user: {
      id,
      email: `${id}@example.test`,
      user_metadata: { display_name: `Name ${id}` },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}
function deferredSignOut() {
  let complete!: (result: { error: Error | null }) => void;
  const promise = new Promise<{ error: Error | null }>((resolve) => { complete = resolve; });
  return { promise, complete };
}
async function startAsA() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
  emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
  await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-a"));
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  onAuthStateChange.mockClear();
  signOut.mockReset().mockResolvedValue({ error: null });
  useAccount.setState({
    phase: "signed-out", user: null, link: "unlinked", protection: "local-only",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("an old sign-out completion must not take over a newer account session", () => {
  it("retains new B after a successful A sign-out request finishes late", async () => {
    await startAsA();
    const pending = deferredSignOut();
    signOut.mockImplementationOnce(() => pending.promise);
    const logoutA = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));

    // The SDK is authoritative for the active identity. An old promise must
    // not clear the newly established B session when it later settles.
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    pending.complete({ error: null });
    await logoutA;

    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect(useAccount.getState().message).not.toBe("Signed out. This device’s workspace is still here.");
  });

  it("does not show a stale A sign-out transport failure to account B", async () => {
    await startAsA();
    const pending = deferredSignOut();
    signOut.mockImplementationOnce(() => pending.promise);
    const logoutA = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));

    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    expect(useAccount.getState().error).toBe("");
    pending.complete({ error: new Error("Synthetic old A sign-out rejection") });
    await logoutA;

    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect(useAccount.getState().error).toBe("");
    expect(useAccount.getState().message).toBe("");
  });

  it("still signs out normally when no intervening identity transition occurred", async () => {
    await startAsA();
    const pending = deferredSignOut();
    signOut.mockImplementationOnce(() => pending.promise);
    const logoutA = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    pending.complete({ error: null });
    await logoutA;

    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().user).toBeNull();
    expect(useAccount.getState().message).toBe("Signed out. This device’s workspace is still here.");
  });
});
