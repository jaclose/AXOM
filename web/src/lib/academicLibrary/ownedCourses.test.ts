import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "./client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  review: vi.fn(),
  check: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./client", () => ({
  listAcademicCourses: mocks.list,
  getAcademicCourse: mocks.detail,
  reviewAcademicCourse: mocks.review,
}));
vi.mock("./accountScope", () => ({
  academicAccountScope: () => ({ assertCurrent: mocks.check, dispose: mocks.dispose }),
}));

import { approveAcademicCourses, listOwnedAcademicCourses } from "./ownedCourses";

const uuid = (number: number) => `${number.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
const course = (number: number, owned = true): AcademicCourse => ({
  id: uuid(number),
  current_revision_id: uuid(number + 5000),
  term: "Term 4",
  module: "DERS",
  title: `Academic course ${number}`,
  visibility: "private",
  review_status: "pending",
  owned,
  ready_questions: 2,
  review_questions: 0,
});
const firstPage = () => Array.from({ length: 24 }, (_, index) => course(index + 1, index !== 4));

beforeEach(() => {
  mocks.list.mockReset();
  mocks.detail.mockReset();
  mocks.review.mockReset();
  mocks.check.mockReset();
  mocks.dispose.mockReset();
});

describe("owned academic collection pagination integrity", () => {
  it("returns all legitimate owned courses from a 24-row page plus a final partial page", async () => {
    const first = firstPage();
    const last = [course(25), course(26, false)];
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce(last)
      .mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    mocks.detail.mockResolvedValue(first.at(-1));
    const result = await listOwnedAcademicCourses("owner");
    expect(result.map(row => row.id)).toEqual([...first.filter(row => row.owned), last[0]].map(row => row.id));
    expect(mocks.list).toHaveBeenNthCalledWith(2, "", "", first.at(-1)?.id);
    expect(mocks.detail).toHaveBeenCalledWith(first.at(-1)?.id, "owner");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated collection ID across pages rather than inflating a review batch", async () => {
    const first = firstPage();
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([first[2]]);
    mocks.detail.mockResolvedValueOnce(first.at(-1));
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog changed/i);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated exact-revision ID on another collection", async () => {
    const first = firstPage();
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([
      { ...course(25), current_revision_id: first[5].current_revision_id },
    ]);
    mocks.detail.mockResolvedValueOnce(first.at(-1));
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog changed/i);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty page after its preceding cursor collection was withdrawn", async () => {
    const first = firstPage();
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([]);
    mocks.detail.mockRejectedValueOnce(new Error("Collection withdrawn"));
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog could not be verified/i);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed cursor revision instead of presenting a mixed-version list", async () => {
    const first = firstPage();
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([]);
    mocks.detail.mockResolvedValueOnce({ ...first.at(-1), current_revision_id: uuid(9001) });
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog changed/i);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation that occurs during the last catalog RPC", async () => {
    const controller = new AbortController();
    mocks.list.mockImplementationOnce(async () => {
      controller.abort();
      return [course(1)];
    });
    await expect(listOwnedAcademicCourses("owner", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects a noncursor course refiled across an already-read page boundary", async () => {
    // SQL keyset sorting uses term, module, title, id. An item can move
    // *before* a stable cursor and disappear from later pages without repeats.
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...course(index + 1), module: "DERS", title: `Course ${String(index + 1).padStart(2, "0")}`,
    }));
    let moved = false;
    mocks.list.mockImplementation(async (_search: string, _term: string, after?: string) => {
      if (after === uuid(24) && !moved) {
        rows[24] = { ...rows[24], title: "Course 00" };
        moved = true;
      }
      const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      const cursor = rows.find(row => row.id === after);
      return sorted.filter(row => !cursor || row.title > cursor.title
        || (row.title === cursor.title && row.id > cursor.id)).slice(0, 24);
    });
    mocks.detail.mockImplementation(async (id: string) => rows.find(row => row.id === id));
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog changed/i);
    expect(moved).toBe(true);
    expect(mocks.list.mock.calls.length).toBeGreaterThan(2);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects a stable-cursor page whose noncursor row changes during later reads", async () => {
    const first = firstPage();
    const last = [course(25)];
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce(last)
      .mockResolvedValueOnce([{ ...first[0], ready_questions: 3 }, ...first.slice(1)]);
    mocks.detail.mockResolvedValue(first.at(-1));
    await expect(listOwnedAcademicCourses("owner")).rejects.toThrow(/catalog changed/i);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });


  it("does not report a reviewer approval when Stop occurs during the in-flight RPC", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    mocks.review.mockImplementationOnce(async () => { controller.abort(); });
    await expect(approveAcademicCourses([uuid(1), uuid(2)], "owner",
      { signal: controller.signal, onProgress })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not emit a stale approval if the account changes while the RPC settles", async () => {
    const onProgress = vi.fn();
    const assertCurrent = vi.fn().mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error("Account changed"); });
    mocks.review.mockResolvedValueOnce(undefined);
    await expect(approveAcademicCourses([uuid(1), uuid(2)], "owner",
      { assertCurrent, onProgress })).rejects.toThrow(/Account changed/i);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not record a settled reviewer rejection for a now-different account", async () => {
    const onProgress = vi.fn();
    const assertCurrent = vi.fn().mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error("Account changed"); });
    mocks.review.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(approveAcademicCourses([uuid(1)], "owner",
      { assertCurrent, onProgress })).rejects.toThrow(/Account changed/i);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("retains normal per-course failures and exact progress when the account remains active", async () => {
    const onProgress = vi.fn();
    mocks.review.mockRejectedValueOnce(new Error("Needs source review"))
      .mockResolvedValueOnce(undefined);
    const result = await approveAcademicCourses([uuid(1), uuid(2)], "owner", { onProgress });
    expect(result).toEqual([
      { collectionId: uuid(1), approved: false, error: "Needs source review" },
      { collectionId: uuid(2), approved: true },
    ]);
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
  });

  it("skips reviewer RPCs when cancelled before the first course", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await approveAcademicCourses([uuid(1)], "owner", { signal: controller.signal })).toEqual([]);
    expect(mocks.review).not.toHaveBeenCalled();
  });

});
