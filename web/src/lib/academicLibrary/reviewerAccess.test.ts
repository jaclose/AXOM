import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operation: vi.fn(), rpc: vi.fn(), assertCurrent: vi.fn() }));
vi.mock("../account/supabase", () => ({ accountOperationClient: mocks.operation }));
vi.mock("../store", () => ({ useStore: { getState: vi.fn() } }));
vi.mock("./contentReferences", () => ({ academicBindings: vi.fn() }));
vi.mock("../question-content/assets", () => ({ sha256: vi.fn() }));
vi.mock("../privateLibrary/install", () => ({ installPrivateLibrary: vi.fn(), safeLibraryPath: (path: string) => path }));
vi.mock("./explanationReview", () => ({ attestAcademicExplanations: vi.fn() }));

import { isAcademicReviewer } from "./client";

function currentAccount(id: string) {
  mocks.operation.mockResolvedValue({ userId: id, client: { rpc: mocks.rpc }, assertCurrent: mocks.assertCurrent });
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCurrent.mockReset();
  mocks.assertCurrent.mockResolvedValue(undefined);
});

describe("academic reviewer permission refresh", () => {
  it("rechecks after a denied role when the review queue is refreshed", async () => {
    currentAccount("r87-denied-then-granted");
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    expect(await isAcademicReviewer("r87-denied-then-granted")).toBe(false);
    expect(await isAcademicReviewer("r87-denied-then-granted")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "academic_is_reviewer");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "academic_is_reviewer");
  });

  it("rechecks after reviewer permission is revoked, rather than retaining an old true result", async () => {
    currentAccount("r87-granted-then-revoked");
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    expect(await isAcademicReviewer("r87-granted-then-revoked")).toBe(true);
    expect(await isAcademicReviewer("r87-granted-then-revoked")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("allows an explicit retry after a transient reviewer RPC error", async () => {
    currentAccount("r87-transient-error");
    mocks.rpc.mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ data: true, error: null });

    expect(await isAcademicReviewer("r87-transient-error")).toBe(false);
    expect(await isAcademicReviewer("r87-transient-error")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("shares one pending RPC for the same account but not a later explicit permission check", async () => {
    currentAccount("r87-singleflight");
    const first = pending<{ data: boolean; error: null }>();
    mocks.rpc.mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: false, error: null });

    const a = isAcademicReviewer("r87-singleflight");
    const b = isAcademicReviewer("r87-singleflight");
    expect(a).toBe(b);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    first.resolve({ data: true, error: null });
    expect(await a).toBe(true);
    expect(await b).toBe(true);

    expect(await isAcademicReviewer("r87-singleflight")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not authorize a stale account identity or cache its failure permanently", async () => {
    mocks.operation.mockResolvedValueOnce({ userId: "other-account", client: { rpc: mocks.rpc }, assertCurrent: mocks.assertCurrent })
      .mockResolvedValueOnce({ userId: "r87-current-account", client: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    expect(await isAcademicReviewer("r87-current-account")).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await isAcademicReviewer("r87-current-account")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each([
    ["account change", "The signed-in account changed."],
    ["token refresh", "The account session was refreshed."],
  ])("does not surface an in-flight reviewer grant after %s", async (scenario, reason) => {
    currentAccount(`r88-${scenario.replaceAll(" ", "-")}`);
    const first = pending<{ data: boolean; error: null }>();
    mocks.rpc.mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: true, error: null });

    const check = isAcademicReviewer(`r88-${scenario.replaceAll(" ", "-")}`);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    // The scoped request was originally authorized. The session changes
    // before its response resolves; a stale true must never reach UI state.
    mocks.assertCurrent.mockRejectedValueOnce(new Error(reason));
    first.resolve({ data: true, error: null });
    expect(await check).toBe(false);
    expect(mocks.assertCurrent).toHaveBeenCalledOnce();

    // A subsequent explicit check uses a new authorization operation.
    expect(await isAcademicReviewer(`r88-${scenario.replaceAll(" ", "-")}`)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
