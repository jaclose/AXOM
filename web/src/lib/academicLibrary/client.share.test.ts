import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareAcademicCourses } from "./client";

const mocks = vi.hoisted(() => ({ accountOperationClient: vi.fn() }));
// Retain the real module contract: transitive accountStore imports cloudConfigured.
// Replace only the authenticated operation seam used by the sharing tests.
vi.mock("../account/supabase", async importOriginal => ({
  ...(await importOriginal<typeof import("../account/supabase")>()),
  accountOperationClient: mocks.accountOperationClient,
}));

describe("academic batch sharing account generation", () => {
  beforeEach(() => { mocks.accountOperationClient.mockReset(); });

  it("never reports an in-flight old-account RPC as current-account sharing or sends the next RPC", async () => {
    let finish!: (value: { data: null; error: null }) => void;
    let requestStarted!: () => void;
    const pending = new Promise<{ data: null; error: null }>(resolve => { finish = resolve; });
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    const rpc = vi.fn().mockImplementationOnce(() => {
      requestStarted();
      return pending;
    });
    mocks.accountOperationClient.mockResolvedValue({ userId: "owner-A", client: { rpc } });

    let accountIsCurrent = true;
    const assertCurrent = vi.fn(() => {
      if (!accountIsCurrent) throw new Error("The account changed during academic sharing.");
    });
    const sharing = shareAcademicCourses(["course-1", "course-2"], "owner-A", { assertCurrent });
    await started;
    accountIsCurrent = false;
    finish({ data: null, error: null });

    await expect(sharing).rejects.toThrow(/account changed/i);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("academic_set_visibility",
      { collection: "course-1", visibility: "shared", group_id: null });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  });


  it("does not report a cancelled in-flight share as a confirmed success or start another RPC", async () => {
    const abort = new AbortController();
    let finish!: (value: { data: null; error: null }) => void;
    let started!: () => void;
    const launched = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<{ data: null; error: null }>(resolve => { finish = resolve; });
    const rpc = vi.fn().mockImplementationOnce(() => { started(); return pending; });
    mocks.accountOperationClient.mockResolvedValue({ userId: "owner-A", client: { rpc } });
    const assertCurrent = vi.fn();

    const sharing = shareAcademicCourses(["course-1", "course-2"], "owner-A",
      { assertCurrent, signal: abort.signal });
    await launched;
    abort.abort();
    finish({ data: null, error: null });

    await expect(sharing).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  });

  it("keeps earlier confirmed sharing while withholding a later cancelled in-flight outcome", async () => {
    const abort = new AbortController();
    let finish!: (value: { data: null; error: null }) => void;
    let started!: () => void;
    const launched = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<{ data: null; error: null }>(resolve => { finish = resolve; });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockImplementationOnce(() => { started(); return pending; });
    mocks.accountOperationClient.mockResolvedValue({ userId: "owner-A", client: { rpc } });

    const sharing = shareAcademicCourses(["course-1", "course-2", "course-3"], "owner-A",
      { signal: abort.signal });
    await launched;
    abort.abort();
    finish({ data: null, error: null });

    await expect(sharing).resolves.toEqual([{ collectionId: "course-1", shared: true }]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not make any cloud share request if the account is already stale", async () => {
    const rpc = vi.fn();
    mocks.accountOperationClient.mockResolvedValue({ userId: "owner-A", client: { rpc } });
    await expect(shareAcademicCourses(["course-1"], "owner-A", {
      assertCurrent: () => { throw new Error("The account changed."); },
    })).rejects.toThrow(/account changed/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("continues valid per-course sharing, keeping genuine server errors attached to their own course", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied" } })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.accountOperationClient.mockResolvedValue({ userId: "owner-A", client: { rpc } });
    const assertCurrent = vi.fn();
    const results = await shareAcademicCourses(["course-1", "course-2"], "owner-A", { assertCurrent });
    expect(results).toEqual([
      { collectionId: "course-1", shared: false, error: "Sharing could not be requested for this course." },
      { collectionId: "course-2", shared: true },
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(assertCurrent).toHaveBeenCalledTimes(4);
  });
});
