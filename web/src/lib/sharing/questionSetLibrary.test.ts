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
    correctKey: "A", explanation: "The first synthetic option matches the explicitly defined test observation.",
    status: "unseen", tags: [], attempts: [], createdAt: now, updatedAt: now,
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
    ["URL basic-auth password", "https://learner:private-password@example.edu/lesson"],
    ["URL email identity", "https://learner@example.edu/lesson"],
    ["percent-encoded userinfo", "https://learner%3Asecret%40example.edu/lesson"],
    ["percent-encoded URL and authority", "https%3A%2F%2Flearner%40example.edu%2Flesson"],
    ["nested userinfo URL in query", "https://example.edu/redirect?to=https://learner:secret@other.edu/lesson"],
    ["nested local file URI in public URL", "https://example.edu/redirect?source=file:///Users/learner/private.pdf"],
    ["nested Android content URI in public URL", "https://example.edu/view?source=content://private.documents/item/1"],
    ["encoded nested local file URI", "https://example.edu/view?source=file%3A%2F%2F%2FUsers%2Flearner%2Fprivate.pdf"],
    ["double-encoded nested local URI", "https://example.edu/view?source=file%253A%252F%252F%252FUsers%252Flearner%252Fprivate.pdf"],
    ["embedded PDF data URI", "data:application/pdf;base64,JVBERi0x"],
    ["embedded text data URI", "data:text/plain;charset=utf-8;base64,YWJj"],
    ["empty-media-type data URI", "data:,private%20notes"],
    ["browser object URL", "blob:https://example.edu/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["opaque-origin object URL", "blob:null/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["nested encoded inline document", "https://example.edu/view?src=data%3Aapplication%2Fpdf%3Bbase64%2CJVBERi0x"],
    ["double-encoded object URL", "https://example.edu/view?src=blob%253Ahttps%253A%252F%252Fexample.edu%252Fprivate"],
    ["four-layer encoded inline PDF", "https://example.edu/view?src=data%2525253Aapplication%2525252Fpdf%2525253Bbase64%2525252CJVBERi0x"],
    ["five-layer encoded inline PDF", "https://example.edu/view?src=data%252525253Aapplication%252525252Fpdf%252525253Bbase64%252525252CJVBERi0x"],
    ["twelve-layer encoded inline PDF", "https://example.edu/view?src=data%25252525252525252525253Aapplication%25252525252525252525252Fpdf%25252525252525252525253Bbase64%25252525252525252525252CJVBERi0x"],
    ["five-layer encoded browser object URL", "https://example.edu/view?src=blob%252525253Ahttps%252525253A%252525252F%252525252Fexample.edu%252525252Fprivate"],
    ["five-layer encoded private file URI", "https://example.edu/view?src=file%252525253A%252525252F%252525252F%252525252FUsers%252525252Flearner%252525252Fprivate.pdf"],
    ["four-layer fully escaped scheme", "https://example.edu/view?src=%2525252564%2525252561%2525252574%2525252561%252525253Aapplication%252525252Fpdf%252525253Bbase64%252525252CJVBERi0x"],
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

  it.each(["stem", "choice", "rationale", "topic", "tags", "title"] as const)(
    "holds embedded private files or media in public %s before submission", async field => {
      const value = snapshot();
      switch (field) {
        case "stem":
          value.questions[0].stem += " file:///Users/private/clinical-notes.pdf";
          break;
        case "choice":
          value.questions[0].options[0].text = "See content://device/private-scan";
          value.questions[0].correctAnswerText = "See content://device/private-scan";
          break;
        case "rationale":
          value.questions[0].choiceRationales = { B: "Do not embed data:image/png;base64,AAABBB" };
          break;
        case "topic":
          value.questions[0].topic = "C:\\Users\\student\\private\\case.pdf";
          break;
        case "tags":
          value.questions[0].tags = ["blob:https://example.edu/private-file"];
          break;
        case "title":
          value.title = "Review /Users/student/private-cases.pdf";
          break;
      }
      const rpc = vi.fn();
      service(rpc);
      await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
        .rejects.toThrow(/teaching text contains a private local file or inline media reference/i);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("holds a nested, encoded browser object URL in an otherwise public question", async () => {
    const value = snapshot();
    value.questions[0].stem += " https://example.edu/view?src=blob%253Ahttps%253A%252F%252Fexample.edu%252Fprivate";
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/teaching text contains a private local file or inline media reference/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["Linux mount", "/mnt/study/private-lecture.pdf"],
    ["temporary folder", "/tmp/hidden-answer-key.pdf"],
    ["iOS container", "/var/mobile/Containers/private-slide.png"],
    ["Android media", "/storage/emulated/0/private-scan.jpg"],
    ["labeled arbitrary folder", "source:/unpublished/answer-key.pdf"],
    ["network share", "//campus-server/records/notes.pdf"],
    ["credential-bearing HTTP source", "https://learner:secret@example.edu/lecture"],
  ])("holds %s paths in teaching text before public submission", async (_name, reference) => {
    const value = snapshot();
    value.questions[0].stem += ` Local copy: ${reference}`;
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/private local file or inline media reference/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["local file", "file:///Users/author/private-source.pdf"],
    ["browser object URL", "blob:https://example.edu/private-preview"],
    ["embedded data", "data:text/plain;base64,YWJj"],
    ["network share", "//intranet/private/credit.txt"],
    ["source-labeled device path", "source:/mnt/private/author.txt"],
    ["HTTP URL credentials", "https://creator:secret@example.edu/profile"],
    ["encoded local file", "file%253A%252F%252F%252FUsers%252Fauthor%252Fprivate.pdf"],
  ])("blocks %s in public creator credit before the submission RPC", async (_label, credit) => {
    const value = snapshot();
    const original = JSON.stringify(value);
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, credit, confirmed))
      .rejects.toThrow(/Public creator credit contains a private file/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(original);
  });

  it.each([
    "Department of Pathology / Histology",
    "Faculty reviewer, Example University",
    "https://example.edu/faculty/author",
    "Dr. Example (CC BY 4.0 attribution)",
  ])("allows safe public creator credit (%s)", async credit => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, credit, confirmed))
      .resolves.toBe(entryId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_question_set_library", expect.objectContaining({
      p_credit: credit,
      p_snapshot: value,
    }));
  });

  it("retains public medical prose, mechanism URLs and slash-delimited terminology", async () => {
    const value = snapshot();
    value.questions[0].stem = "Compare the CD4/CD8 ratio and MHC I/II mechanisms. https://example.edu/review";
    value.questions[0].explanation = "The CD4/CD8 ratio is used here as synthetic teaching text; Data: available upon request.";
    value.questions[0].choiceRationales = { B: "This answer differs from the specified observation." };
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .resolves.toBe(entryId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_question_set_library", expect.objectContaining({
      p_snapshot: value,
    }));
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
    "https://example.edu/paper?q=learner@example.edu",
    "https://example.edu/@editor/chapter",
    "https://example.edu/paper#author@university",
    "Data: available upon request",
    "https://example.edu/paper?format=data",
    "https://example.edu/paper?term=alpha%3Abeta&name=%C3%A9tude",
    "DOI: 10.1000/escaped%2520space",
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
    ["missing", undefined],
    ["key-only", "Answer: A"],
    ["source-only", "Source: page 4"],
    ["unexplained slide marker", "PowerPoint slide note 12 explicitly marks A. The supplied notes do not provide a teaching rationale."],
  ])("holds %s explanation before any public submission RPC", async (_label, explanation) => {
    const value = snapshot();
    value.questions[0].explanation = explanation;
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/teaching explanation prose/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["bare key letter", "A"],
    ["answer-only option", "Option A is correct."],
    ["unfinished rationale", "Explanation to be added."],
    ["unreviewed draft notice", "Rationale: pending."],
    ["bare slide reference", "See slide 4."],
    ["answer-only plus citation", "Option A is correct.\nSource: Lecture 4"],
  ])("rejects %s as a Community explanation before submission", async (_label, explanation) => {
    const value = snapshot();
    value.questions[0].explanation = explanation;
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/teaching explanation prose/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "Option A is correct because the synthetic observation uniquely identifies this choice.",
    "Source: Synthetic protocol\nThe first option follows directly from the explicitly defined observation.",
  ])("permits actual teaching prose without treating it as medically reviewed (%s)", async explanation => {
    const value = snapshot();
    value.questions[0].explanation = explanation;
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed)).resolves.toBe(entryId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_question_set_library", expect.anything());
  });

  it("checks explanation readiness for every question, not only the first", async () => {
    const value = snapshot();
    value.questions.push({ ...value.questions[0], id: "shared-question-2", explanation: "Explanation pending." });
    value.orderedQuestionIds.push("shared-question-2");
    const rpc = vi.fn();
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed))
      .rejects.toThrow(/teaching explanation prose/);
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

  it("pins the validated submission across asynchronous account lookup", async () => {
    const value = snapshot();
    const expected = JSON.parse(JSON.stringify(value)) as ReturnType<typeof snapshot>;
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    let resumeAccount!: (operation: Awaited<ReturnType<typeof accountOperationClient>>) => void;
    vi.mocked(accountOperationClient).mockImplementationOnce(() =>
      new Promise(resolve => { resumeAccount = resolve; }));

    // Submission validation occurs before the service yields to resolve the
    // signed-in account. Simulate editing a source key and adding a private
    // citation while that account request remains unresolved.
    const pending = submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed);
    value.questions[0].correctKey = "B";
    value.questions[0].correctAnswerText = "Second";
    value.questions[0].explanation = "The second choice is now claimed as correct.";
    value.questions[0].citation = "file:///Users/private/source.pdf";

    resumeAccount({
      userId: accountId, client: { rpc },
      assertCurrent: vi.fn().mockResolvedValue(undefined),
    } as never);
    await expect(pending).resolves.toBe(entryId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_question_set_library", expect.objectContaining({
      p_source_id: "set-1", p_snapshot: expected,
      p_rights_confirmed: true, p_answers_confirmed: true,
    }));
    expect(expected.questions[0].correctKey).toBe("A");
    expect(expected.questions[0].citation).toBeUndefined();
    expect(value.questions[0].correctKey).toBe("B");
  });

  it("refuses a changed reviewed snapshot after async account verification, before the public RPC", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    let resumeAccount!: (operation: Awaited<ReturnType<typeof accountOperationClient>>) => void;
    vi.mocked(accountOperationClient).mockImplementationOnce(() =>
      new Promise(resolve => { resumeAccount = resolve; }));
    let live = JSON.parse(JSON.stringify(value)) as ReturnType<typeof snapshot>;
    const pending = submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed, () => live);
    live = { ...live, questions: live.questions.map(item => ({
      ...item, correctKey: "B", correctAnswerText: "Second",
      explanation: "The second answer was substituted after source review.",
    })) };
    resumeAccount({
      userId: accountId, client: { rpc },
      assertCurrent: vi.fn().mockResolvedValue(undefined),
    } as never);
    await expect(pending).rejects.toThrow(/changed during account verification/);
    expect(rpc).not.toHaveBeenCalled();
    expect(value.questions[0].correctKey).toBe("A");
  });

  it("accepts a refreshed, identical wire snapshot after async account verification", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({ data: entryId, error: null });
    let rechecked = 0;
    service(rpc);
    await expect(submitQuestionSetToLibrary(accountId, "set-1", value, "", confirmed, () => {
      rechecked += 1;
      return JSON.parse(JSON.stringify(value)) as ReturnType<typeof snapshot>;
    })).resolves.toBe(entryId);
    expect(rechecked).toBe(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_question_set_library", expect.objectContaining({
      p_source_id: "set-1", p_snapshot: value,
    }));
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

  it.each([
    ["answer label", "Answer: A"],
    ["citation only", "Source: page 4"],
    ["no teaching rationale", "Explanation pending."],
    ["absent explanation", undefined],
  ])("prevents academic approval of a pending set with %s", async (_label, explanation) => {
    // Legacy pending submissions may predate the publisher egress guard.
    // They are still inspectable/rejectable, but not safe to approve.
    const original = snapshot();
    original.questions[0].explanation = explanation;
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status: "pending",
      snapshot_payload: original, review_revision: 1,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked source and rights"))
      .rejects.toThrow(/not ready for approval.*teaching explanation prose/i);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
  });

  it.each([
    ["bare key", "A"],
    ["answer-only claim", "Option A is correct."],
    ["unfinished draft", "Rationale: pending."],
    ["source slide only", "See slide 4."],
  ])("does not approve a legacy pending set with %s", async (_label, explanation) => {
    const original = snapshot();
    original.questions[0].explanation = explanation;
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status: "pending",
      snapshot_payload: original, review_revision: 1,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Reviewed source and rights"))
      .rejects.toThrow(/not ready for approval.*teaching explanation prose/i);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
  });

  it("prevents academic approval when an older pending submission has no answer key", async () => {
    const original = snapshot();
    delete original.questions[0].correctKey;
    delete original.questions[0].correctAnswerText;
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: entryId, title: original.title, question_count: 1, status: "pending",
      snapshot_payload: original, review_revision: 1,
    }, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Checked source and rights"))
      .rejects.toThrow(/not ready for approval.*confirmed answer/i);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["citation", "stem", "metadata", "set title", "URL credentials"] as const)(
    "holds a legacy pending set with a private %s at academic approval", async field => {
      const original = snapshot();
      switch (field) {
        case "citation":
          original.questions[0].citation = "file:///Users/reviewer/private-source.pdf";
          break;
        case "stem":
          original.questions[0].stem += " blob:https://example.edu/hidden-document";
          break;
        case "metadata":
          original.questions[0].topic = "See /mnt/private-course/teaching.pdf";
          break;
        case "set title":
          original.title = "Private slides /Volumes/external/private-set.pdf";
          break;
        case "URL credentials":
          original.questions[0].explanation += " https://teacher:private@example.edu/exam";
          break;
      }
      const reviewed = { id: entryId, snapshot: original,
        contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
      const rpc = vi.fn().mockResolvedValue({ data: {
        id: entryId, title: original.title, question_count: 1, status: "pending",
        snapshot_payload: original, review_revision: 1,
      }, error: null });
      service(rpc);
      await expect(reviewQuestionSetSubmission(accountId, reviewed, true, "Reviewed the source and permission"))
        .rejects.toThrow(/private file or inline media reference.*Return it for revision/i);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).not.toHaveBeenCalledWith("review_question_set_library", expect.anything());
    },
  );

  it("allows returning a privacy-blocked legacy submission for revision", async () => {
    const original = snapshot();
    original.questions[0].citation = "content://private-document/lecture";
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: {
        id: entryId, title: original.title, question_count: 1, status: "pending",
        snapshot_payload: original, review_revision: 1,
      }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, false, "Remove the private source reference"))
      .resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(2, "review_question_set_library", {
      p_id: entryId, p_approved: false, p_reason: "Remove the private source reference",
      p_expected_snapshot: original, p_expected_revision: 1,
    });
  });

  it("still permits returning an unready pending set for revision without positive attestations", async () => {
    const original = snapshot();
    delete original.questions[0].correctKey;
    delete original.questions[0].correctAnswerText;
    original.questions[0].explanation = "Answer pending.";
    const reviewed = { id: entryId, snapshot: original,
      contentDigest: await sharedQuestionSetDigest(original), status: "pending" as const, reviewRevision: 1 };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: {
        id: entryId, title: original.title, question_count: 1, status: "pending",
        snapshot_payload: original, review_revision: 1,
      }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    service(rpc);
    await expect(reviewQuestionSetSubmission(accountId, reviewed, false, "Missing verified key and rationale"))
      .resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(2, "review_question_set_library", {
      p_id: entryId, p_approved: false, p_reason: "Missing verified key and rationale",
      p_expected_snapshot: original, p_expected_revision: 1,
    });
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
