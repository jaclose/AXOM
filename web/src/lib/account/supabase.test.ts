// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sdk = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
import { accountOperationClient, resetSupabaseForTests } from "./supabase";

afterEach(() => { resetSupabaseForTests(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("account-bound storage operations", () => {
  it("keeps the starting token and refuses every request after account switch or sign-out", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    let userId: string | null = "account-a";
    const shared = { auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId }, access_token: `token-${userId}` } : null }, error: null }) } } as unknown as SupabaseClient;
    resetSupabaseForTests(shared);
    const operation = await accountOperationClient();
    const options = sdk.createClient.mock.calls[0] as unknown as [string, string, { accessToken: () => Promise<string> }];
    expect(operation.userId).toBe("account-a");
    expect(await options[2].accessToken()).toBe("token-account-a");
    userId = "account-b";
    await expect(options[2].accessToken()).rejects.toThrow(/account changed/);
    await expect(operation.assertCurrent()).rejects.toThrow(/account changed/);
    userId = null;
    await expect(options[2].accessToken()).rejects.toThrow(/account changed/);
  });
});
