// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { listAcademicCourses, type AcademicCourse } from "./client";
import { listPublicCourses, type PublicCourse } from "./publicCatalog";
import { useAcademicCatalog } from "./useAcademicCatalog";

const backend = vi.hoisted(() => ({ configured: true }));
vi.mock("../account/supabase", () => ({ cloudConfigured: () => backend.configured }));
vi.mock("./client", () => ({ listAcademicCourses: vi.fn() }));
vi.mock("./publicCatalog", () => ({
  listPublicCourses: vi.fn(async () => []),
  publicCatalogCourse: (entry: PublicCourse) => ({ id: entry.id, title: entry.title, module: entry.module, term: entry.term, visibility: "shared",
    review_status: "approved", current_revision_id: entry.current_revision_id, owned: false, ready_questions: entry.ready_questions, review_questions: 0 }),
}));
const offered = (id: string): PublicCourse => ({ id, title: id, module: "SAMPLE", term: "Term 1", current_revision_id: id, ready_questions: 3, has_plan: true });
const course = (id: string): AcademicCourse => ({ id, title: id, module: "SAMPLE", term: "Term 1", visibility: "private", review_status: "pending", current_revision_id: id, owned: true, ready_questions: 1, review_questions: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); backend.configured = true; });

it("discards a private response after switching accounts, including sign-out", async () => {
  vi.useFakeTimers();
  const a = deferred<AcademicCourse[]>(); const b = deferred<AcademicCourse[]>();
  vi.mocked(listAcademicCourses).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { result, rerender } = renderHook(({ id }) => useAcademicCatalog(id, "", ""), { initialProps: { id: "a" as string | undefined } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  rerender({ id: "b" });
  await act(() => a.resolve([course("private-a")]));
  expect(result.current.courses).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(200));
  await act(() => b.resolve([course("private-b")]));
  expect(result.current.courses.map(c => c.id)).toEqual(["private-b"]);
  rerender({ id: undefined });
  expect(result.current.courses).toEqual([]);
  expect(result.current.more).toBe(false);
});

it("rejects stale pagination after filtering and prevents duplicate page requests", async () => {
  vi.useFakeTimers();
  const next = deferred<AcademicCourse[]>();
  vi.mocked(listAcademicCourses).mockResolvedValueOnce(Array.from({ length: 24 }, (_, i) => course(String(i))))
    .mockReturnValueOnce(next.promise).mockResolvedValueOnce([course("filtered")]);
  const { result, rerender } = renderHook(({ query }) => useAcademicCatalog("a", query, ""), { initialProps: { query: "" } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  act(() => { void result.current.loadMore(); void result.current.loadMore(); });
  expect(listAcademicCourses).toHaveBeenCalledTimes(2);
  rerender({ query: "new" });
  await act(() => vi.advanceTimersByTimeAsync(200));
  await act(() => next.resolve([course("old-page")]));
  expect(result.current.courses.map(c => c.id)).toEqual(["filtered"]);
});


it("keeps the open course mounted during same-account refresh, but clears it for another query", async () => {
  vi.useFakeTimers();
  const refreshed = deferred<AcademicCourse[]>();
  vi.mocked(listAcademicCourses).mockResolvedValueOnce([course("owned")]).mockReturnValueOnce(refreshed.promise)
    .mockResolvedValueOnce([]);
  const { result, rerender } = renderHook(({ query }) => useAcademicCatalog("a", query, ""), { initialProps: { query: "" } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  act(() => result.current.retry());
  expect(result.current.courses.map(c => c.id)).toEqual(["owned"]);
  expect(result.current.loading).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(200));
  await act(() => refreshed.resolve([{ ...course("owned"), visibility: "shared" }]));
  expect(result.current.courses[0].visibility).toBe("shared");
  rerender({ query: "different" });
  expect(result.current.courses).toEqual([]);
});

it("serves a visitor only the courses offered to everyone, with the same paging", async () => {
  vi.useFakeTimers();
  vi.mocked(listPublicCourses).mockResolvedValueOnce(Array.from({ length: 24 }, (_, index) => offered(`offered-${index}`)))
    .mockResolvedValueOnce([offered("offered-24")]);
  const { result } = renderHook(() => useAcademicCatalog(undefined, "goer", "Term 5"));
  expect(result.current.visitor).toBe(true);
  expect(result.current.loading).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(listPublicCourses).toHaveBeenCalledWith("goer", "Term 5", undefined);
  expect(listAcademicCourses).not.toHaveBeenCalled();
  expect(result.current.courses).toHaveLength(24);
  expect(result.current.courses[0]).toMatchObject({ id: "offered-0", owned: false, visibility: "shared", review_status: "approved" });
  expect(result.current.more).toBe(true);
  await act(() => result.current.loadMore());
  expect(listPublicCourses).toHaveBeenLastCalledWith("goer", "Term 5", "offered-23");
  expect(result.current.courses).toHaveLength(25);
  expect(result.current.more).toBe(false);
});

it("never shows offered courses under an account, or an account's courses to a visitor", async () => {
  vi.useFakeTimers();
  const account = deferred<AcademicCourse[]>(); const visitor = deferred<PublicCourse[]>();
  vi.mocked(listPublicCourses).mockResolvedValueOnce([offered("offered")]).mockReturnValueOnce(visitor.promise);
  vi.mocked(listAcademicCourses).mockReturnValueOnce(account.promise);
  const { result, rerender } = renderHook(({ id }) => useAcademicCatalog(id, "", ""), { initialProps: { id: undefined as string | undefined } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current.courses.map(c => c.id)).toEqual(["offered"]);
  rerender({ id: "a" });
  expect(result.current.courses).toEqual([]);
  expect(result.current.visitor).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(200));
  rerender({ id: undefined });
  await act(() => account.resolve([course("private-a")]));
  expect(result.current.courses).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(200));
  await act(() => visitor.resolve([offered("offered-again")]));
  expect(result.current.courses.map(c => c.id)).toEqual(["offered-again"]);
});

it("reports a visitor catalog outage without inventing an empty catalog", async () => {
  vi.useFakeTimers();
  vi.mocked(listPublicCourses).mockRejectedValueOnce(new Error("The course catalog could not be loaded. Check your connection and retry."));
  const { result } = renderHook(() => useAcademicCatalog(undefined, "", ""));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current.error).toContain("could not be loaded");
  expect(result.current.loading).toBe(false);
});

it("asks nothing and shows no loading state on a build without an account backend", async () => {
  vi.useFakeTimers();
  backend.configured = false;
  const { result } = renderHook(() => useAcademicCatalog(undefined, "", ""));
  expect(result.current.loading).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(listPublicCourses).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ courses: [], loading: false, more: false, error: "", visitor: true });
  await act(() => result.current.loadMore());
  expect(listPublicCourses).not.toHaveBeenCalled();
});
