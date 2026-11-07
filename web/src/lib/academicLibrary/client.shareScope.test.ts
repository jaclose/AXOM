import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shareAcademicCourses } from "./client";

const mocks = vi.hoisted(() => ({
  accountOperationClient: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../account/supabase", () => ({ accountOperationClient: mocks.accountOperationClient }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.accountOperationClient.mockResolvedValue({ userId: "account-a", client: { rpc: mocks.rpc } });
});
afterEach(() => vi.restoreAllMocks());

it.each([null, { message: "server rejected" }])(
  "discards an in-flight sharing receipt after the account changes (RPC error=%j)", async error => {
    const response = deferred<{ error: null | { message: string } }>();
    mocks.rpc.mockReturnValueOnce(response.promise);
    let accountCurrent = true;
    const assertCurrent = vi.fn(() => {
      if (!accountCurrent) throw new Error("The account changed. Reopen your library.");
    });
    const operation = shareAcademicCourses(["course-a"], "account-a", { assertCurrent });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    accountCurrent = false;
    response.resolve({ error });
    await expect(operation).rejects.toThrow(/account changed/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  },
);

it("does not report an in-flight RPC as confirmed sharing when cancelled", async () => {
  const response = deferred<{ error: null }>();
  mocks.rpc.mockReturnValueOnce(response.promise);
  const abort = new AbortController();
  const operation = shareAcademicCourses(["course-a", "course-b"], "account-a", { signal: abort.signal });
  await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  abort.abort();
  response.resolve({ error: null });
  expect(await operation).toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("retains confirmed earlier outcomes but not the cancelled in-flight outcome", async () => {
  const response = deferred<{ error: null }>();
  mocks.rpc.mockResolvedValueOnce({ error: null }).mockReturnValueOnce(response.promise);
  const abort = new AbortController();
  const operation = shareAcademicCourses(["course-a", "course-b"], "account-a", { signal: abort.signal });
  await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  abort.abort();
  response.resolve({ error: null });
  expect(await operation).toEqual([{ collectionId: "course-a", shared: true }]);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("preserves same-account successes and per-course server errors", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "denied" } });
  const assertCurrent = vi.fn();
  const results = await shareAcademicCourses(["course-a", "course-b"], "account-a", { assertCurrent });
  expect(results).toEqual([
    { collectionId: "course-a", shared: true },
    { collectionId: "course-b", shared: false, error: "Sharing could not be requested for this course." },
  ]);
  expect(assertCurrent).toHaveBeenCalledTimes(4);
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, "academic_set_visibility",
    { collection: "course-a", visibility: "shared", group_id: null });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "academic_set_visibility",
    { collection: "course-b", visibility: "shared", group_id: null });
});
