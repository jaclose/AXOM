// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { TermCourseActions } from "./TermCourseActions";

const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), launch: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn(),
  downloaded: new Set<string>(), questionIds: ["ready-question"], setIds: ["ready-set"], needsCatalog: false,
  activeAccount: "learner", accountListeners: new Set<(state: { user?: { id: string } }) => void>() }));
vi.mock("../../lib/store", () => ({ useStore: Object.assign(() => ({}), { getState: () => ({}) }) }));
vi.mock("../../lib/account/accountStore", () => ({ useAccount: {
  getState: () => ({ user: { id: mocks.activeAccount } }),
  subscribe: (listener: (state: { user?: { id: string } }) => void) => {
    mocks.accountListeners.add(listener);
    return () => { mocks.accountListeners.delete(listener); };
  },
} }));
vi.mock("../../lib/academicLibrary/accountScope", () => ({ academicAccountScope: (accountId: string) => {
  // Match the real scope contract: a switch away and back permanently invalidates
  // the same scope instance, even if the account ID matches again at click time.
  let switched = false;
  const onAccountChange = (state: { user?: { id: string } }) => {
    if (state.user?.id !== accountId) switched = true;
  };
  mocks.accountListeners.add(onAccountChange);
  return { assertCurrent: () => {
    if (switched || mocks.activeAccount !== accountId) {
      switched = true;
      throw new Error("The account changed.");
    }
    mocks.assertCurrent();
  }, dispose: () => {
    mocks.accountListeners.delete(onAccountChange);
    mocks.dispose();
  } };
} }));
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
function switchAccount(accountId: string) {
  mocks.activeAccount = accountId;
  for (const listener of [...mocks.accountListeners]) listener({ user: { id: accountId } });
}
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
  mocks.activeAccount = "learner"; mocks.accountListeners.clear();
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
    mocks.download.mockImplementationOnce(async () => { switchAccount("another-learner"); });
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

  it("retains the parent download lock through same-account preview unmount until the held course settles", async () => {
    const active = deferred();
    mocks.download.mockReturnValueOnce(active.promise);
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    const busyCalls = onBusyChange.mock.calls.length;
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onBusyChange).toHaveBeenCalledTimes(busyCalls);
    // A remounted preview's term action receives the still-owned parent lock.
    mount(true);
    expect(screen.getByRole("button", { name: "Download Term 5" }).hasAttribute("disabled")).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => active.resolve());
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("releases a preview-unmounted A lock on account switch without clearing B's in-flight download", async () => {
    const first = deferred();
    const second = deferred();
    mocks.download.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const actions = (accountId: string) => <TermCourseActions term="Term 5" accountId={accountId}
      courses={courses} disabled={false} onBusyChange={onBusyChange} />;
    switchAccount("account-a");
    const view = render(actions("account-a"));
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    view.unmount();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    switchAccount("account-b");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    render(actions("account-b"));
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    const callsDuringB = onBusyChange.mock.calls.length;
    await act(async () => first.resolve());
    expect(onBusyChange).toHaveBeenCalledTimes(callsDuringB);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => second.resolve());
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("uses the exact quiz handoff and displays its active-quiz error", () => {
    mocks.launch.mockImplementation(() => { throw new Error("Finish your current quiz first."); });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).toHaveBeenCalledWith({ module: "Term 5", term: "Term 5", questionIds: ["ready-question"], setIds: ["ready-set"] });
    expect(screen.getByRole("alert").textContent).toBe("Finish your current quiz first.");
  });
  it("blocks a stale Download after A→B→A before parent props commit, but permits a fresh mount", async () => {
    const view = mount();
    const staleButton = screen.getByRole("button", { name: "Download Term 5" });
    switchAccount("another-learner");
    switchAccount("learner");
    fireEvent.click(staleButton);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(onBusyChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("The account changed.");

    view.unmount();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale Practice click after the learner account changes before the parent rerenders", () => {
    mount();
    expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(false);
    // Simulate the account-store transition before React receives new parent props.
    // The stale button must not hand the previous learner's selection to QBank.
    switchAccount("another-learner");
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("The account changed.");
  });
  it("rejects a stale Practice click after A→B→A while the original term controls remain mounted", () => {
    mount();
    const oldButton = screen.getByRole("button", { name: "Practice Term 5" });
    expect(oldButton.hasAttribute("disabled")).toBe(false);
    // The store leaves A and returns to A before React receives new parent
    // props. A click-time-only scope falsely treats the old UI as fresh.
    switchAccount("another-learner");
    switchAccount("learner");
    fireEvent.click(oldButton);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("The account changed.");
  });
  it("allows current-account practice again after the stale term controls are remounted", () => {
    const view = mount();
    switchAccount("another-learner");
    switchAccount("learner");
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).not.toHaveBeenCalled();
    view.unmount();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).toHaveBeenCalledTimes(1);
  });
  it.each([0, 2001])("disables practice for %s ready questions", count => {
    mocks.questionIds = Array.from({ length: count }, (_, index) => `question-${index}`);
    mount(); expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(true);
    if (count) expect(screen.getByText(/supports up to 2000 questions/)).toBeTruthy();
  });
  it("never exposes the previous account's legacy catalog in the committed Practice button while another account loads", async () => {
    mocks.needsCatalog = true;
    let resolveNext!: (entries: AcademicCourse[]) => void;
    const nextCatalog = new Promise<AcademicCourse[]>(resolve => { resolveNext = resolve; });
    mocks.list.mockResolvedValueOnce(courses).mockReturnValueOnce(nextCatalog);
    const frames: Array<{ accountId: string; disabled: boolean; pending: boolean }> = [];
    const action = (accountId: string) => <Profiler id="legacy-account-switch" onRender={() => {
      const practice = screen.queryByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement | null;
      frames.push({ accountId, disabled: practice?.disabled ?? false,
        pending: !!screen.queryByText("Reading saved course details for term practice…") });
    }}>
      <TermCourseActions term="Term 5" accountId={accountId} courses={courses.slice(0, 1)}
        disabled={false} onBusyChange={onBusyChange} />
    </Profiler>;
    switchAccount("account-a");
    const view = render(action("account-a"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(false));
    const beforeSwitch = frames.length;
    switchAccount("account-b");
    view.rerender(action("account-b"));
    const switchFrames = frames.slice(beforeSwitch);
    expect(switchFrames.length).toBeGreaterThan(0);
    expect(switchFrames.every(frame => frame.accountId === "account-b" && frame.disabled && frame.pending)).toBe(true);
    expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.launch).not.toHaveBeenCalled();
    await act(async () => resolveNext(courses));
    await waitFor(() => expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("does not reuse the previous retry's catalog error while a new request starts", async () => {
    mocks.needsCatalog = true;
    mocks.list.mockRejectedValueOnce(new Error("First catalog attempt failed."));
    let resolveRetry!: (entries: AcademicCourse[]) => void;
    const retry = new Promise<AcademicCourse[]>(resolve => { resolveRetry = resolve; });
    mocks.list.mockReturnValueOnce(retry);
    const frames: Array<{ disabled: boolean; error: boolean; pending: boolean }> = [];
    render(<Profiler id="legacy-retry" onRender={() => {
      const practice = screen.queryByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement | null;
      frames.push({ disabled: practice?.disabled ?? false,
        error: !!screen.queryByText("First catalog attempt failed."),
        pending: !!screen.queryByText("Reading saved course details for term practice…") });
    }}>
      <TermCourseActions term="Term 5" accountId="learner" courses={courses.slice(0, 1)}
        disabled={false} onBusyChange={onBusyChange} />
    </Profiler>);
    await screen.findByText("First catalog attempt failed.");
    const beforeRetry = frames.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry term practice" }));
    const retryFrames = frames.slice(beforeRetry);
    expect(retryFrames.length).toBeGreaterThan(0);
    expect(retryFrames.every(frame => frame.disabled && !frame.error && frame.pending)).toBe(true);
    await act(async () => resolveRetry(courses));
    await waitFor(() => expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(false));
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
    expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Older downloads without a saved term are excluded");
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).toHaveBeenCalledWith({ module: "Term 5", term: "Term 5", questionIds: ["ready-question"], setIds: ["ready-set"] });
    fireEvent.click(screen.getByRole("button", { name: "Retry term practice" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Practice Term 5" }).hasAttribute("disabled")).toBe(false);
  });
  it("redacts the prior account's download diagnostics and quiz errors on the first account-switch commit", async () => {
    mocks.download.mockImplementation(async (entry: AcademicCourse) => {
      if (entry.id === "CPR") throw new Error("Account A private course diagnostic.");
      mocks.downloaded.add(entry.id);
    });
    mocks.launch.mockImplementation(() => { throw new Error("Account A private quiz diagnostic."); });
    const frames: Array<{ accountId: string; leaked: boolean }> = [];
    const actions = (accountId: string) => <Profiler id="term-switch-diagnostics" onRender={() => {
      frames.push({ accountId, leaked: !!document.body.textContent?.includes("Account A private")
        || !!document.body.textContent?.includes("Download complete.") });
    }}>
      <TermCourseActions term="Term 5" accountId={accountId} courses={courses}
        disabled={false} onBusyChange={onBusyChange} />
    </Profiler>;
    switchAccount("account-a");
    const view = render(actions("account-a"));
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText(/Account A private course diagnostic/);
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(screen.getByText("Account A private quiz diagnostic.")).toBeTruthy();
    const start = frames.length;
    switchAccount("account-b");
    view.rerender(actions("account-b"));
    const switched = frames.slice(start);
    expect(switched.length).toBeGreaterThan(0);
    expect(switched.every(frame => frame.accountId === "account-b" && !frame.leaked)).toBe(true);
    expect(screen.queryByText(/Account A private/)).toBeNull();
    expect(screen.queryByText(/Download complete/)).toBeNull();
  });
  it("prevents late A completion from clearing B's still-active download or progress", async () => {
    const first = deferred();
    const second = deferred();
    mocks.download.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const actions = (accountId: string) => <TermCourseActions term="Term 5" accountId={accountId}
      courses={courses} disabled={false} onBusyChange={onBusyChange} />;
    switchAccount("account-a");
    const view = render(actions("account-a"));
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    switchAccount("account-b");
    view.rerender(actions("account-b"));
    expect(screen.queryByText("Downloading 1 of 3: GOER")).toBeNull();
    expect(screen.getByRole("button", { name: "Download Term 5" }).hasAttribute("disabled")).toBe(false);
    mocks.download.mockImplementation(async (entry: AcademicCourse) => { mocks.downloaded.add(entry.id); });
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    const callsDuringB = onBusyChange.mock.calls.length;
    await act(async () => first.resolve());
    expect(onBusyChange).toHaveBeenCalledTimes(callsDuringB);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Downloading 1 of 3: GOER")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => second.resolve());
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(mocks.download.mock.calls.map(args => args[0].id)).toEqual(["GOER", "GOER", "CPR", "RHPS"]);
  });

  it("shows per-source progress without losing the term course ordinal", async () => {
    const active = deferred();
    let report: ((message: string) => void) | undefined;
    mocks.download.mockImplementationOnce(async (_entry: AcademicCourse, _account: string, progress: (message: string) => void) => {
      report = progress;
      progress("Preparing your library · 1 of 4 sources · checking original");
      await active.promise;
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER · Preparing your library · 1 of 4 sources · checking original");
    await act(async () => { report?.("Finalizing local library catalog…"); });
    expect(screen.getByText("Downloading 1 of 3: GOER · Finalizing local library catalog…")).toBeTruthy();
    await act(async () => active.resolve());
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
  });

  it("ignores late source progress from a switched account while the old download settles", async () => {
    const active = deferred();
    let report: ((message: string) => void) | undefined;
    mocks.download.mockImplementationOnce(async (_entry: AcademicCourse, _account: string, progress: (message: string) => void) => {
      report = progress;
      await active.promise;
    });
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Downloading 1 of 3: GOER");
    switchAccount("another-learner");
    await act(async () => { report?.("Private source label from old account"); });
    expect(screen.queryByText(/Private source label from old account/)).toBeNull();
    view.rerender(<TermCourseActions term="Term 5" accountId="another-learner"
      courses={courses} disabled={false} onBusyChange={onBusyChange} />);
    await act(async () => { report?.("Another late private source label"); });
    expect(screen.queryByText(/Another late private source label/)).toBeNull();
    await act(async () => active.resolve());
    expect(screen.queryByText(/private source label/i)).toBeNull();
  });

  it("does not let a settled source callback overwrite the final term summary", async () => {
    let report: ((message: string) => void) | undefined;
    mocks.download.mockImplementationOnce(async (_entry: AcademicCourse, _account: string, progress: (message: string) => void) => {
      report = progress;
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Download Term 5" }));
    await screen.findByText("Download complete. 3 downloaded, 0 already on this device.");
    await act(async () => { report?.("Old source callback after completion"); });
    expect(screen.queryByText(/Old source callback after completion/)).toBeNull();
    expect(screen.getByText("Download complete. 3 downloaded, 0 already on this device.")).toBeTruthy();
  });

});
