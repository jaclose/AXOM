// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudCatalog } from "./useCloudCatalog";
import type { CloudCatalog } from "./client";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), client: vi.fn(), list: vi.fn(), session: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("../account/supabase", () => ({ cloudConfigured: mocks.configured, loadSupabase: mocks.client }));
vi.mock("./client", () => ({ listCloudCatalog: mocks.list }));
type Session = { user: { id: string } } | null;
type Listener = (event: string, session: Session) => void;
const listeners: Listener[] = [];
const session = (id: string | null) => ({ data: { session: id ? { user: { id } } : null }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks(); listeners.length = 0;
  mocks.configured.mockReturnValue(true);
  mocks.session.mockResolvedValue(session("account-a"));
  mocks.subscribe.mockImplementation((listener: Listener) => {
    listeners.push(listener);
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
  mocks.client.mockResolvedValue({ auth: { getSession: mocks.session, onAuthStateChange: mocks.subscribe } });
  mocks.list.mockResolvedValue({ releases: [], entries: [] });
});
afterEach(cleanup);
describe("account-aware catalog discovery lifecycle", () => {
  it("automatically discovers metadata without importing course files", async () => {
    const { result } = renderHook(useCloudCatalog);
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toMatchObject({ identity: "account-a", signedIn: true });
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("does not open a connection when the build has no cloud configuration", () => {
    mocks.configured.mockReturnValue(false);
    const { result } = renderHook(useCloudCatalog);
    expect(result.current.state.status).toBe("unconfigured");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not subscribe or fetch after an unmounted view's auth request resolves", async () => {
    const delayed = deferred<ReturnType<typeof session>>(); mocks.session.mockReturnValue(delayed.promise);
    const { unmount } = renderHook(useCloudCatalog);
    await waitFor(() => expect(mocks.session).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { delayed.resolve(session("account-a")); await delayed.promise; });
    expect(mocks.subscribe).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("drops the old account's pending response when the account changes", async () => {
    const first = deferred<CloudCatalog>(), second = deferred<CloudCatalog>();
    mocks.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(useCloudCatalog);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    const oldSignal = mocks.list.mock.calls[0][0] as AbortSignal;
    mocks.session.mockResolvedValue(session("account-b"));
    act(() => listeners[0]("SIGNED_IN", { user: { id: "account-b" } }));
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    const current: CloudCatalog = { releases: [], entries: [] };
    await act(async () => { second.resolve(current); await second.promise; });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready", identity: "account-b" }));
    await act(async () => { first.resolve({ releases: [], entries: [] }); await first.promise; });
    expect(result.current.state).toMatchObject({ status: "ready", identity: "account-b", catalog: current });
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
  it("does not reload or clear the catalog for a same-user token refresh", async () => {
    const { result } = renderHook(useCloudCatalog);
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => listeners[0]("TOKEN_REFRESHED", { user: { id: "account-a" } }));
    expect(result.current.state.status).toBe("ready"); expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
