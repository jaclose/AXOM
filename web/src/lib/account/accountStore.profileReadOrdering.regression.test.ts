// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Real Zustand accountStore with synthetic SDK and profile-table responses.
// Deferred reads reproduce same-owner network response reordering without
// accessing any learner account or hosted database.
type ProfileResponse = { data: { display_name: string } | null; error: null };
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const upsert = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
const updateUser = vi.fn(async () => ({
  data: { user: { id: "synthetic-a" } },
  error: null as { message: string } | null,
}));
const reads: Array<() => Promise<ProfileResponse>> = [];
const maybeSingle = vi.fn((): Promise<ProfileResponse> =>
  (reads.shift() ?? (() => Promise.resolve({ data: null, error: null })))());
const client = {
  auth: { onAuthStateChange, updateUser },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return { upsert, select: () => ({ eq: () => ({ maybeSingle }) }) };
  },
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => client,
  loadSupabase: async () => client,
  readStoredSession: () => null,
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

function sessionFor(id: string, displayName = "SDK old"): Session {
  return {
    user: {
      id, email: id + "@example.test",
      user_metadata: { display_name: displayName },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}

function deferProfileRead() {
  let resolve!: (value: ProfileResponse) => void;
  const pending = new Promise<ProfileResponse>((finish) => { resolve = finish; });
  reads.push(() => pending);
  return (name: string | null) => resolve({
    data: name === null ? null : { display_name: name }, error: null,
  });
}

async function startAuthFeed() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
}

async function drainProfileResponse() {
  // The account listener dispatches a detached async profile read.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  emitAuth = undefined;
  reads.length = 0;
  onAuthStateChange.mockClear();
  maybeSingle.mockClear();
  upsert.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({
    data: { user: { id: "synthetic-a" } }, error: null,
  });
  // Reset the observable owner to signed-out, so INITIAL_SESSION performs
  // the actual identity transition and clears the previous test's confirmed
  // profile name. The auth-subscription reset alone does not reset that closure.
  useAccount.setState({
    phase: "signed-out", user: null,
    link: "unlinked", protection: "local-only", busy: false,
    message: "", error: "",
  });
});

describe("profile name reads cannot overtake acknowledged writes", () => {
  it("ignores an old profile read that resolves after a successful rename", async () => {
    await startAuthFeed();
    const finishOldRead = deferProfileRead();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));

    expect(await useAccount.getState().updateDisplayName("New A")).toBe(true);
    expect(useAccount.getState().user?.displayName).toBe("New A");
    finishOldRead("Old A");
    await drainProfileResponse();

    expect(useAccount.getState().user?.displayName).toBe("New A");
    expect(useAccount.getState().message).toBe("Account name updated.");
  });

  it("does not display stale SDK metadata on same-account TOKEN_REFRESHED after rename", async () => {
    await startAuthFeed();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "Old A"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));

    expect(await useAccount.getState().updateDisplayName("New A")).toBe(true);
    const finishRefreshedRead = deferProfileRead();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "Old SDK metadata"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    expect(useAccount.getState().user?.displayName).toBe("New A");

    finishRefreshedRead("New A");
    await drainProfileResponse();
    expect(useAccount.getState().user?.displayName).toBe("New A");
  });

  it("accepts a fresh profile-table read after rename, including changes from another device", async () => {
    await startAuthFeed();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    expect(await useAccount.getState().updateDisplayName("New A")).toBe(true);

    const finishNewRead = deferProfileRead();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "Old SDK metadata"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    finishNewRead("Remote legitimate edit");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Remote legitimate edit"));
  });

  it("keeps the later-started same-owner profile read when earlier read returns last", async () => {
    await startAuthFeed();
    const finishEarlier = deferProfileRead();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    const finishLater = deferProfileRead();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));

    finishLater("Later authoritative");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Later authoritative"));
    finishEarlier("Earlier stale");
    await drainProfileResponse();
    expect(useAccount.getState().user?.displayName).toBe("Later authoritative");
  });

  it("treats a newer successful no-row SELECT as authoritative over an older name", async () => {
    await startAuthFeed();
    const finishEarlier = deferProfileRead();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a", "SDK fallback"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));

    const finishLater = deferProfileRead();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a", "SDK fallback"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
    expect(useAccount.getState().user?.displayName).toBe("SDK fallback");

    // A valid no-row is different from a thrown request or PostgREST error:
    // it must invalidate the earlier response, without inventing a profile.
    finishLater(null);
    await drainProfileResponse();
    finishEarlier("Removed historical profile");
    await drainProfileResponse();
    expect(useAccount.getState().user?.displayName).toBe("SDK fallback");
  });

  it("still permits a pending profile read after a failed rename", async () => {
    await startAuthFeed();
    const finishRead = deferProfileRead();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    upsert.mockResolvedValueOnce({ error: { message: "Synthetic write rejected" } });

    expect(await useAccount.getState().updateDisplayName("Rejected")).toBe(false);
    finishRead("Server old name");
    await vi.waitFor(() => expect(useAccount.getState().user?.displayName).toBe("Server old name"));
    expect(useAccount.getState().message).not.toBe("Account name updated.");
  });

  it("does not resurrect old A profile data after A to B to A", async () => {
    await startAuthFeed();
    const finishOldA = deferProfileRead();
    emitAuth!("INITIAL_SESSION", sessionFor("synthetic-a"));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b", "B"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a", "New A session"));
    finishOldA("Old A session");
    await drainProfileResponse();

    expect(useAccount.getState().user).toMatchObject({
      id: "synthetic-a", displayName: "New A session",
    });
  });
});
