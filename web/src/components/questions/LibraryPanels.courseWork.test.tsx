// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../../lib/library";
import { QuestionSetList } from "./LibraryPanels";

const mocked = vi.hoisted(() => ({
  bulkAddTrackerItems: vi.fn(),
  store: {} as Record<string, unknown>,
}));

vi.mock("../../lib/store", () => ({ useStore: () => mocked.store }));
vi.mock("../../lib/ai", () => ({ resolveActiveProvider: () => null, enhanceQuestionSet: vi.fn() }));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuestionSetList course review work", () => {
  it("turns digest suggestions into module-linked review tasks", async () => {
    const set: QuestionSet = {
      id: "set-1",
      title: "Neuro misses",
      trackerPath: "Term 4/NCRS/Neuro",
      sourceDocumentIds: [],
      createdAt: "2026-10-13T10:00:00.000Z",
      questionIds: [],
      tags: [],
      aiEnhanced: true,
      parserWarnings: [],
      digest: {
        summary: "Review the weak areas.",
        pitfalls: [],
        suggestedReview: ["Cranial nerve nuclei"],
        generatedBy: "Local model",
        generatedAt: "2026-10-13T10:00:00.000Z",
      },
    };
    mocked.store = {
      questionSets: [set],
      questions: [],
      documents: [],
      tracker: [],
      bulkAddTrackerItems: mocked.bulkAddTrackerItems,
      updateQuestionSet: vi.fn(),
      removeQuestionSet: vi.fn(),
    };

    const user = userEvent.setup();
    render(<QuestionSetList onRunSet={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add review to Tracker" }));

    expect(mocked.bulkAddTrackerItems).toHaveBeenCalledWith([
      expect.objectContaining({
        path: "Term 4/NCRS/Neuro",
        label: "Review Cranial nerve nuclei",
        reviewTask: { source: "digest", sourceId: "set-1" },
      }),
    ]);
  });
});
