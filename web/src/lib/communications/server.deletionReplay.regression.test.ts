import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunicationsService } from "./server/service";
import { requestPrivacy } from "./server/privacy";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fixture(insertError: string | null = null, existing: Array<{ status: string; failure_code: string | null }> = []) {
  const insert = vi.fn((values: Record<string, unknown>) => ({
    select: () => ({ single: async () => insertError
      ? { data: null, error: { code: insertError, message: "constraint violation" } }
      : { data: { id: "new-request" }, error: null } }),
    values,
  }));
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: existing, error: null })),
  };
  const from = vi.fn(() => ({ insert, select: vi.fn(() => query) }));
  const enqueue = vi.fn(async () => undefined);
  const service = {
    db: { from } as unknown as SupabaseClient,
    user: vi.fn(async () => ({ id: OWNER, email: "owner@example.invalid", email_confirmed_at: "2026-11-01T00:00:00Z" })),
    enqueue,
  } as unknown as CommunicationsService;
  return { service, insert, query, enqueue };
}

describe("deletion consent session tombstone", () => {
  it("rejects missing/invalid session before any privacy storage call", async () => {
    const h = fixture();
    await expect(requestPrivacy(h.service, OWNER, "deletion")).rejects.toThrow(/verified sign-in session/);
    await expect(requestPrivacy(h.service, OWNER, "deletion", "wrong")).rejects.toThrow(/verified sign-in session/);
    expect(h.insert).not.toHaveBeenCalled();
  });
  it("does not reschedule a cancelled consent for the same signed-in session", async () => {
    const h = fixture("23505", [{ status: "cancelled", failure_code: null }]);
    await expect(requestPrivacy(h.service, OWNER, "deletion", OLD)).rejects.toThrow(/session is closed/);
    expect(h.query.eq).toHaveBeenCalledWith("actor_session_id", OLD);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("keeps an active same-session retry idempotent without another notification", async () => {
    const h = fixture("23505", [{ status: "scheduled", failure_code: null }]);
    await expect(requestPrivacy(h.service, OWNER, "deletion", OLD)).resolves.toBeUndefined();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("rejects an active collision belonging to another session rather than treating it as success", async () => {
    const h = fixture("23505");
    await expect(requestPrivacy(h.service, OWNER, "deletion", NEW)).rejects.toThrow(/already pending/);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("binds a fresh deletion to a new session but never attaches an actor to exports", async () => {
    const deletion = fixture();
    await requestPrivacy(deletion.service, OWNER, "deletion", NEW);
    expect(deletion.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "deletion", actor_session_id: NEW }));
    expect(deletion.enqueue).toHaveBeenCalledTimes(2);
    const exported = fixture();
    await requestPrivacy(exported.service, OWNER, "export");
    expect(exported.insert).toHaveBeenCalledWith(expect.not.objectContaining({ actor_session_id: expect.anything() }));
    expect(exported.enqueue).toHaveBeenCalledTimes(1);
  });
});
