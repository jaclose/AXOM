import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { attestAcademicExplanations } from "./explanationReview";
import { reviewAcademicCourse } from "./client";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("./explanationReview", () => ({ attestAcademicExplanations: vi.fn(async () => undefined) }));

const collectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revisionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountId = "reviewer-account";
const receipt = {
  collectionId, revisionId, contentHash: "a".repeat(64),
  readyQuestions: 77, explainedReadyQuestions: 77, missingExplanations: 0,
};

function setupRpc(rpc: ReturnType<typeof vi.fn>) {
  vi.mocked(accountOperationClient).mockResolvedValue({
    userId: accountId,
    client: { rpc },
  } as unknown as Awaited<ReturnType<typeof accountOperationClient>>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("academic course review routing", () => {
  it("retains the ordinary academic review endpoint for collections without a Community submission", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    setupRpc(rpc);

    await reviewAcademicCourse(collectionId, true, accountId, receipt, true);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("academic_review", { collection: collectionId, approved: true });
    expect(attestAcademicExplanations).toHaveBeenCalledWith(receipt, accountId, true);
  });

  it("uses exact-revision Community review only when the ordinary endpoint explicitly requires it", async () => {
    const rpc = vi.fn(async (name: string) => name === "academic_review"
      ? { error: { code: "42501", message: "Use exact community revision review" } }
      : { error: null });
    setupRpc(rpc);

    await reviewAcademicCourse(collectionId, true, accountId, receipt, true);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "academic_review", { collection: collectionId, approved: true });
    expect(rpc).toHaveBeenNthCalledWith(2, "academic_community_review", {
      collection: collectionId, revision: revisionId, approved: true,
    });
    expect(attestAcademicExplanations).toHaveBeenCalledWith(receipt, accountId, true);
  });

  it("never infers a Community revision or executes a fallback without exact revision evidence", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "42501", message: "Use exact community revision review" } }));
    setupRpc(rpc);

    await expect(reviewAcademicCourse(collectionId, false, accountId)).rejects.toThrow(/Community Uploads/);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(attestAcademicExplanations).not.toHaveBeenCalled();
  });

  it("does not treat a rejected exact Community review as approval", async () => {
    const rpc = vi.fn(async (name: string) => name === "academic_review"
      ? { error: { code: "42501", message: "Use exact community revision review" } }
      : { error: { code: "40001", message: "The submission changed." } });
    setupRpc(rpc);

    await expect(reviewAcademicCourse(collectionId, true, accountId, receipt, true))
      .rejects.toThrow(/Community submission changed/);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("withdraws an approved Community revision without requiring a new explanation attestation", async () => {
    const rpc = vi.fn(async (name: string) => name === "academic_review"
      ? { error: { code: "42501", message: "Use exact community revision review" } }
      : { error: null });
    setupRpc(rpc);

    await reviewAcademicCourse(collectionId, false, accountId, undefined, false, revisionId);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "academic_review", { collection: collectionId, approved: false });
    expect(rpc).toHaveBeenNthCalledWith(2, "academic_community_review", {
      collection: collectionId, revision: revisionId, approved: false,
    });
    expect(attestAcademicExplanations).not.toHaveBeenCalled();
  });

  it("refuses a malformed or absent selected revision for Community withdrawal", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "42501", message: "Use exact community revision review" } }));
    setupRpc(rpc);

    await expect(reviewAcademicCourse(collectionId, false, accountId, undefined, false, "not-a-uuid"))
      .rejects.toThrow(/current revision/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(attestAcademicExplanations).not.toHaveBeenCalled();
  });

  it("rejects a conflicting explanation receipt instead of withdrawing another revision", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "42501", message: "Use exact community revision review" } }));
    setupRpc(rpc);
    const otherRevision = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await expect(reviewAcademicCourse(collectionId, false, accountId, receipt, false, otherRevision))
      .rejects.toThrow(/current revision/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stops before the Community RPC if the account changes after the initial refusal", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "42501", message: "Use exact community revision review" } }));
    const first = { userId: accountId, client: { rpc } } as unknown as Awaited<ReturnType<typeof accountOperationClient>>;
    const switched = { userId: "different-account", client: { rpc } } as unknown as Awaited<ReturnType<typeof accountOperationClient>>;
    vi.mocked(accountOperationClient).mockReset();
    vi.mocked(accountOperationClient).mockResolvedValueOnce(first).mockResolvedValueOnce(switched);

    await expect(reviewAcademicCourse(collectionId, false, accountId, undefined, false, revisionId))
      .rejects.toThrow(/account changed/i);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not report success if the exact Community withdrawal is rejected by the server", async () => {
    const rpc = vi.fn(async (name: string) => name === "academic_review"
      ? { error: { code: "42501", message: "Use exact community revision review" } }
      : { error: { code: "40001", message: "The revision changed" } });
    setupRpc(rpc);

    await expect(reviewAcademicCourse(collectionId, false, accountId, undefined, false, revisionId))
      .rejects.toThrow(/Community submission changed/);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(attestAcademicExplanations).not.toHaveBeenCalled();
  });

});
