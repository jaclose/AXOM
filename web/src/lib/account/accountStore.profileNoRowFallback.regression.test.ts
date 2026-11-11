// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Real accountStore/Zustand; only Supabase auth/profile I/O is synthetic.
// A successful no-row SELECT must invalidate a previously confirmed name.
type ProfileResponse = { data: { display_name: string } | null; error: { message: string } | null };
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const pendingReads: Array<() => Promise<ProfileResponse>> = [];
const maybeSingle = vi.fn(() => (pendingReads.shift()
  ?? (() => Promise.resolve({ data: null, error: null })))());
const supabase = {
  auth: { onAuthStateChange },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return { select: () => ({ eq: () => ({ maybeSingle }) }) };
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

function sessionFor(id: string, name: string): Session {
  return { user: {
    id, email: id + "@example.test",
    user_metadata: { display_name: name }, email_confirmed_at: "2026-11-01T12:00:00Z",
  } } as unknown as Session;
}
function deferred() {
  let complete!: (response: ProfileResponse) => void;
  const request = new Promise<ProfileResponse>((resolve) => { complete = resolve; });
  pendingReads.push(() => request);
  return {
    succeed: (name: string) => complete({ data: { display_name: name }, error: null }),
    noRow: () => complete({ data: null, error: null }),
    failResponse: () => complete({ data: null, error: { message: "synthetic error" } }),
  };
}
async function init() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
}
async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  pendingReads.length = 0;
  onAuthStateChange.mockClear();
  maybeSingle.mockClear();
  // Allow the actual identity transition to clear closure-scoped caches.
  useAccount.setState({
    phase: "signed-out", user: null, link: "unlinked", protection: "local-only",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("confirmed profile disappears on authoritative no-row", () => {
  it("replaces an already confirmed server name with the latest SDK fallback", async () => {
    await init();
    const first = deferred();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "Initial SDK"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    first.succeed("Confirmed server");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Confirmed server"));

    const removed = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "Latest SDK"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    expect(useAccount.getState().user?.displayName).toBe("Confirmed server");
    removed.noRow();
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Latest SDK"));

    const repeated = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "Latest SDK"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(3));
    expect(useAccount.getState().user?.displayName).toBe("Latest SDK");
    repeated.noRow();
    await flush();
    expect(useAccount.getState().user?.displayName).toBe("Latest SDK");
  });

  it("does not resurrect the removed profile from an older pending SELECT", async () => {
    await init();
    const established = deferred();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "SDK A"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    established.succeed("Server A");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Server A"));

    const older = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "SDK newer"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    const newer = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "SDK newest"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(3));
    newer.noRow();
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("SDK newest"));
    older.succeed("Stale server A");
    await flush();
    expect(useAccount.getState().user?.displayName).toBe("SDK newest");
  });

  it("keeps a confirmed server name when a later SELECT explicitly fails", async () => {
    await init();
    const first = deferred();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "SDK"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    first.succeed("Confirmed A");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Confirmed A"));

    const failed = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "Stale SDK"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    failed.failResponse();
    await flush();
    expect(useAccount.getState().user?.displayName).toBe("Confirmed A");
  });

  it("does not reuse account A's fallback during A→B→A", async () => {
    await init();
    const firstA = deferred();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "SDK first A"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    firstA.succeed("Old A server");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Old A server"));

    const oldA = deferred();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "SDK old session"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b", "SDK B"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a", "SDK new A"));
    oldA.noRow();
    await flush();
    expect(useAccount.getState().user).toMatchObject({
      id: "synthetic-a", displayName: "SDK new A",
    });
  });
});
