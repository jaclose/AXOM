// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { useOperatorAccessStatus } from "./hostClient";

const account = vi.hoisted(() => {
  type State = { user: { id: string } | null };
  let state: State = { user: { id: "owner-account" } };
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (next: State, previous: State) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    change: (id: string | null) => {
      const previous = state;
      state = { user: id ? { id } : null };
      for (const listener of listeners) listener(state, previous);
    },
  };
});
vi.mock("../account/accountStore", () => ({
  useAccount: Object.assign((select: (state: ReturnType<typeof account.getState>) => unknown) => select(account.getState()), {
    getState: account.getState,
    subscribe: account.subscribe,
  }),
}));
vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));

const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  account.change("owner-account");
  vi.mocked(accountOperationClient).mockResolvedValue({
    userId: "owner-account",
    client: { rpc },
    assertCurrent: vi.fn().mockResolvedValue(undefined),
  } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
});
afterEach(cleanup);

describe("Host access recovery", () => {
  it("retries an unavailable role check without showing a stale owner badge", async () => {
    let resolveRole!: (response: { data: string; error: null }) => void;
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockReturnValueOnce(new Promise(resolve => { resolveRole = resolve; }));
    const { result } = renderHook(() => useOperatorAccessStatus());
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.role).toBeNull();

    act(() => result.current.retry());
    expect(result.current.state).toBe("checking");
    expect(result.current.role).toBeNull();
    await act(async () => { resolveRole({ data: "owner", error: null }); });
    await waitFor(() => expect(result.current.state).toBe("verified"));
    expect(result.current.role).toBe("owner");

    act(() => account.change(null));
    expect(result.current.state).toBe("signed-out");
    expect(result.current.role).toBeNull();
  });

  it("shares one answer across screens and keeps it through a background recheck", async () => {
    rpc.mockResolvedValueOnce({ data: "owner", error: null });
    const shell = renderHook(() => useOperatorAccessStatus());
    const route = renderHook(() => useOperatorAccessStatus());
    await waitFor(() => expect(shell.result.current.state).toBe("verified"));
    expect(route.result.current.role).toBe("owner");
    expect(rpc).toHaveBeenCalledTimes(1);

    let finishRecheck!: (response: { data: null; error: { message: string } }) => void;
    rpc.mockReturnValueOnce(new Promise(resolve => { finishRecheck = resolve; }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(shell.result.current.role).toBe("owner");
    await act(async () => { finishRecheck({ data: null, error: { message: "offline" } }); });
    expect(route.result.current.state).toBe("verified");

    rpc.mockResolvedValueOnce({ data: null, error: null });
    act(() => { window.dispatchEvent(new Event("axom:operator-access-changed")); });
    await waitFor(() => expect(shell.result.current.state).toBe("denied"));
    expect(route.result.current.role).toBeNull();

    act(() => account.change("another-account"));
    expect(shell.result.current.state).toBe("checking");
    expect(shell.result.current.role).toBeNull();
    // The scoped client still belongs to the first account, so this check fails closed.
    await waitFor(() => expect(shell.result.current.state).toBe("error"));
    expect(route.result.current.role).toBeNull();
  });

  it("checks the new account when the previous account's role is still pending", async () => {
    let finishOwner!: (response: { data: string; error: null }) => void;
    let finishMember!: (response: { data: null; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise(resolve => { finishOwner = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { finishMember = resolve; }));
    vi.mocked(accountOperationClient).mockImplementation(async () => ({
      userId: account.getState().user?.id,
      client: { rpc },
      assertCurrent: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof accountOperationClient>>));

    const shell = renderHook(() => useOperatorAccessStatus());
    const route = renderHook(() => useOperatorAccessStatus());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(shell.result.current.state).toBe("checking");

    act(() => account.change("pending-member-account"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(shell.result.current.state).toBe("checking");
    expect(route.result.current.role).toBeNull();

    await act(async () => { finishMember({ data: null, error: null }); });
    expect(shell.result.current.state).toBe("denied");
    expect(route.result.current.state).toBe("denied");

    await act(async () => { finishOwner({ data: "owner", error: null }); });
    expect(shell.result.current.state).toBe("denied");
    expect(shell.result.current.role).toBeNull();
    expect(route.result.current.state).toBe("denied");
    expect(route.result.current.role).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
