// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CloudAcademicLibrary } from "./CloudAcademicLibrary";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), load: vi.fn(), quiz: vi.fn(), state: {} as any }));
vi.mock("../../lib/cloudLibrary/useCloudCatalog", () => ({ useCloudCatalog: () => ({ state: mocks.state, refresh: mocks.refresh }) }));
vi.mock("../../lib/cloudLibrary/load", () => ({ loadCloudCourse: (...args: unknown[]) => mocks.load(...args), prepareCloudQuiz: (...args: unknown[]) => mocks.quiz(...args) }));
// Action tests are separate from the animated bookshelf's browser tests.
vi.mock("./AcademicBookshelf", () => ({ AcademicBookshelf: ({ shelves, renderBook }: any) => <div>{shelves.flatMap((s: any) => s.books).map((b: any) => <div key={b.id}>{renderBook(b, () => {})}</div>)}</div> }));
const release = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bank = { release_id: release, id: "bank", kind: "bank", title: "School set", module: "TEST", term: "Term 1", week: 1, question_count: 2, image_question_count: 1, activity_count: 0, payload_path: "banks/test/bank.json", source_label: "test.txt" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.state = { status: "ready", identity: "account-a", signedIn: true, catalog: { releases: [], entries: [bank] } };
});
afterEach(cleanup);
describe("published library entry points", () => {
  it("offers a real quiz without a file-import action", async () => {
    const onPractice = vi.fn(), selection = { module: "TEST", setIds: ["saved-set"], count: 2 };
    mocks.quiz.mockResolvedValue(selection);
    render(<CloudAcademicLibrary mode="questions" onPractice={onPractice} />);
    expect(screen.getByText("School set")).toBeTruthy();
    expect(screen.queryByText("Install prepared folder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Quiz" }));
    await waitFor(() => expect(onPractice).toHaveBeenCalledWith(selection));
    expect(mocks.quiz.mock.calls[0][0]).toHaveLength(1);
  });
  it("lets a learner cancel a stalled transfer and retry without losing control", async () => {
    const onPractice = vi.fn();
    mocks.quiz.mockImplementationOnce((_sets: unknown, _wanted: number, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
      }));
    render(<CloudAcademicLibrary mode="questions" onPractice={onPractice} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Quiz" }));
    const cancel = screen.getByRole("button", { name: "Cancel preparation" });
    expect(cancel).toBeTruthy();
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Preparation stopped");
      expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", false);
    });
    expect(onPractice).not.toHaveBeenCalled();
    const selection = { module: "TEST", setIds: ["saved-set"], questionIds: ["saved-question"], count: 1 };
    mocks.quiz.mockResolvedValueOnce(selection);
    fireEvent.click(screen.getByRole("button", { name: "Create Quiz" }));
    await waitFor(() => expect(onPractice).toHaveBeenCalledWith(selection));
  });

  it("defaults to one set and allows selecting a full week deliberately", async () => {
    const another = { ...bank, id: "second", title: "Second set", week: 2 };
    mocks.state.catalog.entries = [bank, another];
    const onPractice = vi.fn();
    mocks.quiz.mockResolvedValue({ setIds: ["first"], questionIds: ["a"], count: 1 });
    render(<CloudAcademicLibrary mode="questions" onPractice={onPractice} />);
    expect(screen.getByText("1 of 2 sets selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Quiz" }));
    await waitFor(() => expect(onPractice).toHaveBeenCalledOnce());
    expect(mocks.quiz.mock.calls[0][0]).toEqual([bank]);
    cleanup();

    render(<CloudAcademicLibrary mode="questions" />);
    fireEvent.click(screen.getByRole("button", { name: "Select Week 2" }));
    expect(screen.getByText("2 of 2 sets selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", true);
  });
  it("does not interpret an empty selection as every question", () => {
    render(<CloudAcademicLibrary mode="questions" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", true);
    expect(mocks.quiz).not.toHaveBeenCalled();
  });
  it("shows backend failure instead of claiming an empty catalog", () => {
    mocks.state = { status: "error", identity: "a", message: "Catalog connection failed" };
    render(<CloudAcademicLibrary mode="questions" />);
    expect(screen.getByRole("alert").textContent).toContain("Catalog connection failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry library" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("loads a course only after the learner chooses it", async () => {
    mocks.state.catalog.entries = [{ ...bank, id: "template", kind: "template", question_count: 0, image_question_count: 0, activity_count: 3 }];
    mocks.load.mockResolvedValue("Course loaded. Your progress is saved on this device.");
    render(<CloudAcademicLibrary mode="courses" />);
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Load Course/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Course loaded"));
  });
  it("reports failed downloads without starting an empty practice block", async () => {
    mocks.quiz.mockRejectedValue(new Error("Published image validation failed."));
    const onPractice = vi.fn(); render(<CloudAcademicLibrary mode="questions" onPractice={onPractice} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Quiz" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("image validation"));
    expect(onPractice).not.toHaveBeenCalled();
  });
});
