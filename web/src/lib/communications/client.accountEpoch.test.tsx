// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "admin-a" as string | null,
  invoke: vi.fn(),
}));
vi.mock("../account/accountStore", () => ({
  useAccount: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("../account/supabase", () => ({
  loadSupabase: async () => ({ functions: { invoke: mocks.invoke } }),
}));

const { useCommunications } = await import("./client");
type SettingsResponse = {
  data: {
    preferences: never[]; identity: { accent: string; theme: "dark" };
    history: never[]; privacy: never[]; admin: boolean;
    deliveryMode: string; deletionEnabled: boolean; hasProtectedCopy: boolean;
  };
  error: null;
};
function response(label: string, admin = true): SettingsResponse {
  return { data: { preferences: [], identity: { accent: "gold", theme: "dark" },
    history: [], privacy: [], admin, deliveryMode: label,
    deletionEnabled: false, hasProtectedCopy: false }, error: null };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.userId = "admin-a";
  mocks.invoke.mockReset();
});
afterEach(() => { cleanup(); });

describe("communications settings account epoch and request ownership", () => {
  it("rejects first-A settings after A→B→A and accepts the newest A settings", async () => {
    const firstA = pending<SettingsResponse>();
    const B = pending<SettingsResponse>();
    const nextA = pending<SettingsResponse>();
    mocks.invoke
      .mockImplementationOnce(() => firstA.promise)
      .mockImplementationOnce(() => B.promise)
      .mockImplementationOnce(() => nextA.promise);
    const { result, rerender } = renderHook(() => useCommunications());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    act(() => { mocks.userId = "admin-b"; rerender(); });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    act(() => { mocks.userId = "admin-a"; rerender(); });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(3));

    await act(async () => { nextA.resolve(response("latest A", false)); await nextA.promise; });
    expect(result.current.data?.deliveryMode).toBe("latest A");
    expect(result.current.data?.admin).toBe(false);
    await act(async () => { firstA.resolve(response("old A", true)); await firstA.promise; });
    expect(result.current.data?.deliveryMode).toBe("latest A");
    expect(result.current.data?.admin).toBe(false);
    await act(async () => { B.resolve(response("late B", true)); await B.promise; });
    expect(result.current.data?.deliveryMode).toBe("latest A");
    expect(result.current.loading).toBe(false);
  });

  it("lets only the latest concurrent same-owner reload set settings and error", async () => {
    const older = pending<SettingsResponse>();
    const newer = pending<SettingsResponse>();
    mocks.invoke.mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result } = renderHook(() => useCommunications());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    await act(async () => { void result.current.reload(); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    await act(async () => { newer.resolve(response("newest", false)); await newer.promise; });
    expect(result.current.data?.deliveryMode).toBe("newest");
    await act(async () => { older.resolve(response("older", true)); await older.promise; });
    expect(result.current.data?.deliveryMode).toBe("newest");
    expect(result.current.data?.admin).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("does not retain an old loading state or admin settings after sign-out", async () => {
    const old = pending<SettingsResponse>();
    mocks.invoke.mockImplementationOnce(() => old.promise);
    const { result, rerender } = renderHook(() => useCommunications());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);
    act(() => { mocks.userId = null; rerender(); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain("Sign in");
    await act(async () => { old.resolve(response("old admin")); await old.promise; });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("clears an old admin permission at refresh start and fails closed if refresh fails", async () => {
    const failing = pending<{ data: null; error: Error }>();
    mocks.invoke.mockResolvedValueOnce(response("initial admin", true))
      .mockImplementationOnce(() => failing.promise);
    const { result } = renderHook(() => useCommunications());
    await waitFor(() => expect(result.current.data?.admin).toBe(true));
    await act(async () => { void result.current.reload(); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => { failing.resolve({ data: null, error: new Error("offline") }); await failing.promise; });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("Communications could not be reached");
  });
});
