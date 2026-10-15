// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../lib/library";
import { createQuestionSetShare } from "../lib/sharing/questionSetShare";
import { resolveShare } from "../lib/sharing/supabaseSharing";
import { SharedQuestionSetPage } from "./SharedQuestionSetPage";

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  questionSets: [] as QuestionSet[],
}));

vi.mock("../lib/store", () => ({
  useStore: {
    getState: () => ({
      questionSets: mocks.questionSets,
      commitSharedQuestionSetImport: mocks.commit,
    }),
  },
}));
vi.mock("../lib/sharing/supabaseSharing", () => ({ resolveShare: vi.fn() }));

const SHARE_ID = "00000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);
const TOKEN = "b".repeat(48);
const NOW = "2026-10-15T12:00:00.000Z";

const snapshot = createQuestionSetShare({
  id: "source-set",
  title: "Synthetic shared set",
  sourceDocumentIds: [],
  createdAt: NOW,
  questionIds: ["q1"],
  tags: [],
  aiEnhanced: false,
  parserWarnings: [],
}, [{
  id: "q1",
  source: "manual",
  stem: "Synthetic question?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "A",
  correctAnswerText: "Alpha",
  status: "unseen",
  tags: [],
  attempts: [],
  createdAt: NOW,
  updatedAt: NOW,
}], NOW);

beforeEach(() => {
  window.location.hash = `#/shared?token=${TOKEN}`;
  mocks.questionSets = [];
  mocks.commit.mockReset();
  vi.mocked(resolveShare).mockReset();
  vi.mocked(resolveShare).mockResolvedValue({ id: SHARE_ID, snapshot, contentDigest: DIGEST });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Shared Question Set page", () => {
  it("routes the validated server identity through the durable store action", async () => {
    mocks.commit.mockResolvedValue({
      ok: true,
      questionSetId: "local-set",
      questionIds: ["local-question"],
      added: 1,
      reused: 0,
      alreadyImported: false,
    });
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    expect(screen.getByText("Unlisted Question Set link")).toBeTruthy();
    expect(screen.getByText(/Anyone with this link can open and import the snapshot/)).toBeTruthy();
    expect(screen.getByText(/Do not share restricted or private source material/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));

    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith({
      snapshot,
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
    }));
    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
  });

  it("recognizes a durable prior import after reload without another mutation", async () => {
    mocks.questionSets = [{
      id: "local-set",
      title: "Synthetic shared set",
      sourceDocumentIds: [],
      createdAt: NOW,
      questionIds: ["local-question"],
      tags: [],
      aiEnhanced: false,
      parserWarnings: [],
      importProvenance: { version: 1, shareId: SHARE_ID, contentDigest: DIGEST },
    }];
    render(<SharedQuestionSetPage />);

    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("shows a durable-save failure and leaves retry available", async () => {
    mocks.commit.mockResolvedValue({
      ok: false,
      message: "Synthetic vault failure",
      rollbackFailures: [],
    });
    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Synthetic vault failure");
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
  });
});
