// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// This mounts the actual Zustand account action and SDK auth callback.
// Synthetic Supabase profile responses are deliberately held across identity
// changes; no account, database, or real profile is written.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const upsert = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
const updateUser = vi.fn(async () => ({ data: { user: { id: "synthetic-a" } }, error: null as { message: string } | null }));
const client = {
  auth: { onAuthStateChange, updateUser },
  from: (table: string) => table === "account_profiles"
    ? { upsert }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) },
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => client,
  loadSupabase: async () => client,
  readStoredSession: () => null,
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

function sessionFor(id: string): Session {
  return {
    user: {
      id, email: id + "@example.test",
      user_metadata: { display_name: id },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}
async function startAuthFeed() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
  expect(emitAuth).toBeTypeOf("function");
}
function blockProfileUpsert(): () => void {
  let release: (() => void) | undefined;
  upsert.mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve({ error: null });
  }));
  return () => {
    if (!release) throw new Error("Profile upsert has not started");
    release();
  };
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  onAuthStateChange.mockClear();
  upsert.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({ data: { user: { id: "synthetic-a" } }, error: null });
  useAccount.setState({
    phase: "signed-in",
    user: {
      id: "synthetic-a", email: "synthetic-a@example.test",
      displayName: "Before rename", emailConfirmed: true,
    },
    link: "linked",
    protection: "protected",
    busy: false,
    message: "",
    error: "",
  });
});

describe("profile name write is owned by its original auth generation", () => {
  it("cannot reinstate A's user after A -> B during the profile upsert", async () => {
    await startAuthFeed();
    const release = blockProfileUpsert();
    const pending = useAccount.getState().updateDisplayName("A renamed");
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    release();
    expect(await pending).toBe(false);

    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState()).toMatchObject({
      user: expect.objectContaining({ id: "synthetic-b", displayName: "synthetic-b" }),
      phase: "signed-in", busy: false, message: "", error: "",
    });
  });

  it("rejects stale A profile completion after A -> B -> A even when the final ID matches", async () => {
    await startAuthFeed();
    const release = blockProfileUpsert();
    const pending = useAccount.getState().updateDisplayName("A stale name");
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    release();
    expect(await pending).toBe(false);

    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState().user).toMatchObject({ id: "synthetic-a", displayName: "synthetic-a" });
    expect(useAccount.getState().message).toBe("");
  });

  it("cannot resurrect a signed-out account from a late profile write", async () => {
    await startAuthFeed();
    const release = blockProfileUpsert();
    const pending = useAccount.getState().updateDisplayName("Late A");
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    emitAuth!("SIGNED_OUT", null);
    release();
    expect(await pending).toBe(false);

    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState()).toMatchObject({ phase: "signed-out", user: null, busy: false, message: "" });
  });

  it("rejects a late auth-metadata response after the account changes", async () => {
    await startAuthFeed();
    let finishAuthUpdate: (() => void) | undefined;
    updateUser.mockImplementationOnce(() => new Promise((resolve) => {
      finishAuthUpdate = () => resolve({ data: { user: { id: "synthetic-a" } }, error: null });
    }));
    const pending = useAccount.getState().updateDisplayName("Late auth response");
    await vi.waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));

    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    finishAuthUpdate!();
    expect(await pending).toBe(false);
    expect(useAccount.getState().user).toMatchObject({ id: "synthetic-b", displayName: "synthetic-b" });
    expect(useAccount.getState().message).toBe("");
  });

  it("preserves a current-owner rename through a TOKEN_REFRESHED callback", async () => {
    await startAuthFeed();
    const release = blockProfileUpsert();
    const pending = useAccount.getState().updateDisplayName("Current A");
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    release();
    expect(await pending).toBe(true);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(useAccount.getState()).toMatchObject({
      user: expect.objectContaining({ id: "synthetic-a", displayName: "Current A" }),
      message: "Account name updated.", error: "", busy: false,
    });
  });

  it("still surfaces a same-owner profile-table rejection without a success receipt", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "Synthetic profile write denied" } });
    expect(await useAccount.getState().updateDisplayName("Rejected")).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState().user?.displayName).toBe("Before rename");
    expect(useAccount.getState().message).not.toBe("Account name updated.");
    expect(useAccount.getState().error).toContain("Synthetic profile write denied");
  });
});
