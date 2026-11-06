// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CommunityQuestionSetPublisher } from "./CommunityQuestionSetPublisher";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";

const state = vi.hoisted(() => ({
  accountId: "owner-1" as string | undefined,
  questionSets: [] as unknown[],
  questions: [] as unknown[],
}));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (value: { user: { id: string } | null }) => unknown) =>
    select({ user: state.accountId ? { id: state.accountId } : null }),
}));
vi.mock("../../lib/store", () => ({
  useStore: (select: (value: { questionSets: unknown[]; questions: unknown[] }) => unknown) =>
    select({ questionSets: state.questionSets, questions: state.questions }),
}));
vi.mock("./QuestionSetLibrarySubmitDialog", () => ({
  QuestionSetLibrarySubmitDialog: ({ set, questions, onClose }: {
    set: QuestionSet; questions: readonly QuestionRecord[]; onClose: () => void;
  }) => <div role="dialog" aria-label={`Submit ${set.title}`}>
    <span>{questions.length} bank questions supplied</span>
    <button type="button" onClick={onClose}>Close set submission</button>
  </div>,
}));

const set = (id: string, title: string, kind: QuestionSet["kind"] = "custom"): QuestionSet => ({
  id, title, kind, questionIds: ["q-1"], sourceDocumentIds: [], tags: [],
  createdAt: "2026-11-06T12:00:00Z", aiEnhanced: false, parserWarnings: [],
});
const question = { id: "q-1", stem: "Synthetic stem", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }], correctKey: "A", tags: [], attempts: [] } as QuestionRecord;

describe("Community Question Set publisher", () => {
  beforeEach(() => {
    state.accountId = "owner-1";
    state.questionSets = [];
    state.questions = [question];
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("accepts standalone saved sets without requiring a course, module or source file", () => {
    state.questionSets = [set("set-1", "Independent clinical cases")];
    render(<CommunityQuestionSetPublisher onOpenLibrary={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Publish a Question Set" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Saved Question Set" }), { target: { value: "set-1" } });
    expect(screen.getByText(/1 question selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review and submit set" }));
    const dialog = screen.getByRole("dialog", { name: "Submit Independent clinical cases" });
    expect(within(dialog).getByText("1 bank questions supplied")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Term confirmed/ })).toBeNull();
  });

  it("excludes private missed-review collections and imported community copies", () => {
    state.questionSets = [
      set("custom", "My authored set"),
      set("review", "My misses", "review"),
      { ...set("imported", "Someone else's public set"), importProvenance: {
        version: 1, shareId: "shared-1", contentDigest: "digest",
      } },
    ];
    render(<CommunityQuestionSetPublisher onOpenLibrary={vi.fn()} />);
    const choices = screen.getByRole("combobox", { name: "Saved Question Set" });
    expect(within(choices).getByRole("option", { name: /My authored set/ })).toBeTruthy();
    expect(within(choices).queryByRole("option", { name: /My misses/ })).toBeNull();
    expect(within(choices).queryByRole("option", { name: /Someone else's/ })).toBeNull();
  });

  it("keeps an empty library local and opens Question Bank", () => {
    const onOpenLibrary = vi.fn();
    render(<CommunityQuestionSetPublisher onOpenLibrary={onOpenLibrary} />);
    expect(screen.getByText(/No eligible Question Sets on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Question Bank" }));
    expect(onOpenLibrary).toHaveBeenCalledOnce();
  });

  it("does not carry a selected set or open submission across account changes", () => {
    state.questionSets = [set("set-1", "Original owner set")];
    const { rerender } = render(<CommunityQuestionSetPublisher onOpenLibrary={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Saved Question Set" }), { target: { value: "set-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit set" }));
    expect(screen.getByRole("dialog", { name: "Submit Original owner set" })).toBeTruthy();
    state.accountId = "owner-2";
    rerender(<CommunityQuestionSetPublisher onOpenLibrary={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Saved Question Set" }) as HTMLSelectElement).value).toBe("");
  });
});
