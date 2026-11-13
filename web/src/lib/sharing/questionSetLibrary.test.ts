import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { createQuestionSetShare, sharedQuestionSetDigest } from "./questionSetShare";
import {
  authorizeQuestionSetLibraryImport, loadPendingQuestionSetReviewPreview,
  loadQuestionSetLibraryPreview, reviewQuestionSetSubmission,
  searchQuestionSetLibrary, submitQuestionSetToLibrary,
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
  it("accepts a public preview only with a positive, server-issued review revision", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved",
      snapshot_payload: value, review_revision: 2,
    }, error: null });
    service(rpc);
    const preview = await loadQuestionSetLibraryPreview(accountId, entryId);
    expect(preview).toMatchObject({ id: entryId, status: "approved", reviewRevision: 2, snapshot: value });
    expect(preview.contentDigest).toBe(await sharedQuestionSetDigest(value));
  });

  it.each([undefined, null, 0, -1, 1.5, "2"])(
    "refuses an approved preview without a safe revision (%s)", async review_revision => {
      const value = snapshot();
      const rpc = vi.fn().mockResolvedValue({ data: {
        id: entryId, title: value.title, question_count: 1, status: "approved",
        snapshot_payload: value, review_revision,
      }, error: null });
      service(rpc);
      await expect(loadQuestionSetLibraryPreview(accountId, entryId)).rejects.toThrow(/revision is missing/i);
    },
  );

  it("authorizes exact approved snapshot and revision in one SQL RPC", async () => {
    const value = snapshot();
    const digest = await sharedQuestionSetDigest(value);
    const inspected = { id: entryId, snapshot: value, contentDigest: digest,
      status: "approved" as const, reviewRevision: 2 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved",
      snapshot_payload: value, review_revision: 2,
    }, error: null });
    service(rpc);
    const approved = await authorizeQuestionSetLibraryImport(accountId, inspected);
    expect(approved).toMatchObject(inspected);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("authorize_question_set_library_import", {
      p_id: entryId, p_expected_revision: 2, p_expected_snapshot: value,
    });
  });

  it("rejects same-content reapproval on a new review revision", async () => {
    const value = snapshot();
    const inspected = { id: entryId, snapshot: value,
      contentDigest: await sharedQuestionSetDigest(value),
      status: "approved" as const, reviewRevision: 2 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved",
      snapshot_payload: value, review_revision: 4,
    }, error: null });
    service(rpc);
    await expect(authorizeQuestionSetLibraryImport(accountId, inspected))
      .rejects.toThrow(/changed or was withdrawn/i);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid or tampered import receipts before an RPC", async () => {
    const value = snapshot();
    const valid = { id: entryId, snapshot: value,
      contentDigest: await sharedQuestionSetDigest(value),
      status: "approved" as const, reviewRevision: 2 };
    const rpc = vi.fn();
    service(rpc);
    await expect(authorizeQuestionSetLibraryImport(accountId, { ...valid, reviewRevision: 0 }))
      .rejects.toThrow(/Reopen the approved/i);
    await expect(authorizeQuestionSetLibraryImport(accountId, { ...valid, contentDigest: "a".repeat(64) }))
      .rejects.toThrow(/previewed Question Set changed/i);
    await expect(authorizeQuestionSetLibraryImport(accountId, { ...valid, status: "pending" }))
      .rejects.toThrow(/Reopen the approved/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the server revokes an import or changes its snapshot", async () => {
    const value = snapshot();
    const valid = { id: entryId, snapshot: value,
      contentDigest: await sharedQuestionSetDigest(value),
      status: "approved" as const, reviewRevision: 2 };
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "withdrawn" } })
      .mockResolvedValueOnce({ data: { id: entryId, status: "approved", review_revision: 2,
        title: value.title, question_count: 1,
        snapshot_payload: { ...value, title: "Unauthorized change" } }, error: null });
    service(rpc);
    await expect(authorizeQuestionSetLibraryImport(accountId, valid))
      .rejects.toThrow(/changed or was withdrawn/i);
    await expect(authorizeQuestionSetLibraryImport(accountId, valid))
      .rejects.toThrow(/published Question Set differs|reviewed Question Set changed/i);
  });

  it("refuses a preview with an extra private question field", async () => {
    const value = snapshot() as unknown as { title: string; questions: Array<Record<string, unknown>> };
    value.questions[0].attempts = [{ answer: "B" }];
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved", snapshot_payload: value, review_revision: 2,
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
      id: entryId, title: value.title, question_count: 1, status: "pending",
      snapshot_payload: value, review_revision: 1,
    }, error: null });
    service(rpc);
    const reviewed = await loadPendingQuestionSetReviewPreview(accountId, entryId);
    expect(reviewed).toMatchObject({ id: entryId, status: "pending", snapshot: value });
    expect(reviewed.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(loadQuestionSetLibraryPreview(accountId, entryId)).rejects.toThrow(/unavailable|withdrawn/i);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, 0, -1, 1.5, "1"])(
    "fails closed when pending moderation revision is not a safe positive integer (%s)",
    async revision => {
      const value = snapshot();
      const rpc = vi.fn().mockResolvedValue({ data: {
        id: entryId, title: value.title, question_count: 1,
        status: "pending", snapshot_payload: value, review_revision: revision,
      }, error: null });
      service(rpc);
      await expect(loadPendingQuestionSetReviewPreview(accountId, entryId))
        .rejects.toThrow(/review revision is missing/i);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
    },
  );

  it.each(["approved", "rejected"])("refuses a %s listing in the pending moderation reader", async status => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status, snapshot_payload: value,
    }, error: null });
    service(rpc);
    await expect(loadPendingQuestionSetReviewPreview(accountId, entryId))
      .rejects.toThrow(/no longer awaiting academic review/i);
  });

  it.each([
    ["file URI", "file:///Users/example/private-course.pdf"],
    ["macOS path", "Internal source /Users/example/private-course.pdf"],
    ["Linux path", "/home/example/private-course.pdf"],
    ["Windows drive", "C:\\Users\\Example\\private-course.pdf"],
    ["Android provider", "content://com.example.provider/document/42"],
    ["network share", "\\\\campus-server\\share\\private-course.pdf"],
    ["home-relative path", "~/Documents/private-course.pdf"],
    ["label-colon macOS path", "source:/Users/Example/private.pdf"],
    ["label-equals macOS path", "source=/Users/Example/private.pdf"],
    ["label-colon Windows path", "source:C:\\Users\\Example\\private.pdf"],
    ["label-equals Windows path", "source=C:\\Users\\Example\\private.pdf"],
    ["label-colon file URI", "source:file:///Users/Example/private.pdf"],
    ["encoded file URI", "file%3A%2F%2F%2FUsers%2FExample%2Fprivate.pdf"],
    ["double-encoded file URI", "file%253A%252F%252F%252FUsers%252FExample%252Fprivate.pdf"],
    ["encoded file URI with unrelated malformed escape", "file%3A%2F%2F%2FUsers%2FExample%2Fprivate.pdf%GG"],
    ["macOS external volume", "/Volumes/JDabSSD/private.pdf"],
    ["Linux mount", "/mnt/private-source/file.pdf"],
    ["removable-media mount", "/media/user/source/file.pdf"],
    ["root directory", "source:/root/study/private.pdf"],
    ["temporary directory", "source:/tmp/private.pdf"],
    ["iOS mobile directory", "/var/mobile/Containers/private.pdf"],
    ["Android storage", "/storage/emulated/0/private.pdf"],
    ["opt directory", "source:/opt/exams/private.pdf"],
    ["arbitrary absolute folder", "source:/unpublished/private.pdf"],
    ["slash-style network share", "//campus-server/share/private.pdf"],
    ["encoded arbitrary root", "source%3A%2Froot%2Fprivate.pdf"],
  ])("refuses direct %s citations before the submission RPC without altering source evidence", async (_label, citation) => {
    const value = snapshot();
    value.questions[0].citation = citation;
    const original = JSON.stringify(value);
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/citation contains a private local file path/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(original);
  });

  it("permits public source references through direct new submission", async () => {
    const value = snapshot();
    value.questions[0].citation = "PMID: 123456; DOI: 10.1000/demo; https://example.edu/source";
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    service(rpc);
    expect(await submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed)).toBe(entryId);
    expect(rpc).toHaveBeenCalledWith("submit_question_set_library", expect.objectContaining({
      p_source_id: "set-1", p_snapshot: value, p_rights_confirmed: true, p_answers_confirmed: true,
    }));
  });

  it.each([
    "https://example.edu/home/overview",
    "https://example.edu/Volumes/lecture-record",
    "https://example.edu/resources?course=home",
    "PMID: 123456; DOI: 10.1000/example",
    "https://example.edu/research?source=/home/public-notes",
    "https://example.edu/tmp/lecture.pdf",
    "DOI:10.1000/abc",
  ])("allows a public citation containing path-like words (%s)", async citation => {
    const value = snapshot();
    value.questions[0].citation = citation;
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    service(rpc);
    expect(await submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed)).toBe(entryId);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps approved historical previews with device-local citations readable", async () => {
    const value = snapshot();
    value.questions[0].citation = "file:///Users/historical/source.pdf";
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: value.title, question_count: 1, status: "approved",
      snapshot_payload: value, review_revision: 3,
    }, error: null });
    service(rpc);
    const preview = await loadQuestionSetLibraryPreview(accountId, entryId);
    expect(preview.snapshot).toEqual(value);
    expect(preview.reviewRevision).toBe(3);
    expect(rpc).toHaveBeenCalledWith("get_question_set_library", { p_id: entryId });
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
  it("refuses a replaced answer key after the pending set was inspected", async () => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const changed = snapshot();
    changed.questions[0].correctKey = "B";
    changed.questions[0].correctAnswerText = "Second";
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: changed.title, question_count: 1, status: "pending", snapshot_payload: changed,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked the source key"))
      .rejects.toThrow(/changed since inspection/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
  });

  it.each(["approved", "rejected"])("refuses a %s status transition before moderation decision", async status => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status, snapshot_payload: original,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Evidence was checked"))
      .rejects.toThrow(/no longer awaiting academic review/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered review receipt without touching the server", async () => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: "a".repeat(64), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn();
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked the source key"))
      .rejects.toThrow(/reviewed Question Set changed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an account-epoch change between fresh inspection and decision", async () => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status: "pending", snapshot_payload: original,
    }, error: null });
    const assertCurrent = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The signed-in account changed."));
    service(rpc, assertCurrent);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked the source key"))
      .rejects.toThrow(/account changed/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects the same snapshot after its protected review revision advances", async () => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status: "pending",
      snapshot_payload: original, review_revision: 2,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked the source key"))
      .rejects.toThrow(/changed since inspection/);
    expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
  });

  it("submits an unchanged pending revision using the source-reviewed decision only", async () => {
    const original = snapshot();
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: {
        id: entryId, title: original.title, question_count: 1, status: "pending", snapshot_payload: original,
        review_revision: 1,
      }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    service(rpc);
    await reviewQuestionSetSubmission(accountId, reviewed, true, "Checked the source key");
    expect(rpc).toHaveBeenNthCalledWith(1, "get_question_set_library", { p_id: entryId });
    expect(rpc).toHaveBeenNthCalledWith(2, "review_question_set_library", {
      p_id: entryId, p_approved: true, p_reason: "Checked the source key",
      p_expected_snapshot: original,
      p_expected_revision: 1,
    });
  });

});
