// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicReviewFiles } from "./AcademicReviewFiles";

const mocks = vi.hoisted(() => ({ archive: vi.fn(), source: vi.fn(), create: vi.fn(), revoke: vi.fn(),
  account: { user: { id: "reviewer" } as { id: string } | undefined },
  listeners: new Set<(state: { user: { id: string } | undefined }) => void>() }));
vi.mock("../../lib/account/accountStore", () => ({ useAccount: Object.assign(
  (select: (state: typeof mocks.account) => unknown) => select(mocks.account),
  { getState: () => mocks.account, subscribe: (listener: (state: typeof mocks.account) => void) => {
    mocks.listeners.add(listener); return () => mocks.listeners.delete(listener);
  } },
) }));
vi.mock("../../lib/academicLibrary/reviewExport", () => ({ createStoredReviewArchive: mocks.archive, createStoredSourceArchive: mocks.source }));
const course = { id: "collection", current_revision_id: "revision", module: "Example", ready_questions: 1, review_questions: 0 } as AcademicCourse;
const archive = () => ({ blob: new Blob(["verified synthetic archive"]), fileName: "Review.zip", includedFiles: 2, omittedFiles: 1 });
const sourceArchive = () => ({ ...archive(), fileName: "Source.zip", includedFiles: 6, omittedFiles: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.account.user = { id: "reviewer" };
  mocks.archive.mockResolvedValue(archive()); mocks.source.mockResolvedValue(sourceArchive()); mocks.create.mockReturnValue("blob:review-evidence");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revoke });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); expect(mocks.listeners.size).toBe(0); });

it("reads nothing until requested and starts a named download only after the verified archive arrives", async () => {
  const pending = deferred<ReturnType<typeof archive>>(); mocks.archive.mockReturnValue(pending.promise);
  const links: string[] = [];
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { links.push(this.download); });
  render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.source).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Export stored review files" }));
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => pending.resolve(archive()));
  expect(links).toEqual(["Review.zip"]);
  expect(screen.getByRole("status").textContent).toContain("Images and original PDFs remain separate");
  expect(document.querySelector("a[download]")).toBeNull();
});

it("discards a completed archive after an account switches away and back", async () => {
  const pending = deferred<ReturnType<typeof archive>>(); mocks.archive.mockReturnValue(pending.promise);
  render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Export stored review files" }));
  for (const id of ["other", "reviewer"]) {
    mocks.account.user = { id }; for (const listener of mocks.listeners) listener(mocks.account);
  }
  await act(async () => pending.resolve(archive()));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("account changed");
});

it.each(["revision", "unmount"]) ("discards a completed archive after the %s changes", async changed => {
  const pending = deferred<ReturnType<typeof archive>>(); mocks.archive.mockReturnValue(pending.promise);
  const view = render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Export stored review files" }));
  if (changed === "revision") view.rerender(<AcademicReviewFiles course={{ ...course, current_revision_id: "new" }} accountId="reviewer" />);
  else view.unmount();
  await act(async () => pending.resolve(archive()));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByText(/Download started/)).toBeNull();
});

it("starts the separate full-source download only on request and disables both export controls while preparing", async () => {
  const pending = deferred<ReturnType<typeof sourceArchive>>(); mocks.source.mockReturnValue(pending.promise);
  const links: string[] = [];
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { links.push(this.download); });
  render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  expect(mocks.source).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download full source package" }));
  const source = screen.getByRole("button", { name: "Preparing source package…" }) as HTMLButtonElement;
  const review = screen.getByRole("button", { name: "Export stored review files" }) as HTMLButtonElement;
  expect(source.disabled).toBe(true); expect(review.disabled).toBe(true);
  fireEvent.click(source); fireEvent.click(review);
  expect(mocks.source).toHaveBeenCalledTimes(1); expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  act(() => mocks.source.mock.calls[0][2]("Preparing source package · 3 of 6"));
  expect(screen.getByRole("status").textContent).toContain("3 of 6");
  await act(async () => pending.resolve(sourceArchive()));
  expect(links).toEqual(["Source.zip"]);
  expect(screen.getByRole("status").textContent).toContain("all 6 stored course files");
  expect(screen.getByRole("status").textContent).toContain("workspace is unchanged");
  expect((screen.getByRole("button", { name: "Download full source package" }) as HTMLButtonElement).disabled).toBe(false);
});

it("shows source-export failures without a download and allows a later explicit retry", async () => {
  mocks.source.mockRejectedValueOnce(new Error("A course file failed its integrity check."));
  render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download full source package" })));
  expect(screen.getByRole("alert").textContent).toContain("integrity check");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download full source package" })));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it.each(["account", "revision", "unmount"])("discards full-source bytes after %s scope changes", async changed => {
  const pending = deferred<ReturnType<typeof sourceArchive>>(); mocks.source.mockReturnValue(pending.promise);
  const view = render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Download full source package" }));
  if (changed === "account") {
    for (const id of ["other", "reviewer"]) {
      mocks.account.user = { id }; for (const listener of mocks.listeners) listener(mocks.account);
    }
  } else if (changed === "revision") {
    view.rerender(<AcademicReviewFiles course={{ ...course, current_revision_id: "new" }} accountId="reviewer" />);
  } else view.unmount();
  await act(async () => pending.resolve(sourceArchive()));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByText(/Download started/)).toBeNull();
});

it("retains the export lock across a revision change until old reads finish, then permits the new scope", async () => {
  const pending = deferred<ReturnType<typeof sourceArchive>>(); mocks.source.mockReturnValueOnce(pending.promise);
  const view = render(<AcademicReviewFiles course={course} accountId="reviewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Download full source package" }));
  view.rerender(<AcademicReviewFiles course={{ ...course, current_revision_id: "new" }} accountId="reviewer" />);
  expect((screen.getByRole("button", { name: "Preparing source package…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Export stored review files" }));
  expect(mocks.archive).not.toHaveBeenCalled();
  await act(async () => pending.resolve(sourceArchive()));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download full source package" })));
  expect(mocks.source).toHaveBeenCalledTimes(2);
  expect(mocks.source.mock.calls[1][0].current_revision_id).toBe("new");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
