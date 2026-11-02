import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { joinCommunity, loadCommunity, searchCommunityProfiles, type CommunityConnection, type CommunityProfile } from "./community";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("../academicLibrary/accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: () => {}, dispose: () => {} }) }));

type Query = {
  table: string;
  filters: Record<string, unknown>;
  limit?: number;
  range?: [number, number];
  insert?: unknown;
};
type Response = { data: unknown; error: null | { code?: string; message: string } };
const ok = (data: unknown): Response => ({ data, error: null });
const profile = (user_id: string, handle: string, discoverable = true): CommunityProfile => ({
  user_id, handle, display_name: handle, bio: "", discoverable,
});

function mockBackend(answer: (query: Query) => Response) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, filters: {} };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: (size: number) => { query.limit = size; return builder; },
      range: (first: number, last: number) => { query.range = [first, last]; return builder; },
      eq: (field: string, value: unknown) => { query.filters[field] = value; return builder; },
      ilike: (field: string, value: string) => { query.filters[`ilike:${field}`] = value; return builder; },
      in: (field: string, value: unknown[]) => { query.filters[`in:${field}`] = value; return builder; },
      insert: (value: unknown) => { query.insert = value; return builder; },
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

beforeEach(() => vi.clearAllMocks());

describe("Community account and directory loading", () => {
  it("keeps an existing owner profile beyond the first 100 directory rows", async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => profile(`user-${index}`, `a${String(index).padStart(3, "0")}`));
    const queries = mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([profile("me", "zzz_owner", false)]);
      if (query.table === "social_profiles") return ok(firstHundred);
      if (query.table === "social_connections" || query.table === "social_posts") return ok([]);
      throw new Error(`Unexpected ${query.table}`);
    });
    const snapshot = await loadCommunity("me");
    expect(snapshot.profiles).toHaveLength(101);
    expect(snapshot.profiles.find(item => item.user_id === "me")?.handle).toBe("zzz_owner");
    expect(snapshot.connectionsError).toBeUndefined();
    expect(queries).toContainEqual(expect.objectContaining({ table: "social_profiles", filters: { user_id: "me" }, limit: 1 }));
  });

  it("pages beyond 150 connections and loads their visible profiles", async () => {
    const connections: CommunityConnection[] = Array.from({ length: 151 }, (_, index) => ({
      id: `connection-${index}`, requester_id: "me", addressee_id: `friend-${index}`, status: "accepted",
    }));
    const queries = mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([profile("me", "owner", false)]);
      if (query.table === "social_profiles" && Array.isArray(query.filters["in:user_id"]))
        return ok((query.filters["in:user_id"] as string[]).map(id => profile(id, id)));
      if (query.table === "social_profiles") return ok([]);
      if (query.table === "social_connections") return ok(connections.slice(query.range?.[0] ?? 0, (query.range?.[1] ?? 0) + 1));
      if (query.table === "social_posts") return ok([]);
      throw new Error(`Unexpected ${query.table}`);
    });
    const snapshot = await loadCommunity("me");
    expect(snapshot.connections).toHaveLength(151);
    expect(snapshot.profiles.find(item => item.user_id === "friend-150")).toBeDefined();
    expect(queries.filter(query => query.table === "social_connections").map(query => query.range))
      .toEqual([[0, 149], [150, 299]]);
  });

  it("shows connection overflow without hiding the owner profile", async () => {
    mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([profile("me", "owner", false)]);
      if (query.table === "social_profiles" || query.table === "social_posts") return ok([]);
      if (query.table === "social_connections") return ok(Array.from({ length: 150 }, (_, index) => ({
        id: `${query.range?.[0]}-${index}`, requester_id: "me", addressee_id: `friend-${index}`, status: "accepted",
      })));
      throw new Error(`Unexpected ${query.table}`);
    });
    const snapshot = await loadCommunity("me");
    expect(snapshot.profiles.find(item => item.user_id === "me")).toBeDefined();
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.connectionsError).toMatch(/too large/);
  });

  it("keeps the owner profile when directory lookup fails", async () => {
    mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([profile("me", "owner", false)]);
      if (query.table === "social_profiles") return { data: null, error: { message: "temporary outage" } };
      if (query.table === "social_connections" || query.table === "social_posts") return ok([]);
      throw new Error(`Unexpected ${query.table}`);
    });
    const snapshot = await loadCommunity("me");
    expect(snapshot.profiles).toEqual([profile("me", "owner", false)]);
    expect(snapshot.directoryError).toMatch(/directory could not be loaded/);
  });

  it("searches both server fields, excludes hidden profiles, and never upserts an existing profile", async () => {
    const queries = mockBackend(query => {
      if (query.insert) return { data: null, error: { code: "23505", message: "duplicate" } };
      if (query.filters["ilike:handle"]) return ok([profile("older", "older_learner"), profile("hidden", "hidden", false)]);
      if (query.filters["ilike:display_name"]) return ok([profile("older", "older_learner")]);
      throw new Error(`Unexpected ${query.table}`);
    });
    await expect(searchCommunityProfiles("me", "  older  ")).resolves.toEqual([profile("older", "older_learner")]);
    expect(queries.filter(query => query.table === "social_profiles" && !query.insert).map(query => query.filters))
      .toEqual([{ discoverable: true, "ilike:handle": "%older%" }, { discoverable: true, "ilike:display_name": "%older%" }]);
    await expect(joinCommunity("me", "existing", "Existing learner")).rejects.toThrow(/profile already exists/);
    expect(queries.find(query => query.insert)?.insert).toMatchObject({ user_id: "me", handle: "existing" });
  });
});
