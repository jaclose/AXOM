// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// R41 owner-owned tests; preserve the independent R50 RED regression unchanged.
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
      displayName: "Previous name",
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

describe("two-write profile rename partial acknowledgements", () => {
  it("keeps the acknowledged profile row/name but reports resolved auth-metadata errors as incomplete", async () => {
    updateUser.mockResolvedValueOnce({
      data: { user: { id: "synthetic-a" } },
      error: { message: "Synthetic auth metadata denied" },
    });
    expect(await useAccount.getState().updateDisplayName("Saved row")).toBe(false);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "synthetic-a", display_name: "Saved row",
    }));
    expect(useAccount.getState().user?.displayName).toBe("Saved row");
    expect(useAccount.getState().message).not.toBe("Account name updated.");
    expect(useAccount.getState().error).toContain("Name saved to your profile");
    expect(useAccount.getState().error).toContain("Synthetic auth metadata denied");
    expect(useAccount.getState().busy).toBe(false);
  });

  it("allows an idempotent retry to finish auth metadata without removing the already-saved profile", async () => {
    updateUser.mockResolvedValueOnce({
      data: { user: { id: "synthetic-a" } },
      error: { message: "Synthetic auth update denied" },
    });
    expect(await useAccount.getState().updateDisplayName("Retryable name")).toBe(false);
    expect(await useAccount.getState().updateDisplayName("Retryable name")).toBe(true);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.every(([row]) => row.display_name === "Retryable name")).toBe(true);
    expect(updateUser).toHaveBeenCalledTimes(2);
    expect(useAccount.getState()).toMatchObject({
      user: expect.objectContaining({ id: "synthetic-a", displayName: "Retryable name" }),
      message: "Account name updated.", error: "", busy: false,
    });
  });

  it("preserves the acknowledged profile name if auth transport throws after its upsert", async () => {
    updateUser.mockRejectedValueOnce(new Error("Synthetic auth transport rejected"));
    expect(await useAccount.getState().updateDisplayName("Persisted despite error")).toBe(false);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().user?.displayName).toBe("Persisted despite error");
    expect(useAccount.getState().error).toContain("Synthetic auth transport rejected");
    expect(useAccount.getState().message).not.toBe("Account name updated.");
  });

  it("does not adopt an unacknowledged profile name when the first write fails", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "Synthetic profile denial" } });
    expect(await useAccount.getState().updateDisplayName("Never saved")).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(useAccount.getState().user?.displayName).toBe("Previous name");
    expect(useAccount.getState().error).toContain("Synthetic profile denial");
  });
});
