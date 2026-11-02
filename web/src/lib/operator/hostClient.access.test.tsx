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
});
