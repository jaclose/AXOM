import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createCommunicationsHandler } from "./server/handler";

const ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jwt = `header.${btoa(JSON.stringify({ sub: ID, session_id: SESSION, amr: [{ timestamp: Math.floor(Date.now()/1000)-10 }] }))}.sig`;

describe("bounded malformed authenticated deletion attempts", () => {
  it("counts malformed JSON before body parsing and rejects the thirteenth attempt", async () => {
    let attempts = 0;
    const rpc = vi.fn(async (_name: string, options: { p_key: string }) => ({ data: options.p_key.endsWith(":attempt") ? ++attempts <= 12 : true, error: null }));
    const from = vi.fn();
    const auth = { getUser: vi.fn(async () => ({ data: { user: { id: ID } as User }, error: null })) };
    const handler = createCommunicationsHandler({ auth, from, rpc } as unknown as SupabaseClient, { AXOM_ACCOUNT_DELETION_ENABLED: "true" });
    const post = () => handler(new Request("https://axom.invalid?action=request-deletion", {
      method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: "{bad",
    }));
    for (let i = 0; i < 12; i++) expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(429);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(13);
    expect(rpc).toHaveBeenCalledWith("consume_communication_limit", {
      p_key: `${ID}:request-deletion:attempt`, p_limit: 12, p_seconds: 3600,
    });
  });
});
