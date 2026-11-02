// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicBatchJob, AcademicBatchOutcome } from "../../lib/academicLibrary/batch";
import type { AcademicUpload } from "../../lib/academicLibrary/upload";
import { bank, library } from "../../lib/academicLibrary/publicationFixture.testing";
import { MI_NMI_DECISION_FORMAT } from "../../lib/academicLibrary/miNmiCorrection";
import { sha256 } from "../../lib/question-content/assets";
import { AcademicLibraryPublisher } from "./AcademicLibraryPublisher";

const mocks = vi.hoisted(() => ({ share: vi.fn(), batch: vi.fn(), folder: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "owner-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "owner-1", assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  shareAcademicCourses: (...args: unknown[]) => mocks.share(...args),
}));
vi.mock("../../lib/academicLibrary/batch", () => ({ uploadAcademicBatch: (...args: unknown[]) => mocks.batch(...args) }));
vi.mock("../../lib/privateLibrary/install", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/privateLibrary/install")>()),
  folderLibraryReader: (...args: unknown[]) => mocks.folder(...args),
}));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
    <button type="button" {...props}>{children}</button>,
  GhostButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  Tag: ({ children }: { children: React.ReactNode }) => <span data-tag="">{children}</span>,
}));

/** Real course preparation; only the network side of the batch is simulated. */
function simulatedBatch(prepared: AcademicUpload[]) {
  return async (jobs: AcademicBatchJob[], options: { onOutcome?: (outcome: AcademicBatchOutcome) => void }) => {
    const outcomes: AcademicBatchOutcome[] = [];
    for (const job of jobs) {
      let outcome: AcademicBatchOutcome;
      try {
        const upload = await job.prepare();
        prepared.push(upload);
        outcome = { key: job.key, state: "verified", receipt: { collectionId: `collection-${job.key}`, revisionId: `revision-${job.key}`,
          contentHash: upload.hash, readyQuestions: Number(upload.metadata.ready_questions),
          explainedReadyQuestions: Number(upload.metadata.ready_questions), missingExplanations: 0,
          reviewQuestions: Number(upload.metadata.review_questions),
          sourceReceipts: [], verifiedFiles: upload.files.length, localOnlyOriginals: [] } };
      } catch {
        outcome = { key: job.key, state: "failed", category: "validation", message: "Private academic upload/readback was not completed." };
      }
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    }
    return { expected: jobs.length, verified: outcomes.filter(outcome => outcome.state === "verified").length, outcomes };
  };
}

async function chooseLibrary(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Prepared library folder"]')!;
  fireEvent.change(input, { target: { files: [new File(["{}"], "catalog.json")] } });
  return screen.findByText(/courses? found/);
}

