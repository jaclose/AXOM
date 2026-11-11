// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Actual Zustand account action; synthetic auth SDK only. No cloud writes.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const signOut = vi.fn(async () => ({ error: null as Error | null }));
const supabase = {
  auth: { onAuthStateChange, signOut },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected table");
    return {
      select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }) }),
    };
  },
};
let delayedClient: Promise<typeof supabase> | undefined;
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => supabase,
  loadSupabase: () => delayedClient ?? Promise.resolve(supabase),
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
  emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
  await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-a"));
}
beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  delayedClient = undefined;
  emitAuth = undefined;
  onAuthStateChange.mockClear();
  signOut.mockReset().mockResolvedValue({ error: null });
  useAccount.setState({
    phase: "signed-out", user: null, link: "unlinked", protection: "local-only",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, error: "", message: "",
  });
});

describe("sign-out must settle only the initiating authentication generation", () => {
  it("cannot clear a new A session after A → B → A", async () => {
    await startAsA();
    const pending = deferred<{ error: Error | null }>();
    signOut.mockImplementationOnce(() => pending.promise);
    const oldLogout = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    pending.finish({ error: null });
    await oldLogout;
    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(useAccount.getState().message).not.toBe("Signed out. This device’s workspace is still here.");
  });

  it("accepts SDK SIGNED_OUT from the same request before its promise resolves", async () => {
    await startAsA();
    const pending = deferred<{ error: Error | null }>();
    signOut.mockImplementationOnce(() => pending.promise);
    const logout = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    emitAuth!("SIGNED_OUT", null);
    pending.finish({ error: null });
    await logout;
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().user).toBeNull();
    expect(useAccount.getState().message).toBe("Signed out. This device’s workspace is still here.");
    expect(useAccount.getState().busy).toBe(false);
  });

  it("never signs out B when loading the SDK for A is delayed", async () => {
    await startAsA();
    const delayed = deferred<typeof supabase>();
    delayedClient = delayed.promise;
    const oldLogout = useAccount.getState().signOut();
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    delayed.finish(supabase);
    await oldLogout;
    expect(signOut).not.toHaveBeenCalled();
    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect(useAccount.getState().error).toBe("");
  });

  it("retains failure notice for an uninterrupted failed sign-out", async () => {
    await startAsA();
    signOut.mockResolvedValueOnce({ error: new Error("Synthetic logout refused") });
    await useAccount.getState().signOut();
    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().error).toContain("Synthetic logout refused");
    expect(useAccount.getState().busy).toBe(false);
  });
});
