// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTLE_AFTER_TOUCH_MS, useSettledOrder } from "./useSettledOrder";

type Row = { id: string };
const key = (row: Row) => row.id;
const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: Row[]) => list.map((row) => row.id);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSettledOrder", () => {
  it("re-sorts at once when nobody is interacting", () => {
    const { result, rerender } = renderHook(({ desired }) => useSettledOrder(desired, key), { initialProps: { desired: rows("a", "b", "c") } });
    rerender({ desired: rows("c", "a", "b") });
    expect(ids(result.current.ordered)).toEqual(["c", "a", "b"]);
  });

  it("freezes the order while tapping, then settles 10 s after the last tap", () => {
    const { result, rerender } = renderHook(({ desired }) => useSettledOrder(desired, key), { initialProps: { desired: rows("a", "b", "c") } });
    act(() => result.current.touch());
    rerender({ desired: rows("c", "a", "b") });
    expect(ids(result.current.ordered)).toEqual(["a", "b", "c"]);
    act(() => { vi.advanceTimersByTime(SETTLE_AFTER_TOUCH_MS - 1000); });
    act(() => result.current.touch()); // another tap restarts the quiet period
    act(() => { vi.advanceTimersByTime(SETTLE_AFTER_TOUCH_MS - 1); });
    expect(ids(result.current.ordered)).toEqual(["a", "b", "c"]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(ids(result.current.ordered)).toEqual(["c", "a", "b"]);
  });

  it("shows new items and drops removed ones immediately without moving the rest", () => {
    const { result, rerender } = renderHook(({ desired }) => useSettledOrder(desired, key), { initialProps: { desired: rows("a", "b", "c") } });
    act(() => result.current.touch());
    rerender({ desired: rows("d", "c", "a") });
    expect(ids(result.current.ordered)).toEqual(["a", "c", "d"]);
  });
});
