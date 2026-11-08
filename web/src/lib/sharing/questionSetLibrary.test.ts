import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { createQuestionSetShare } from "./questionSetShare";
import {
  loadPendingQuestionSetReviewPreview, loadQuestionSetLibraryPreview, searchQuestionSetLibrary, submitQuestionSetToLibrary,
} from "./questionSetLibrary";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));

const accountId = "00000000-0000-4000-8000-000000000010";
const entryId = "00000000-0000-4000-8000-000000000011";
const now = "2026-11-01T12:00:00.000Z";
const confirmed = { rightsConfirmed: true, answersConfirmed: true };

function snapshot() {
  return createQuestionSetShare({
    id: "set-1", title: "Synthetic practice", sourceDocumentIds: [], createdAt: now,
    questionIds: ["q-1"], tags: ["synthetic"], aiEnhanced: false, parserWarnings: [],
  }, [{
    id: "q-1", source: "manual", stem: "A synthetic question?",
    options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: now, updatedAt: now,
  }], now);
}

function service(rpc: ReturnType<typeof vi.fn>, assertCurrent = vi.fn().mockResolvedValue(undefined)) {
  vi.mocked(accountOperationClient).mockResolvedValue({
    userId: accountId, client: { rpc }, assertCurrent,
  } as never);
  return assertCurrent;
}

beforeEach(() => vi.clearAllMocks());

describe("searchable Question Set client boundary", () => {
  it("refuses a preview with an extra private question field", async () => {
    const value = snapshot() as unknown as { title: string; questions: Array<Record<string, unknown>> };
    value.questions[0].attempts = [{ answer: "B" }];
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved", snapshot_payload: value,
    }, error: null });
    service(rpc);
    await expect(loadQuestionSetLibraryPreview(accountId, entryId)).rejects.toThrow(/field|key|invalid/i);
  });

  it.each(["pending", "rejected"])("rejects %s owner/reviewer RPC payloads from public previews", async status => {
    // The SQL RPC lets an owner or reviewer inspect their own submissions.
    // That privilege must never turn a non-approved submission into an import.
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status, snapshot_payload: value,
    }, error: null });
    service(rpc);
    await expect(loadQuestionSetLibraryPreview(accountId, entryId)).rejects.toThrow(/unavailable|withdrawn/i);
    expect(rpc).toHaveBeenCalledWith("get_question_set_library", { p_id: entryId });
  });

  it("allows an awaiting-review snapshot only through the moderation preview reader", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "pending", snapshot_payload: value,
    }, error: null });
    service(rpc);
    const reviewed = await loadPendingQuestionSetReviewPreview(accountId, entryId);
    expect(reviewed).toMatchObject({ id: entryId, status: "pending", snapshot: value });
    expect(reviewed.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(loadQuestionSetLibraryPreview(accountId, entryId)).rejects.toThrow(/unavailable|withdrawn/i);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each(["approved", "rejected"])("refuses a %s listing in the pending moderation reader", async status => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status, snapshot_payload: value,
    }, error: null });
    service(rpc);
    await expect(loadPendingQuestionSetReviewPreview(accountId, entryId))
      .rejects.toThrow(/no longer awaiting academic review/i);
  });

  it("requires a confirmed answer before sending a public submission", async () => {
    const value = snapshot();
    delete value.questions[0].correctKey;
    delete value.questions[0].correctAnswerText;
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/confirmed answer/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { rightsConfirmed: false, answersConfirmed: true },
    { rightsConfirmed: true, answersConfirmed: false },
    { rightsConfirmed: false, answersConfirmed: false },
  ])("refuses incomplete publisher assertions (%o) without a submission RPC", async attestations => {
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", snapshot(), "", attestations))
      .rejects.toThrow(/redistribution rights and source-reviewed answers/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when an untyped caller omits publisher assertions", async () => {
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", snapshot(), "", undefined as never))
      .rejects.toThrow(/redistribution rights and source-reviewed answers/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a changed account after a submission response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    const assertCurrent = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The signed-in account changed."));
    service(rpc, assertCurrent);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", snapshot(), "", confirmed))
      .rejects.toThrow(/account changed/);
    expect(rpc).toHaveBeenCalledWith("submit_question_set_library", expect.objectContaining({
      p_source_id: "set-1", p_rights_confirmed: true, p_answers_confirmed: true,
    }));
  });

  it("accepts only bounded approved search metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      id: entryId, title: "Synthetic practice", credit: "", tags: ["synthetic"],
      question_count: 1, approved_at: now, likes: 0, liked: false,
    }], error: null });
    service(rpc);
    expect(await searchQuestionSetLibrary(accountId, "synthetic")).toMatchObject([{ title: "Synthetic practice" }]);
    rpc.mockResolvedValueOnce({ data: [{
      id: entryId, title: "Synthetic practice", credit: "", tags: [], question_count: 1,
      approved_at: now, likes: -1, liked: false,
    }], error: null });
    await expect(searchQuestionSetLibrary(accountId)).rejects.toThrow(/invalid listing/);
  });
});
