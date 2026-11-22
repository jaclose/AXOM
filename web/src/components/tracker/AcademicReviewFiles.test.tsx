// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { AcademicReviewFiles } from "./AcademicReviewFiles";

const mocks = vi.hoisted(() => ({ archive: vi.fn(), create: vi.fn(), revoke: vi.fn(),
  account: { user: { id: "reviewer" } as { id: string } | undefined },
  listeners: new Set<(state: { user: { id: string } | undefined }) => void>() }));
vi.mock("../../lib/account/accountStore", () => ({ useAccount: Object.assign(
  (select: (state: typeof mocks.account) => unknown) => select(mocks.account),
  { getState: () => mocks.account, subscribe: (listener: (state: typeof mocks.account) => void) => {
    mocks.listeners.add(listener); return () => mocks.listeners.delete(listener);
  } },
) }));
vi.mock("../../lib/academicLibrary/reviewExport", () => ({ createStoredReviewArchive: mocks.archive }));
const course = { id: "collection", current_revision_id: "revision", module: "Example", ready_questions: 1, review_questions: 0 } as AcademicCourse;
const archive = () => ({ blob: new Blob(["verified synthetic archive"]), fileName: "Review.zip", includedFiles: 2, omittedFiles: 1 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.account.user = { id: "reviewer" };
  mocks.archive.mockResolvedValue(archive()); mocks.create.mockReturnValue("blob:review-evidence");
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
