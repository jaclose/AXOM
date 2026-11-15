import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountId: "owner",
  rpc: vi.fn(),
}));
vi.mock("../account/supabase", () => ({
  accountOperationClient: vi.fn(async () => ({
    userId: mocks.accountId,
    client: { rpc: mocks.rpc },
  })),
}));

import { shareAcademicCourses } from "./client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.accountId = "owner";
  mocks.rpc.mockReset();
});

describe("shared academic publication account scope", () => {
  it.each(["success", "error"] as const)(
    "rejects an account switch during an in-flight %s share result instead of reporting a stale outcome",
    async status => {
      const pending = deferred<{ error: Error | null }>();
      mocks.rpc.mockReturnValueOnce(pending.promise);
      let stillOwner = true;
      const assertCurrent = () => {
        if (!stillOwner) throw new Error("The account changed.");
      };
      const sharing = shareAcademicCourses(["first", "second"], "owner", { assertCurrent });
      await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
      stillOwner = false;
      pending.resolve({ error: status === "error" ? new Error("Backend failure") : null });
      await expect(sharing).rejects.toThrow("The account changed.");
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("reports clean same-account successes and failures without treating failed requests as shared", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("No access") });
    let checks = 0;
    const results = await shareAcademicCourses(["first", "second"], "owner", {
      assertCurrent: () => { checks++; },
    });
    expect(results).toEqual([
      { collectionId: "first", shared: true },
      { collectionId: "second", shared: false, error: "Sharing could not be requested for this course." },
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(checks).toBeGreaterThanOrEqual(4); // Before and after each RPC.
  });

  it("does not start another RPC after an aborted batch", async () => {
    const stop = new AbortController();
    mocks.rpc.mockImplementationOnce(async () => {
      stop.abort();
      return { error: null };
    });
    const results = await shareAcademicCourses(["first", "second"], "owner", { signal: stop.signal });
    expect(results).toEqual([{ collectionId: "first", shared: true }]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
