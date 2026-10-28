// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { TermCourseActions } from "./TermCourseActions";

const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), launch: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn(),
  downloaded: new Set<string>(), questionIds: ["ready-question"], setIds: ["ready-set"], needsCatalog: false }));
vi.mock("../../lib/store", () => ({ useStore: Object.assign(() => ({}), { getState: () => ({}) }) }));
vi.mock("../../lib/academicLibrary/accountScope", () => ({ academicAccountScope: () => ({ assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
vi.mock("../../lib/academicLibrary/downloadReference", () => ({ downloadCourseQuestions: mocks.download,
  isAcademicCourseDownloaded: (course: AcademicCourse) => mocks.downloaded.has(course.id) }));
vi.mock("../../lib/academicLibrary/termCourses", () => ({ listTermCourses: mocks.list,
  termQuizNeedsCatalog: () => mocks.needsCatalog,
  termQuizSelection: () => ({ module: "Term 5", term: "Term 5", questionIds: mocks.questionIds, setIds: mocks.setIds }) }));
vi.mock("../../lib/course-engine/quizLaunch", () => ({ launchCourseQuiz: mocks.launch, MAX_COURSE_QUIZ_QUESTIONS: 2000 }));

function course(id: string): AcademicCourse {
  return { id, current_revision_id: `${id}-revision`, title: id, module: id, term: "Term 5", visibility: "shared", review_status: "approved", owned: false, ready_questions: 1, review_questions: 0 };
}
const courses = [course("GOER"), course("CPR"), course("RHPS")];
const onBusyChange = vi.fn();
function mount(disabled = false) {
  return render(<TermCourseActions term="Term 5" accountId="learner" courses={courses.slice(0, 1)} disabled={disabled} onBusyChange={onBusyChange} />);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.downloaded.clear(); mocks.questionIds = ["ready-question"]; mocks.setIds = ["ready-set"]; mocks.needsCatalog = false;
  mocks.list.mockResolvedValue(courses);
  mocks.download.mockImplementation(async (entry: AcademicCourse) => { mocks.downloaded.add(entry.id); });
  mocks.assertCurrent.mockImplementation(() => {}); mocks.launch.mockImplementation(() => {});
});
afterEach(cleanup);

describe("term course actions", () => {
  it("skips saved courses, lists each failure, continues and resumes on retry", async () => {
    mocks.downloaded.add("GOER");
    mocks.download.mockImplementation(async (entry: AcademicCourse) => {
      if (entry.id === "CPR") throw new Error("This course file is unavailable.");
      mocks.downloaded.add(entry.id);
    });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 1 downloaded, 1 already on this device, 1 failed.");
    expect(mocks.list).toHaveBeenCalledWith("Term 5", "learner", expect.objectContaining({ shouldStop: expect.any(Function) }));
    expect(mocks.download.mock.calls.map(args => args[0].id)).toEqual(["CPR", "RHPS"]);
    expect(screen.getByRole("alert").textContent).toContain("CPR: This course file is unavailable.");
    mocks.download.mockClear(); mocks.download.mockImplementation(async (entry: AcademicCourse) => { mocks.downloaded.add(entry.id); });
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 1 downloaded, 2 already on this device.");
    expect(mocks.download.mock.calls.map(args => args[0].id)).toEqual(["CPR"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("finishes the current course on Stop, starts no later course, and resumes", async () => {
    const active = deferred();
    mocks.download.mockImplementation(async (entry: AcademicCourse) => { await active.promise; mocks.downloaded.add(entry.id); });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    expect(mocks.download).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Stopping…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => active.resolve());
    await screen.findByText("Download stopped. 1 downloaded, 0 already on this device.");
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 2 downloaded, 1 already on this device.");
    expect(mocks.download.mock.calls.map(args => args[0].id)).toEqual(["GOER", "CPR", "RHPS"]);
  });
  it("stops while reading pages without installing a partial catalog", async () => {
    const reading = deferred();
    mocks.list.mockImplementation(async (_term, _account, options: { shouldStop: () => boolean }) => {
      await reading.promise;
      if (options.shouldStop()) throw new DOMException("Stopped", "AbortError");
      return courses;
    });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => reading.resolve());
    await screen.findByText("Download stopped. Download this term again to continue.");
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("shows catalog failures and allows retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("The collection is offline."));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("The collection is offline.");
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
  });
  it("ends the run on account change instead of attempting remaining courses", async () => {
    mocks.download.mockImplementationOnce(async () => { mocks.assertCurrent.mockImplementation(() => { throw new Error("The account changed."); }); });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("The account changed.");
    expect(mocks.download).toHaveBeenCalledTimes(1); expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("stops between courses when the term leaves the screen", async () => {
    const active = deferred(); mocks.download.mockReturnValue(active.promise);
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    view.unmount(); await act(async () => active.resolve());
    expect(mocks.download).toHaveBeenCalledTimes(1); expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("uses the exact quiz handoff and displays its active-quiz error", () => {
    mocks.launch.mockImplementation(() => { throw new Error("Finish your current quiz first."); });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).toHaveBeenCalledWith({ module: "Term 5", term: "Term 5", questionIds: ["ready-question"], setIds: ["ready-set"] });
    expect(screen.getByRole("alert").textContent).toBe("Finish your current quiz first.");
  });
  it.each([0, 2001])("disables practice for %s ready questions", count => {
    mocks.questionIds = Array.from({ length: count }, (_, index) => `question-${index}`);
    mount(); expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(true);
    if (count) expect(screen.getByText(/supports up to 2000 questions/)).toBeTruthy();
  });
  it("prevents another term starting while a download is running", () => {
    mount(true); fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("waits for all catalog pages to resolve older receipts and allows a failed lookup to retry", async () => {
    mocks.needsCatalog = true; mocks.list.mockRejectedValueOnce(new Error("Saved course details are offline."));
    mount();
    expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(true);
    await screen.findByText("Saved course details are offline.");
    fireEvent.click(screen.getByRole("button", { name: "Retry term practice" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(false);
  });
});
