import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import {
  deleteCommunityComment, editCommunityComment, editCommunityPost, loadCommunityComments,
  loadCommunityProfile, publishCommunityComment, updateCommunityProfile,
} from "./conversations";
import type { CommunityPost, CommunityProfile } from "./community";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("../academicLibrary/accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: () => {}, dispose: () => {} }) }));

type Query = { table: string; fields?: string; filters: Record<string, unknown>; range?: [number, number]; insert?: unknown; update?: unknown; deleted?: boolean };
type Response = { data: unknown; error: null | { code?: string; message: string } };
const ok = (data: unknown): Response => ({ data, error: null });
const profile: CommunityProfile = { user_id: "learner", handle: "learner", display_name: "A learner", bio: "", discoverable: true };
const reply = { id: "r1", post_id: "p1", user_id: "learner", body: "We can study together", created_at: "2026-11-05T14:00:00Z", updated_at: "2026-11-05T14:00:00Z" };
const progress: CommunityPost = { id: "day", user_id: "learner", kind: "progress", visibility: "friends", activity_day: "2026-11-05",
  minutes: 40, cards: 20, questions: 5, caption: "", set_title: null, created_at: "2026-11-05T10:00:00Z", revision: 1 };

function backend(answer: (query: Query) => Response) {
  const queries: Query[] = [];
  const client = { from: (table: string) => {
    const query: Query = { table, filters: {} };
    const builder = {
      select: (fields: string) => { query.fields = fields; return builder; },
      order: () => builder, limit: () => builder,
      eq: (field: string, value: unknown) => { query.filters[field] = value; return builder; },
      gte: (field: string, value: unknown) => { query.filters[`gte:${field}`] = value; return builder; },
      in: (field: string, value: unknown) => { query.filters[`in:${field}`] = value; return builder; },
      range: (first: number, last: number) => { query.range = [first, last]; return builder; },
      insert: (value: unknown) => { query.insert = value; return builder; },
      update: (value: unknown) => { query.update = value; return builder; },
      delete: () => { query.deleted = true; return builder; },
      then: (resolve: (response: Response) => unknown, reject?: (reason: unknown) => unknown) => {
        queries.push(query);
        return Promise.resolve().then(() => answer(query)).then(resolve, reject);
      },
    };
    return builder;
  } };
  vi.mocked(accountOperationClient).mockResolvedValue({ userId: "me", client, assertCurrent: async () => {} } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
  return queries;
}
beforeEach(() => vi.clearAllMocks());

describe("Community conversation visibility and author changes", () => {
  it("uses the revision captured when editing began and keeps a stale edit from overwriting new content", async () => {
    const queries = backend(query => ok(query.update ? [] : [{ id: "p1", kind: "update", revision: 5 }]));
    await expect(editCommunityPost("me", "p1", { caption: "My saved draft", visibility: "friends", expectedRevision: 3 }))
      .rejects.toThrow(/changed on another device/);
    expect(queries.find(query => query.update)).toMatchObject({ update: { caption: "My saved draft", visibility: "friends" }, filters: { id: "p1", user_id: "me", revision: 3 } });
  });

  it("does not replace text posts with an empty caption or write profile sharing preferences", async () => {
    const queries = backend(query => ok(query.table === "social_profiles" ? [{ user_id: "me" }] : [{ id: "p1", kind: "study_invite", revision: 1 }]));
    await expect(editCommunityPost("me", "p1", { caption: "   ", visibility: "community", expectedRevision: 1 })).rejects.toThrow(/Write something/);
    await updateCommunityProfile("me", { handle: "  My_Handle  ", displayName: " My name ", bio: " Hello " });
    expect(queries.filter(query => query.update)).toEqual([expect.objectContaining({
      table: "social_profiles", filters: { user_id: "me" }, update: { handle: "my_handle", display_name: "My name", bio: "Hello" },
    })]);
  });

  it("reports a post withdrawn while replies were loading instead of showing a successful empty thread", async () => {
    let postReads = 0;
    const queries = backend(query => query.table === "social_posts" ? ok(++postReads === 1 ? [{ id: "p1" }] : []) : ok([]));
    await expect(loadCommunityComments("me", "p1")).rejects.toThrow(/no longer available/);
    expect(queries.some(query => query.table === "social_profiles")).toBe(false);
  });

  it("paginates replies and attaches only visible author profiles with a graceful hidden-author fallback", async () => {
    const queries = backend(query => query.table === "social_posts" ? ok([{ id: "p1" }])
      : query.table === "social_profiles" ? ok([profile]) : ok([reply, { ...reply, id: "r2", user_id: "hidden" }]));
    const comments = await loadCommunityComments("me", "p1", 100);
    expect(comments[0].author).toEqual({ user_id: "learner", handle: "learner", display_name: "A learner" });
    expect(comments[1].author).toBeUndefined();
    expect(queries.find(query => query.table === "social_comments")?.range).toEqual([100, 199]);
  });

  it("binds a new reply to the requester, validates the body, and rejects denied writes", async () => {
    const queries = backend(query => query.insert ? { data: null, error: { code: "42501", message: "Denied" } } : ok([]));
    await expect(publishCommunityComment("me", "p1", "   ")).rejects.toThrow(/1 to 500/);
    await expect(publishCommunityComment("me", "p1", "x".repeat(501))).rejects.toThrow(/1 to 500/);
    expect(queries).toEqual([]);
    await expect(publishCommunityComment("me", "p1", " Let's join ")).rejects.toThrow(/audience changed/);
    expect(queries[0].insert).toEqual({ user_id: "me", post_id: "p1", body: "Let's join" });
    await expect(publishCommunityComment("someone-else", "p1", "No cross-account draft")).rejects.toThrow(/account changed/);
    expect(queries).toHaveLength(1);
  });

  it("compares the original reply timestamp and permits host removal through server RLS", async () => {
    const queries = backend(() => ok([]));
    await expect(editCommunityComment("me", "r1", "Changed draft", reply.updated_at)).rejects.toThrow(/changed on another device/);
    expect(queries[0]).toMatchObject({ update: { body: "Changed draft" }, filters: { id: "r1", user_id: "me", updated_at: reply.updated_at } });
    await deleteCommunityComment("me", "r1");
    expect(queries[1]).toMatchObject({ deleted: true, filters: { id: "r1" } });
  });

  it("does not request hidden profile activity and preserves month totals behind a busy feed", async () => {
    const hidden = backend(() => ok([]));
    expect(await loadCommunityProfile("me", "hidden")).toEqual({ profile: null, posts: [] });
    expect(hidden.map(query => query.table)).toEqual(["social_profiles"]);
    const updates = Array.from({ length: 100 }, (_, index) => ({ ...progress, id: `u${index}`, kind: "update", activity_day: null, minutes: 0, cards: 0, questions: 0, caption: "A conversation" }));
    backend(query => query.table === "social_profiles" ? ok([profile]) : ok(query.filters.kind === "progress" ? [progress] : updates));
    const visible = await loadCommunityProfile("me", "learner");
    expect(visible.posts).toHaveLength(101);
    expect(visible.posts.find(post => post.id === "day")?.minutes).toBe(40);
  });
});
