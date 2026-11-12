// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Independent synthetic receipt tests against the real accountStore action.
// No live account, credentials, backend queries, or production data.
let returnedUserId: string | null = "synthetic-a";
const upsert = vi.fn(async (_row: { user_id: string; display_name: string; updated_at: string }) =>
  ({ error: null as Error | null }));
const updateUser = vi.fn(async (_payload: { data: { display_name: string } }): Promise<{
  data: { user: { id: string } | null }; error: Error | null
}> => ({
  data: { user: returnedUserId === null ? null : { id: returnedUserId } },
  error: null,
}));
const onAuthStateChange = vi.fn((_handler: (event: string, session: Session | null) => void) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));
const supabase = {
  auth: { updateUser, onAuthStateChange },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return { upsert };
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

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  returnedUserId = "synthetic-a";
  upsert.mockClear();
  updateUser.mockClear();
  onAuthStateChange.mockClear();
  useAccount.getState().attachCoordinator(null);
  useAccount.setState({
    phase: "signed-in",
    user: {
      id: "synthetic-a", email: "synthetic-a@example.test",
      displayName: "Original", emailConfirmed: true,
    },
    link: "linked", protection: "protected",
    history: [], devices: [], restoreOffer: undefined,
    busy: false, message: "", error: "",
  });
});

describe("profile metadata receipts must identify the account they acknowledge", () => {
  it("never claims a completed rename when auth metadata acknowledges another user", async () => {
    returnedUserId = "synthetic-b";
    const saved = await useAccount.getState().updateDisplayName("New A");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "synthetic-a", display_name: "New A",
    }));
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "New A" } });
    // Profile-table success is only a partial receipt. A foreign auth identity
    // cannot make the combined transaction "complete", even with error: null.
    expect(saved).toBe(false);
    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(useAccount.getState().message).not.toBe("Account name updated.");
  });

  it("does not treat a null auth user with error:null as proof of completed rename", async () => {
    returnedUserId = null;
    const saved = await useAccount.getState().updateDisplayName("New A");
    expect(upsert).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledOnce();
    expect(saved).toBe(false);
    expect(useAccount.getState().message).not.toBe("Account name updated.");
  });

  it("accepts the matching authenticated identity on an otherwise complete receipt", async () => {
    returnedUserId = "synthetic-a";
    const saved = await useAccount.getState().updateDisplayName("Verified A");
    expect(saved).toBe(true);
    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(useAccount.getState().user?.displayName).toBe("Verified A");
    expect(useAccount.getState().message).toBe("Account name updated.");
  });
});
