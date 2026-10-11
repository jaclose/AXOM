import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloudAcademicLibrary } from "./CloudAcademicLibrary";
const mocks = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), quiz: vi.fn() }));
vi.mock("../../lib/cloudLibrary/client", () => ({ listCloudCatalog: mocks.list }));
vi.mock("../../lib/cloudLibrary/load", () => ({ loadCloudCourse: mocks.load, prepareCloudQuiz: mocks.quiz }));
vi.mock("../../lib/account/supabase", () => ({ loadSupabase: async () => null }));
const release = "11111111-1111-4111-8111-111111111111";
const bank = { release_id: release, id: "bank-a", kind: "bank", title: "Example bank", module: "TEST", term: "Term 1", week: 1, question_count: 2, image_question_count: 1, activity_count: 0, payload_path: "banks/a/bank.json", source_label: "Synthetic fixture" };
const template = { ...bank, id: "template-a", kind: "template", title: "Example course", question_count: 0, image_question_count: 0, activity_count: 3, payload_path: "templates/a.txt" };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ releases: [], entries: [bank, template] }); mocks.load.mockResolvedValue("Course loaded."); mocks.quiz.mockResolvedValue({ module: "TEST", setIds: ["saved-exact-set"], count: 2 }); });
afterEach(cleanup);
describe("published library user workflow", () => {
  it("discovers courses without requiring a local import", async () => {
    render(<CloudAcademicLibrary />);
    expect(await screen.findByRole("button", { name: "Open TEST, Term 1" })).toBeTruthy();
    expect(screen.queryByText(/Install prepared folder/)).toBeNull();
  });
  it("loads a selected published course through the real integration boundary", async () => {
    const user = userEvent.setup(); render(<CloudAcademicLibrary />);
    await user.click(await screen.findByRole("button", { name: "Open TEST, Term 1" }));
    await user.click(screen.getByRole("button", { name: "Load Course" }));
    expect(await screen.findByText("Course loaded.")).toBeTruthy(); expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit set selection and passes the result to the existing player", async () => {
    const user = userEvent.setup(), play = vi.fn(); render(<CloudAcademicLibrary onPractice={play} />);
    await user.click(await screen.findByRole("button", { name: "Open TEST, Term 1" }));
    expect(screen.getByRole("button", { name: "Create Quiz" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Create Quiz" }));
    await screen.findByText("Questions are ready. Choose your study mode.");
    expect(mocks.quiz.mock.calls[0][0]).toEqual([bank]); expect(play).toHaveBeenCalledWith({ module: "TEST", setIds: ["saved-exact-set"], count: 2 });
  });
  it("shows a backend failure instead of claiming the bank has zero content", async () => {
    mocks.list.mockRejectedValue(new Error("Catalog database unavailable")); render(<CloudAcademicLibrary />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Catalog database unavailable");
    expect(screen.queryByText(/No courses have been published/)).toBeNull();
  });
});
