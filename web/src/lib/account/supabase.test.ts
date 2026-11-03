// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sdk = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
import { accountOperationClient, resetSupabaseForTests } from "./supabase";

afterEach(() => { resetSupabaseForTests(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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

  it("honors a slow final RPC signal past two minutes while bounding ordinary requests", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    const shared = { auth: { getSession: async () => ({ data: { session: { user: { id: "account-a" }, access_token: "token-a" } }, error: null }) } } as unknown as SupabaseClient;
    resetSupabaseForTests(shared);
    vi.useFakeTimers();
    const timeoutDurations: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      timeoutDurations.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const request = vi.fn(async () => ({} as Response));
    vi.stubGlobal("fetch", request);
    await accountOperationClient();
    const options = sdk.createClient.mock.calls.at(-1) as unknown as [string, string, {
      global: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
    }];
    const scopedFetch = options[2].global.fetch;

    // A roughly 4 MB RPC has a 145-second caller deadline, past the old cap.
    const rpcDeadline = AbortSignal.timeout(145_000);
    await scopedFetch("https://example.invalid/rest/v1/rpc/push_workspace_revision_v2", { signal: rpcDeadline });
    const rpcSignal = (request.mock.calls.at(-1) as unknown as [string, RequestInit])[1].signal!;
    expect(timeoutDurations).toEqual([145_000, 300_000]);
    vi.advanceTimersByTime(120_000);
    expect(rpcSignal.aborted).toBe(false);
    vi.advanceTimersByTime(25_000);
    expect(rpcSignal.aborted).toBe(true);

    await scopedFetch("https://example.invalid/rest/v1/workspaces");
    const ordinarySignal = (request.mock.calls.at(-1) as unknown as [string, RequestInit])[1].signal!;
    expect(timeoutDurations.at(-1)).toBe(120_000);
    vi.advanceTimersByTime(120_000);
    expect(ordinarySignal.aborted).toBe(true);

    const explicitAbort = new AbortController();
    await scopedFetch("https://example.invalid/rest/v1/workspaces", { signal: explicitAbort.signal });
    const abortSignal = (request.mock.calls.at(-1) as unknown as [string, RequestInit])[1].signal!;
    explicitAbort.abort();
    expect(abortSignal.aborted).toBe(true);

    const overlongDeadline = new AbortController();
    await scopedFetch("https://example.invalid/rest/v1/workspaces", { signal: overlongDeadline.signal });
    const cappedSignal = (request.mock.calls.at(-1) as unknown as [string, RequestInit])[1].signal!;
    vi.advanceTimersByTime(300_000);
    expect(cappedSignal.aborted).toBe(true);
  });
});
