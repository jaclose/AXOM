import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createCommunicationsHandler } from "./server/handler";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = () => Math.floor(Date.now() / 1000);
function bearer(id = A, session = SA, recent = true) {
  return `header.${btoa(JSON.stringify({
    sub: id, session_id: session,
    amr: [{ timestamp: now() - (recent ? 30 : 3600) }],
  }))}.signature`;
}
function harness() {
  const user = { id: A, email: "owner@example.invalid", email_confirmed_at: "2026-11-01T00:00:00Z" } as unknown as User;
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));
  const getUserById = vi.fn(async () => ({ data: { user }, error: null }));
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => ({ data: { id: "privacy-request-id" }, error: null }) }),
  }));
  const from = vi.fn(() => ({ insert }));
  const db = { auth: { getUser, admin: { getUserById } }, from, rpc } as unknown as SupabaseClient;
  const handler = createCommunicationsHandler(db, { AXOM_ACCOUNT_DELETION_ENABLED: "true" });
  const invoke = (payload: Record<string, unknown>, token = bearer()) =>
    handler(new Request("https://axom.invalid?action=request-deletion", {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT", ...payload }),
    }));
  return { invoke, rpc, insert, from, getUser };
}
describe("account deletion intent verified against the authenticated bearer (no production data)", () => {
  it.each([
    ["missing identity", {}],
    ["missing session", { actorUserId: A }],
    ["foreign account", { actorUserId: B, actorSessionId: SA }],
    ["foreign session after A→B→A", { actorUserId: A, actorSessionId: SB }],
    ["malformed account", { actorUserId: "account-a", actorSessionId: SA }],
    ["malformed session", { actorUserId: A, actorSessionId: "not-a-session" }],
  ])("fails closed for %s before rate limiting or scheduling", async (_name, payload) => {
    const h = harness();
    const response = await h.invoke(payload);
    expect(response.status).toBe(403);
    expect(h.rpc).toHaveBeenCalledWith("consume_communication_limit", {
      p_key: `${A}:request-deletion:attempt`, p_limit: 12, p_seconds: 3600,
    });
    expect(h.from).not.toHaveBeenCalled();
  });
  it("rejects bearer subject disagreement even when actor matches authenticated user", async () => {
    const h = harness();
    const response = await h.invoke({ actorUserId: A, actorSessionId: SA }, bearer(B, SA));
    expect(response.status).toBe(403);
    expect(h.from).not.toHaveBeenCalled();
  });
  it("rejects valid actor with old reauthentication", async () => {
    const h = harness();
    const response = await h.invoke({ actorUserId: A, actorSessionId: SA }, bearer(A, SA, false));
    expect(response.status).toBe(403);
    expect(h.from).not.toHaveBeenCalled();
  });
  it("allows a matching verified actor/session through to scheduling", async () => {
    const h = harness();
    const result = await h.invoke({ actorUserId: A, actorSessionId: SA });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ requested: true });
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: A, kind: "deletion" }));
  });
  it("fails closed if deletion is feature-disabled", async () => {
    const h = harness();
    // No network or account mutation: server configuration alone rejects.
    const disabled = createCommunicationsHandler({
      auth: { getUser: h.getUser }, rpc: h.rpc, from: h.from,
    } as unknown as SupabaseClient, { AXOM_ACCOUNT_DELETION_ENABLED: "false" });
    const response = await disabled(new Request("https://axom.invalid?action=request-deletion", {
      method: "POST", headers: { authorization: `Bearer ${bearer()}` },
      body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT", actorUserId: A, actorSessionId: SA }),
    }));
    expect(response.status).toBe(503);
    expect(h.from).not.toHaveBeenCalled();
  });
});
