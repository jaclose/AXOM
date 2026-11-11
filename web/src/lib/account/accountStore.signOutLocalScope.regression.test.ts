// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Real accountStore action; two-device token effects are synthetic. No cloud writes.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
let otherDeviceSessionValid = true;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
type SignOutOptions = { scope?: "local" | "global" | "others" };
const signOut = vi.fn(async (options?: SignOutOptions) => {
  // Supabase's default scope is global. This synthetic model deliberately
  // detects an accidental bare signOut() call by revoking device B.
  if (!options || options.scope === "global") otherDeviceSessionValid = false;
  emitAuth?.("SIGNED_OUT", null);
  return { error: null as Error | null };
});
const supabase = {
  auth: { onAuthStateChange, signOut },
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
  emitAuth!("INITIAL_SESSION", sessionFor("device-a"));
  await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("device-a"));
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  otherDeviceSessionValid = true;
  onAuthStateChange.mockClear();
  useAccount.getState().attachCoordinator(null);
  signOut.mockReset().mockImplementation(async (options?: SignOutOptions) => {
    if (!options || options.scope === "global") otherDeviceSessionValid = false;
    emitAuth?.("SIGNED_OUT", null);
    return { error: null };
  });
  useAccount.setState({
    phase: "signed-out", user: null, link: "unlinked", protection: "local-only",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("sign out only the current device's authentication session", () => {
  it("passes explicit local scope and keeps a second device's refresh session intact", async () => {
    await startAsA();
    await useAccount.getState().signOut();
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(otherDeviceSessionValid).toBe(true);
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().user).toBeNull();
    expect(useAccount.getState().message).toBe("Signed out. This device’s workspace is still here.");
  });

  it("preserves new B after A's delayed local sign-out settles, without global revocation", async () => {
    await startAsA();
    const pending = deferred<{ error: Error | null }>();
    signOut.mockImplementationOnce((options?: SignOutOptions) => {
      if (!options || options.scope === "global") otherDeviceSessionValid = false;
      return pending.promise;
    });
    const logoutA = useAccount.getState().signOut();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" }));
    emitAuth!("SIGNED_IN", sessionFor("device-b"));
    pending.finish({ error: null });
    await logoutA;
    expect(otherDeviceSessionValid).toBe(true);
    expect(useAccount.getState().user?.id).toBe("device-b");
    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().message).not.toContain("Signed out");
  });

  it("cleans up local sync despite a failed remote token revocation after SDK logout", async () => {
    await startAsA();
    const dispose = vi.fn();
    useAccount.getState().attachCoordinator({ dispose } as never);
    signOut.mockImplementationOnce(async (options?: SignOutOptions) => {
      if (!options || options.scope === "global") otherDeviceSessionValid = false;
      emitAuth?.("SIGNED_OUT", null);
      return { error: new Error("Synthetic remote token revocation failed") };
    });
    await useAccount.getState().signOut();
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(otherDeviceSessionValid).toBe(true);
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().message).not.toBe("Signed out. This device’s workspace is still here.");
    expect(useAccount.getState().error).toContain("Signed out on this device, but server token revocation could not be confirmed");
    expect(useAccount.getState().error).toContain("Synthetic remote token revocation failed");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
