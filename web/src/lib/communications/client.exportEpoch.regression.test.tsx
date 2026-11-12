// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Account transitions, SDK acquisition and network responses are synthetic.
// No real export, emails, protected data or provider calls.
type Account = { user: { id: string } | null };
const mocks = vi.hoisted(() => ({
  userId: "owner-a" as string | null,
  listeners: new Set<(state: Account) => void>(),
  sdk: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../account/accountStore", () => ({
  useAccount: Object.assign(
    (selector: (state: Account) => unknown) =>
      selector({ user: mocks.userId ? { id: mocks.userId } : null }),
    {
      getState: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
      subscribe: (listener: (state: Account) => void) => {
        mocks.listeners.add(listener);
        return () => { mocks.listeners.delete(listener); };
      },
    },
  ),
}));
vi.mock("../account/supabase", () => ({ loadSupabase: mocks.sdk }));
const { communicationsRequest } = await import("./client");

function transition(userId: string | null) {
  mocks.userId = userId;
  const state: Account = { user: userId ? { id: userId } : null };
  for (const listener of mocks.listeners) listener(state);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const client = () => ({ functions: { invoke: mocks.invoke } });

beforeEach(() => {
  mocks.userId = "owner-a";
  mocks.listeners.clear();
  mocks.sdk.mockReset();
  mocks.invoke.mockReset();
  mocks.sdk.mockResolvedValue(client());
  mocks.invoke.mockResolvedValue({ data: { requested: true }, error: null });
});

describe("account export request epoch fences", () => {
  it("rejects A -> B -> A while SDK is loading, even when final owner ID matches", async () => {
    const load = deferred<ReturnType<typeof client>>();
    mocks.sdk.mockReturnValue(load.promise);
    const request = communicationsRequest("request-export");
    expect(mocks.listeners.size).toBe(1);
    transition("owner-b");
    transition("owner-a");
    load.resolve(client());
    await expect(request).rejects.toThrow(/account changed/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });

  it("does not report stale success after a request was already sent for A", async () => {
    const completion = deferred<{ data: { requested: boolean }; error: null }>();
    mocks.invoke.mockReturnValue(completion.promise);
    const request = communicationsRequest("request-export");
    // Allow the loadSupabase() await to resolve and dispatch using A.
    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    transition("owner-b");
    completion.resolve({ data: { requested: true }, error: null });
    await expect(request).rejects.toThrow(/account changed/i);
    expect(mocks.listeners.size).toBe(0);
  });

  it("allows same-owner state refresh without treating it as another account", async () => {
    const load = deferred<ReturnType<typeof client>>();
    mocks.sdk.mockReturnValue(load.promise);
    const request = communicationsRequest<{ requested: boolean }>("request-export");
    transition("owner-a");
    load.resolve(client());
    await expect(request).resolves.toEqual({ requested: true });
    expect(mocks.listeners.size).toBe(0);
  });

  it("rejects a signed-out initiator before SDK acquisition", async () => {
    transition(null);
    await expect(communicationsRequest("request-export")).rejects.toThrow(/account changed/i);
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });

  it("keeps settings (read-only) functional without account-export fencing", async () => {
    transition(null);
    await expect(communicationsRequest<{ requested: boolean }>("settings")).resolves.toEqual({ requested: true });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);
  });
});
