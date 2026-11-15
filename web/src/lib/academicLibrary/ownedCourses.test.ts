import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "./client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  check: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./client", () => ({
  listAcademicCourses: mocks.list,
  getAcademicCourse: mocks.detail,
}));
vi.mock("./accountScope", () => ({
  academicAccountScope: () => ({ assertCurrent: mocks.check, dispose: mocks.dispose }),
}));

import { listOwnedAcademicCourses } from "./ownedCourses";

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
  mocks.check.mockReset();
  mocks.dispose.mockReset();
});

describe("owned academic collection pagination integrity", () => {
  it("returns all legitimate owned courses from a 24-row page plus a final partial page", async () => {
    const first = firstPage();
    const last = [course(25), course(26, false)];
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    mocks.detail.mockResolvedValueOnce(first.at(-1));
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
});
