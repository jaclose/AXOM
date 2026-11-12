import { beforeEach, describe, expect, it, vi } from "vitest";
import { communicationsRequest } from "./client";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const jwt = (id: string, session: string) =>
  `header.${btoa(JSON.stringify({ sub: id, session_id: session }))}.signature`;
const session = (id: string, sid: string) => ({
  access_token: jwt(id, sid),
  refresh_token: "synthetic-refresh",
  user: { id },
});
type Account = { phase: string; user: { id: string } | null };
const mocks = vi.hoisted(() => ({
  account: { phase: "signed-in", user: { id: "11111111-1111-4111-8111-111111111111" } } as Account,
  subscribers: new Set<(next: Account, prev: Account) => void>(),
  stored: null as ReturnType<typeof session> | null,
  load: vi.fn(),
  getSession: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../account/accountStore", () => ({
  useAccount: Object.assign(
    (select: (account: Account) => unknown) => select(mocks.account),
    {
      getState: () => mocks.account,
      subscribe: (listener: (next: Account, prev: Account) => void) => {
        mocks.subscribers.add(listener);
        return () => mocks.subscribers.delete(listener);
      },
    },
  ),
}));
vi.mock("../account/supabase", () => ({
  loadSupabase: () => mocks.load(),
  readStoredSession: () => mocks.stored,
}));
const client = {
  auth: { getSession: mocks.getSession },
  functions: { invoke: mocks.invoke },
};
function switchTo(id: string | null) {
  const prev = mocks.account;
  mocks.account = { phase: id ? "signed-in" : "signed-out", user: id ? { id } : null };
  for (const listener of mocks.subscribers) listener(mocks.account, prev);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const send = () => communicationsRequest<{ requested: boolean }>("request-deletion", { confirmation: "DELETE MY ACCOUNT" });
beforeEach(() => {
  mocks.account = { phase: "signed-in", user: { id: A } };
  mocks.subscribers.clear();
  mocks.stored = session(A, SA);
  mocks.load.mockReset().mockResolvedValue(client);
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: session(A, SA) }, error: null });
  mocks.invoke.mockReset().mockResolvedValue({ data: { requested: true }, error: null });
});
describe("deletion request initiation and SDK dispatch account fences", () => {
  it("does not dispatch A's deletion when SDK loads after B signs in", async () => {
    const d = deferred<typeof client>();
    mocks.load.mockReturnValueOnce(d.promise);
    const request = send();
    switchTo(B);
    d.resolve(client);
    await expect(request).rejects.toThrow(/account|session|changed|sign in/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("does not resurrect the same deletion intent after A→B→A", async () => {
    const d = deferred<typeof client>();
    mocks.load.mockReturnValueOnce(d.promise);
    const request = send();
    switchTo(B); switchTo(A);
    d.resolve(client);
    await expect(request).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("rejects the changed SDK session even when the account-store view is still A", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: session(B, SB) }, error: null });
    await expect(send()).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("rejects a refreshed/replaced session after A→B→A when its session id differs", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: session(A, SB) }, error: null });
    await expect(send()).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("fails closed without a parseable signed-in session at deliberate submit time", async () => {
    mocks.stored = session(A, "not-a-session");
    await expect(send()).rejects.toThrow();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("binds the positive path to the starting account and session", async () => {
    await expect(send()).resolves.toEqual({ requested: true });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("communications?action=request-deletion", {
      body: { confirmation: "DELETE MY ACCOUNT", actorUserId: A, actorSessionId: SA },
    });
    expect(mocks.subscribers.size).toBe(0);
  });
  it("never returns a success receipt to B for A's pending network response", async () => {
    const d = deferred<{ data: { requested: boolean }; error: null }>();
    mocks.invoke.mockReturnValueOnce(d.promise);
    const request = send();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    switchTo(B);
    d.resolve({ data: { requested: true }, error: null });
    await expect(request).rejects.toThrow();
  });
});
