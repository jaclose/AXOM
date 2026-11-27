// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { enhanceQuestionSet, resolveActiveProvider } from "../../lib/ai";
import { listQuestionSetShares, publishShare, revokeShare } from "../../lib/sharing/supabaseSharing";
import { pushToast } from "../../lib/toast";
import { QuestionSetList, SourceLibrary } from "./LibraryPanels";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../../lib/questionAttachmentScope";

const mocked = vi.hoisted(() => ({
  document: {
    id: "doc-1",
    title: "Saved source",
    fileName: "saved.txt",
    fileType: "text",
    uploadedAt: "2026-07-12T00:00:00.000Z",
    rawText: "1. Stem?\nA. Alpha\nB. Beta\nAnswer: B",
    sizeBytes: 100,
    tags: [],
    linkedQuestionSetIds: [],
    libraryOnly: true,
  },
  store: null as Record<string, unknown> | null,
}));

vi.mock("../../lib/store", () => {
  const useStore = Object.assign(
    () => mocked.store ?? { documents: [mocked.document], removeDocument: vi.fn() },
    { getState: () => mocked.store ?? { documents: [mocked.document], removeDocument: vi.fn() } },
  );
  return { useStore };
});
vi.mock("../../lib/ai", () => ({
  enhanceQuestionSet: vi.fn(),
  resolveActiveProvider: vi.fn(() => null),
}));
vi.mock("../../lib/sharing/supabaseSharing", () => ({
  listQuestionSetShares: vi.fn(),
  publishShare: vi.fn(),
  revokeShare: vi.fn(),
}));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

afterEach(() => {
  cleanup();
  mocked.store = null;
  vi.clearAllMocks();
  resetQuestionAttachmentScopeForTests();
});

