// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  workspace: { questions: [] as unknown[], questionSets: [] as unknown[] },
}));
vi.mock("../../lib/account/accountStore", () => {
  const getAccountState = () => ({ user: mocks.accountId ? { id: mocks.accountId } : null });
  const useAccount = (selector: (snapshot: ReturnType<typeof getAccountState>) => unknown) => selector(getAccountState());
  useAccount.getState = getAccountState;
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
  useStore: { getState: () => ({ questions: mocks.workspace.questions, questionSets: mocks.workspace.questionSets, updateQuestion: mocks.updateQuestion }) },
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
  mocks.workspace.questionSets = [set];
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
  it("requires an account-specific submission check before automatic AI", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    let completeLookup!: (value: []) => void;
    mocks.submissions.mockImplementationOnce(() => new Promise<[]>(resolve => { completeLookup = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { completeLookup([]); });
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.completeJson).toHaveBeenCalledOnce();
  });


  it("prepares explanations automatically only after opening a Community publication review", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.completeJson).toHaveBeenCalledOnce();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("never auto-generates from a held answer or publishes it", async () => {
    const source = question({ correctKey: undefined, needsReview: true });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/still held for answer or source review/)).toBeTruthy();
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("drafts explanations and displays them for human review before any local write", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    expect(await screen.findByText(/1 missing explanation/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const draftButton = screen.getByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    fireEvent.click(draftButton);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Question 1 · Review explanation and choices/));
    const explanationInput = screen.getByRole("textbox", { name: "Question 1 explanation" }) as HTMLTextAreaElement;
    expect(explanationInput.value).toMatch(/Tunica media has concentric vascular smooth muscle/);
    fireEvent.change(explanationInput, { target: {
      value: "The tunica media contains the main smooth muscle layers and adjusts vessel caliber when vascular resistance changes.",
    } });
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    await waitFor(() => expect(mocks.updateQuestion).toHaveBeenCalledWith("q-1", expect.objectContaining({
      explanation: expect.stringContaining("AXOM AI-assisted explanation"),
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
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    fireEvent.click(draftButton);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    mocks.workspace.questions = [{ ...source, stem: "Changed source stem" }];
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/questions changed/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
  });
  it("refuses saving AI explanations after a silent replacement of reviewed answer evidence", async () => {
    const source = question({
      citation: "Authoritative text, page 4",
      extraction: { confidence: "high", reviewed: true, answerEvidence: "Marked answer A" },
    });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    fireEvent.click(draftButton);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    // The mapped answer remains marked reviewed, and no updatedAt is bumped.
    // The old fingerprint checked neither source citation nor answer evidence,
    // so this stale proposal previously appeared safe to save.
    mocks.workspace.questions = [{ ...source, citation: "Replacement source, page 9", extraction: {
      ...source.extraction!, answerEvidence: "Different original key annotation",
    } }];
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/questions changed/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects a previously reviewed question if its live answer becomes held before submission", async () => {
    const source = question({ explanation: "The tunica media is the arterial smooth muscle layer, important for contraction and resistance." });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.disabled).toBe(false));
    // Simulate an out-of-band import/review update without rerendering the dialog.
    mocks.workspace.questions = [{ ...source, correctKey: "B", needsReview: true }];
    fireEvent.click(send);
    expect(await screen.findByText(/changed while publishing/)).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["removed from the live set", { ...set, questionIds: [] }],
    ["replaced under the same set ID", { ...set, title: "Replacement set" }],
    ["moved to a different source filing", { ...set, sourceDocumentIds: ["new-source"] }],
    ["moved to a different course", { ...set, scope: { courseId: "unapproved-course" } }],
    ["replaced by another imported source", { ...set, importProvenance: {
      version: 1 as const, shareId: "different-share", contentDigest: "a".repeat(64),
    } }],
    ["recreated under the same ID", { ...set, createdAt: "2026-11-07T12:00:00.000Z" }],
  ])("does not write a prepared draft when its set was %s", async (_reason, changedSet) => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    fireEvent.click(draftButton);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    // An independent import or editor changed the set while the dialog stayed open.
    // A question fingerprint alone remains valid, but the author's reviewed
    // membership and source context are no longer the current workspace state.
    mocks.workspace.questionSets = [changedSet];
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/set changed/i)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not transmit an imported set after silent course refiling", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    // This is a real privacy boundary: the source can remain answer-ready,
    // but it no longer belongs to the same course/right-to-share context.
    mocks.workspace.questionSets = [{ ...set, scope: { courseId: "private-course" } }];
    fireEvent.click(draftButton);
    expect(await screen.findByText(/changed before AI drafting/i)).toBeTruthy();
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["parser-warning review status", { ...set, parserWarnings: ["Unresolved source extraction warning"] }],
    ["AI-enhancement status", { ...set, aiEnhanced: true }],
  ])("refuses AI transmission after silent %s change", async (_reason, changedSet) => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    mocks.workspace.questionSets = [changedSet];
    fireEvent.click(draftButton);
    expect(await screen.findByText(/changed before AI drafting/i)).toBeTruthy();
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("never sends a silently refiled question to the AI provider", async () => {
    const source = question({ courseId: "approved-course", module: "M1" });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    // No timestamp change is needed to reproduce the original stale-context gap.
    mocks.workspace.questions = [{ ...source, courseId: "restricted-course" }];
    fireEvent.click(draftButton);
    expect(await screen.findByText(/changed before AI drafting/i)).toBeTruthy();
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not transmit stale or revoked source-review evidence to the AI provider", async () => {
    const source = question({
      citation: "Textbook page 12",
      extraction: { confidence: "high", reviewed: true, answerEvidence: "Printed key A" },
    });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const button = await screen.findByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    // An external reimport revoked the answer check while the dialog stayed open.
    // No private question should be transmitted to the model after revocation.
    mocks.workspace.questions = [{ ...source, extraction: { ...source.extraction!, reviewed: false }, needsReview: true }];
    fireEvent.click(button);
    expect(await screen.findByText(/changed before AI drafting/i)).toBeTruthy();
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("discards an in-flight proposal and stops the batch if the Question Set changed", async () => {
    const first = question();
    const second = question({ id: "q-2", stem: "Which layer lines the arterial lumen?" });
    const pair = { ...set, questionIds: [first.id, second.id] };
    mocks.workspace.questions = [first, second];
    mocks.workspace.questionSets = [pair];
    let resolveAI!: (value: unknown) => void;
    mocks.completeJson.mockImplementationOnce(() => new Promise(resolve => { resolveAI = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={pair} questions={[first, second]} autoDraft onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.completeJson).toHaveBeenCalledOnce());

    // The first request was already in flight. A second question must not be
    // sent after membership changed, and the first returned draft is discarded.
    mocks.workspace.questionSets = [{ ...pair, questionIds: [first.id] }];
    await act(async () => {
      resolveAI({
        explanation: "The tunica media has multiple smooth muscle layers that regulate arterial resistance and caliber.",
        choiceRationales: {
          A: "Tunica media contains smooth muscle.",
          B: "Tunica intima is the endothelial lining.",
        },
        keywords: ["vascular smooth muscle"],
      });
    });
    expect(await screen.findByText(/changed during AI drafting/i)).toBeTruthy();
    expect(screen.queryByText(/AI draft.*to inspect/)).toBeNull();
    expect(mocks.completeJson).toHaveBeenCalledTimes(1);
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

});
