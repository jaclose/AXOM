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
function confirmSourceOnly(file = "reviewed-bank.zip", term = "Term 5", module = "GOER", ordinal = 1) {
  const label = `Package ${ordinal}: ${file}`;
  fireEvent.change(screen.getByRole("combobox", { name: `Verified term for ${label}` }), { target: { value: term } });
  fireEvent.change(screen.getByRole("textbox", { name: `Verified module for ${label}` }), { target: { value: module } });
  fireEvent.click(screen.getByRole("checkbox", { name: `I verified original source for ${label}` }));
}
function confirmStorageConsent() {
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed these packages and confirm I have permission/ }));
}
const verified = (key: string, originalFileStatus: "cloud-verified" | "local-only" | "not-provided" = "cloud-verified") => ({
  key, state: "verified" as const, receipt: {
    collectionId: "owned-a", revisionId: "revision-1", readyQuestions: 3,
    reviewQuestions: 2, sourceReceipts: [{
      sha256: "a".repeat(64), questionCount: 3, reviewCount: 2,
      figureReferences: 1, distinctFigureFiles: 1, figureReadbackVerified: true as const,
      originalFileStatus, originalReadbackVerified: originalFileStatus === "cloud-verified",
      readyQuestionIds: ["question-1"],
      bankReadbackVerified: true, ownerAuthenticated: true as const,
    }], verifiedFiles: 3, localOnlyOriginals: [],
  },
});
const report = (key: string, originalFileStatus: "cloud-verified" | "local-only" | "not-provided" = "cloud-verified") => ({
  expected: 1, processed: 1, verified: 1, superseded: 0, duplicateInputs: 0,
  failed: 0, cancelled: 0, authBlocked: 0, pending: 0,
  inserted: null, alreadyPresentOnServer: null, serverConfirmed: 1,
  reviewRequired: 2, verifiedReadyQuestions: 3, verifiedFigures: 1,
  cloudVerifiedOriginals: originalFileStatus === "cloud-verified" ? 1 : 0,
  localOnlyOriginals: originalFileStatus === "local-only" ? 1 : 0,
  originalsNotProvided: originalFileStatus === "not-provided" ? 1 : 0,
  outcomes: [verified(key, originalFileStatus)],
});
beforeEach(() => {
  account.user = { id: "owner-a" };
  vi.resetAllMocks();
  vi.mocked(zipLibraryReader).mockResolvedValue(fakeReader);
  vi.mocked(readCatalog).mockReturnValue({
    format: "axom-private-library", schemaVersion: 1, id: "owned-academic-bank", version: "v1",
    templates: [], sources: [{
      id: "source-a", name: "Synthetic source", sourcePath: "source", module: "GOER",
      checksum: "a".repeat(64), status: "review-required", reason: "synthetic review",
      ready: 3, review: 2, bankFile: "bank.json",
    }],
  });
  vi.mocked(prepareAcademicUpload).mockResolvedValue({ catalogId: "synthetic" } as never);
  vi.mocked(academicReconciliationLedger).mockReturnValue({ sources: [{
    sha256: "a".repeat(64), questionCount: 3, reviewCount: 2,
    bankReadbackVerified: true, ownerAuthenticated: true,
    figureReferences: 1, figureReadbackVerified: true,
    originalFileStatus: "cloud-verified", originalReadbackVerified: true,
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
    expect((screen.getByRole("checkbox", { name: /I reviewed these packages and confirm I have permission/ }) as HTMLInputElement).disabled).toBe(true);
    confirmSourceOnly();
    expect(action.disabled).toBe(true); // private-storage consent is a separate explicit action
    confirmStorageConsent();
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      expect(jobs).toHaveLength(1);
      expect(jobs[0].key).toContain("reviewed-bank.zip");
      expect(prepareAcademicUpload).not.toHaveBeenCalled();
      expect(await jobs[0].prepare(options?.signal)).toMatchObject({ catalogId: "synthetic" });
      expect(prepareAcademicUpload).toHaveBeenCalledWith(fakeReader, {
        term: "Term 5", module: "GOER", evidence: "human-reviewed",
      });
      expect(vi.mocked(prepareAcademicUpload).mock.calls[0][1]).not.toHaveProperty("week");
      await options?.onOutcome?.(verified(jobs[0].key));
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(uploadAcademicBatch).toHaveBeenCalledOnce());
    expect(await screen.findByText(/1 collections independently re-read in your private cloud account/)).toBeTruthy();
    expect(screen.getByText(/1 owner-authenticated revisions verified/)).toBeTruthy();
    expect(screen.getByText(/Authenticated bank and figure bytes re-read/)).toBeTruthy();
    expect(screen.getByText(/Original sources: 1 cloud-re-read · 0 local-only · 0 not provided/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export academic readback evidence" })).toBeTruthy();
  });

  it("does not describe a local-only original as cloud-re-read", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    confirmSourceOnly();
    confirmStorageConsent();
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      await options?.onOutcome?.(verified(jobs[0].key, "local-only"));
      return report(jobs[0].key, "local-only");
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 privately and verify" }));
    expect(await screen.findByText(/Original sources: 0 cloud-re-read · 1 local-only · 0 not provided/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("originals: 0 cloud-re-read, 1 local-only, 0 not provided");
  });

  it("does not claim successful cloud readback when a batch reports auth-blocked", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    confirmSourceOnly();
    confirmStorageConsent();
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
    const action = screen.getByRole("button", { name: "Export academic readback evidence" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText(/Account authorization changed; sign in again/)).toBeTruthy();
  });

  it("invalidates staged packages when the owner account changes", async () => {
    const { container, rerender } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    confirmSourceOnly();
    confirmStorageConsent();
    expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(false);
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
    confirmSourceOnly();
    confirmStorageConsent();
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
    expect((screen.getByRole("button", { name: "Export academic readback evidence" }) as HTMLButtonElement).disabled).toBe(true);
  });


  it("allows one stale module hint to be corrected only after original-source confirmation", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    expect(screen.getByText(/Package-declared module hints \(not proof\): GOER/)).toBeTruthy();
    const term = screen.getByRole("combobox", { name: "Verified term for Package 1: reviewed-bank.zip" }) as HTMLSelectElement;
    const module = screen.getByRole("textbox", { name: "Verified module for Package 1: reviewed-bank.zip" }) as HTMLInputElement;
    const verifiedSource = screen.getByRole("checkbox", { name: "I verified original source for Package 1: reviewed-bank.zip" }) as HTMLInputElement;
    const consent = screen.getByRole("checkbox", { name: /I reviewed these packages and confirm I have permission/ }) as HTMLInputElement;
    const action = screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement;
    expect(term.value).toBe("");
    expect(module.value).toBe("");
    expect(verifiedSource.checked).toBe(false);
    expect(consent.disabled).toBe(true);
    expect(action.disabled).toBe(true);
    fireEvent.change(term, { target: { value: "Term 5" } });
    fireEvent.change(module, { target: { value: "FTCM" } });
    expect(container.textContent).toMatch(/Reviewed module differs from the package hint/);
    expect(container.textContent).toMatch(/original hint remains evidence/);
    expect(container.textContent).toMatch(/reviewed filing controls placement/);
    expect(consent.disabled).toBe(true);
    expect(action.disabled).toBe(true);
    fireEvent.click(verifiedSource);
    expect(action.disabled).toBe(true);
    expect(consent.disabled).toBe(false);
    confirmStorageConsent();
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs) => {
      await jobs[0].prepare();
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledWith(fakeReader, {
      term: "Term 5", module: "FTCM", evidence: "human-reviewed",
    }));
    fireEvent.change(term, { target: { value: "Term 4" } });
    expect(verifiedSource.checked).toBe(false);
    expect(consent.disabled).toBe(true);
    expect(consent.checked).toBe(false);
    expect(action.disabled).toBe(true);
    expect(container.textContent).toMatch(/current SGU catalog lists PCM 500\/PCM 501/);
    expect(uploadAcademicBatch).toHaveBeenCalledOnce();
  });

  it("holds contradictory module declarations within one source-only ZIP instead of picking the first", async () => {
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "conflicting-private-bank", version: "v1",
      templates: [], sources: [
        { id: "a", name: "Synthetic A", module: "GOER", sourcePath: "synthetic-a",
          checksum: "a".repeat(64), status: "review-required", reason: "Synthetic",
          ready: 0, review: 1, bankFile: "banks/a/bank.json" },
        { id: "b", name: "Synthetic B", module: "NCRS", sourcePath: "synthetic-b",
          checksum: "b".repeat(64), status: "review-required", reason: "Synthetic",
          ready: 0, review: 1, bankFile: "banks/b/bank.json" },
      ],
    });
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    expect(container.textContent).toMatch(/Conflicting source modules require correcting or splitting/);
    confirmSourceOnly();
    const consent = screen.getByRole("checkbox", { name: /I reviewed these packages and confirm I have permission/ }) as HTMLInputElement;
    expect(consent.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
  });


  it("keeps a template-backed ZIP on the established reviewed plan without attaching an unscheduled override", async () => {
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "template-backed", version: "v1",
      templates: [{ name: "Source supported plan", file: "templates/term-plan.txt", checksum: "c".repeat(64) }],
      sources: [{ id: "s", name: "Synthetic source", sourcePath: "source", module: "GOER",
        checksum: "a".repeat(64), status: "review-required", reason: "Synthetic",
        ready: 3, review: 2, bankFile: "banks/s/bank.json" }],
    });
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container, ["template-course.zip"]);
    await screen.findByText(/1 prepared packages staged on this device/);
    expect(screen.queryByRole("combobox", { name: /Verified term for/ })).toBeNull();
    expect(container.textContent).toMatch(/Includes a course template/);
    const action = screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    confirmStorageConsent();
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs) => {
      expect(jobs).toHaveLength(1);
      await jobs[0].prepare();
      expect(prepareAcademicUpload).toHaveBeenCalledWith(fakeReader, undefined);
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledOnce());
  });

  it("requires individual Term/Module source confirmations for each ZIP in a mixed private batch", async () => {
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "multi-review", version: "v1",
      templates: [], sources: [{ id: "source-a", name: "Synthetic source", sourcePath: "source",
        checksum: "a".repeat(64), status: "review-required", reason: "Synthetic",
        ready: 3, review: 2, bankFile: "bank.json" }],
    });
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container, ["source-4.zip", "source-5.zip"]);
    await screen.findByText(/2 prepared packages staged on this device/);
    expect(screen.getByRole("combobox", { name: "Verified term for Package 1: source-4.zip" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Verified term for Package 2: source-5.zip" })).toBeTruthy();
    confirmSourceOnly("source-4.zip", "Term 4", "FTCM");
    const action = screen.getByRole("button", { name: "Upload 2 privately and verify" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true); // Second source has not been reviewed.
    confirmSourceOnly("source-5.zip", "Term 5", "GOER", 2);
    confirmStorageConsent();
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs) => {
      expect(jobs).toHaveLength(2);
      await jobs[0].prepare();
      await jobs[1].prepare();
      expect(vi.mocked(prepareAcademicUpload).mock.calls.map(([, scope]) => scope)).toEqual([
        { term: "Term 4", module: "FTCM", evidence: "human-reviewed" },
        { term: "Term 5", module: "GOER", evidence: "human-reviewed" },
      ]);
      for (const [, scope] of vi.mocked(prepareAcademicUpload).mock.calls) {
        expect(scope).not.toHaveProperty("week");
        expect(scope).not.toHaveProperty("weekSource");
      }
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledTimes(2));
    expect(container.textContent).toContain("week unassigned");
  });


  it("holds a GOER bank whose ZIP also includes an NCRS original-only source", async () => {
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "cross-source-file", version: "v1",
      templates: [], sources: [
        { id: "goer-bank", name: "GOER bank", sourcePath: "private/goer",
          module: "GOER", checksum: "a".repeat(64), status: "review-required",
          reason: "synthetic", ready: 3, review: 2, bankFile: "banks/goer/bank.json" },
        { id: "ncrs-original", name: "NCRS original", sourcePath: "private/ncrs",
          module: "NCRS", checksum: "b".repeat(64), status: "reference/template-only",
          reason: "synthetic", ready: 0, review: 0, originalFile: "sources/ncrs.pdf" },
      ],
    });
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    expect(container.textContent).toContain("GOER, NCRS");
    expect(container.textContent).toMatch(/Conflicting source modules require correcting or splitting/);
    confirmSourceOnly();
    const consent = screen.getByRole("checkbox", {
      name: /I reviewed these packages and confirm I have permission/,
    }) as HTMLInputElement;
    expect(consent.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(true);
    expect(prepareAcademicUpload).not.toHaveBeenCalled();
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
  });


  it.each(["GOER/NCRS", "GOER&NCRS", "GOER+NCRS", "GOER | NCRS", "GOER, NCRS", "GOER and NCRS", "GOER-NCRS", "MI-GOER"])(
    "rejects combined source module %s even when a reviewer erases its separators",
    async (declaredModule) => {
      vi.mocked(readCatalog).mockReturnValue({
        format: "axom-private-library", schemaVersion: 1, id: "combined-source", version: "v1",
        templates: [], sources: [{ id: "combined", name: "Synthetic source",
          sourcePath: "synthetic", module: declaredModule, checksum: "a".repeat(64),
          status: "review-required", reason: "synthetic", ready: 3, review: 2, bankFile: "bank.json" }],
      });
      const { container } = render(<PrivateAcademicBatchUpload />);
      fireEvent.click(screen.getByText("Private academic cloud batch"));
      selectZip(container);
      await screen.findByText(/1 prepared packages staged on this device/);
      confirmSourceOnly("reviewed-bank.zip", "Term 5", declaredModule === "MI-GOER" ? "MIGOER" : "GOERNCRS");
      expect(container.textContent).toMatch(/Conflicting source modules require correcting or splitting/);
      const consent = screen.getByRole("checkbox", {
        name: /I reviewed these packages and confirm I have permission/,
      }) as HTMLInputElement;
      expect(consent.disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(true);
      expect(uploadAcademicBatch).not.toHaveBeenCalled();
      expect(prepareAcademicUpload).not.toHaveBeenCalled();
    },
  );

  it("allows benign single-module case, spacing and hyphen differences only after explicit review", async () => {
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "benign-module", version: "v1",
      templates: [], sources: [{ id: "benign", name: "Synthetic source", sourcePath: "source",
        module: "  Go - Er  ", checksum: "a".repeat(64), status: "review-required",
        reason: "synthetic", ready: 3, review: 2, bankFile: "bank.json" }],
    });
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    confirmSourceOnly("reviewed-bank.zip", "Term 5", " GOER ");
    confirmStorageConsent();
    expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(false);
    expect(uploadAcademicBatch).not.toHaveBeenCalled();
  });


  it("revokes stale success, outcomes and receipt export after source scope changes", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container);
    await screen.findByText(/1 prepared packages staged on this device/);
    confirmSourceOnly();
    confirmStorageConsent();
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs, options) => {
      await options?.onOutcome?.(verified(jobs[0].key));
      return report(jobs[0].key);
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 privately and verify" }));
    expect(await screen.findByText(/1 collections independently re-read in your private cloud account/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export academic readback evidence" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Private source upload outcomes" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/locally assessed practice-ready questions with authenticated bytes re-read/);

    const reviewTerm = screen.getByRole("combobox", { name: "Verified term for Package 1: reviewed-bank.zip" });
    fireEvent.change(reviewTerm, { target: { value: "Term 4" } });
    expect(screen.queryByRole("button", { name: "Export academic readback evidence" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Private source upload outcomes" })).toBeNull();
    expect(screen.queryByText(/1 owner-authenticated revisions verified/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByRole("checkbox", {
      name: /I reviewed these packages and confirm I have permission/,
    }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Upload 1 privately and verify" }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploadAcademicBatch).toHaveBeenCalledTimes(1);
  });


  it("gives repeated filenames distinct ordinal labels, source scopes, and job keys", async () => {
    const { container } = render(<PrivateAcademicBatchUpload />);
    fireEvent.click(screen.getByText("Private academic cloud batch"));
    selectZip(container, ["duplicate.zip", "duplicate.zip"]);
    await screen.findByText(/2 prepared packages staged on this device/);
    expect(screen.getByRole("group", {
      name: "Source-supported classification for Package 1: duplicate.zip",
    })).toBeTruthy();
    expect(screen.getByRole("group", {
      name: "Source-supported classification for Package 2: duplicate.zip",
    })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Verified term for Package 1: duplicate.zip" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Verified term for Package 2: duplicate.zip" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Verified module for Package 1: duplicate.zip" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Verified module for Package 2: duplicate.zip" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "I verified original source for Package 1: duplicate.zip" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "I verified original source for Package 2: duplicate.zip" })).toBeTruthy();

    confirmSourceOnly("duplicate.zip", "Term 5", "GOER", 1);
    const consent = screen.getByRole("checkbox", {
      name: /I reviewed these packages and confirm I have permission/,
    }) as HTMLInputElement;
    expect(consent.disabled).toBe(true);
    confirmSourceOnly("duplicate.zip", "Term 5", "GOER", 2);
    confirmStorageConsent();
    const action = screen.getByRole("button", { name: "Upload 2 privately and verify" }) as HTMLButtonElement;
    expect(action.disabled).toBe(false);
    vi.mocked(uploadAcademicBatch).mockImplementation(async (jobs) => {
      expect(jobs).toHaveLength(2);
      expect(jobs[0].key).not.toBe(jobs[1].key);
      await jobs[0].prepare();
      await jobs[1].prepare();
      expect(vi.mocked(prepareAcademicUpload).mock.calls.map(([, scope]) => scope)).toEqual([
        { term: "Term 5", module: "GOER", evidence: "human-reviewed" },
        { term: "Term 5", module: "GOER", evidence: "human-reviewed" },
      ]);
      return report(jobs[0].key);
    });
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledTimes(2));
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