describe("publishing a prepared library", () => {
  let fixture: Awaited<ReturnType<typeof library>>;
  beforeEach(async () => {
    fixture = await library();
    mocks.folder.mockReturnValue(fixture.read);
    mocks.share.mockImplementation(async (ids: string[]) =>
      ids.map(collectionId => ({ collectionId, shared: true })));
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("plans one course per term and module, needs a confirmed term, and shares only after attesting rights", async () => {
    const prepared: AcademicUpload[] = [];
    mocks.batch.mockImplementation(simulatedBatch(prepared));
    const onPublished = vi.fn();
    const { container } = render(<AcademicLibraryPublisher onPublished={onPublished} />);
    expect((await chooseLibrary(container)).textContent).toMatch(/3 courses found\. 2 courses selected to publish\./);
    expect(screen.getAllByRole("group").map(group => group.querySelector("legend")?.textContent)).toEqual(
      expect.arrayContaining(["Term 1", "Term 4", "Term 5"]));

    const cpr = screen.getByText("CPR 1").closest("article")!;
    expect(within(cpr).getByText(/SGU outline lists CPR 1 in Term 1\. Confirm the term to publish this course\./)).toBeTruthy();
    expect((within(cpr).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(cpr).getByRole("button", { name: "Confirm Term 1" }));
    expect(await screen.findByText(/3 courses selected to publish/)).toBeTruthy();
    expect(within(screen.getByText("CPR 1").closest("article")!).getByText("Term you confirmed.")).toBeTruthy();

    expect(screen.getByText("2 course plans need attention")).toBeTruthy();
    expect(screen.getByText(/source files stay on this device/)).toBeTruthy();
    const publish = screen.getByRole("button", { name: /Publish 3 courses/ });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Approve sharing now/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(publish);

    expect(await screen.findByText("3 courses published and verified.")).toBeTruthy();
    expect(prepared.map(upload => [upload.catalogId, upload.metadata.term])).toEqual([
      ["academic-library-t1-cpr1", "Term 1"], ["academic-library-t4-ncrs", "Term 4"], ["academic-library-t5-goer", "Term 5"],
    ]);
    expect(mocks.share).toHaveBeenCalledWith(prepared.map(upload => `collection-${upload.catalogId}`), "owner-1",
      expect.any(Object));
    expect(mocks.share.mock.calls[0][2]).not.toHaveProperty("approve");
    expect(screen.getAllByText("Sharing awaits review")).toHaveLength(3);
    expect(onPublished).toHaveBeenCalledOnce();
    // Published courses are cleared from the selection so a retry does not redo them.
    expect(screen.getByText(/0 courses selected to publish/)).toBeTruthy();
  });

  it("does not approve courses during publishing even when sharing is requested", async () => {
    mocks.batch.mockImplementation(simulatedBatch([]));
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    expect(screen.queryByRole("checkbox", { name: /Approve sharing now/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(screen.getByRole("button", { name: /Publish 2 courses/ }));
    await waitFor(() => expect(screen.getAllByText("Sharing awaits review")).toHaveLength(2));
    expect(screen.queryAllByText("Shared with everyone")).toHaveLength(0);
    expect(mocks.share.mock.calls[0][2]).not.toHaveProperty("approve");
  });

  it("keeps courses private when sharing is off, and explains a course that fails validation", async () => {
    mocks.batch.mockImplementation(simulatedBatch([]));
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    // The library changes after planning: one claimed count no longer matches its questions.
    const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json")!));
    catalog.sources.find((source: { name: string }) => source.name === "goer-pq.pdf").ready = 5;
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(catalog)));
    fireEvent.click(screen.getByRole("checkbox", { name: /Submit for academic review to share/ }));
    expect(screen.queryByRole("checkbox", { name: /right to share/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Publish 2 courses/ }));
    expect(await screen.findByText(/1 course published and verified\. 1 course not published/)).toBeTruthy();
    const goer = screen.getByText("GOER").closest("article")!;
    expect(within(goer).getByText(/claimed ready\/review counts differ/)).toBeTruthy();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("checks every selected course on this device without uploading, and unselects the ones that need attention", async () => {
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json")!));
    catalog.sources.find((source: { name: string }) => source.name === "goer-pq.pdf").ready = 5;
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(catalog)));
    fireEvent.click(screen.getByRole("button", { name: /Check 2 courses/ }));

    expect(await screen.findByText("1 of 2 courses ready to publish. 1 course needs attention and was unselected. Nothing was uploaded.")).toBeTruthy();
    const ncrs = screen.getByText("NCRS").closest("article")!;
    expect(within(ncrs).getByText("Ready to publish")).toBeTruthy();
    expect(within(ncrs).getByText(/1 ready question and \d+ files checked \(\d+ KB\)\./)).toBeTruthy();
    const goer = screen.getByText("GOER").closest("article")!;
    expect(within(goer).getByText("Needs attention")).toBeTruthy();
    expect(within(goer).getByText(/claimed ready\/review counts differ/)).toBeTruthy();
    expect((within(goer).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/1 course selected to publish/)).toBeTruthy();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("applies and removes the exact MI to NMI decision through the publisher control", async () => {
    const original = new TextEncoder().encode("%PDF-1.4 synthetic MI source");
    const checksum = (await sha256(original)).slice(7);
    const bankPath = `banks/${checksum}/bank.json`;
    const miBank = bank("mi-pq", "MI", 5, checksum);
    miBank.pkg.manifest.course.week = 0;
    miBank.pkg.questions[0].week = 0;
    fixture.files.set(`sources/${checksum}.pdf`, original);
    fixture.files.set(bankPath, new TextEncoder().encode(JSON.stringify(miBank)));
    fixture.catalog.sources.push({ id: `source-${checksum}`, name: "mi-pq.pdf", sourcePath: "MI/mi-pq.pdf", checksum,
      module: "MI", status: "prepared", reason: "Synthetic test source", bankFile: bankPath,
      originalFile: `sources/${checksum}.pdf`, ready: 1, review: 0 });
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));
    const decision = { format: MI_NMI_DECISION_FORMAT, schemaVersion: 2,
      catalogSha256: (await sha256(fixture.files.get("catalog.json")!)).slice(7),
      fromModule: "MI", toModule: "NMI", term: "Term 5", ownerDecision: "MI belongs under NMI",
      decidedAtUtc: "2026-11-01T00:00:00Z", sources: [{ sourceId: `source-${checksum}`, sourceChecksum: checksum,
        bankSha256: (await sha256(fixture.files.get(bankPath)!)).slice(7) }], plans: [] };
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    expect(screen.getByRole("button", { name: "Add MI to NMI decision" })).toBeTruthy();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="MI to NMI decision file"]')!;
    fireEvent.change(input, { target: { files: [{ text: async () => JSON.stringify(decision) }] } });
    expect(await screen.findByText(/1 MI source verified and placed under Term 5 NMI/)).toBeTruthy();
    expect(screen.getByText("NMI")).toBeTruthy();
    expect(screen.queryByText("MI")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove MI to NMI decision" }));
    expect(await screen.findByText("MI")).toBeTruthy();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("explains when a bank's unsupported original stays on this device", async () => {
    const bankSource = fixture.catalog.sources.find(source => source.name === "goer-pq.pdf")!;
    const original = bankSource.originalFile!;
    bankSource.originalFile = original.replace(/\.pdf$/, ".pptx");
    fixture.files.set(bankSource.originalFile, fixture.files.get(original)!);
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(fixture.catalog)));

    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    fireEvent.click(screen.getByRole("button", { name: /Check 2 courses/ }));
    const goer = screen.getByText("GOER").closest("article")!;
    expect(await within(goer).findByText("Ready to publish")).toBeTruthy();
    expect(within(goer).getByText(/1 source file will stay on this device because the file type or course size limit prevents upload/)).toBeTruthy();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("publishes a library of more than 100 courses in runs of 100", async () => {
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const files = new Map<string, Uint8Array>();
    const sources = [];
    for (let index = 1; index <= 101; index++) {
      const module = `Synthetic ${String(index).padStart(3, "0")}`;
      const original = new TextEncoder().encode(`%PDF-1.4 synthetic ${index}`);
      const checksum = (await sha256(original)).slice(7);
      files.set(`sources/${checksum}.pdf`, original);
      files.set(`banks/${checksum}/bank.json`, encode(bank(`set-${index}`, module, 1, checksum)));
      sources.push({ id: `source-${checksum}`, name: `set-${index}.pdf`, sourcePath: `${module}/set-${index}.pdf`, checksum, module,
        status: "prepared", reason: "Validated package", bankFile: `banks/${checksum}/bank.json`, originalFile: `sources/${checksum}.pdf`, ready: 1, review: 0 });
    }
    files.set("catalog.json", encode({ format: "axom-private-library", schemaVersion: 1, id: "academic-library", version: "v1", templates: [], sources }));
    mocks.folder.mockReturnValue(async (path: string) => files.get(path)!);
    // Only the run boundaries matter here; preparation is covered above.
    mocks.batch.mockImplementation(async (jobs: AcademicBatchJob[], options: { onOutcome?: (outcome: AcademicBatchOutcome) => void }) => {
      for (const job of jobs) options.onOutcome?.({ key: job.key, state: "verified", receipt: { collectionId: `collection-${job.key}`,
        revisionId: `revision-${job.key}`, contentHash: "a".repeat(64), readyQuestions: 1,
        explainedReadyQuestions: 1, missingExplanations: 0,
        reviewQuestions: 0, sourceReceipts: [], verifiedFiles: 3, localOnlyOriginals: [] } });
      return { expected: jobs.length, verified: jobs.length, authBlocked: 0 };
    });
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    expect((await chooseLibrary(container)).textContent).toMatch(/101 courses found\. 101 courses selected to publish\./);
    fireEvent.click(screen.getByRole("checkbox", { name: /Submit for academic review to share/ }));
    fireEvent.click(screen.getByRole("button", { name: /Publish 101 courses/ }));
    expect(await screen.findByText("101 courses published and verified.")).toBeTruthy();
    expect(mocks.batch.mock.calls.map(([jobs]) => (jobs as AcademicBatchJob[]).length)).toEqual([100, 1]);
  });
});
