import { afterEach, expect, it, vi } from "vitest";
import { academicClient } from "./client";
import { communityPreview, listCommunityUploads, reviewCommunityUpload, submitCommunityUpload, withdrawCommunityUpload } from "./community";

vi.mock("./client", () => ({ academicClient: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const row = {
  id, current_revision_id: revision, title: "Synthetic course", module: "SAMPLE", term: "Term 1",
  ready_questions: 2, review_questions: 1, submitted_at: "2026-11-01T12:00:00+00:00",
  owned: false, status: "unreviewed",
};
const rpc = vi.fn();
afterEach(() => { vi.resetAllMocks(); });

it("lists only bounded unreviewed metadata and passes the exact cursor", async () => {
  vi.mocked(academicClient).mockResolvedValue({ rpc } as never);
  rpc.mockResolvedValueOnce({ data: [row], error: null });
  expect(await listCommunityUploads("synthetic", "Term 1", { submittedAt: row.submitted_at, id })).toEqual([row]);
  expect(rpc).toHaveBeenCalledWith("academic_community_catalog", {
    search: "synthetic", term_filter: "Term 1", after_submitted_at: row.submitted_at, after_id: id,
  });
  rpc.mockResolvedValueOnce({ data: [{ ...row, status: "approved" }], error: null });
  await expect(listCommunityUploads()).rejects.toThrow(/invalid/);
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("requires explicit rights confirmation and sends immutable upload identities", async () => {
  vi.mocked(academicClient).mockResolvedValue({ rpc } as never);
  await expect(submitCommunityUpload(id, revision, "owner", false)).rejects.toThrow(/right to share/);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: null });
  await submitCommunityUpload(id, revision, "owner", true);
  expect(academicClient).toHaveBeenCalledWith("owner");
  expect(rpc).toHaveBeenCalledWith("academic_submit_community", {
    collection: id, revision, rights_attested: true,
  });
});

it("loads only a bounded preview for the selected community revision", async () => {
  vi.mocked(academicClient).mockResolvedValue({ rpc } as never);
  rpc.mockResolvedValueOnce({ data: {
    id: revision, collection_id: id, source_revision: null, template_text: "Week 1: Example",
    ready_questions: 2, review_questions: 1,
  }, error: null });
  expect((await communityPreview(id, revision, "reader")).template_text).toBe("Week 1: Example");
  expect(rpc).toHaveBeenCalledWith("academic_community_preview", { collection: id, revision });
  rpc.mockResolvedValueOnce({ data: { id: revision, collection_id: id, template_text: "x".repeat(262145),
    ready_questions: 2, review_questions: 1 }, error: null });
  await expect(communityPreview(id, revision, "reader")).rejects.toThrow(/unavailable/);
});

it("binds withdrawal and reviewer action to the selected revision", async () => {
  vi.mocked(academicClient).mockResolvedValue({ rpc } as never);
  rpc.mockResolvedValue({ error: null });
  await withdrawCommunityUpload(id, revision, "owner");
  await reviewCommunityUpload(id, revision, true, "reviewer");
  expect(rpc).toHaveBeenNthCalledWith(1, "academic_community_withdraw", { collection: id, revision });
  expect(rpc).toHaveBeenNthCalledWith(2, "academic_community_review", { collection: id, revision, approved: true });
  await expect(reviewCommunityUpload(id, "changed", true, "reviewer")).rejects.toThrow(/identity is invalid/);
  expect(rpc).toHaveBeenCalledTimes(2);
});
