// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicBatchJob, AcademicBatchOutcome } from "../../lib/academicLibrary/batch";
import type { AcademicUpload } from "../../lib/academicLibrary/upload";
import { library } from "../../lib/academicLibrary/publicationFixture.testing";
import { AcademicLibraryPublisher } from "./AcademicLibraryPublisher";

const mocks = vi.hoisted(() => ({ reviewer: vi.fn(), share: vi.fn(), batch: vi.fn(), folder: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "owner-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "owner-1", assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
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
          readyQuestions: Number(upload.metadata.ready_questions), reviewQuestions: Number(upload.metadata.review_questions),
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
    mocks.reviewer.mockResolvedValue(false);
    mocks.share.mockImplementation(async (ids: string[], _account: string, options: { approve: boolean }) =>
      ids.map(collectionId => ({ collectionId, shared: true, approved: options.approve })));
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
      expect.objectContaining({ approve: false }));
    expect(screen.getAllByText("Sharing awaits review")).toHaveLength(3);
    expect(onPublished).toHaveBeenCalledOnce();
    // Published courses are cleared from the selection so a retry does not redo them.
    expect(screen.getByText(/0 courses selected to publish/)).toBeTruthy();
  });

  it("lets a reviewer approve the published courses for everyone", async () => {
    mocks.reviewer.mockResolvedValue(true);
    mocks.batch.mockImplementation(simulatedBatch([]));
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Approve sharing now/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /right to share this course material/ }));
    fireEvent.click(screen.getByRole("button", { name: /Publish 2 courses/ }));
    await waitFor(() => expect(screen.getAllByText("Shared with everyone")).toHaveLength(2));
    expect(mocks.share).toHaveBeenCalledWith(expect.any(Array), "owner-1", expect.objectContaining({ approve: true }));
  });

  it("keeps courses private when sharing is off, and explains a course that fails validation", async () => {
    mocks.batch.mockImplementation(simulatedBatch([]));
    const { container } = render(<AcademicLibraryPublisher onPublished={vi.fn()} />);
    await chooseLibrary(container);
    // The library changes after planning: one claimed count no longer matches its questions.
    const catalog = JSON.parse(new TextDecoder().decode(fixture.files.get("catalog.json")!));
    catalog.sources.find((source: { name: string }) => source.name === "goer-pq.pdf").ready = 5;
    fixture.files.set("catalog.json", new TextEncoder().encode(JSON.stringify(catalog)));
    fireEvent.click(screen.getByRole("checkbox", { name: /Share with every signed-in AXOM account/ }));
    expect(screen.queryByRole("checkbox", { name: /right to share/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Publish 2 courses/ }));
    expect(await screen.findByText(/1 course published and verified\. 1 course not published/)).toBeTruthy();
    const goer = screen.getByText("GOER").closest("article")!;
    expect(within(goer).getByText(/claimed ready\/review counts differ/)).toBeTruthy();
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
