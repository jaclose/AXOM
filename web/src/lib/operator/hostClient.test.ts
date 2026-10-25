import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { operatorRole, setOperatorAI, validOperatorDashboard } from "./hostClient";
import { publishCommunityPost, setDiscoverable } from "../community/community";

const fixture = vi.hoisted(() => {
  type State = { user: { id: string } | null };
  let state: State = { user: { id: "account-a" } };
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (next: State, previous: State) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    change: (id: string | null) => { const previous = state; state = { user: id ? { id } : null }; listeners.forEach(listener => listener(state, previous)); },
  };
});
vi.mock("../account/accountStore", () => ({ useAccount: Object.assign(vi.fn(), { getState: fixture.getState, subscribe: fixture.subscribe }) }));
vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));

const rpc = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fixture.change("account-a");
  vi.mocked(accountOperationClient).mockResolvedValue({ userId: "account-a", client: { rpc, from }, assertCurrent: vi.fn().mockResolvedValue(undefined) } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("account-bound Host and Community requests", () => {
  it("rejects a delayed role response after switching away and back", async () => {
    const response = deferred<{ data: string; error: null }>();
    rpc.mockReturnValue(response.promise);
    const request = operatorRole("account-a");
    const rejected = expect(request).rejects.toThrow(/account changed/i);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    fixture.change("account-b"); fixture.change("account-a");
    response.resolve({ data: "owner", error: null });
    await rejected;
  });
  it("does not send a mutation if the account changes while credentials load", async () => {
    const pending = deferred<Awaited<ReturnType<typeof accountOperationClient>>>();
    vi.mocked(accountOperationClient).mockReturnValue(pending.promise);
    const request = setOperatorAI("account-a", "target", false, 0, "Permission review");
    const rejected = expect(request).rejects.toThrow(/account changed/i);
    fixture.change("account-b");
    pending.resolve({ userId: "account-a", client: { rpc }, assertCurrent: vi.fn() } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
    await rejected;
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires an audit reason before sending an AI policy change", async () => {
    await expect(setOperatorAI("account-a", "target", false, 0, "")).rejects.toThrow(/reason/i);
    expect(accountOperationClient).not.toHaveBeenCalled();
  });
  it("does not report Community mutation success to a different account", async () => {
    const response = deferred<{ data: null; error: null }>();
    const insert = vi.fn().mockReturnValue(response.promise);
    from.mockReturnValue({ insert });
    const request = publishCommunityPost("account-a", { kind: "question_set", visibility: "private", setTitle: "Synthetic set", caption: "A private milestone" });
    const rejected = expect(request).rejects.toThrow(/account changed/i);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
    fixture.change("account-b"); fixture.change("account-a");
    response.resolve({ data: null, error: null });
    await rejected;
  });
  it("requires one persisted profile row before confirming discovery changes", async () => {
    const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn() };
    query.update.mockReturnValue(query); query.eq.mockReturnValue(query); query.select.mockResolvedValue({ data: [], error: null });
    from.mockReturnValue(query);
    await expect(setDiscoverable("account-a", true)).rejects.toThrow(/could not be confirmed/i);
  });
  it("treats unavailable role lookup as an error, not a verified member role", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(operatorRole("account-a")).rejects.toThrow(/could not be checked/i);
  });
});

describe("Host response contract", () => {
  it("rejects fabricated counters and malformed account records", () => {
    const overview = { role: "owner", registered_accounts: 2, shared_profiles: 0, shared_posts: 0, reports_pending: 0, academic_review_pending: 0, academic_approved: 0, ai_requests_7d: 0 };
    const data = { role: "owner", overview, accounts: [], queue: [], reports: [], audit: [] };
    expect(validOperatorDashboard(data)).toBe(true);
    expect(validOperatorDashboard({ ...data, overview: { ...overview, registered_accounts: "2" } })).toBe(false);
    expect(validOperatorDashboard({ ...data, accounts: [{ user_id: "other" }] })).toBe(false);
    expect(validOperatorDashboard({ ...data, role: "member" })).toBe(false);
    expect(validOperatorDashboard({ ...data, audit: [{ id: "audit", actor_id: null, action: "role", target_id: null, metadata: {}, created_at: "2026-10-25" }] })).toBe(true);
  });
});
