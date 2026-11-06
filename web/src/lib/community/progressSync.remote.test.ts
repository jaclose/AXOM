import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { CommunityProfileMissingError, CommunityProgressConflictError, loadProgressBoard, readCommunityPreferences, saveCommunityPreferences, readShareMode, saveShareMode, syncSharedProgress } from "./community";
import { resetCommunityProgressRevisionsForTests } from "./progressSync";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("../academicLibrary/accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: () => {}, dispose: () => {} }) }));

type Query = { table?: string; rpc?: string; args?: Record<string, unknown>; filters: Record<string, unknown>; range?: [number, number]; limit?: number; signal?: AbortSignal };
type Response = { data: unknown; error: null | { code?: string; message: string } };
const ok = (data: unknown): Response => ({ data, error: null });
const preference = { discoverable: true, shareMode: "friends", revision: 3 };
const entry = { day: "2026-11-05", minutes: 45, cards: 30, questions: 12 };
const existing = { id: "post-1", visibility: "friends", share_source: "automatic", minutes: 45, cards: 30, questions: 12, revision: 2 };

function mockBackend(answer: (query: Query) => Response | Promise<Response>) {
  const queries: Query[] = [];
  function builder(query: Query) {
    const result = {
      select: () => result, order: () => result,
      range: (first: number, last: number) => { query.range = [first, last]; return result; },
      limit: (size: number) => { query.limit = size; return result; },
      eq: (field: string, value: unknown) => { query.filters[field] = value; return result; },
      neq: (field: string, value: unknown) => { query.filters[`neq:${field}`] = value; return result; },
      gte: (field: string, value: unknown) => { query.filters[`gte:${field}`] = value; return result; },
      in: (field: string, value: unknown[]) => { query.filters[`in:${field}`] = value; return result; },
      abortSignal: (signal: AbortSignal) => { query.signal = signal; return result; },
      then: (resolve: (response: Response) => unknown, reject?: (reason: unknown) => unknown) => {
        queries.push(query);
        return Promise.resolve().then(() => answer(query)).then(resolve, reject);
      },
    };
    return result;
  }
  const client = { from: (table: string) => builder({ table, filters: {} }), rpc: (rpc: string, args?: Record<string, unknown>) => builder({ rpc, args, filters: {} }) };
  vi.mocked(accountOperationClient).mockResolvedValue({ userId: "me", client, assertCurrent: async () => {} } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
  return queries;
}
const uploads = (queries: Query[]) => queries.filter(query => query.rpc === "axom_sync_community_day");
beforeEach(() => { vi.clearAllMocks(); resetCommunityProgressRevisionsForTests(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("automatic daily sharing with server consent and conflict control", () => {
  it("shares the learner's local day immediately when it is tomorrow in UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T22:30:00Z"));
    // A UTC+3 browser's local fields differ from the same instant's UTC date.
    vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
    vi.spyOn(Date.prototype, "getMonth").mockReturnValue(10);
    vi.spyOn(Date.prototype, "getDate").mockReturnValue(6);
    const queries = mockBackend(query => query.rpc === "axom_community_preferences" ? ok(preference)
      : query.rpc === "axom_sync_community_day" ? ok({ action: "inserted", revision: 1 }) : ok([]));
    expect(await syncSharedProgress("me", "friends", [{ ...entry, day: "2026-11-06" }]))
      .toEqual([{ day: "2026-11-06", action: "inserted" }]);
    expect(uploads(queries)[0].args?.p_day).toBe("2026-11-06");
  });

  it("sends bounded totals with the server's consent revision and no private log payload", async () => {
    const queries = mockBackend(query => query.rpc === "axom_community_preferences" ? ok(preference)
      : query.rpc === "axom_sync_community_day" ? ok({ action: query.args?.p_minutes ? "inserted" : "skipped", revision: query.args?.p_minutes ? 1 : 0 }) : ok([]));
    const outcome = await syncSharedProgress("me", "friends", [
      { day: "2026-11-04", minutes: 0, cards: 0, questions: 0 }, entry, { ...entry, day: "2999-01-01" },
    ]);
    expect(outcome.map(item => item.action)).toEqual(["skipped", "inserted", "skipped"]);
    expect(uploads(queries)[1].args).toEqual({ p_day: entry.day, p_minutes: 45, p_cards: 30, p_questions: 12, p_consent_revision: 3, p_expected_revision: 0 });
    expect(uploads(queries)).toHaveLength(2);
  });

  it("allows a corrected lower value only after confirming the same version, without fieldwise maxima", async () => {
    let current = { ...existing };
    const queries = mockBackend(query => {
      if (query.rpc === "axom_community_preferences") return ok(preference);
      if (query.rpc === "axom_sync_community_day") {
        const unchanged = query.args?.p_minutes === current.minutes;
        if (!unchanged) current = { ...current, minutes: Number(query.args?.p_minutes), revision: current.revision + 1 };
        return ok({ action: unchanged ? "unchanged" : "updated", revision: current.revision });
      }
      return ok([current]);
    });
    expect((await syncSharedProgress("me", "friends", [entry]))[0].action).toBe("unchanged");
    expect((await syncSharedProgress("me", "friends", [{ ...entry, minutes: 10 }]))[0].action).toBe("updated");
    expect(uploads(queries)[1].args).toMatchObject({ p_minutes: 10, p_expected_revision: 2 });
  });

  it("does not adopt a different existing day's revision on a fresh or stale device", async () => {
    const queries = mockBackend(query => query.rpc === "axom_community_preferences" ? ok(preference)
      : query.rpc === "axom_sync_community_day" ? ok({ action: "conflict", revision: 7 }) : ok([{ ...existing, minutes: 10, revision: 7 }]));
    await expect(syncSharedProgress("me", "friends", [entry])).rejects.toBeInstanceOf(CommunityProgressConflictError);
    expect(uploads(queries)[0].args?.p_expected_revision).toBeNull();
  });

  it.each(["manual", "withdrawn"])("never overwrites %s days", async share_source => {
    const queries = mockBackend(query => query.rpc === "axom_community_preferences" ? ok(preference) : ok([{ ...existing, share_source }]));
    expect((await syncSharedProgress("me", "friends", [entry]))[0].action).toBe("kept-private");
    expect(uploads(queries)).toEqual([]);
  });

  it("rejects an obsolete consent revision before any write", async () => {
    const queries = mockBackend(() => ok(preference));
    await expect(syncSharedProgress("me", "friends", [entry], { consentRevision: 2 })).rejects.toThrow(/choice changed/);
    expect(uploads(queries)).toEqual([]);
  });

  it("checks abort after a delayed read and before the write", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const queries = mockBackend(query => query.rpc ? ok(preference) : new Promise(resolve => { finish = resolve; }));
    const promise = syncSharedProgress("me", "friends", [entry], { signal: controller.signal });
    const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    finish(ok([]));
    await rejected;
    expect(uploads(queries)).toEqual([]);
  });

  it("maps server-side revocation and missing-profile refusals to useful statuses", async () => {
    for (const code of ["PT409", "PT412"]) {
      mockBackend(query => query.rpc === "axom_community_preferences" ? ok(preference)
        : query.rpc ? { data: null, error: { code, message: "Server refused" } } : ok([]));
      if (code === "PT412") await expect(syncSharedProgress("me", "friends", [entry])).rejects.toBeInstanceOf(CommunityProfileMissingError);
      else await expect(syncSharedProgress("me", "friends", [entry])).rejects.toThrow(/choice changed/);
    }
  });

  it("refuses invalid totals and normalized impossible dates before any request", async () => {
    const queries = mockBackend(() => ok([]));
    await expect(syncSharedProgress("me", "friends", [{ ...entry, minutes: 2000 }])).rejects.toThrow(/limits/);
    await expect(syncSharedProgress("me", "friends", [{ ...entry, day: "2026-02-30" }])).rejects.toThrow(/limits/);
    expect(queries).toEqual([]);
  });
});

describe("leaderboard data and account sharing preferences", () => {
  it("loads every page before ranking and resolves every author's visible profile", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: `p${index}`, user_id: "ana", kind: "progress", visibility: "friends", activity_day: "2026-11-05",
      minutes: 30, cards: 0, questions: 4, set_title: null, caption: "", created_at: "2026-11-05T12:00:00Z" }));
    const queries = mockBackend(query => {
      if (query.table === "social_profiles" && query.filters.user_id === "me") return ok([{ user_id: "me", handle: "me_handle", display_name: "Me", bio: "", discoverable: false }]);
      if (query.table === "social_profiles") return ok([{ user_id: "ana", handle: "ana", display_name: "Ana", bio: "", discoverable: true }]);
      if (query.table === "social_connections") return ok([{ id: "c1", requester_id: "me", addressee_id: "ana", status: "accepted" }]);
      if (query.table === "social_posts") return ok(rows.slice(query.range?.[0], (query.range?.[1] ?? 0) + 1));
      throw new Error("Unexpected query");
    });
    const data = await loadProgressBoard("me", "2026-10-07");
    expect(data.friendIds).toEqual(["ana"]);
    expect(data.posts).toHaveLength(501);
    expect(data.profiles.map(item => item.user_id)).toEqual(["me", "ana"]);
    expect(queries.filter(query => query.table === "social_posts").map(query => query.range)).toEqual([[0, 499], [500, 999]]);
    await expect(loadProgressBoard("me", "last month")).rejects.toThrow(/period/);
  });

  it("reads and saves validated preferences through account-bound RPCs", async () => {
    let stored = { ...preference, shareMode: "off" };
    const queries = mockBackend(query => {
      if (query.rpc === "axom_save_community_preferences") stored = { discoverable: Boolean(query.args?.p_discoverable), shareMode: String(query.args?.p_share_mode), revision: stored.revision + 1 };
      return ok(stored);
    });
    expect(await readShareMode("me")).toBe("off");
    expect(await saveCommunityPreferences("me", { discoverable: false, shareMode: "community" })).toEqual({ discoverable: false, shareMode: "community", revision: 4 });
    await saveShareMode("me", "friends");
    expect(await readCommunityPreferences("me")).toEqual({ discoverable: false, shareMode: "friends", revision: 5 });
    expect(queries.filter(query => query.rpc === "axom_save_community_preferences")[1].args).toEqual({ p_discoverable: false, p_share_mode: "friends" });
    await expect(saveShareMode("someone-else", "friends")).rejects.toThrow(/account changed/);
  });

  it("fails closed on missing service/malformed preference data rather than trusting auth metadata", async () => {
    mockBackend(() => ({ data: null, error: { code: "PGRST202", message: "Not migrated" } }));
    await expect(readCommunityPreferences("me")).rejects.toThrow(/could not be checked/);
    mockBackend(() => ok({ ...preference, shareMode: "everyone" }));
    await expect(readCommunityPreferences("me")).rejects.toThrow(/could not be confirmed/);
  });
});
