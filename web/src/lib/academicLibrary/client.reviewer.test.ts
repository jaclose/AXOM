import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accountId: "owner", rpc: vi.fn() }));
vi.mock("../account/supabase", () => ({
  accountOperationClient: vi.fn(async () => ({ userId: mocks.accountId, client: { rpc: mocks.rpc } })),
}));

import { isAcademicReviewer } from "./client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { mocks.rpc.mockReset(); mocks.accountId = "owner"; });

describe("academic reviewer entitlement freshness", () => {
  it("rechecks an initially denied reviewer after rights are granted without a reload", async () => {
    mocks.accountId = "newly-granted";
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    expect(await isAcademicReviewer("newly-granted")).toBe(false);
    expect(await isAcademicReviewer("newly-granted")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("rechecks an initially approved reviewer after rights are revoked", async () => {
    mocks.accountId = "revoked";
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect(await isAcademicReviewer("revoked")).toBe(true);
    expect(await isAcademicReviewer("revoked")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("shares a concurrent in-flight RPC, then refreshes on the next request", async () => {
    mocks.accountId = "parallel";
    const pending = deferred<{ data: boolean; error: null }>();
    mocks.rpc.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ data: false, error: null });
    const first = isAcademicReviewer("parallel");
    const second = isAcademicReviewer("parallel");
    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    pending.resolve({ data: true, error: null });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await isAcademicReviewer("parallel")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("allows an unavailable reviewer RPC to recover on the next request", async () => {
    mocks.accountId = "retryable";
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") })
      .mockResolvedValueOnce({ data: true, error: null });
    expect(await isAcademicReviewer("retryable")).toBe(false);
    expect(await isAcademicReviewer("retryable")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
