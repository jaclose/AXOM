// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";

const mocks = vi.hoisted(() => ({
  accountId: "owner-1",
  completeJson: vi.fn(),
  submissions: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  updateQuestion: vi.fn(),
  workspace: { questions: [] as unknown[] },
}));
vi.mock("../../lib/account/accountStore", () => {
  const state = () => ({ user: mocks.accountId ? { id: mocks.accountId } : null });
  const useAccount = (selector: (state: ReturnType<typeof state>) => unknown) => selector(state());
  useAccount.getState = state;
  return { useAccount };
});
vi.mock("../../lib/ai", () => ({
  resolveActiveProvider: () => ({
    info: { kind: "openai-compat", label: "Test AI", local: false, requiresKey: false },
    completeJson: (...args: unknown[]) => mocks.completeJson(...args),
    available: async () => ({ ok: true, detail: "ready" }),
  }),
}));
vi.mock("../../lib/store", () => ({
  useStore: { getState: () => ({ questions: mocks.workspace.questions, updateQuestion: mocks.updateQuestion }) },
}));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listMyQuestionSetSubmissions: (...args: unknown[]) => mocks.submissions(...args),
  submitQuestionSetToLibrary: (...args: unknown[]) => mocks.submit(...args),
  withdrawQuestionSetSubmission: (...args: unknown[]) => mocks.withdraw(...args),
}));

const set: QuestionSet = {
  id: "set-1", title: "Vascular review", questionIds: ["q-1"], sourceDocumentIds: [],
  tags: ["vascular"], createdAt: "2026-11-06T12:00:00.000Z",
  aiEnhanced: false, parserWarnings: [], kind: "custom",
};
function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: "q-1", stem: "Which arterial layer contains smooth muscle?",
    options: [{ key: "A", text: "Tunica media" }, { key: "B", text: "Tunica intima" }],
    source: "manual", correctKey: "A", status: "unseen", attempts: [], tags: ["anatomy"],
    topic: "Vascular histology",
    createdAt: "2026-11-06T12:00:00.000Z", updatedAt: "2026-11-06T12:00:00.000Z", ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = "owner-1";
  mocks.submissions.mockResolvedValue([]);
  mocks.completeJson.mockResolvedValue({
    explanation: "Tunica media has concentric vascular smooth muscle layers that control arterial caliber and vascular resistance.",
    choiceRationales: {
      A: "Tunica media contains the smooth muscle cells.",
      B: "Tunica intima contains the endothelial lining rather than the contractile media.",
    },
    keywords: ["Vascular smooth muscle", "Tunica media"],
  });
});
afterEach(cleanup);

describe("Question Set draft explanation review", () => {
  it("drafts explanations and displays them for human review before any local write", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    expect(await screen.findByText(/1 missing explanation/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Draft explanations \(1 at a time\)/ }));
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Question 1 · Review explanation and choices/));
    expect(screen.getByText(/Tunica media has concentric vascular smooth muscle/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    await waitFor(() => expect(mocks.updateQuestion).toHaveBeenCalledWith("q-1", expect.objectContaining({
      explanation: expect.stringContaining("concentric vascular smooth muscle"),
      choiceRationales: expect.objectContaining({ B: expect.stringContaining("endothelial") }),
    })));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not allow AI to draft a held or unanswered question", async () => {
    const source = question({ correctKey: undefined, needsReview: true });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draft = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    expect(draft.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Send for review" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });

  it("rejects an AI draft if the live source changed before saving", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Draft explanations/ }));
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    mocks.workspace.questions = [{ ...source, stem: "Changed source stem" }];
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/questions changed/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
  });
});
