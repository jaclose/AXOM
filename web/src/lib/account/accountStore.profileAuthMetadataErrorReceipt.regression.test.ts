// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// R50 independent integration regression. Exercise the real Zustand action,
// while Supabase profile/auth writes are synthetic and cannot touch live data.
const upsert = vi.fn(async () => ({ error: null as { message: string } | null }));
const updateUser = vi.fn(async () => ({
  data: { user: { id: "synthetic-a" } },
  error: null as { message: string } | null,
}));
const supabase = {
  auth: { updateUser },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected table");
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
  upsert.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({
    data: { user: { id: "synthetic-a" } }, error: null,
  });
  useAccount.setState({
    phase: "signed-in",
    user: {
      id: "synthetic-a",
      email: "synthetic-a@example.test",
      displayName: "Old SDK name",
      emailConfirmed: true,
    },
    link: "linked",
    protection: "protected",
    history: [],
    devices: [],
    restoreOffer: undefined,
    busy: false,
    error: "",
    message: "",
  });
});

describe("profile rename acknowledgements across two independent backend writes", () => {
  it("never claims complete success when profile upsert succeeds but auth metadata returns an explicit error", async () => {
    // Supabase commonly resolves {error} without throwing. The profile row is
    // already persisted; do not pretend the second write also succeeded.
    updateUser.mockResolvedValueOnce({
      data: { user: { id: "synthetic-a" } },
      error: { message: "Synthetic auth metadata update denied" },
    });
    const completed = await useAccount.getState().updateDisplayName("New profile name");

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "synthetic-a", display_name: "New profile name",
    }));
    expect(updateUser).toHaveBeenCalledWith({
      data: { display_name: "New profile name" },
    });
    expect(completed).toBe(false);
    expect(useAccount.getState().message).not.toBe("Account name updated.");
    expect(useAccount.getState().error).toContain("Synthetic auth metadata update denied");
    expect(useAccount.getState().busy).toBe(false);
  });

  it("still confirms a fully acknowledged profile and auth metadata update", async () => {
    expect(await useAccount.getState().updateDisplayName("Complete update")).toBe(true);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(useAccount.getState()).toMatchObject({
      user: expect.objectContaining({
        id: "synthetic-a", displayName: "Complete update",
      }),
      message: "Account name updated.",
      error: "",
      busy: false,
    });
  });

  it("rejects a throwing auth-metadata update instead of claiming success", async () => {
    updateUser.mockRejectedValueOnce(new Error("Synthetic auth transport failure"));
    expect(await useAccount.getState().updateDisplayName("Not fully saved")).toBe(false);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().message).not.toBe("Account name updated.");
    expect(useAccount.getState().error).toContain("Synthetic auth transport failure");
  });

  it("does not start an auth update when the profile upsert is rejected", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "Synthetic profile write denied" } });
    expect(await useAccount.getState().updateDisplayName("Rejected profile")).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState().message).not.toBe("Account name updated.");
  });
});
