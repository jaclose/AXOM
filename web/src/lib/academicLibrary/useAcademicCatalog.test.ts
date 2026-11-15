// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { listAcademicCourses, type AcademicCourse } from "./client";
import { useAcademicCatalog } from "./useAcademicCatalog";

vi.mock("./client", () => ({ listAcademicCourses: vi.fn() }));
const course = (id: string): AcademicCourse => ({ id, title: id, module: "SAMPLE", term: "Term 1", visibility: "private", review_status: "pending", current_revision_id: id, owned: true, ready_questions: 1, review_questions: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

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


it("fails closed when a catalog page repeats a collection ID or assigns a revision to different collections", async () => {
  vi.useFakeTimers();
  const cases = [
    [course("collection"), { ...course("collection"), current_revision_id: "other-revision" }],
    [course("first"), { ...course("second"), current_revision_id: "first" }],
  ];
  for (const rows of cases) {
    vi.mocked(listAcademicCourses).mockResolvedValueOnce(rows);
    const { result, unmount } = renderHook(() => useAcademicCatalog("a", "", ""));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(result.current.courses).toEqual([]);
    expect(result.current.more).toBe(false);
    expect(result.current.error).toMatch(/catalog changed/i);
    unmount();
  }
});

it("does not hide a repeated collection or revision identity on a later catalog page", async () => {
  vi.useFakeTimers();
  const first = Array.from({ length: 24 }, (_, index) => course("course-" + index));
  for (const conflicting of [
    { ...course("course-23"), current_revision_id: "new-revision" },
    { ...course("different-collection"), current_revision_id: "course-5" },
  ]) {
    vi.mocked(listAcademicCourses).mockResolvedValueOnce(first).mockResolvedValueOnce([conflicting]);
    const { result, unmount } = renderHook(() => useAcademicCatalog("a", "", ""));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(result.current.courses).toHaveLength(24);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.courses).toEqual([]);
    expect(result.current.more).toBe(false);
    expect(result.current.error).toMatch(/catalog changed/i);
    unmount();
  }
});

it("allows unambiguous pagination and clean recovery after an inconsistent catalog page", async () => {
  vi.useFakeTimers();
  const first = Array.from({ length: 24 }, (_, index) => course("course-" + index));
  vi.mocked(listAcademicCourses)
    .mockResolvedValueOnce([course("first"), { ...course("first"), current_revision_id: "changed" }])
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce([course("course-24")]);
  const { result } = renderHook(() => useAcademicCatalog("a", "", ""));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current.error).toMatch(/catalog changed/i);
  act(() => result.current.retry());
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current.courses).toHaveLength(24);
  expect(result.current.error).toBe("");
  await act(async () => { await result.current.loadMore(); });
  expect(result.current.courses.map(entry => entry.id)).toEqual(
    Array.from({ length: 25 }, (_, index) => "course-" + index));
  expect(result.current.more).toBe(false);
  expect(result.current.error).toBe("");
});
