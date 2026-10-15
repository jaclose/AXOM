// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { listQuestionSetShares, publishShare, revokeShare } from "../../lib/sharing/supabaseSharing";
import { pushToast } from "../../lib/toast";
import { QuestionSetList, SourceLibrary } from "./LibraryPanels";

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

vi.mock("../../lib/store", () => ({
  useStore: () => mocked.store ?? { documents: [mocked.document], removeDocument: vi.fn() },
}));
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
