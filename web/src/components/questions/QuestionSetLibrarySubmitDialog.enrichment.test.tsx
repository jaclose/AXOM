// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";
import { COMMUNITY_PUBLICATION_EPOCH_KEY, readCommunityPublicationEpoch, signalCommunityPublicationChange } from "../../lib/sharing/communityPublicationEpoch";

const mocks = vi.hoisted(() => ({
  accountId: "owner-1",
  completeJson: vi.fn(),
  submissions: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  updateQuestion: vi.fn(),
  flush: vi.fn(),
  assertWrites: vi.fn(),
  readVault: vi.fn(),
  accountListeners: new Set<(state: { user: { id: string } | null }) => void>(),
  workspace: { questions: [] as unknown[], questionSets: [] as unknown[] },
}));
vi.mock("../../lib/account/accountStore", () => {
  const getAccountState = () => ({ user: mocks.accountId ? { id: mocks.accountId } : null });
  const useAccount = (selector: (snapshot: ReturnType<typeof getAccountState>) => unknown) => selector(getAccountState());
  useAccount.getState = getAccountState;
  useAccount.subscribe = (listener: (state: ReturnType<typeof getAccountState>) => void) => {
    mocks.accountListeners.add(listener);
    return () => { mocks.accountListeners.delete(listener); };
  };
  return { useAccount };
});
vi.mock("../../lib/localVault", () => ({
  getVaultWriteCheckpoint: () => 1,
  assertVaultWritesSince: (...args: unknown[]) => mocks.assertWrites(...args),
  flushLocalVaultWrites: (...args: unknown[]) => mocks.flush(...args),
  localVaultStorage: { getItem: (...args: unknown[]) => mocks.readVault(...args) },
}));
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
  mocks.accountListeners.clear();
  mocks.flush.mockReset().mockResolvedValue(undefined);
  mocks.assertWrites.mockReset();
  mocks.readVault.mockReset().mockImplementation(async () => JSON.stringify({ state: mocks.workspace }));
  mocks.updateQuestion.mockReset().mockImplementation((id: string, patch: Partial<QuestionRecord>) => {
    mocks.workspace.questions = mocks.workspace.questions.map(value => {
      const current = value as QuestionRecord;
      return current.id === id ? { ...current, ...patch, updatedAt: "2026-11-09T12:00:00.000Z" } : current;
    });
  });
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
      choiceRationales: expect.objectContaining({
        A: expect.stringContaining("AXOM AI-assisted rationale (verify against source): Tunica media"),
        B: expect.stringContaining("AXOM AI-assisted rationale (verify against source): Tunica intima"),
      }),
    })));
    // These are explicitly model-assisted teaching texts, not source-verified
    // rationales. Do not alter the underlying source question or answer key.
    expect(source.choiceRationales).toBeUndefined();
    expect(source.correctKey).toBe("A");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("keeps AI keyword suggestions private unless the publisher explicitly opts in", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Question 1 · Review explanation and choices/));
    const keywords = screen.getByRole("textbox", { name: "Question 1 suggested keywords" }) as HTMLInputElement;
    expect(keywords.value).toContain("vascular smooth muscle");
    const optIn = screen.getByRole("checkbox", { name: /Include inspected keywords for Question 1/ }) as HTMLInputElement;
    expect(optIn.checked).toBe(false);
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    await waitFor(() => expect(mocks.updateQuestion).toHaveBeenCalledOnce());
    const patch = mocks.updateQuestion.mock.calls[0][1] as Partial<QuestionRecord>;
    expect(patch.tags).toBeUndefined();
    expect(source.tags).toEqual(["anatomy"]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("adds only explicitly reviewed, bounded keywords while preserving author tags and answer keys", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Question 1 · Review explanation and choices/));
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1 suggested keywords" }), {
      target: { value: "Vascular Smooth Muscle; anatomy, Histology, histology" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Include inspected keywords for Question 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    await waitFor(() => expect(screen.getByText(/Reviewed explanations saved privately/)).toBeTruthy());
    expect(mocks.updateQuestion).toHaveBeenCalledWith("q-1", expect.objectContaining({
      tags: ["anatomy", "vascular smooth muscle", "histology"],
    }));
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
    expect(source.tags).toEqual(["anatomy"]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects excessive opted-in AI keywords before touching any questions", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Question 1 · Review explanation and choices/));
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1 suggested keywords" }), {
      target: { value: "one,two,three,four,five,six,seven,eight,nine" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Include inspected keywords for Question 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/at most eight keywords/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("keeps drafts and blocks duplicate saves until a durable readback completes", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    let finishFlush!: () => void;
    mocks.flush.mockImplementationOnce(() => new Promise<void>(resolve => { finishFlush = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    const save = await screen.findByRole("button", { name: "Save inspected explanations to my QBank" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "Saving explanations…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/1 AI draft/)).toBeTruthy();
    expect(screen.queryByText(/Reviewed explanations saved privately/)).toBeNull();
    expect(mocks.updateQuestion).toHaveBeenCalledOnce();
    expect(mocks.readVault).not.toHaveBeenCalled();

    await act(async () => { finishFlush(); });
    expect(await screen.findByText(/Reviewed explanations saved privately/)).toBeTruthy();
    expect(screen.queryByText(/1 AI draft/)).toBeNull();
    expect(mocks.assertWrites).toHaveBeenCalledWith(1);
    expect(mocks.readVault).toHaveBeenCalledOnce();
  });

  it("retains inspected drafts after a quota failure and safely retries its optimistic revision", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    mocks.assertWrites.mockImplementationOnce(() => { throw new Error("Local storage is full."); });
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/Local storage is full.*Your drafts are still here/)).toBeTruthy();
    expect(screen.getByText(/1 AI draft/)).toBeTruthy();
    expect(screen.queryByText(/Reviewed explanations saved privately/)).toBeNull();
    expect((mocks.workspace.questions[0] as QuestionRecord).explanation).toContain("AXOM AI-assisted explanation");

    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/Reviewed explanations saved privately/)).toBeTruthy();
    expect(mocks.updateQuestion).toHaveBeenCalledTimes(2);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not claim success when the persisted snapshot lacks the explanations", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    mocks.readVault.mockResolvedValueOnce(JSON.stringify({ state: { questions: [source], questionSets: [set] } }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/saved explanations could not be verified/)).toBeTruthy();
    expect(screen.getByText(/1 AI draft/)).toBeTruthy();
    expect(screen.queryByText(/Reviewed explanations saved privately/)).toBeNull();
  });

  it("preserves a newer question edit during a pending save and refuses to overwrite it on retry", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    let finishFlush!: () => void;
    mocks.flush.mockImplementationOnce(() => new Promise<void>(resolve => { finishFlush = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save inspected explanations to my QBank" }));
    mocks.workspace.questions = [{ ...(mocks.workspace.questions[0] as QuestionRecord), explanation: "Newer independently edited source explanation" }];
    await act(async () => { finishFlush(); });
    expect(await screen.findByText(/saved explanations could not be verified/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/avoid overwriting newer work/)).toBeTruthy();
    expect(mocks.updateQuestion).toHaveBeenCalledOnce();
    expect((mocks.workspace.questions[0] as QuestionRecord).explanation).toBe("Newer independently edited source explanation");
    expect(screen.getByText(/1 AI draft/)).toBeTruthy();
  });

  it("never confirms a pending save after an account switch, even when the original account returns", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    let finishFlush!: () => void;
    mocks.flush.mockImplementationOnce(() => new Promise<void>(resolve => { finishFlush = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save inspected explanations to my QBank" }));
    mocks.accountId = "owner-2";
    for (const listener of mocks.accountListeners) listener({ user: { id: "owner-2" } });
    mocks.accountId = "owner-1";
    for (const listener of mocks.accountListeners) listener({ user: { id: "owner-1" } });
    await act(async () => { finishFlush(); });
    expect(mocks.readVault).not.toHaveBeenCalled();
    expect(screen.queryByText(/Reviewed explanations saved privately/)).toBeNull();
    // The save observer is detached; the modal-wide session guard stays mounted.
    expect(mocks.accountListeners.size).toBe(1);
  });

  it("rejects AI choice rationales that exceed the share limit once provenance is added", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    mocks.completeJson.mockResolvedValueOnce({
      explanation: "Tunica media contains concentric smooth muscle layers regulating arterial caliber and vascular resistance.",
      choiceRationales: {
        A: "A".repeat(9_990),
        B: "Tunica intima contains the endothelial lining rather than the vascular smooth muscle.",
      },
      keywords: [],
    });
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const draftButton = await screen.findByRole("button", { name: /Draft explanations/ });
    await waitFor(() => expect(draftButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(draftButton);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save inspected explanations to my QBank" }));
    expect(await screen.findByText(/Finish the explanation and every choice rationale before saving/)).toBeTruthy();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
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

  it("revokes an in-flight AI batch after an A → B → A account round trip without an intermediate React render", async () => {
    const first = question();
    const second = question({ id: "q-2", stem: "Which arterial layer is the synthetic endothelial lining?" });
    const pair = { ...set, questionIds: [first.id, second.id] };
    mocks.workspace.questions = [first, second];
    mocks.workspace.questionSets = [pair];
    let resolveAI!: (value: unknown) => void;
    mocks.completeJson.mockImplementationOnce(() => new Promise(resolve => { resolveAI = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={pair} questions={[first, second]} autoDraft onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.completeJson).toHaveBeenCalledOnce());

    // Account changes may be batched between React commits, so inspecting
    // only the current account when the provider finishes is insufficient.
    await act(async () => {
      mocks.accountId = "owner-2";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-2" } });
      mocks.accountId = "owner-1";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-1" } });
    });
    await act(async () => {
      resolveAI({
        explanation: "The synthetic source shows that arterial tunica media contains smooth muscle and regulates resistance.",
        choiceRationales: {
          A: "Tunica media is the smooth muscle layer.",
          B: "Tunica intima is the endothelial lining, not the smooth muscle layer.",
        },
        keywords: ["smooth muscle"],
      });
    });

    expect(screen.getByText(/account changed during AI drafting/i)).toBeTruthy();
    expect(screen.queryByText(/AI draft.*to inspect/)).toBeNull();
    expect(mocks.completeJson).toHaveBeenCalledTimes(1);
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    // The in-flight observer is removed; only the lifetime session guard remains.
    expect(mocks.accountListeners.size).toBe(1);
    cleanup();
    expect(mocks.accountListeners.size).toBe(0);
  });

  it("revokes a completed AI draft and refuses any further model calls after an invisible A → B → A switch", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.completeJson).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.accountId = "owner-2";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-2" } });
      mocks.accountId = "owner-1";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-1" } });
    });

    expect(await screen.findByText(/account session changed while this review was open/i)).toBeTruthy();
    expect(screen.queryByText(/AI draft.*to inspect/)).toBeNull();
    const draftButton = screen.getByRole("button", { name: /Draft explanations/ }) as HTMLButtonElement;
    expect(draftButton.disabled).toBe(true);
    fireEvent.click(draftButton);
    expect(mocks.completeJson).toHaveBeenCalledOnce();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("discards checked rights and answer attestations after an invisible A → B → A switch", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that controls arterial caliber and vascular resistance." });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.disabled).toBe(false));

    await act(async () => {
      mocks.accountId = "owner-2";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-2" } });
      mocks.accountId = "owner-1";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-1" } });
    });

    expect((screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement).checked).toBe(false);
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("discards a cached withdrawal capability after an invisible A → B → A switch", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that controls arterial caliber and vascular resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", sourceId: set.id, title: set.title, status: "approved" }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" }) as HTMLButtonElement;
    await waitFor(() => expect(withdraw.disabled).toBe(false));

    await act(async () => {
      mocks.accountId = "owner-2";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-2" } });
      mocks.accountId = "owner-1";
      for (const listener of mocks.accountListeners) listener({ user: { id: "owner-1" } });
    });

    // Hidden React re-renders do not restore the right to act on cached review state.
    const revokedWithdraw = screen.getByRole("button", { name: "Withdraw submission" }) as HTMLButtonElement;
    expect(revokedWithdraw.disabled).toBe(true);
    fireEvent.click(revokedWithdraw);
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
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

  const publishedSubmission = {
    id: "11111111-1111-4111-8111-111111111111",
    sourceId: set.id,
    title: set.title,
    credit: "",
    questionCount: 1,
    status: "pending" as const,
    reviewNote: "",
    createdAt: "2026-11-07T10:00:00.000Z",
  };

  it("refuses withdrawal of a cached submission after an account switch", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([publishedSubmission]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" });
    await waitFor(() => expect(withdraw.hasAttribute("disabled")).toBe(false));

    // The account store can change before React has rerendered this modal.
    mocks.accountId = "owner-2";
    fireEvent.click(withdraw);

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("refuses withdrawal when the account switches during native confirmation", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([publishedSubmission]);
    vi.spyOn(window, "confirm").mockImplementationOnce(() => {
      mocks.accountId = "owner-2";
      return true;
    });
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" });

    fireEvent.click(withdraw);
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("refuses a stale tab's checked attestations after another tab submits and withdraws, even before a storage event", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    mocks.submit.mockResolvedValue("fresh-publication-id");
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    const rights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const answers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    fireEvent.click(rights);
    fireEvent.click(answers);
    await waitFor(() => expect(send.disabled).toBe(false));

    // A second same-origin tab submitted and withdrew this source. Its two
    // acknowledged RPCs advance the opaque publication marker, but this tab
    // has not yet received the browser's queued "storage" notification.
    expect(signalCommunityPublicationChange()).toBe(true);
    expect(signalCommunityPublicationChange()).toBe(true);
    fireEvent.click(send);
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(rights.checked).toBe(false);
      expect(answers.checked).toBe(false);
      expect(send.disabled).toBe(true);
    });
    expect(screen.getByText(/Publication state changed or browser storage is unavailable/)).toBeTruthy();

    // Checking only one box after revocation cannot send the original grant.
    fireEvent.click(rights);
    expect(send.disabled).toBe(true);
    fireEvent.click(answers);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("revokes checked source and rights grants on the cross-tab publication storage event", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    const rights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const answers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    fireEvent.click(rights);
    fireEvent.click(answers);
    await waitFor(() => expect(send.disabled).toBe(false));

    const oldEpoch = readCommunityPublicationEpoch();
    expect(signalCommunityPublicationChange()).toBe(true);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: COMMUNITY_PUBLICATION_EPOCH_KEY, oldValue: oldEpoch, newValue: readCommunityPublicationEpoch(),
      }));
    });
    await waitFor(() => {
      expect(rights.checked).toBe(false);
      expect(answers.checked).toBe(false);
      expect(send.disabled).toBe(true);
    });
    expect(screen.getByText(/Another Question Set publication changed/)).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("revokes cross-tab grants when a lost submit response is recovered as pending", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    // The server committed before its network response was lost. Only the
    // subsequent authenticated status lookup establishes that publication.
    mocks.submissions.mockResolvedValueOnce([]).mockResolvedValueOnce([publishedSubmission]);
    mocks.submit.mockRejectedValueOnce(new Error("Connection lost after commit"));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.disabled).toBe(false));
    const epochBefore = readCommunityPublicationEpoch();
    fireEvent.click(send);

    expect(await screen.findByText(/Your submission is in the library review queue/)).toBeTruthy();
    expect(readCommunityPublicationEpoch()).not.toBe(epochBefore);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submissions).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Withdraw submission" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send for review" })).toBeNull();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("does not signal publication change when a failed submit has no confirmed server row", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([]);
    mocks.submit.mockRejectedValueOnce(new Error("Server rejected the submission"));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.disabled).toBe(false));
    const epochBefore = readCommunityPublicationEpoch();
    fireEvent.click(send);

    expect(await screen.findByText(/Server rejected the submission/)).toBeTruthy();
    expect(readCommunityPublicationEpoch()).toBe(epochBefore);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submissions).toHaveBeenCalledTimes(2);
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("requires fresh rights and answer attestations after a confirmed withdrawal", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValueOnce([]).mockResolvedValueOnce([publishedSubmission]).mockResolvedValueOnce([]);
    mocks.submit.mockResolvedValue(publishedSubmission.id);
    mocks.withdraw.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);

    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    const rights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const answers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    fireEvent.click(rights);
    fireEvent.click(answers);
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/Submission received/)).toBeTruthy();
    expect(mocks.submit).toHaveBeenCalledOnce();

    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" });
    fireEvent.click(withdraw);
    expect(await screen.findByText(/was withdrawn from the library/)).toBeTruthy();
    expect(mocks.withdraw).toHaveBeenCalledWith("owner-1", publishedSubmission.id);

    // Submission-status UI unmounts the form. Reacquire newly mounted
    // inputs rather than inspecting detached DOM nodes from the first grant.
    const freshRights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const freshAnswers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    const freshSend = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    // The same source questions are still ready. The preceding attestations,
    // however, must not silently authorize a second publication.
    await waitFor(() => {
      expect(freshRights.checked).toBe(false);
      expect(freshAnswers.checked).toBe(false);
      expect(freshSend.disabled).toBe(true);
    });
    fireEvent.click(freshRights);
    expect(freshSend.disabled).toBe(true);
    fireEvent.click(freshAnswers);
    expect(freshSend.disabled).toBe(false);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("requires new attestations after a withdrawn listing disappears on delayed status retry", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    // The withdrawal RPC commits; its immediate status readback fails.
    // Only a later authenticated retry establishes that publication is gone.
    mocks.submissions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([publishedSubmission])
      .mockRejectedValueOnce(new Error("Temporary status lookup failure"))
      .mockResolvedValueOnce([]);
    mocks.submit.mockResolvedValue(publishedSubmission.id);
    mocks.withdraw.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);

    const rights = await screen.findByRole("checkbox", { name: /I own this content/ });
    const answers = screen.getByRole("checkbox", { name: /I checked every answer/ });
    fireEvent.click(rights);
    fireEvent.click(answers);
    const send = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/Submission received/)).toBeTruthy();
    expect(mocks.submit).toHaveBeenCalledOnce();

    fireEvent.click(await screen.findByRole("button", { name: "Withdraw submission" }));
    expect(await screen.findByText("Temporary status lookup failure")).toBeTruthy();
    // The failed readback must not falsely announce a confirmed withdrawal
    // or unlock a second submission while the previous listing is still shown.
    expect(screen.queryByText("The submission was withdrawn from the library.")).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw submission" })).toBeTruthy();
    expect(mocks.withdraw).toHaveBeenCalledWith("owner-1", publishedSubmission.id);
    expect(mocks.submit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Retry status check" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Withdraw submission" })).toBeNull());
    // Reacquire the now-mounted form. An earlier owner checked both boxes,
    // but those grants belonged to the publication that is now confirmed gone.
    const freshRights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const freshAnswers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    const freshSend = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(freshRights.checked).toBe(false);
      expect(freshAnswers.checked).toBe(false);
      expect(freshSend.disabled).toBe(true);
    });
    fireEvent.click(freshRights);
    expect(freshSend.disabled).toBe(true);
    fireEvent.click(freshAnswers);
    expect(freshSend.disabled).toBe(false);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("recovers a committed withdrawal when its network reply is lost, without reusing grants", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValueOnce([]).mockResolvedValueOnce([publishedSubmission]).mockResolvedValueOnce([]);
    mocks.submit.mockResolvedValueOnce(publishedSubmission.id);
    mocks.withdraw.mockRejectedValueOnce(new Error("Connection lost after withdrawal committed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);

    const send = await screen.findByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/Submission received/)).toBeTruthy();

    const epochBefore = readCommunityPublicationEpoch();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw submission" }));
    expect(await screen.findByText(/withdrawn from the library after status recovery/)).toBeTruthy();
    expect(readCommunityPublicationEpoch()).not.toBe(epochBefore);
    expect(mocks.withdraw).toHaveBeenCalledOnce();
    expect(mocks.submissions).toHaveBeenCalledTimes(3);
    const freshRights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const freshAnswers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    const freshSend = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    expect(freshRights.checked).toBe(false);
    expect(freshAnswers.checked).toBe(false);
    expect(freshSend.disabled).toBe(true);
    fireEvent.click(freshRights);
    expect(freshSend.disabled).toBe(true);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("retains unknown withdrawal until a later authenticated status retry confirms its disappearance", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates vascular resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValueOnce([publishedSubmission])
      .mockRejectedValueOnce(new Error("Temporary status readback outage"))
      .mockResolvedValueOnce([]);
    mocks.withdraw.mockRejectedValueOnce(new Error("Withdrawal response lost"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);

    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" });
    const epochBefore = readCommunityPublicationEpoch();
    fireEvent.click(withdraw);
    expect(await screen.findByText("Withdrawal response lost")).toBeTruthy();
    expect(readCommunityPublicationEpoch()).toBe(epochBefore);
    expect(screen.getByRole("button", { name: "Withdraw submission" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send for review" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry status check" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Withdraw submission" })).toBeNull());
    expect(readCommunityPublicationEpoch()).not.toBe(epochBefore);
    const rights = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const answers = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    const send = screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement;
    expect(rights.checked).toBe(false);
    expect(answers.checked).toBe(false);
    expect(send.disabled).toBe(true);
    expect(mocks.submissions).toHaveBeenCalledTimes(3);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("does not unlock resubmission when the withdrawal RPC rejects", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([publishedSubmission]);
    mocks.withdraw.mockRejectedValueOnce(new Error("Withdrawal denied"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Withdraw submission" }));
    expect(await screen.findByText("Withdrawal denied")).toBeTruthy();
    expect(screen.queryByText("The submission was withdrawn from the library.")).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw submission" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send for review" })).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry status check" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw submission" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Send for review" })).toBeNull();
    expect((mocks.workspace.questions[0] as QuestionRecord).correctKey).toBe("A");
  });

  it("does not report successful withdrawal if the same submission is still returned", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and resistance." });
    mocks.workspace.questions = [source];
    mocks.submissions.mockResolvedValue([publishedSubmission]);
    mocks.withdraw.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const withdraw = await screen.findByRole("button", { name: "Withdraw submission" });

    fireEvent.click(withdraw);
    expect(await screen.findByText(/Withdrawal could not be confirmed/)).toBeTruthy();
    expect(mocks.withdraw).toHaveBeenCalledWith("owner-1", publishedSubmission.id);
    expect(screen.queryByText(/was withdrawn from the library/)).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });


  it("refuses publication with the previous account's still-rendered attestations", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and vascular resistance." });
    mocks.workspace.questions = [source];
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));

    // The actual store changed before the component got its React update.
    mocks.accountId = "owner-2";
    fireEvent.click(send);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("clears public credit and both attestations when another account opens the same dialog", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and vascular resistance." });
    mocks.workspace.questions = [source];
    const view = render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    const rightsBox = screen.getByRole("checkbox", { name: /I own this content/ }) as HTMLInputElement;
    const answersBox = screen.getByRole("checkbox", { name: /I checked every answer/ }) as HTMLInputElement;
    const creditBox = screen.getByRole("textbox", { name: /Public credit/ }) as HTMLInputElement;
    fireEvent.click(rightsBox);
    fireEvent.click(answersBox);
    fireEvent.change(creditBox, { target: { value: "Previous account's credit" } });
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));

    mocks.accountId = "owner-2";
    view.rerender(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.submissions).toHaveBeenCalledWith("owner-2"));
    await waitFor(() => {
      expect(rightsBox.checked).toBe(false);
      expect(answersBox.checked).toBe(false);
      expect(creditBox.value).toBe("");
      expect(send.hasAttribute("disabled")).toBe(true);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not query or confirm old-account submissions after an in-flight publish switches accounts", async () => {
    const source = question({ explanation: "The tunica media contains smooth muscle that regulates arterial caliber and vascular resistance." });
    mocks.workspace.questions = [source];
    let resolveSubmission!: (id: string) => void;
    mocks.submit.mockImplementationOnce(() => new Promise<string>(resolve => { resolveSubmission = resolve; }));
    render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} onClose={vi.fn()} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this content/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked every answer/ }));
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());

    // Count completed initial lookups rather than assuming React only
    // performs one mount lookup. The requirement is no NEW old-owner readback
    // after the account switches during the in-flight network request.
    const ownerOneLookups = mocks.submissions.mock.calls.filter(([id]) => id === "owner-1").length;
    mocks.accountId = "owner-2";
    await act(async () => { resolveSubmission("22222222-2222-4222-8222-222222222222"); });
    expect(mocks.submissions.mock.calls.filter(([id]) => id === "owner-1")).toHaveLength(ownerOneLookups);
    expect(screen.queryByText(/Submission received/)).toBeNull();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("does not silently auto-draft private material after the account changes", async () => {
    const source = question();
    mocks.workspace.questions = [source];
    const view = render(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    expect(await screen.findByText(/1 AI draft/)).toBeTruthy();
    expect(mocks.completeJson).toHaveBeenCalledOnce();

    mocks.accountId = "owner-2";
    view.rerender(<QuestionSetLibrarySubmitDialog set={set} questions={[source]} autoDraft onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.submissions).toHaveBeenCalledWith("owner-2"));
    await waitFor(() => expect(screen.queryByText(/AI draft.*to inspect/)).toBeNull());
    expect(mocks.completeJson).toHaveBeenCalledOnce();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
  });
});
