import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "./client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  review: vi.fn(),
  assertCurrent: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./client", () => ({
  listAcademicCourses: mocks.list,
  reviewAcademicCourse: mocks.review,
}));
vi.mock("./accountScope", () => ({
  academicAccountScope: (key: string) => ({
    key,
    assertCurrent: mocks.assertCurrent,
    dispose: mocks.dispose,
  }),
}));
import { listOwnedAcademicCourses } from "./ownedCourses";

const course = (index: number, owned = true): AcademicCourse => ({
  id: `course-${index}`,
  current_revision_id: `revision-${index}`,
  title: `Module ${index}`,
  module: `Module ${index}`,
  term: "Term 1",
  visibility: owned ? "private" : "shared",
  review_status: owned ? "pending" : "approved",
  owned,
  ready_questions: 1,
  review_questions: 0,
});
const fullPage = () => Array.from({ length: 24 }, (_, index) => course(index));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReset();
  mocks.assertCurrent.mockReset();
  mocks.dispose.mockReset();
});

describe("owner catalog pagination integrity", () => {
  it("reads all pages in server cursor order, filtering only after identity validation", async () => {
    const first = fullPage();
    first[2] = course(2, false);
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([course(24), course(25, false)]);
    const owned = await listOwnedAcademicCourses("account");
    expect(owned.map(row => row.id)).toEqual([
      ...first.filter(row => row.owned).map(row => row.id), "course-24",
    ]);
    expect(mocks.list.mock.calls).toEqual([["", "", undefined], ["", "", "course-23"]]);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects a duplicate owned ID across two pages even if the final page is short", async () => {
    mocks.list.mockResolvedValueOnce(fullPage()).mockResolvedValueOnce([course(23)]);
    await expect(listOwnedAcademicCourses("account")).rejects.toThrow(/catalog changed/);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects duplicate IDs inside one page, including non-owned catalog records", async () => {
    mocks.list.mockResolvedValueOnce([course(4, false), course(4, false)]);
    await expect(listOwnedAcademicCourses("account")).rejects.toThrow(/catalog changed/);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("does not report a late final page as complete after cancellation during its request", async () => {
    const abort = new AbortController();
    mocks.list.mockImplementationOnce(async () => {
      abort.abort();
      return [course(1)];
    });
    await expect(listOwnedAcademicCourses("account", abort.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects a late page after a signed-in account switch", async () => {
    mocks.list.mockImplementationOnce(async () => {
      mocks.assertCurrent.mockImplementation(() => { throw new Error("The account changed"); });
      return [course(1)];
    });
    await expect(listOwnedAcademicCourses("account")).rejects.toThrow(/account changed/);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
