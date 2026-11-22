// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicSourcePdf } from "../../lib/academicLibrary/sourcePdfs";
import { CourseSourcePdfs } from "./CourseSourcePdfs";

const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), account: { user: { id: "learner" } as { id: string } | undefined },
  listeners: new Set<(state: { user: { id: string } | undefined }) => void>(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({ useAccount: Object.assign(
  (select: (state: typeof mocks.account) => unknown) => select(mocks.account),
  { getState: () => mocks.account, subscribe: (listener: (state: typeof mocks.account) => void) => {
    mocks.listeners.add(listener); return () => mocks.listeners.delete(listener);
  } },
) }));
vi.mock("../../lib/academicLibrary/sourcePdfs", () => ({ listAcademicSourcePdfs: mocks.list, downloadAcademicSourcePdf: mocks.download }));
const pdf: AcademicSourcePdf = { id: "source", name: "Synthetic lecture.pdf", available: true, fileName: "Synthetic lecture.pdf", byteSize: 4096,
  asset: { revisionId: "revision", path: "originals/source.pdf", sha256: "a".repeat(64) } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function account(id?: string) {
  mocks.account.user = id ? { id } : undefined;
  for (const listener of mocks.listeners) listener(mocks.account);
}
const showPdfs = () => fireEvent.click(screen.getByRole("button", { name: "Show original PDFs" }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.account.user = { id: "learner" };
  mocks.list.mockResolvedValue([pdf, { id: "missing", name: "Missing.pdf", available: false }]);
  mocks.download.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  mocks.create.mockReturnValue("blob:synthetic-pdf");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revoke });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); expect(mocks.listeners.size).toBe(0); });

describe("course original PDFs", () => {
  it("does not read the catalog on preview, then lists originals only after an explicit request", async () => {
    render(<CourseSourcePdfs revisionId="revision" />);
    expect(screen.getByRole("button", { name: "Show original PDFs" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
    showPdfs();
    expect(await screen.findByRole("button", { name: "Download PDF: Synthetic lecture.pdf" })).toBeTruthy();
    expect(screen.getByText("PDF · 4 KB")).toBeTruthy(); expect(screen.getByText("Original PDF unavailable in this revision")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith("revision", expect.objectContaining({ key: "learner" }));
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("starts a named download only after verified bytes arrive, then revokes the temporary URL", async () => {
    const pending = deferred<Blob>(); mocks.download.mockReturnValue(pending.promise);
    const links: Array<{ href: string; name: string }> = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { links.push({ href: this.href, name: this.download }); });
    render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    const button = await screen.findByRole("button", { name: "Download PDF: Synthetic lecture.pdf" });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.download).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
    vi.useFakeTimers();
    await act(async () => { pending.resolve(new Blob(["%PDF"], { type: "application/pdf" })); });
    expect(links).toEqual([{ href: "blob:synthetic-pdf", name: "Synthetic lecture.pdf" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Download started");
    act(() => vi.advanceTimersByTime(30000)); expect(mocks.revoke).toHaveBeenCalledWith("blob:synthetic-pdf");
  });
  it("reports integrity failure without making a URL or claiming a download", async () => {
    mocks.download.mockRejectedValue(new Error("The course source failed its download integrity check."));
    render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF: Synthetic lecture.pdf" }));
    expect((await screen.findByRole("alert")).textContent).toContain("integrity check");
    expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByText(/Download started/)).toBeNull();
  });
  it("retries a failed index without downloading source files", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Index unavailable")).mockResolvedValueOnce([]);
    render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    fireEvent.click(await screen.findByRole("button", { name: "Retry PDFs" }));
    expect(await screen.findByText("No original PDFs are available in this course revision.")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("discards a pending file even after an account switches away and back", async () => {
    const pending = deferred<Blob>(); mocks.download.mockReturnValue(pending.promise);
    render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF: Synthetic lecture.pdf" }));
    account("another"); account("learner");
    await act(async () => { pending.resolve(new Blob(["%PDF"])); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByText(/Download started/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("account changed");
  });
  it.each(["revision", "unmount"])("discards a pending download after %s changes", async mode => {
    const pending = deferred<Blob>(); mocks.download.mockReturnValue(pending.promise);
    const view = render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF: Synthetic lecture.pdf" }));
    if (mode === "revision") {
      view.rerender(<CourseSourcePdfs revisionId="new-revision" />);
      expect(screen.getByRole("button", { name: "Show original PDFs" })).toBeTruthy();
      expect(mocks.list).toHaveBeenCalledOnce();
    }
    else view.unmount();
    await act(async () => { pending.resolve(new Blob(["%PDF"])); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByText(/Download started/)).toBeNull();
  });
  it("does not replace the current revision list with an older response", async () => {
    const pending = deferred<AcademicSourcePdf[]>(); mocks.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const view = render(<CourseSourcePdfs revisionId="old" />);
    showPdfs();
    view.rerender(<CourseSourcePdfs revisionId="new" />);
    expect(screen.getByRole("button", { name: "Show original PDFs" })).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledOnce();
    showPdfs();
    expect(await screen.findByText("No original PDFs are available in this course revision.")).toBeTruthy();
    await act(async () => { pending.resolve([pdf]); });
    expect(screen.queryByRole("button", { name: /Download PDF/ })).toBeNull();
  });
  it("discards an old account's pending list and requires a fresh request in the new account", async () => {
    const pending = deferred<AcademicSourcePdf[]>(); mocks.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const view = render(<CourseSourcePdfs revisionId="revision" />);
    showPdfs();
    account("another"); view.rerender(<CourseSourcePdfs revisionId="revision" />);
    expect(screen.getByRole("button", { name: "Show original PDFs" })).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve([pdf]); });
    expect(screen.queryByRole("button", { name: /Download PDF/ })).toBeNull();
    showPdfs();
    expect(await screen.findByText("No original PDFs are available in this course revision.")).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith("revision", expect.objectContaining({ key: "another" }));
  });
  it("does not read catalogs when navigating through previews without requesting PDFs", () => {
    const view = render(<CourseSourcePdfs revisionId="first" />);
    view.rerender(<CourseSourcePdfs revisionId="second" />);
    view.rerender(<CourseSourcePdfs revisionId="first" />);
    expect(screen.getByRole("button", { name: "Show original PDFs" })).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not read an account's file index while signed out", () => {
    account(); const view = render(<CourseSourcePdfs revisionId="revision" />);
    expect(view.container.textContent).toBe(""); expect(mocks.list).not.toHaveBeenCalled();
  });
});
