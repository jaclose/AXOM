// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Test-only deferred transport. These represent two independent acknowledged
// server writes, not a live Supabase account or a browser storage mutation.
type PendingWrite = { name: string; complete: () => void };
const pendingProfileWrites: PendingWrite[] = [];
const pendingAuthWrites: PendingWrite[] = [];
let durableProfileName = "Original";
let durableAuthName = "Original";

const upsert = vi.fn((row: { user_id: string; display_name: string; updated_at: string }) =>
  new Promise<{ error: null }>((resolve) => {
    pendingProfileWrites.push({
      name: row.display_name,
      complete: () => {
        durableProfileName = row.display_name;
        resolve({ error: null });
      },
    });
  }));

const updateUser = vi.fn((payload: { data: { display_name: string } }) =>
  new Promise<{ data: { user: { id: string } }; error: null }>((resolve) => {
    pendingAuthWrites.push({
      name: payload.data.display_name,
      complete: () => {
        durableAuthName = payload.data.display_name;
        resolve({ data: { user: { id: "synthetic-a" } }, error: null });
      },
    });
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
  upsert.mockClear();
  updateUser.mockClear();
  pendingProfileWrites.length = 0;
  pendingAuthWrites.length = 0;
  durableProfileName = "Original";
  durableAuthName = "Original";
  useAccount.setState({
    phase: "signed-in",
    user: {
      id: "synthetic-a",
      email: "synthetic-a@example.test",
      displayName: "Original",
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

describe("same-account overlapping profile rename receipts", () => {
  it("never acknowledges two completed renames with conflicting durable profile and auth names", async () => {
    // Separate tabs or callers can enter the action before either has finished,
    // even if one rendered form disables its Save button while busy.
    const first = useAccount.getState().updateDisplayName("First");
    const second = useAccount.getState().updateDisplayName("Second");
    await vi.waitFor(() => {
      expect(pendingProfileWrites.map((write) => write.name)).toEqual(["First", "Second"]);
    });

    // The second profile write commits first, but the first write commits last.
    pendingProfileWrites[1].complete();
    await vi.waitFor(() => expect(pendingAuthWrites.map((write) => write.name)).toEqual(["Second"]));
    pendingProfileWrites[0].complete();
    await vi.waitFor(() => {
      expect(pendingAuthWrites.map((write) => write.name)).toEqual(["Second", "First"]);
    });

    // The first metadata write commits before the second, leaving the
    // two server-side name authorities at different acknowledged values.
    pendingAuthWrites[1].complete();
    const firstAcknowledged = await first;
    pendingAuthWrites[0].complete();
    const secondAcknowledged = await second;

    expect(firstAcknowledged).toBe(true);
    expect(secondAcknowledged).toBe(true);
    expect(durableProfileName).toBe(durableAuthName);
    expect(useAccount.getState().user?.displayName).toBe(durableProfileName);
    expect(useAccount.getState().message).toBe("Account name updated.");
    expect(useAccount.getState().error).toBe("");
  });

  it("preserves normal sequential rename success and consistent server names", async () => {
    for (const [index, name] of ["First", "Second"].entries()) {
      const saving = useAccount.getState().updateDisplayName(name);
      await vi.waitFor(() => expect(pendingProfileWrites).toHaveLength(index + 1));
      expect(pendingProfileWrites[index].name).toBe(name);
      pendingProfileWrites[index].complete();
      await vi.waitFor(() => expect(pendingAuthWrites).toHaveLength(index + 1));
      expect(pendingAuthWrites[index].name).toBe(name);
      pendingAuthWrites[index].complete();
      expect(await saving).toBe(true);
    }

    expect(durableProfileName).toBe("Second");
    expect(durableAuthName).toBe("Second");
    expect(useAccount.getState().user?.displayName).toBe("Second");
    expect(useAccount.getState()).toMatchObject({
      busy: false, message: "Account name updated.", error: "",
    });
  });
});
