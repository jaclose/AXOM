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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("structured question import review", () => {
  it("shows an answer image once when the package both places and lists it", async () => {
    const user = userEvent.setup();
    const sample = bank("answer-reveal-slide");
    const question = sample.pkg.questions[0];
    question.assets.push({ id: "source-answer", filename: "answer.png", mimeType: "image/png", role: "answer_reveal", questionId: "q1" });
    question.explanation?.push({ type: "image", assetId: "source-answer", role: "answer_reveal" });
    sample.files = [new File(["image placeholder"], "answer.png", { type: "image/png" })];
    const view = render(<BankImportReview bank={sample} onBack={() => {}} />);
    expect(view.container.querySelectorAll('[data-asset-role="answer_reveal"]')).toHaveLength(0);
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(view.container.querySelectorAll('[data-asset-role="answer_reveal"]')).toHaveLength(1);
  });

  it("preselects the key a marked slide suggests, but counts it only after the reviewer confirms it", async () => {
    const user = userEvent.setup();
    render(<BankImportReview bank={bank("answer-reveal-slide")} onBack={() => {}} />);
    expect(screen.getByText(/1 questions · 0 ready/)).toBeTruthy();
    expect(screen.getByLabelText("Verified answer")).toHaveProperty("value", "B");
    expect(screen.getByText("The original answer slide marks B. It stays a suggestion until you check the slide and confirm it.")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm answer from source" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(screen.getByText(/1 questions · 0 ready/)).toBeTruthy();
    // Clearing the suggestion is respected rather than refilled.
    await user.selectOptions(screen.getByLabelText("Verified answer"), "");
    expect(screen.getByLabelText("Verified answer")).toHaveProperty("value", "");
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Verified answer"), "B");
    await user.click(confirm);
    await waitFor(() => expect(screen.getByText(/1 questions · 1 ready for import/)).toBeTruthy());
  });

  it.each([undefined, 37])("shows only a declared original question number (%s)", (questionNumber) => {
    const reviewBank = bank("printed-key");
    reviewBank.pkg.questions[0].source.questionNumber = questionNumber;
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);
    expect(screen.getByText(/Source page 2/).textContent).toBe(
      `READY FOR IMPORT · Source page 2${questionNumber !== undefined ? ` · Original question ${questionNumber}` : ""}`,
    );
    expect(screen.queryByText(/Original question 1(?:\D|$)/)).toBeNull();
  });

  it.each(["stem", "choice", "explanation"] as const)("renders an answer-reveal asset placed in the %s once without altering source records", async (section) => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:placed-answer");
      static revokeObjectURL = vi.fn();
    });
    const reviewBank = bank("printed-key");
    const question = reviewBank.pkg.questions[0];
    question.assets = [{ id: "reveal", questionId: question.id, filename: "reveal.png", mimeType: "image/png", role: "answer_reveal" }];
    const block = { type: "image" as const, assetId: "reveal", alt: "Placed answer slide" };
    if (section === "stem") question.stem.push(block);
    else if (section === "choice") question.choices[0].blocks.push(block);
    else question.explanation!.push(block);
    reviewBank.files = [new File(["synthetic image"], "reveal.png", { type: "image/png" })];
    const originalPackage = JSON.stringify(reviewBank.pkg);
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    expect(screen.queryByRole("img")).toBeNull();
    for (const mode of ["answered", "review"]) {
      await user.selectOptions(screen.getByLabelText("Preview mode"), mode);
      expect(await screen.findByRole("img", { name: "Placed answer slide" })).toBeTruthy();
      expect(screen.getAllByRole("img")).toHaveLength(1);
    }
    await user.selectOptions(screen.getByLabelText("Preview mode"), "question");
    expect(screen.queryByRole("img")).toBeNull();
    expect(JSON.stringify(reviewBank.pkg)).toBe(originalPackage);
  });

  it("keeps unplaced reveals and references accessible after answering and whole source pages review-only", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
      static revokeObjectURL = vi.fn();
    });
    const reviewBank = bank("printed-key");
    const question = reviewBank.pkg.questions[0];
    question.assets = (["answer_reveal", "reference", "source_page"] as const).map((role) => ({
      id: role, questionId: question.id, filename: `${role}.png`, mimeType: "image/png", role,
    }));
    reviewBank.files = question.assets.map((asset) => new File(["synthetic image"], asset.filename, { type: "image/png" }));
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    expect(screen.queryByRole("img")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "answered");
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("src"))).toEqual([
      "blob:answer_reveal.png", "blob:reference.png",
    ]);
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("src"))).toContain("blob:source_page.png");
    await user.selectOptions(screen.getByLabelText("Preview mode"), "question");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not bypass a placed source-page restriction through the supporting-asset fallback", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:restricted-page");
      static revokeObjectURL = vi.fn();
    });
    const reviewBank = bank("printed-key");
    const question = reviewBank.pkg.questions[0];
    question.assets = [{ id: "page", questionId: question.id, filename: "page.png", mimeType: "image/png", role: "answer_reveal" }];
    question.stem.push({ type: "image", assetId: "page", role: "source_page", alt: "Original source page" });
    reviewBank.files = [new File(["synthetic image"], "page.png", { type: "image/png" })];
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    expect(screen.queryByRole("img")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "answered");
    expect(screen.queryByRole("img")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(await screen.findByRole("img", { name: "Original source page" })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("distinguishes ready, review and unresolved questions in the count and current-question status", async () => {
    const user = userEvent.setup();
    const reviewBank = bank("printed-key");
    const question = reviewBank.pkg.questions[0];
    reviewBank.pkg.questions.push(
      { ...question, id: "q2", correctAnswer: { labels: ["B"], evidence: "answer-reveal-slide" } },
      { ...question, id: "q3", correctAnswer: undefined },
    );
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    expect(screen.getByText("3 questions · 1 ready for import · 1 need review · 1 unresolved")).toBeTruthy();
    expect(screen.getByText(/^READY FOR IMPORT · Source page/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText(/^NEEDS REVIEW · Source page/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText(/^UNRESOLVED · Source page/)).toBeTruthy();
  });

  it("labels a bare answer letter as an unverified candidate without changing it", async () => {
    const user = userEvent.setup();
    const reviewBank = bank("printed-key");
    reviewBank.pkg.questions[0].correctAnswer = { labels: ["B"] };
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    expect(screen.queryByText(/Candidate key/)).toBeNull();
    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(screen.getByText("Candidate key (unverified): B")).toBeTruthy();
    expect(reviewBank.pkg.questions[0].correctAnswer).toEqual({ labels: ["B"] });
  });

  it.each(["printed-key", "reviewer"] as const)("preserves the %s source key label when an unrelated structural issue holds the question", async (evidence) => {
    const user = userEvent.setup();
    const reviewBank = bank("printed-key");
    reviewBank.pkg.questions[0].correctAnswer = { labels: ["B"], evidence };
    reviewBank.conversionIssues.push({ questionId: "q1", severity: "error", code: "missing_required_media", message: "A required source figure is missing." });
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(screen.getByText(/^UNRESOLVED · Source page/)).toBeTruthy();
    expect(screen.getByText("Source key: B")).toBeTruthy();
  });

  it("shows a printed key as a candidate when its answer has an explicit review flag", async () => {
    const user = userEvent.setup();
    const reviewBank = bank("printed-key");
    reviewBank.pkg.questions[0].flags = [{ type: "answer_needs_review", message: "The answer needs checking against the original." }];
    render(<BankImportReview bank={reviewBank} onBack={() => {}} />);

    await user.selectOptions(screen.getByLabelText("Preview mode"), "review");
    expect(screen.getByText("Candidate key (unverified): B")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Verified answer"), "B");
    await user.click(screen.getByRole("button", { name: "Confirm answer from source" }));
    expect(screen.getByText("Source key: B")).toBeTruthy();
  });

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
