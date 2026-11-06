import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { CommunityProfileMissingError, loadProgressBoard, readShareMode, saveShareMode, syncSharedProgress } from "./community";
import { SHARE_MODE_KEY } from "./progressBoard";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));
vi.mock("../academicLibrary/accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: () => {}, dispose: () => {} }) }));

type Query = { table: string; filters: Record<string, unknown>; insert?: Record<string, unknown>; update?: Record<string, unknown>; limit?: number };
type Response = { data: unknown; error: null | { code?: string; message: string } };
const ok = (data: unknown): Response => ({ data, error: null });

function mockBackend(answer: (query: Query) => Response) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, filters: {} };
    const builder = {
      select: () => builder, order: () => builder, range: () => builder,
      limit: (size: number) => { query.limit = size; return builder; },
      eq: (field: string, value: unknown) => { query.filters[field] = value; return builder; },
      neq: (field: string, value: unknown) => { query.filters[`neq:${field}`] = value; return builder; },
      gte: (field: string, value: unknown) => { query.filters[`gte:${field}`] = value; return builder; },
      in: (field: string, value: unknown[]) => { query.filters[`in:${field}`] = value; return builder; },
      insert: (value: Record<string, unknown>) => { query.insert = value; return builder; },
      update: (value: Record<string, unknown>) => { query.update = value; return builder; },
      then: (resolve: (response: Response) => unknown, reject?: (reason: unknown) => unknown) => {
        queries.push(query);
        return Promise.resolve().then(() => answer(query)).then(resolve, reject);
      },
    };
    return builder;
  });
  vi.mocked(accountOperationClient).mockResolvedValue({
    userId: "me", client: { from }, assertCurrent: async () => {},
  } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
  return queries;
}
const writes = (queries: Query[]) => queries.filter(query => query.insert || query.update);

beforeEach(() => vi.clearAllMocks());

describe("automatic daily sharing", () => {
  it("creates a shared day in the chosen audience, skipping empty days and days the server would call future", async () => {
    const queries = mockBackend(query => query.insert ? ok(null) : ok([]));
    const outcome = await syncSharedProgress("me", "friends", [
      { day: "2026-11-04", minutes: 0, cards: 0, questions: 0 },
      { day: "2026-11-05", minutes: 45, cards: 30, questions: 12 },
      { day: "2999-01-01", minutes: 5, cards: 0, questions: 0 },
    ]);
    expect(outcome.map(item => item.action)).toEqual(["skipped", "inserted", "skipped"]);
    expect(writes(queries)).toEqual([expect.objectContaining({ table: "social_posts", insert: expect.objectContaining({
      user_id: "me", kind: "progress", visibility: "friends", activity_day: "2026-11-05", minutes: 45, cards: 30, questions: 12, caption: "",
    }) })]);
  });

  it("raises a shared day to the larger figures and the current audience, and writes nothing when nothing changed", async () => {
    const existing = { id: "post-1", visibility: "friends", minutes: 60, cards: 5, questions: 20 };
    const queries = mockBackend(query => query.update ? ok([{ id: "post-1" }]) : ok([existing]));
    const outcome = await syncSharedProgress("me", "community", [{ day: "2026-11-05", minutes: 40, cards: 9, questions: 20 }]);
    expect(outcome[0].action).toBe("updated");
    expect(writes(queries)).toEqual([expect.objectContaining({ update: { minutes: 60, cards: 9, questions: 20, visibility: "community" },
      filters: expect.objectContaining({ id: "post-1", user_id: "me" }) })]);
    const quiet = mockBackend(() => ok([{ ...existing, visibility: "community", cards: 9 }]));
    expect((await syncSharedProgress("me", "community", [{ day: "2026-11-05", minutes: 40, cards: 9, questions: 20 }]))[0].action).toBe("unchanged");
    expect(writes(quiet)).toEqual([]);
  });

  it("never widens a day the learner kept as Only me", async () => {
    const queries = mockBackend(() => ok([{ id: "post-1", visibility: "private", minutes: 10, cards: 0, questions: 0 }]));
    expect((await syncSharedProgress("me", "friends", [{ day: "2026-11-05", minutes: 90, cards: 0, questions: 0 }]))[0].action).toBe("kept-private");
    expect(writes(queries)).toEqual([]);
  });

  it("updates the row another device created first instead of failing", async () => {
    let reads = 0;
    const queries = mockBackend(query => {
      if (query.insert) return { data: null, error: { code: "23505", message: "duplicate" } };
      if (query.update) return ok([{ id: "post-2" }]);
      reads++;
      return ok(reads === 1 ? [] : [{ id: "post-2", visibility: "friends", minutes: 30, cards: 0, questions: 0 }]);
    });
    expect((await syncSharedProgress("me", "friends", [{ day: "2026-11-05", minutes: 45, cards: 0, questions: 0 }]))[0].action).toBe("updated");
    expect(writes(queries).map(query => query.update?.minutes ?? "insert")).toEqual(["insert", 45]);
  });

  it("asks the learner to join Community when no profile exists", async () => {
    mockBackend(query => query.insert ? { data: null, error: { code: "23503", message: "fk" } } : ok([]));
    await expect(syncSharedProgress("me", "friends", [{ day: "2026-11-05", minutes: 5, cards: 0, questions: 0 }]))
      .rejects.toBeInstanceOf(CommunityProfileMissingError);
  });

  it("refuses totals outside the server's limits before any request", async () => {
    const queries = mockBackend(() => ok([]));
    await expect(syncSharedProgress("me", "friends", [{ day: "2026-11-05", minutes: 2000, cards: 0, questions: 0 }])).rejects.toThrow(/limits/);
    expect(queries).toEqual([]);
  });
});

