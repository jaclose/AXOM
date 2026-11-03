import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { createQuestionSetShare } from "./questionSetShare";
import {
  loadQuestionSetLibraryPreview, searchQuestionSetLibrary, submitQuestionSetToLibrary,
} from "./questionSetLibrary";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));

const accountId = "00000000-0000-4000-8000-000000000010";
const entryId = "00000000-0000-4000-8000-000000000011";
const now = "2026-11-01T12:00:00.000Z";

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

  it("requires a confirmed answer before sending a public submission", async () => {
    const value = snapshot();
    delete value.questions[0].correctKey;
    delete value.questions[0].correctAnswerText;
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, ""))
      .rejects.toThrow(/confirmed answer/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a changed account after a submission response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    const assertCurrent = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The signed-in account changed."));
    service(rpc, assertCurrent);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", snapshot(), ""))
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
