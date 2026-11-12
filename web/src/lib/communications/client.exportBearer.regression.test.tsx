// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic account and JWT fixtures. No private data, real export or provider request.
const mocks = vi.hoisted(() => ({
  uiId: "owner-a" as string | null,
  stored: null as null | { user: { id: string }; access_token: string; refresh_token: string },
  sdkSession: null as null | { user: { id: string }; access_token: string; refresh_token: string },
  listeners: new Set<(state: { user: { id: string } | null }) => void>(),
  invoke: vi.fn(),
  load: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../account/accountStore", () => ({
  useAccount: Object.assign(
    (select: (state: { user: { id: string } | null }) => unknown) =>
      select({ user: mocks.uiId ? { id: mocks.uiId } : null }),
    {
      getState: () => ({ user: mocks.uiId ? { id: mocks.uiId } : null }),
      subscribe: (cb: (state: { user: { id: string } | null }) => void) => {
        mocks.listeners.add(cb);
        return () => { mocks.listeners.delete(cb); };
      },
    },
  ),
}));
vi.mock("../account/supabase", () => ({
  loadSupabase: mocks.load,
  readStoredSession: () => mocks.stored,
}));
const { communicationsRequest } = await import("./client");

function token(sub: string, suffix = "sig") {
  const part = btoa(JSON.stringify({ sub })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `e30.${part}.${suffix}`;
}
function session(id: string, bearer = token(id)) {
  return { user: { id }, access_token: bearer, refresh_token: "synthetic-refresh" };
}
function move(uiId: string | null) {
  mocks.uiId = uiId;
  for (const cb of mocks.listeners) cb({ user: uiId ? { id: uiId } : null });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.uiId = "owner-a";
  mocks.stored = session("owner-a");
  mocks.sdkSession = session("owner-a");
  mocks.listeners.clear();
  mocks.invoke.mockReset().mockResolvedValue({ data: { requested: true }, error: null });
  mocks.getSession.mockReset().mockImplementation(async () => ({ data: { session: mocks.sdkSession }, error: null }));
  mocks.load.mockReset().mockResolvedValue({
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  });
});

describe.each(["request-export", "export-link"])("credential-bound account export: %s", action => {
  it("refuses a B SDK bearer while the initiating UI and stored session still identify A", async () => {
    mocks.sdkSession = session("owner-b");
    await expect(communicationsRequest(action)).rejects.toThrow(/account|session|sign in/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refuses a token whose JWT subject differs from the SDK user despite matching UI", async () => {
    mocks.sdkSession = session("owner-a", token("owner-b"));
    await expect(communicationsRequest(action)).rejects.toThrow(/account|session|sign in/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refuses SDK credential refresh after initiating consent rather than silently retargeting", async () => {
    mocks.sdkSession = session("owner-a", token("owner-a", "refreshed-token"));
    await expect(communicationsRequest(action)).rejects.toThrow(/account|session|sign in|refresh/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects a stale persisted B session before acquiring the SDK for A", async () => {
    mocks.stored = session("owner-b");
    await expect(communicationsRequest(action)).rejects.toThrow(/account|session|sign in/i);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("pins the consented A JWT as the exact Authorization bearer for the Edge function", async () => {
    await expect(communicationsRequest(action)).resolves.toEqual({ requested: true });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      `communications?action=${action}`,
      { body: {}, headers: { Authorization: `Bearer ${mocks.stored!.access_token}` } },
    );
  });

  it("rejects an A to B to A SDK-session handoff before dispatch", async () => {
    const handoff = deferred<{ data: { session: typeof mocks.sdkSession }; error: null }>();
    mocks.getSession.mockReturnValue(handoff.promise);
    const request = communicationsRequest(action);
    await vi.waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(1));
    move("owner-b");
    move("owner-a");
    handoff.resolve({ data: { session: session("owner-a") }, error: null });
    await expect(request).rejects.toThrow(/account changed/i);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
});
