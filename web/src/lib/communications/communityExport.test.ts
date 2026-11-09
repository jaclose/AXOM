import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CommunicationsService } from "./server/service";
import { communityForExport } from "./server/privacy";

type Query = { table: string; filters: Record<string, unknown>; fields?: string; range?: [number, number] };
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number };
function fixture(answer: (query: Query) => Result) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, filters: {} };
    const chain = {
      select: (fields: string) => { query.fields = fields; return chain; },
      order: () => chain,
      eq: (name: string, value: unknown) => { query.filters[name] = value; return chain; },
      or: (value: string) => { query.filters.or = value; return chain; },
      range: (start: number, end: number) => { query.range = [start, end]; return chain; },
      then: (resolve: (result: Result) => unknown) => { queries.push(query); return Promise.resolve(answer(query)).then(resolve); },
    };
    return chain;
  });
  return { service: new CommunicationsService({ from } as unknown as SupabaseClient, {}), queries };
}
const empty = { data: [], error: null, count: 0 };

describe("Community account export ownership boundary", () => {
  it("exports every owned page, replies and preferences with explicit field projection", async () => {
    const posts = Array.from({ length: 501 }, (_, index) => ({ id: `post-${index}`, user_id: "account-a", caption: "Mine", unexpected_private_column: "omit" }));
    const { service, queries } = fixture(query => {
      if (query.table === "social_posts") return { data: posts.slice(query.range?.[0], (query.range?.[1] ?? 0) + 1), error: null, count: 501 };
      if (query.table === "social_comments") return { data: [{ id: "reply-a", user_id: "account-a", post_id: "other-post", body: "My reply" }], error: null, count: 1 };
      if (query.table === "social_preferences") return { data: [{ user_id: "account-a", discoverable: false, share_mode: "off", revision: 4 }], error: null, count: 1 };
      if (query.table === "social_progress_blocks") return { data: [{ user_id: "account-a", activity_day: "2026-11-05" }], error: null, count: 1 };
      if (query.table === "social_connections") return { data: [{ id: "friend-a", requester_id: "account-b", addressee_id: "account-a", status: "accepted", other_email: "omit" }], error: null, count: 1 };
      return empty;
    });
    const data = await communityForExport(service, "account-a");
    expect(data.posts).toHaveLength(501);
    expect((data.posts as Record<string, unknown>[])[0]).not.toHaveProperty("unexpected_private_column");
    expect((data.comments as Record<string, unknown>[])[0]).toMatchObject({ id: "reply-a", body: "My reply" });
    expect((data.comments as Record<string, unknown>[])[0]).not.toHaveProperty("user_id");
    expect(data.preferences).toEqual([{ discoverable: false, share_mode: "off", revision: 4, updated_at: undefined }]);
    expect(data.hiddenProgressDays).toHaveLength(1);
    expect((data.connections as Record<string, unknown>[])[0]).not.toHaveProperty("other_email");
    expect(queries.filter(query => query.table === "social_posts").map(query => query.range)).toEqual([[0, 499], [500, 999]]);
    expect(queries.find(query => query.table === "social_connections")?.filters.or).toBe("requester_id.eq.account-a,addressee_id.eq.account-a");
  });

  it.each(["social_posts", "social_comments", "social_preferences", "social_connections"])("refuses a foreign row returned by service role in %s", async table => {
    const { service } = fixture(query => query.table === table ? {
      data: [{ id: "foreign", user_id: "account-b", requester_id: "account-b", addressee_id: "account-c", activity_day: "2026-11-05" }], error: null, count: 1,
    } : empty);
    await expect(communityForExport(service, "account-a")).rejects.toThrow("community-export-invalid");
  });

  it("reports known absent staged tables but refuses other permission errors", async () => {
    const { service } = fixture(query => query.table === "social_comments"
      ? { data: null, error: { code: "42P01", message: "social_comments does not exist" } } : empty);
    const data = await communityForExport(service, "account-a");
    expect(data.unavailableTables).toEqual(["social_comments"]);
    const denied = fixture(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    await expect(communityForExport(denied.service, "account-a")).rejects.toThrow("community-export-unavailable");
  });

  it("rejects changing counts and duplicate rows instead of exporting a partial history", async () => {
    const page = Array.from({ length: 500 }, (_, index) => ({ id: `p-${index}`, user_id: "account-a" }));
    const changed = fixture(query => query.table === "social_posts" ? {
      data: query.range?.[0] === 0 ? page : [{ id: "p-500", user_id: "account-a" }], error: null, count: query.range?.[0] === 0 ? 501 : 502,
    } : empty);
    await expect(communityForExport(changed.service, "account-a")).rejects.toThrow("community-export-changed");
    const duplicate = fixture(query => query.table === "social_comments"
      ? { data: [{ id: "same", user_id: "account-a" }, { id: "same", user_id: "account-a" }], error: null, count: 2 } : empty);
    await expect(communityForExport(duplicate.service, "account-a")).rejects.toThrow("community-export-invalid");
  });
});