describe("leaderboard data and the sharing choice", () => {
  it("loads shared progress since the period start, accepted friends and the authors' profiles", async () => {
    const queries = mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([{ user_id: "me", handle: "me_handle", display_name: "Me", bio: "", discoverable: false }]);
      if (query.table === "social_profiles") return ok([{ user_id: "ana", handle: "ana", display_name: "Ana", bio: "", discoverable: true }]);
      if (query.table === "social_connections") return ok([
        { id: "c1", requester_id: "me", addressee_id: "ana", status: "accepted" },
        { id: "c2", requester_id: "zed", addressee_id: "me", status: "pending" },
      ]);
      if (query.table === "social_posts") return ok([{ id: "p1", user_id: "ana", kind: "progress", visibility: "friends", activity_day: "2026-11-05",
        minutes: 30, cards: 0, questions: 4, set_title: null, caption: "", created_at: "2026-11-05T12:00:00Z" }]);
      throw new Error(`Unexpected ${query.table}`);
    });
    const data = await loadProgressBoard("me", "2026-10-07");
    expect(data.friendIds).toEqual(["ana"]);
    expect(data.me?.handle).toBe("me_handle");
    expect(data.profiles.map(item => item.user_id)).toEqual(["me", "ana"]);
    expect(queries.find(query => query.table === "social_posts")?.filters).toEqual({ kind: "progress", "neq:visibility": "private", "gte:activity_day": "2026-10-07" });
    await expect(loadProgressBoard("me", "last month")).rejects.toThrow(/period/);
  });

  it("reads and saves the choice on the signed-in account only", async () => {
    let metadata: Record<string, unknown> = { display_name: "Me" };
    const auth = {
      getUser: vi.fn(async () => ({ data: { user: { id: "me", user_metadata: metadata } }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "me" } } } })),
      updateUser: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        metadata = { ...metadata, ...data };
        return { data: { user: { id: "me", user_metadata: metadata } }, error: null };
      }),
    };
    vi.mocked(loadSupabase).mockResolvedValue({ auth } as unknown as Awaited<ReturnType<typeof loadSupabase>>);
    expect(await readShareMode("me")).toBe("off");
    await saveShareMode("me", "community");
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { [SHARE_MODE_KEY]: "community" } });
    expect(await readShareMode("me")).toBe("community");
    await expect(saveShareMode("someone-else", "friends")).rejects.toThrow(/account changed/);
    await expect(readShareMode("someone-else")).rejects.toThrow(/account changed/);
  });
});
