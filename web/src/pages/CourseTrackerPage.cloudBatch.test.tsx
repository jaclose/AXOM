// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrivateAcademicBatchUpload } from "./CourseTrackerPage.cloudBatch";
import { uploadAcademicBatch, academicReconciliationLedger } from "../lib/academicLibrary/batch";
import { zipLibraryReader, readCatalog } from "../lib/privateLibrary/install";
import { prepareAcademicUpload } from "../lib/academicLibrary/upload";

const account = { user: { id: "owner-a" } as { id: string } | null };
vi.mock("../lib/account/accountStore", () => ({
  useAccount: Object.assign((select: (value: typeof account) => unknown) => select(account), {
    getState: () => account,
  }),
}));
vi.mock("../lib/academicLibrary/batch", () => ({
  uploadAcademicBatch: vi.fn(),
  academicReconciliationLedger: vi.fn(),
}));
vi.mock("../lib/academicLibrary/upload", () => ({
  prepareAcademicUpload: vi.fn(),
}));
vi.mock("../lib/privateLibrary/install", () => ({
  zipLibraryReader: vi.fn(),
  readCatalog: vi.fn(),
}));

const fakeReader = async () => new TextEncoder().encode("{}");
function selectZip(container: HTMLElement, names: string[] = ["reviewed-bank.zip"]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = names.map((name) => new File(["prepared-package"], name, { type: "application/zip" }));
  fireEvent.change(input, { target: { files } });
}
const verified = (key: string) => ({
  key, state: "verified" as const, receipt: {
    collectionId: "owned-a", revisionId: "revision-1", readyQuestions: 3,
    reviewQuestions: 2, sourceReceipts: [{
      sha256: "a".repeat(64), questionCount: 3, reviewCount: 2,
      figureReferences: 1, distinctFigureFiles: 1, figureReadbackVerified: true as const,
      originalFileStatus: "cloud-verified" as const, readyQuestionIds: ["question-1"],
      readbackVerified: true as const, ownerAuthenticated: true as const,
    }], verifiedFiles: 3, localOnlyOriginals: [],
  },
});
const report = (key: string) => ({
  expected: 1, processed: 1, verified: 1, superseded: 0, duplicateInputs: 0,
  failed: 0, cancelled: 0, authBlocked: 0, pending: 0,
  inserted: null, alreadyPresentOnServer: null, serverConfirmed: 1,
  reviewRequired: 2, verifiedReadyQuestions: 3, verifiedFigures: 1,
  outcomes: [verified(key)],
});
beforeEach(() => {
  account.user = { id: "owner-a" };
  vi.resetAllMocks();
  vi.mocked(zipLibraryReader).mockResolvedValue(fakeReader);
  vi.mocked(readCatalog).mockReturnValue({
    format: "axom-private-library", schemaVersion: 1, id: "owned-academic-bank", version: "v1",
    templates: [], sources: [{
      id: "source-a", name: "Synthetic source", sourcePath: "source",
      checksum: "a".repeat(64), status: "review-required", reason: "synthetic review",
      ready: 3, review: 2, bankFile: "bank.json",
    }],
  });
  vi.mocked(prepareAcademicUpload).mockResolvedValue({ catalogId: "synthetic" } as never);
  vi.mocked(academicReconciliationLedger).mockReturnValue({ sources: [{
    sha256: "a".repeat(64), questionCount: 3,
    readbackVerified: true, ownerAuthenticated: true,
    figureReferences: 1, figureReadbackVerified: true,
  }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("owner-private reviewed academic ZIP batch", () => {
  it("lets signed-out students inspect manifests without uploading", async () => {
    account.user = null;
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    expect(screen.getByText(/You are not signed in/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose prepared ZIP packages" })).toBeTruthy();
    selectZip(container);
    expect(await screen.findByText(/1 prepared packages staged on this device/)).toBeTruthy();
    expect(container.textContent).toContain("3 declared ready");
    expect(container.textContent).toContain("2 declared review");
    expect(screen.queryByRole("button", { name: "Upload 1 privately and verify" })).toBeNull();
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
  });

  it("reads private manifests only and requires explicit permission confirmation before upload", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    expect(await screen.findByText(/1 prepared packages staged on this device/)).toBeTruthy();
    expect(screen.getByText(/1 declared sources/)).toBeTruthy();
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
    const action = screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      expect(jobs).toHaveLength(1);
      expect(jobs[0].key).toContain("reviewed-bank.zip");
      expect(prepareAcademicUpload).not.toHaveBeenCalled();
      expect(await jobs[0].prepare(options?.signal)).toMatchObject({ catalogId: "synthetic" });
      await options?.onOutcome?.(verified(jobs[0].key));
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(uploadAcademicBatch).toHaveBeenCalledOnce());
    expect(await screen.findByText(/1 collections independently re-read in your private cloud account/)).toBeTruthy();
    expect(screen.getByText(/1 owner-authenticated revisions verified/)).toBeTruthy();
    expect(screen.getByText(/Verified by owner-authenticated source\/figure readback/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export verified private source receipts" })).toBeTruthy();
  });

  it("does not claim successful cloud readback when a batch reports auth-blocked", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    fireEvent.click(screen.getByRole("checkbox"));
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      await options?.onOutcome?.({ key: jobs[0].key, state: "auth-blocked", message: "Session changed" });
      return {
        ...report(jobs[0].key), verified: 0, serverConfirmed: 0,
        verifiedReadyQuestions: 0, verifiedFigures: 0, reviewRequired: 0, authBlocked: 1,
        outcomes: [{ key: jobs[0].key, state: "auth-blocked", message: "Session changed" }],
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 privately and verify" }));
    expect(await screen.findByText(/0 collections independently re-read in your private cloud account/)).toBeTruthy();
    const action = screen.getByRole("button", { name: "Export verified private source receipts" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText(/Account authorization changed; sign in again/)).toBeTruthy();
  });

  it("invalidates staged packages when the owner account changes", async () => {
    const { container, rerender } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    account.user = { id: "owner-b" };
    rerender(<PrivateAcademicBatchUpload />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Upload 1 privately and verify" })).toBeNull());
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
  });


  it("can cancel a pending private batch without awarding any verified-cloud receipt", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    fireEvent.click(screen.getByRole("checkbox"));
    let signal: AbortSignal | undefined;
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      signal = options?.signal;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      await options?.onOutcome?.({ key: jobs[0].key, state: "cancelled" });
      return {
        ...report(jobs[0].key), verified: 0, serverConfirmed: 0,
        verifiedReadyQuestions: 0, verifiedFigures: 0, reviewRequired: 0, cancelled: 1,
        outcomes: [{ key: jobs[0].key, state: "cancelled" }],
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 privately and verify" }));
    const stop = await screen.findByRole("button", { name: "Cancel pending uploads" });
    fireEvent.click(stop);
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(await screen.findByText(/0 collections independently re-read in your private cloud account/)).toBeTruthy();
    expect(screen.getByText(/Cancelled; pending inputs preserved locally/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export verified private source receipts" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects non-ZIP selections without preparing or uploading protected originals", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container, ["unreviewed.pdf"]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/must be an AXOM .zip file/);
    expect(zipLibraryReader).not.toHaveBeenCalled();
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
  });
});