describe("SourceLibrary", () => {
  it("offers deterministic local parsing without requiring an AI provider", async () => {
    const user = userEvent.setup();
    const onParseFrom = vi.fn();
    render(<SourceLibrary onParseFrom={onParseFrom} onGenerateFrom={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Parse into questions" }));
    expect(onParseFrom).toHaveBeenCalledWith(mocked.document);
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
  });
});

describe("QuestionSetList sharing disclosure", () => {
  const expiresAt = "2026-10-22T12:00:00.000Z";

  function ownedShare(id: string, token: string) {
    return {
      id,
      sourceId: "set-1",
      token,
      title: "Synthetic set",
      questionCount: 1,
      createdAt: "2026-10-15T12:00:00.000Z",
      expiresAt,
      idempotent: false,
    };
  }

  function useSyntheticSet() {
    const now = "2026-10-15T12:00:00.000Z";
    const set: QuestionSet = {
      id: "set-1",
      title: "Synthetic set",
      sourceDocumentIds: [],
      createdAt: now,
      questionIds: ["q1"],
      tags: [],
      aiEnhanced: false,
      parserWarnings: [],
    };
    const question: QuestionRecord = {
      id: "q1",
      source: "manual",
      stem: "Synthetic question?",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "A",
      correctAnswerText: "Alpha",
      status: "unseen",
      tags: [],
      attempts: [],
      createdAt: now,
      updatedAt: now,
    };
    mocked.store = {
      questionSets: [set],
      questions: [question],
      documents: [],
      tracker: [],
      terms: [],
      courses: [],
      updateQuestionSet: vi.fn(),
      removeQuestionSet: vi.fn(),
      bulkAddTrackerItems: vi.fn(),
    };
  }

  async function openAndConfirmShare() {
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const create = await screen.findByRole("button", { name: "Create unlisted link" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(publishShare).not.toHaveBeenCalled();
    expect(listQuestionSetShares).toHaveBeenCalledOnce();
    expect(screen.getByText(/Anyone with the link can open and import/)).toBeTruthy();
    expect(screen.getByText(/Do not continue with restricted or private source material/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", {
      name: /I reviewed this set and have permission to distribute its question content/,
    }));
    fireEvent.click(create);
  }

  it("requires informed permission before publishing and exposes copy/revoke controls", async () => {
    useSyntheticSet();
    vi.mocked(listQuestionSetShares).mockResolvedValue([]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(publishShare).mockResolvedValue(ownedShare(
      "00000000-0000-4000-8000-000000000001",
      "a".repeat(48),
    ));
    vi.mocked(revokeShare).mockResolvedValue(undefined);

    await openAndConfirmShare();

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(publishShare).toHaveBeenCalledOnce();
    const visibleLink = screen.getByRole("textbox", { name: "Unlisted Question Set link" }) as HTMLInputElement;
    expect(visibleLink.value).toContain("#shared-set?token=");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke link" })).toBeTruthy();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Unlisted Question Set link copied",
      tone: "success",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(revokeShare).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Unlisted Question Set link" })).toBeNull());
  });

  it("keeps a created link visible and revocable when clipboard access is denied", async () => {
    useSyntheticSet();
    vi.mocked(listQuestionSetShares).mockResolvedValue([]);
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(publishShare).mockResolvedValue(ownedShare(
      "00000000-0000-4000-8000-000000000002",
      "b".repeat(48),
    ));
    vi.mocked(revokeShare).mockResolvedValue(undefined);

    await openAndConfirmShare();

    const visibleLink = await screen.findByRole("textbox", { name: "Unlisted Question Set link" }) as HTMLInputElement;
    expect(visibleLink.value).toContain("b".repeat(48));
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Unlisted link created — clipboard unavailable",
      body: expect.stringMatching(/cloud share exists/i),
      tone: "warn",
    }));
    expect(pushToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Share could not be confirmed" }));

    fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(revokeShare).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002"));
  });

  it("recovers every active owner link after component state is lost", async () => {
    useSyntheticSet();
    const first = ownedShare("00000000-0000-4000-8000-000000000003", "c".repeat(48));
    const second = ownedShare("00000000-0000-4000-8000-000000000004", "d".repeat(48));
    vi.mocked(listQuestionSetShares).mockResolvedValue([first, second]);

    const initial = render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect((await screen.findByRole("textbox", {
      name: "Unlisted Question Set link 1",
    }) as HTMLInputElement).value).toContain("c".repeat(48));
    expect((screen.getByRole("textbox", {
      name: "Unlisted Question Set link 2",
    }) as HTMLInputElement).value).toContain("d".repeat(48));
    initial.unmount();

    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect((await screen.findByRole("textbox", {
      name: "Unlisted Question Set link 1",
    }) as HTMLInputElement).value).toContain("c".repeat(48));
    expect(listQuestionSetShares).toHaveBeenCalledTimes(2);
    expect(publishShare).not.toHaveBeenCalled();
  });

  it("recovers a committed link when the publish response is lost", async () => {
    useSyntheticSet();
    const recovered = ownedShare("00000000-0000-4000-8000-000000000005", "e".repeat(48));
    vi.mocked(listQuestionSetShares)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recovered]);
    vi.mocked(publishShare).mockRejectedValue(new Error("Network response was lost."));

    await openAndConfirmShare();

    const visible = await screen.findByRole("textbox", { name: "Unlisted Question Set link" }) as HTMLInputElement;
    expect(visible.value).toContain("e".repeat(48));
    expect(publishShare).toHaveBeenCalledOnce();
    expect(listQuestionSetShares).toHaveBeenCalledTimes(2);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Unlisted link recovered",
      body: expect.stringMatching(/visible and revocable/i),
    }));
  });

  it("fails closed when owner links cannot be checked", async () => {
    useSyntheticSet();
    vi.mocked(listQuestionSetShares).mockRejectedValue(new Error("Cloud lookup failed."));

    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/will not publish another link/i);
    expect(screen.queryByRole("button", { name: "Create unlisted link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry owner link check" })).toBeTruthy();
    expect(publishShare).not.toHaveBeenCalled();
  });
});


