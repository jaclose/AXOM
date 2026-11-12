// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic accounts and deferred SDK acquisition only. No real auth session,
// account export, storage read, provider call, or sensitive payload is involved.
const mocks = vi.hoisted(() => ({
  userId: "owner-a" as string | null,
  loadSupabase: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../account/accountStore", () => ({
  useAccount: Object.assign(
    (selector: (state: { user: { id: string } | null }) => unknown) =>
      selector({ user: mocks.userId ? { id: mocks.userId } : null }),
    {
      getState: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
    },
  ),
}));
vi.mock("../account/supabase", () => ({
  loadSupabase: mocks.loadSupabase,
}));

const { communicationsRequest } = await import("./client");

type FakeClient = { functions: { invoke: typeof mocks.invoke } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

function client(): FakeClient {
  return { functions: { invoke: mocks.invoke } };
}

beforeEach(() => {
  mocks.userId = "owner-a";
  mocks.loadSupabase.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({ data: { requested: true }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("account export intent ownership across asynchronous SDK acquisition", () => {
  it("must not dispatch A's export request under B after a deferred SDK load", async () => {
    const sdk = deferred<FakeClient>();
    mocks.loadSupabase.mockReturnValue(sdk.promise);

    const request = communicationsRequest<{ requested: boolean }>("request-export");
    mocks.userId = "owner-b";
    sdk.resolve(client());

    await expect(request).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("must not dispatch an already-started export after A signs out", async () => {
    const sdk = deferred<FakeClient>();
    mocks.loadSupabase.mockReturnValue(sdk.promise);

    const request = communicationsRequest<{ requested: boolean }>("request-export");
    mocks.userId = null;
    sdk.resolve(client());

    await expect(request).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps a new B export independent of an earlier A export still awaiting the SDK", async () => {
    const aSdk = deferred<FakeClient>();
    const bSdk = deferred<FakeClient>();
    mocks.loadSupabase.mockReturnValueOnce(aSdk.promise).mockReturnValueOnce(bSdk.promise);

    const staleA = communicationsRequest<{ requested: boolean }>("request-export");
    mocks.userId = "owner-b";
    const currentB = communicationsRequest<{ requested: boolean }>("request-export");

    bSdk.resolve(client());
    await expect(currentB).resolves.toEqual({ requested: true });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    aSdk.resolve(client());
    await expect(staleA).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("still sends one explicitly requested export for a stable signed-in account", async () => {
    const sdk = deferred<FakeClient>();
    mocks.loadSupabase.mockReturnValue(sdk.promise);

    const request = communicationsRequest<{ requested: boolean }>("request-export");
    sdk.resolve(client());

    await expect(request).resolves.toEqual({ requested: true });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "communications?action=request-export", { body: {} },
    );
  });

  it("does not dispatch or claim success when the SDK is unavailable", async () => {
    mocks.loadSupabase.mockResolvedValue(null);
    await expect(communicationsRequest("request-export")).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
