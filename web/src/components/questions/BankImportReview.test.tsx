// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportPackage } from "../../lib/question-content/package";
import * as bankImport from "../../lib/question-content/bankImport";
import { BankImportReview, type ReviewBank } from "./BankImportReview";

const pkg = (evidence: "printed-key" | "answer-reveal-slide"): ImportPackage => ({
  manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "synthetic-review", title: "Synthetic review", discipline: "Medicine" },
    source: { filename: "synthetic.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/" },
  questions: [{
    id: "q1", source: { filename: "synthetic.pdf", questionNumber: 4, page: 2 },
    stem: [{ type: "text", text: "What characterizes metabolic alkalosis?" },
      { type: "table", headers: ["Lab", "Value"], rows: [["pH", "7.55"], ["Bicarbonate", "38 mEq/L"]] }],
    choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Low bicarbonate" }] },
      { id: "b", label: "B", blocks: [{ type: "text", text: "High bicarbonate" }] }],
    correctAnswer: { labels: ["B"], evidence }, assets: [],
    explanation: [{ type: "text", text: "Bicarbonate is elevated." }],
    provenance: { method: "pdf-import", sourceChecksum: "sha256:" + "a".repeat(64) },
  }],
});
function bank(evidence: "printed-key" | "answer-reveal-slide"): ReviewBank {
  return { pkg: pkg(evidence), conversionIssues: evidence === "answer-reveal-slide"
    ? [{ severity: "warning", questionId: "q1", code: "possible_answer_marking", message: "Marked slide requires review." }] : [],
    files: [], sourceText: { rawText: "Source text for review" }, sourceBytes: 100, notes: [], warnings: [], unplaced: [] };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("structured question import review", () => {
  it("keeps the original source-page renderer out of answering mode", async () => {
    const user = userEvent.setup();
    const original = new File(["original PDF bytes"], "synthetic.pdf", { type: "application/pdf" });
    render(<BankImportReview bank={{ ...bank("printed-key"), originalFile: original }} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "View original PDF page" })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(screen.getByRole("button", { name: "View original PDF page" })).toBeTruthy();
    expect(screen.getByLabelText("Original PDF page number")).toHaveProperty("value", "2");
  });

  it("allows correcting stem text and tables without dropping source or media structure; requires re-confirmation", async () => {
    const user = userEvent.setup();
    render(<BankImportReview bank={bank("printed-key")} onBack={() => {}} />);
    expect(screen.getByText(/1 questions · 1 ready for import/)).toBeTruthy();
    await user.click(screen.getByText("Correct extracted text, answer choices or tables"));
    fireEvent.change(screen.getByLabelText("Question 1 stem · block 1"),
      { target: { value: "What finding indicates metabolic alkalosis?" } });
    expect(screen.getByText(/1 questions · 0 ready/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Question 1 stem · block 2, row 2, column 2"),
      { target: { value: "39 mEq/L" } });
    expect(screen.getByText(/1 questions · 0 ready/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    await user.selectOptions(screen.getByLabelText("Verified answer"), "B");
    await user.click(screen.getByRole("button", { name: "Confirm answer from source" }));
    expect(await screen.findByText(/1 questions · 1 ready for import/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import 1 answer-ready question" }).hasAttribute("disabled")).toBe(false);
  });
  it("clears answer-reveal uncertainty only after explicit human confirmation", async () => {
    const user = userEvent.setup();
    render(<BankImportReview bank={bank("answer-reveal-slide")} onBack={() => {}} />);
    expect(screen.getByText(/1 questions · 0 ready/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    await user.selectOptions(screen.getByLabelText("Verified answer"), "B");
    await user.click(screen.getByRole("button", { name: "Confirm answer from source" }));
    await waitFor(() => expect(screen.getByText(/1 questions · 1 ready for import/)).toBeTruthy());
  });

  it("preserves source scope while saving to the reviewed unassigned placement", async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(bankImport, "saveBank").mockResolvedValue({
      status: "saved", sections: [{ setTitle: "Synthetic review", questionIds: ["q1"], savedIds: ["saved-q1"], reused: false,
        images: { attached: 0, missing: 0, problems: [] } }], incompleteSections: [], held: [], withheldAssets: [],
      filing: { module: "FTCM", term: 4, agrees: true }, errors: [],
    });
    render(<BankImportReview bank={{ ...bank("printed-key"), reviewedFiling: {
      module: "FTCM", term: "Term 4", evidence: "human-reviewed", weekAssignment: "unassigned",
    } }} onBack={() => {}} />);

    expect(screen.getByLabelText("Source module")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Source term")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Source week")).toHaveProperty("disabled", true);
    expect(screen.getByText(/Reviewed placement: FTCM · Term 4 · week unassigned/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Import 1 answer-ready question" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const [savedPackage, , , , options] = save.mock.calls[0];
    expect(savedPackage.manifest.course).toEqual({ name: "GOER", term: 5, week: 2 });
    expect(options).toBeDefined();
    if (!options) throw new Error("Expected reviewed import options.");
    expect(options.reviewedFiling).toEqual({ module: "FTCM", term: 4 });
    expect(options).not.toHaveProperty("courseId");
  });

  it("reports durable questions honestly when another bank section remains incomplete", async () => {
    const user = userEvent.setup();
    vi.spyOn(bankImport, "saveBank").mockResolvedValue({
      status: "partial",
      sections: [{
        setTitle: "Synthetic review", questionIds: ["q1"], savedIds: ["saved-q1"], reused: false,
        setId: "saved-set", images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [{
        setTitle: "Synthetic review · reused section", questionIds: ["q0"], savedIds: ["existing-q0"],
        setId: "existing-set", reused: true, reason: "Reviewed filing could not be saved.",
      }],
      held: [], withheldAssets: [], filing: { module: "FTCM", term: 4, agrees: true },
      errors: ["Reviewed filing could not be saved."],
    });
    render(<BankImportReview bank={bank("printed-key")} onBack={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Import 1 answer-ready question" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("1 question saved on this device");
    expect(alert.textContent).toContain("Other bank sections still need attention");
    expect(alert.textContent).toContain("1 existing question remains saved");
    expect(screen.getByRole("button", { name: "Open imported bank" })).toBeTruthy();
  });

  it("does not display import success until prepared-library finalization is durable", async () => {
    const user = userEvent.setup();
    vi.spyOn(bankImport, "saveBank").mockResolvedValue({
      status: "saved",
      sections: [{
        setTitle: "Synthetic review", questionIds: ["q1"], savedIds: ["saved-q1"], reused: false,
        setId: "saved-set", images: { attached: 0, missing: 0, problems: [] },
      }],
      incompleteSections: [], held: [], withheldAssets: [],
      filing: { module: "GOER", term: 5, agrees: true }, errors: [],
    });
    const onReviewed = vi.fn().mockRejectedValue(new Error(
      "1 imported question remains saved, but AXOM could not confirm the reviewed source and library catalog on this device.",
    ));
    render(<BankImportReview bank={bank("printed-key")} onBack={() => {}} onReviewed={onReviewed} />);

    await user.click(screen.getByRole("button", { name: "Import 1 answer-ready question" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/question remains saved.*could not confirm.*catalog/i);
    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/1 question saved on this device/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open imported bank" })).toBeNull();
  });
});
