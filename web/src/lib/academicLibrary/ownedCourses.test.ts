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
import { approveAcademicCourses, listOwnedAcademicCourses } from "./ownedCourses";

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

describe("reviewer approval account boundaries", () => {
  it("rejects an in-flight approval after the signed-in account changes, even for one course", async () => {
    let completeReview!: () => void;
    const pending = new Promise<void>(resolve => { completeReview = resolve; });
    mocks.review.mockImplementationOnce(() => pending);
    let active = true;
    mocks.assertCurrent.mockImplementation(() => {
      if (!active) throw new Error("Academic account changed. Refresh before retrying.");
    });
    const onProgress = vi.fn();
    const operation = approveAcademicCourses(["collection-a"], "account-a", {
      assertCurrent: mocks.assertCurrent, onProgress,
    });
    expect(mocks.review).toHaveBeenCalledOnce();
    active = false;
    completeReview();
    await expect(operation).rejects.toThrow(/account changed/i);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("rejects a failed in-flight review if the account switched before the reply", async () => {
    let rejectReview!: (reason?: Error) => void;
    const pending = new Promise<void>((_, reject) => { rejectReview = reject; });
    mocks.review.mockImplementationOnce(() => pending);
    let active = true;
    mocks.assertCurrent.mockImplementation(() => {
      if (!active) throw new Error("Academic account changed. Refresh before retrying.");
    });
    const onProgress = vi.fn();
    const operation = approveAcademicCourses(["collection-a", "collection-b"], "account-a", {
      assertCurrent: mocks.assertCurrent, onProgress,
    });
    active = false;
    rejectReview(new Error("The prior account's review was not saved."));
    await expect(operation).rejects.toThrow(/account changed/i);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("retains per-course failure recovery and progress when the account stays current", async () => {
    mocks.review.mockRejectedValueOnce(new Error("Review unavailable")).mockResolvedValueOnce(undefined);
    const onProgress = vi.fn();
    const results = await approveAcademicCourses(["collection-a", "collection-b"], "account-a", {
      assertCurrent: mocks.assertCurrent, onProgress,
    });
    expect(results).toEqual([
      { collectionId: "collection-a", approved: false, error: "Review unavailable" },
      { collectionId: "collection-b", approved: true },
    ]);
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
    expect(mocks.assertCurrent).toHaveBeenCalledTimes(4);
  });

  it("finishes a completed in-flight request but does not start the next after cancellation", async () => {
    const controller = new AbortController();
    mocks.review.mockImplementationOnce(async () => { controller.abort(); });
    const onProgress = vi.fn();
    const results = await approveAcademicCourses(["collection-a", "collection-b"], "account-a", {
      signal: controller.signal, assertCurrent: mocks.assertCurrent, onProgress,
    });
    expect(results).toEqual([{ collectionId: "collection-a", approved: true }]);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(1);
  });
});
