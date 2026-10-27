// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AcademicCourseUpload } from "./AcademicCourseUpload";
import { AcademicPlanTermRequiredError } from "../../lib/academicLibrary/coursePlan";
import { readCatalog, zipLibraryReader } from "../../lib/privateLibrary/install";
import { prepareAcademicUpload, uploadAcademicCourse } from "../../lib/academicLibrary/upload";

vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "student-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  academicClient: async () => ({ from: () => ({}) }),
}));
vi.mock("../../lib/privateLibrary/install", () => ({
  readCatalog: vi.fn(),
  zipLibraryReader: vi.fn(),
}));
vi.mock("../../lib/academicLibrary/upload", () => ({
  prepareAcademicUpload: vi.fn(),
  uploadAcademicCourse: vi.fn(),
}));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button type="button" {...props}>{children}</button>,
}));

const reader = async () => new TextEncoder().encode('{"format":"axom-private-library"}');
const output = {
  catalogId: "real-source-package", metadata: { term: "Term 4", module: "NCRS",
    ready_questions: 4, review_questions: 3 },
  provenance: { sourceChecksums: [], weekAssignment: "unassigned" as const },
  files: [{ path: "catalog.json", bytes: new Uint8Array([1, 2]), byte_size: 2 }],
  hash: "a".repeat(64),
};

function chooseZip(container: HTMLElement) {
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!picker) throw new Error("Missing file picker");
  fireEvent.change(picker, { target: { files: [new File(["zip"], "medical-private.zip", { type: "application/zip" })] } });
}

describe("authenticated academic upload — unassigned weeks", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(zipLibraryReader).mockResolvedValue(reader);
    vi.mocked(readCatalog).mockReturnValue({
      format: "axom-private-library", schemaVersion: 1, id: "private-banks", version: "v1",
      templates: [], sources: [{ id: "s", name: "NCRS", sourcePath: "NCRS",
        checksum: "a".repeat(64), status: "review-required", reason: "human confirmation needed",
        bankFile: "bank.json", ready: 4, review: 3 }],
    });
    vi.mocked(prepareAcademicUpload).mockResolvedValue(output as never);
    vi.mocked(uploadAcademicCourse).mockResolvedValue({ collection_id: "one", revision_id: "two", status: "active" });
  });

  it("does not fabricate a term or save a template-less bank without explicit source review", async () => {
    const { container } = render(<AcademicCourseUpload onSaved={vi.fn()} />);
    chooseZip(container);
    expect(await screen.findByRole("group", { name: "Confirm unscheduled course classification" })).toBeTruthy();
    expect(prepareAcademicUpload).not.toHaveBeenCalled();

    const action = screen.getByRole("button", { name: "Validate private collection" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Term 4" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "NCRS" } });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledWith(reader, {
      term: "Term 4", module: "NCRS", evidence: "human-reviewed",
    }));
    expect(await screen.findByText(/Week unassigned/)).toBeTruthy();
    expect(uploadAcademicCourse).not.toHaveBeenCalled();
  });

  it("keeps private saving separate from classification and requires an explicit save action", async () => {
    const onSaved = vi.fn();
    const { container } = render(<AcademicCourseUpload onSaved={onSaved} />);
    chooseZip(container);
    await screen.findByRole("group", { name: "Confirm unscheduled course classification" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Term 4" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "NCRS" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Validate private collection" }));
    await screen.findByRole("button", { name: "Save private collection" });
    expect(uploadAcademicCourse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save private collection" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(uploadAcademicCourse).toHaveBeenCalledOnce();
  });

  it("keeps a package with a reviewed weekly plan on its established path", async () => {
    vi.mocked(readCatalog).mockReturnValueOnce({
      format: "axom-private-library", schemaVersion: 1, id: "planned", version: "v1",
      templates: [{ file: "plan.txt", name: "course", checksum: "b".repeat(64) }], sources: [],
    });
    const { container } = render(<AcademicCourseUpload onSaved={vi.fn()} />);
    chooseZip(container);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenCalledWith(reader));
    expect(screen.queryByRole("group", { name: "Confirm unscheduled course classification" })).toBeNull();
  });

  it("asks a reviewer for the term of a weekly plan that does not name it, and never guesses one", async () => {
    vi.mocked(readCatalog).mockReturnValueOnce({
      format: "axom-private-library", schemaVersion: 1, id: "planned", version: "v1",
      templates: [{ file: "plan.txt", name: "course", checksum: "b".repeat(64) }], sources: [],
    });
    vi.mocked(prepareAcademicUpload)
      .mockRejectedValueOnce(new AcademicPlanTermRequiredError("GOER"))
      .mockResolvedValueOnce({ ...output, metadata: { term: "Term 5", module: "GOER", ready_questions: 4, review_questions: 0 },
        provenance: { sourceChecksums: [], planTermEvidence: "human-reviewed" } } as never);
    const { container } = render(<AcademicCourseUpload onSaved={vi.fn()} />);
    chooseZip(container);
    const group = await screen.findByRole("group", { name: "Confirm the course plan term" });
    expect(within(group).getByText(/Confirm the term for GOER/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    const action = within(group).getByRole("button", { name: "Validate private collection" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.change(within(group).getByRole("combobox"), { target: { value: "Term 5" } });
    expect(action.disabled).toBe(true);
    fireEvent.click(within(group).getByRole("checkbox"));
    fireEvent.click(action);
    await waitFor(() => expect(prepareAcademicUpload).toHaveBeenLastCalledWith(reader, undefined,
      { planTerm: { term: "Term 5", evidence: "human-reviewed" } }));
    expect(await screen.findByText(/GOER · Term 5 · 4 ready questions.*Term you confirmed/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Confirm the course plan term" })).toBeNull();
    expect(uploadAcademicCourse).not.toHaveBeenCalled();
  });
});