describe("QuestionSetList AI digest identity", () => {
  const timestamp = "2026-11-21T00:00:00.000Z";
  const question = (id: string, stem: string, correct: string): QuestionRecord => ({
    id,
    source: "manual",
    stem,
    options: [{ key: "A", text: correct }, { key: "B", text: "Distractor" }],
    correctKey: "A",
    correctAnswerText: correct,
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  function prepare(rows: QuestionRecord[], ids: string[], savedDigest = false) {
    vi.mocked(resolveActiveProvider).mockReturnValue({ info: { label: "Synthetic provider" } } as
      NonNullable<ReturnType<typeof resolveActiveProvider>>);
    vi.mocked(enhanceQuestionSet).mockResolvedValue({
      summary: "Teaching summary", pitfalls: [], suggestedReview: ["Review renal physiology"],
    } as Awaited<ReturnType<typeof enhanceQuestionSet>>);
    const set: QuestionSet = {
      id: "set-digest",
      title: "Synthetic identity test",
      sourceDocumentIds: [],
      createdAt: timestamp,
      questionIds: ids,
      tags: [],
      aiEnhanced: savedDigest,
      parserWarnings: [],
      ...(savedDigest ? { digest: {
        summary: "Untrusted prior digest",
        pitfalls: ["Untrusted pitfall"],
        suggestedReview: ["Untrusted tracker task"],
        generatedBy: "Earlier model",
        generatedAt: timestamp,
      } } : {}),
    };
    const updateQuestionSet = vi.fn();
    mocked.store = {
      questionSets: [set], questions: rows, documents: [], tracker: [], courses: [], terms: [],
      updateQuestionSet, removeQuestionSet: vi.fn(), bulkAddTrackerItems: vi.fn(),
    };
    return { updateQuestionSet };
  }

  it.each([false, true])("withholds AI generation for conflicting IDs in either record order (reverse=%s)", async (reverse) => {
    const cardiac = question("shared", "Cardiac question?", "Gastrin");
    const renal = question("shared", "Renal question?", "Secretin");
    const { updateQuestionSet } = prepare(reverse ? [renal, cardiac] : [cardiac, renal], ["shared"]);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    const build = screen.getByRole("button", { name: /Build digest/i }) as HTMLButtonElement;
    expect(build.disabled).toBe(true);
    expect(screen.getByText(/AI digest on hold:.*conflicting question records/i)).toBeTruthy();
    await userEvent.setup().click(build);
    expect(enhanceQuestionSet).not.toHaveBeenCalled();
    expect(updateQuestionSet).not.toHaveBeenCalled();
  });

  it("holds partial digest construction when any saved member is missing", async () => {
    const { updateQuestionSet } = prepare([question("only", "Available?", "Yes")], ["only", "missing"]);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    const build = screen.getByRole("button", { name: /Build digest/i }) as HTMLButtonElement;
    expect(build.disabled).toBe(true);
    expect(screen.getByText(/AI digest on hold:.*missing question records/i)).toBeTruthy();
    await userEvent.setup().click(build);
    expect(enhanceQuestionSet).not.toHaveBeenCalled();
    expect(updateQuestionSet).not.toHaveBeenCalled();
  });

  it("quarantines a previously saved digest and tracker suggestions while IDs conflict", () => {
    const cardiac = question("shared", "Cardiac?", "Gastrin");
    const renal = question("shared", "Renal?", "Secretin");
    const { updateQuestionSet } = prepare([cardiac, renal], ["shared"], true);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    expect(screen.getByText(/AI digest on hold:.*conflicting question records/i)).toBeTruthy();
    expect(screen.queryByText("Untrusted prior digest")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add review to Tracker/i })).toBeNull();
    expect(updateQuestionSet).not.toHaveBeenCalled();
  });


  it("holds a unique source record when its answer mapping still needs review", async () => {
    const held = { ...question("review", "Unreviewed source?", "Tentative"), needsReview: true };
    const { updateQuestionSet } = prepare([held], ["review"], true);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    expect(screen.getByText(/AI digest on hold:.*answer mapping/i)).toBeTruthy();
    expect(screen.queryByText("Untrusted prior digest")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add review to Tracker/i })).toBeNull();
    expect(enhanceQuestionSet).not.toHaveBeenCalled();
    expect(updateQuestionSet).not.toHaveBeenCalled();
  });

  it("holds uniquely keyed imported answers before extraction review", () => {
    const held = { ...question("unreviewed", "Imported source?", "Tentative"),
      extraction: { confidence: "high" as const, reviewed: false } };
    prepare([held], ["unreviewed"]);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Build digest/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/AI digest on hold:.*answer mapping/i)).toBeTruthy();
  });

  it("holds a unique keyed question whose required source figure is absent", () => {
    const held = { ...question("figure", "Interpret figure?", "Tentative"),
      content: { assets: [{ id: "missing-figure", role: "stem" }] } as QuestionRecord["content"] };
    prepare([held], ["figure"]);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Build digest/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/AI digest on hold:.*answer mapping/i)).toBeTruthy();
  });

  function deferDigest() {
    let resolve!: (value: Awaited<ReturnType<typeof enhanceQuestionSet>>) => void;
    vi.mocked(enhanceQuestionSet).mockImplementation(() => new Promise((done) => { resolve = done; }));
    return async () => {
      await act(async () => resolve({
        summary: "Outdated answer", pitfalls: [], suggestedReview: ["Outdated tracker suggestion"],
      } as Awaited<ReturnType<typeof enhanceQuestionSet>>));
    };
  }

  it("discards an in-flight digest when a valid member's stem/key changes without changing its ID", async () => {
    const { updateQuestionSet } = prepare([question("same", "First stem?", "First key")], ["same"]);
    const finish = deferDigest();
    const view = render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Build digest/i }));
    await waitFor(() => expect(enhanceQuestionSet).toHaveBeenCalledOnce());
    mocked.store = { ...mocked.store, questions: [question("same", "Different stem?", "Different key")] };
    view.rerender(<QuestionSetList recent onRunSet={vi.fn()} />);
    await finish();
    expect(updateQuestionSet).not.toHaveBeenCalled();
    expect(screen.queryByText("Outdated answer")).toBeNull();
  });

  it("discards an in-flight digest after a competing imported row causes a canonical ID collision", async () => {
    const first = question("same", "First stem?", "First key");
    const { updateQuestionSet } = prepare([first], ["same"]);
    const finish = deferDigest();
    const view = render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Build digest/i }));
    await waitFor(() => expect(enhanceQuestionSet).toHaveBeenCalledOnce());
    mocked.store = { ...mocked.store, questions: [first, question("same", "Competing?", "Second key")] };
    view.rerender(<QuestionSetList recent onRunSet={vi.fn()} />);
    await finish();
    expect(updateQuestionSet).not.toHaveBeenCalled();
    expect(screen.queryByText("Outdated answer")).toBeNull();
  });

  it("discards an in-flight digest across account A to B to A even if the source IDs match", async () => {
    setQuestionAttachmentAccount("account-A");
    const { updateQuestionSet } = prepare([question("same", "Source?", "Answer")], ["same"]);
    const finish = deferDigest();
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Build digest/i }));
    await waitFor(() => expect(enhanceQuestionSet).toHaveBeenCalledOnce());
    setQuestionAttachmentAccount("account-B");
    setQuestionAttachmentAccount("account-A");
    await finish();
    expect(updateQuestionSet).not.toHaveBeenCalled();
  });

  it("preserves the one-record-per-ID generation and exact persisted digest", async () => {
    const { updateQuestionSet } = prepare([question("valid", "Valid question?", "Verified answer")], ["valid"]);
    render(<QuestionSetList recent onRunSet={vi.fn()} />);
    const build = screen.getByRole("button", { name: /Build digest/i }) as HTMLButtonElement;
    expect(build.disabled).toBe(false);
    await userEvent.setup().click(build);
    await waitFor(() => expect(enhanceQuestionSet).toHaveBeenCalledOnce());
    expect(enhanceQuestionSet).toHaveBeenCalledWith(expect.anything(), {
      title: "Synthetic identity test",
      questions: [{ stem: "Valid question?", correct: "Verified answer", explanation: undefined }],
    });
    await waitFor(() => expect(updateQuestionSet).toHaveBeenCalledWith("set-digest", expect.objectContaining({
      aiEnhanced: true,
      digest: expect.objectContaining({ summary: "Teaching summary", generatedBy: "Synthetic provider" }),
    })));
  });
});
