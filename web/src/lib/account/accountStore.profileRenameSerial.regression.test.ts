// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Synthetic transport, real accountStore/Zustand actions. No hosted writes.
type PendingWrite = { name: string; finish: (error?: Error) => void };
const profileWrites: PendingWrite[] = [];
const authWrites: PendingWrite[] = [];
let durableProfile = "Original";
let durableAuth = "Original";
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const upsert = vi.fn((row: { user_id: string; display_name: string; updated_at: string }) =>
  new Promise<{ error: Error | null }>((resolve) => {
    profileWrites.push({
      name: row.display_name,
      finish: (error) => {
        if (!error) durableProfile = row.display_name;
        resolve({ error: error ?? null });
      },
    });
  }));
const updateUser = vi.fn((payload: { data: { display_name: string } }) =>
  new Promise<{ data: { user: { id: string } }; error: Error | null }>((resolve) => {
    authWrites.push({
      name: payload.data.display_name,
      finish: (error) => {
        if (!error) durableAuth = payload.data.display_name;
        resolve({ data: { user: { id: "synthetic-a" } }, error: error ?? null });
      },
    });
  }));
const supabase = {
  auth: { updateUser, onAuthStateChange },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return {
      upsert,
      select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }) }),
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
  return { user: {
    id, email: `${id}@example.test`,
    user_metadata: { display_name: `Original ${id}` },
    email_confirmed_at: "2026-11-01T12:00:00Z",
  } } as unknown as Session;
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  profileWrites.length = 0;
  authWrites.length = 0;
  durableProfile = "Original";
  durableAuth = "Original";
  emitAuth = undefined;
  upsert.mockClear();
  updateUser.mockClear();
  onAuthStateChange.mockClear();
  useAccount.getState().attachCoordinator(null);
  useAccount.setState({
    phase: "signed-in",
    user: { id: "synthetic-a", email: "synthetic-a@example.test", displayName: "Original", emailConfirmed: true },
    link: "linked",
    protection: "protected",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("profile rename receipt serialization within one account store", () => {
  it("does not overlap profile and metadata writes for two concurrent Save calls", async () => {
    const first = useAccount.getState().updateDisplayName("First");
    const second = useAccount.getState().updateDisplayName("Second");
    await vi.waitFor(() => expect(profileWrites).toHaveLength(1));
    expect(profileWrites[0].name).toBe("First");
    expect(authWrites).toHaveLength(0);

    profileWrites[0].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(1));
    expect(profileWrites).toHaveLength(1);
    expect(authWrites[0].name).toBe("First");
    authWrites[0].finish();
    expect(await first).toBe(true);

    await vi.waitFor(() => expect(profileWrites).toHaveLength(2));
    expect(profileWrites[1].name).toBe("Second");
    profileWrites[1].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(2));
    expect(authWrites[1].name).toBe("Second");
    authWrites[1].finish();
    expect(await second).toBe(true);
    expect(durableProfile).toBe("Second");
    expect(durableAuth).toBe(durableProfile);
    expect(useAccount.getState().user?.displayName).toBe(durableProfile);
    expect(useAccount.getState().message).toBe("Account name updated.");
    expect(useAccount.getState().error).toBe("");
  });

  it("releases the queue after a partially acknowledged metadata failure", async () => {
    const first = useAccount.getState().updateDisplayName("First");
    const second = useAccount.getState().updateDisplayName("Second");
    await vi.waitFor(() => expect(profileWrites).toHaveLength(1));
    profileWrites[0].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(1));
    authWrites[0].finish(new Error("synthetic metadata service unavailable"));
    expect(await first).toBe(false);
    expect(durableProfile).toBe("First");
    expect(durableAuth).toBe("Original");

    await vi.waitFor(() => expect(profileWrites).toHaveLength(2));
    profileWrites[1].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(2));
    authWrites[1].finish();
    expect(await second).toBe(true);
    expect(durableProfile).toBe("Second");
    expect(durableAuth).toBe(durableProfile);
    expect(useAccount.getState().error).toBe("");
  });

  it("does not submit a queued A request after an A to B to A session transition", async () => {
    useAccount.getState().init();
    await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-a"));

    const first = useAccount.getState().updateDisplayName("Old first");
    const queued = useAccount.getState().updateDisplayName("Old queued");
    await vi.waitFor(() => expect(profileWrites).toHaveLength(1));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    profileWrites[0].finish();
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    expect(profileWrites).toHaveLength(1);
    expect(authWrites).toHaveLength(0);

    const current = useAccount.getState().updateDisplayName("Current");
    await vi.waitFor(() => expect(profileWrites).toHaveLength(2));
    profileWrites[1].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(1));
    authWrites[0].finish();
    expect(await current).toBe(true);
    expect(durableProfile).toBe("Current");
    expect(durableAuth).toBe("Current");
    expect(useAccount.getState().user?.displayName).toBe("Current");
  });

  it("does not block a new B rename behind an unresolved previous A upload", async () => {
    useAccount.getState().init();
    await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-a"));

    const previousA = useAccount.getState().updateDisplayName("Old A");
    await vi.waitFor(() => expect(profileWrites).toHaveLength(1));
    expect(profileWrites[0].name).toBe("Old A");

    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    await vi.waitFor(() => expect(useAccount.getState().user?.id).toBe("synthetic-b"));
    const currentB = useAccount.getState().updateDisplayName("New B");

    // The old A transport is intentionally unresolved. Do not make the
    // assertion itself leave an unhandled write hanging on an expected RED.
    let bStartedWithoutA = false;
    try {
      await vi.waitFor(() => expect(profileWrites).toHaveLength(2), { timeout: 350 });
      bStartedWithoutA = true;
    } catch {
      // Original store-wide queue waits for A. Settle both to cleanly report RED.
    } finally {
      profileWrites[0].finish();
    }

    await vi.waitFor(() => expect(profileWrites).toHaveLength(2));
    expect(profileWrites[1].name).toBe("New B");
    profileWrites[1].finish();
    await vi.waitFor(() => expect(authWrites).toHaveLength(1));
    expect(authWrites[0].name).toBe("New B");
    authWrites[0].finish();
    expect(await previousA).toBe(false);
    expect(await currentB).toBe(true);
    expect(authWrites).toHaveLength(1);
    expect(useAccount.getState().user?.id).toBe("synthetic-b");
    expect(useAccount.getState().user?.displayName).toBe("New B");
    expect(bStartedWithoutA).toBe(true);
  });
});
