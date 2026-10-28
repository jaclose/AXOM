import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn() }));
vi.mock("./client", () => ({ academicClient: mocks.client }));
vi.mock("./accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
import { canReviewAcademicCourses, decideAcademicReview, listAcademicReviewQueue, previewAcademicReview, type ReviewSubmission } from "./reviewQueue";

const entry: ReviewSubmission = { id: "11111111-1111-4111-8111-111111111111", current_revision_id: "22222222-2222-4222-8222-222222222222",
  title: "Synthetic course", module: "GOER", term: "Term 5", owner_display_name: "Synthetic owner", ready_questions: 2, review_questions: 1, submitted_at: "2026-10-28T12:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});

describe("review queue client", () => {
  it("checks membership afresh and fails closed on errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: false }).mockResolvedValueOnce({ error: { message: "offline" } });
    expect(await canReviewAcademicCourses("reviewer")).toBe(true);
    expect(await canReviewAcademicCourses("reviewer")).toBe(false);
    expect(await canReviewAcademicCourses("reviewer")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it("keeps only metadata and passes the full stable cursor", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...entry, questions: ["never retain this"], owner_id: "private" }] });
    expect(await listAcademicReviewQueue("reviewer", { submittedAt: entry.submitted_at, id: entry.id })).toEqual([entry]);
    expect(mocks.rpc).toHaveBeenCalledWith("academic_review_queue", { after_submitted_at: entry.submitted_at, after_id: entry.id });
    expect(mocks.client).toHaveBeenCalledWith("reviewer");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it.each([
    null, Array.from({ length: 25 }, () => entry), [entry, entry], [{ ...entry, id: "invalid" }],
    [{ ...entry, ready_questions: -1 }], [{ ...entry, submitted_at: "invalid" }], [{ ...entry, owner_display_name: "" }],
  ])("rejects malformed page %j", async data => {
    mocks.rpc.mockResolvedValue({ data });
    await expect(listAcademicReviewQueue("reviewer")).rejects.toThrow("response is invalid");
  });
  it("reports queue transport errors", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "offline" } });
    await expect(listAcademicReviewQueue("reviewer")).rejects.toThrow("could not be loaded");
  });
  it("accepts only the exact requested template preview", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: entry.current_revision_id, collection_id: entry.id, template_text: "Week 1", ready_questions: 2, review_questions: 1, questions: [] } });
    expect(await previewAcademicReview(entry, "reviewer")).toEqual({ id: entry.current_revision_id, collection_id: entry.id, template_text: "Week 1", ready_questions: 2, review_questions: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("academic_review_preview", { collection: entry.id, revision: entry.current_revision_id });
    mocks.rpc.mockResolvedValue({ data: { id: "another-revision" } });
    await expect(previewAcademicReview(entry, "reviewer")).rejects.toThrow("no longer available");
  });
  it.each([true, false])("uses academic_review with the previewed revision for decision %s", async approved => {
    mocks.rpc.mockResolvedValue({ error: null });
    await decideAcademicReview(entry, approved, "reviewer");
    expect(mocks.rpc).toHaveBeenCalledWith("academic_review", { collection: entry.id, approved, expected_revision: entry.current_revision_id });
  });
  it("tells the reviewer to reopen a stale preview", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "40001" } });
    await expect(decideAcademicReview(entry, true, "reviewer")).rejects.toThrow("submission changed");
  });
  it("discards a result if the account changes while waiting", async () => {
    mocks.rpc.mockImplementation(async () => { mocks.assertCurrent.mockImplementation(() => { throw new Error("The account changed."); }); return { data: [entry] }; });
    await expect(listAcademicReviewQueue("reviewer")).rejects.toThrow("account changed");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
