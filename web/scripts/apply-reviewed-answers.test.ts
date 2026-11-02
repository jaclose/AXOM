// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessBank } from "../src/lib/question-content/assessBank";
import type { PackageQuestion } from "../src/lib/question-content/package";
import type { PreparedBank, PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";
import { createApprovedOnlyLibrary, type ApprovalDecisions } from "./approved-only-library";
import { applyReviewedAnswers, createReviewedAnswerTemplate, type ReviewedAnswerDecisions } from "./apply-reviewed-answers";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(existingAnswer = false, mediaUncertain = false,
  existingEvidence: "answer-reveal-slide" | "printed-key" = "answer-reveal-slide") {
  const work = await mkdtemp(join(tmpdir(), "axom-reviewed-answer-test-"));
  roots.push(work);
  const root = join(work, "prepared");
  await mkdir(root);
  const original = Buffer.from("%PDF-1.4 invented review fixture");
  const checksum = sha(original);
  const otherOriginal = Buffer.from("%PDF-1.4 unrelated invented fixture");
  const otherChecksum = sha(otherOriginal);
  const bankFile = "banks/" + checksum + "/bank.json";
  const otherBankFile = "banks/" + otherChecksum + "/bank.json";
  const originalFile = "sources/" + checksum + ".pdf";
  const otherOriginalFile = "sources/" + otherChecksum + ".pdf";
  const held: PackageQuestion = {
    id: "invented-held-1", course: "FTM 1", term: 1, week: 1,
    source: { filename: "invented.pdf", page: 1, questionNumber: 1 },
    stem: [{ type: "text", text: "Which invented option is the synthetic answer?" }],
    choices: [
      { id: "invented-a", label: "A", blocks: [{ type: "text", text: "An invented first option" }] },
      { id: "invented-b", label: "B", blocks: [{ type: "text", text: "An invented second option" }] },
    ],
    ...(existingAnswer ? { correctAnswer: { labels: ["A"], evidence: existingEvidence } } : {}),
    flags: [{ type: "answer_needs_review", message: "The invented source key needs human review." },
      ...(mediaUncertain ? [{ type: "media_association_uncertain" as const,
        message: "The required invented figure is not tied to this question." }] : [])],
    assets: [], provenance: { method: "authored", sourceChecksum: "sha256:" + checksum },
  };
  const ready: PackageQuestion = {
    ...structuredClone(held), id: "invented-ready-2", course: "FTM 1", term: 1, week: 2,
    source: { filename: "unrelated.pdf", page: 2, questionNumber: 2 },
    stem: [{ type: "text", text: "Which unrelated invented option is already keyed?" }],
    correctAnswer: { labels: ["A"], evidence: "printed-key" },
    explanation: [{ type: "text", text: "The unrelated invented source explicitly marks the first synthetic option as correct." }],
    flags: undefined, provenance: { method: "authored", sourceChecksum: "sha256:" + otherChecksum },
  };
  const manifest = (filename: string, week: number, id: string) => ({
    schemaVersion: 1, course: { name: "FTM 1", term: 1, week },
    bank: { id, title: "Invented fixture", discipline: "Synthetic" },
    source: { filename, sourceWeekDeclared: true },
    questionsFile: "questions.json", assetsDirectory: "assets",
  });
  const bank: PreparedBank = { pkg: { manifest: manifest("invented.pdf", 1, "invented-bank"), questions: [held] },
    issues: [], sourceText: { rawText: "Invented private source text" }, sourceBytes: original.length, notes: [] };
  const otherBank: PreparedBank = { pkg: { manifest: manifest("unrelated.pdf", 2, "unrelated-bank"), questions: [ready] },
    issues: [], sourceText: { rawText: "Unrelated private source text" }, sourceBytes: otherOriginal.length, notes: [] };
  bank.issues = assessBank(bank.pkg, [], []).issues;
  otherBank.issues = assessBank(otherBank.pkg, [], []).issues;
  const catalog: PrivateLibraryCatalog = {
    format: "axom-private-library", schemaVersion: 1, id: "invented-library", version: "before-review", templates: [],
    sources: [
      { id: "source-" + checksum, name: "invented.pdf", sourcePath: "PRIVATE/invented.pdf",
        checksum, status: "review-required", reason: "Invented held question", bankFile,
        originalFile, ready: 0, review: 1, module: "FTM 1" },
      { id: "source-" + otherChecksum, name: "unrelated.pdf", sourcePath: "PRIVATE/unrelated.pdf",
        checksum: otherChecksum, status: "prepared", reason: "Invented ready question",
        bankFile: otherBankFile, originalFile: otherOriginalFile, ready: 1, review: 0, module: "FTM 1" },
    ],
  };
  const put = async (path: string, bytes: Uint8Array | string) => {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  await put(originalFile, original);
  await put(otherOriginalFile, otherOriginal);
  await put(bankFile, JSON.stringify(bank));
  await put(otherBankFile, JSON.stringify(otherBank));
  await put("catalog.json", JSON.stringify(catalog));
  const decisionsPath = join(work, "answer-decisions.json");
  expect(await createReviewedAnswerTemplate(root, decisionsPath, checksum)).toEqual({ records: 1 });
  const decisions = JSON.parse(await readFile(decisionsPath, "utf8")) as ReviewedAnswerDecisions;
  const review = decisions.records[0];
  review.status = "approved";
  review.answerLabel = "B";
  review.answerEvidenceSourcePage = 1;
  review.answerEvidenceSourceLine = 5;
  review.answerEvidenceNote = "Invented printed answer inspected on source page one";
  review.explanationMode = "replace";
  review.explanationOrigin = "source";
  review.explanationText = "The invented source rationale explicitly identifies the second synthetic option as the correct choice.";
  review.explanationSourcePage = 1;
  review.sourceChecked = true;
  review.filingChecked = true;
  review.clinicalChecked = true;
  review.explanationChecked = true;
  review.rightsStatus = "cleared";
  review.rightsEvidence = "Invented fixture owned for this synthetic test";
  review.reviewer = "Invented reviewer";
  review.reviewedAt = "2026-11-02T08:00:00.000Z";
  await writeFile(decisionsPath, JSON.stringify(decisions));
  return { work, root, bankFile, otherBankFile, originalFile, decisionsPath, decisions,
    output: join(work, "reviewed"), held, ready, catalog };
}

describe("private reviewed-answer application", () => {
  it("applies a reviewed key and source rationale to a separate candidate that can pass approved-only review", async () => {
    const { work, root, bankFile, otherBankFile, originalFile, decisionsPath, output, catalog } = await fixture();
    const originalBankBytes = await readFile(join(root, bankFile));
    const unrelatedBankBytes = await readFile(join(root, otherBankFile));
    const originalSourceBytes = await readFile(join(root, originalFile));
    expect(await applyReviewedAnswers(root, decisionsPath, output))
      .toMatchObject({ appliedQuestions: 1, appliedBanks: 1, readyAdded: 1 });
    const library = join(output, "library");
    expect(await readFile(join(root, bankFile))).toEqual(originalBankBytes);
    expect(await readFile(join(root, originalFile))).toEqual(originalSourceBytes);
    expect(await readFile(join(library, otherBankFile))).toEqual(unrelatedBankBytes);
    const updated = JSON.parse(await readFile(join(library, bankFile), "utf8")) as PreparedBank;
    expect(updated.pkg.questions[0].correctAnswer).toEqual({ labels: ["B"], evidence: "reviewer" });
    expect(updated.pkg.questions[0].source.answerEvidencePage).toBe(1);
    expect(updated.pkg.questions[0].source.explanationSourcePage).toBe(1);
    expect(updated.pkg.questions[0].flags?.some(flag => flag.type === "answer_needs_review") ?? false).toBe(false);
    const updatedCatalog = JSON.parse(await readFile(join(library, "catalog.json"), "utf8")) as PrivateLibraryCatalog;
    expect(updatedCatalog.sources[0]).toMatchObject({ ready: 1, review: 0 });
    expect(updated.pkg.manifest.course).toEqual({ name: "FTM 1", term: 1, week: 1 });
    expect(updatedCatalog.sources[0].sourcePath).toBe(catalog.sources[0].sourcePath);
    const receipt = await readFile(join(output, "private-receipt.json"), "utf8");
    expect(receipt).not.toContain("invented source rationale");
    expect(receipt).not.toContain("PRIVATE/");
    expect(JSON.parse(receipt)).toMatchObject({ appliedQuestions: 1, appliedBanks: 1 });
    expect(JSON.parse(receipt).banks[0].reviewed[0]).toMatchObject({
      answerEvidenceSourcePage: 1, answerEvidenceSourceLine: 5,
      answerEvidenceNoteSha256: sha("Invented printed answer inspected on source page one"),
    });
    await expect(readFile(join(library, "private-receipt.json"))).rejects.toThrow();
    await expect(readFile(join(library, "approval-decisions.json"))).rejects.toThrow();
    const approvalPath = join(output, "approval-decisions.json");
    const approval = JSON.parse(await readFile(approvalPath, "utf8")) as ApprovalDecisions;
    const selected = approval.records.find(row => row.questionId === "invented-held-1")!;
    expect(selected.status).toBe("pending");
    selected.status = "approved";
    selected.sourceChecked = selected.filingChecked = selected.clinicalChecked = selected.explanationChecked = true;
    selected.rightsStatus = "cleared";
    selected.rightsEvidence = "Invented fixture owned for this synthetic test";
    selected.reviewer = "Invented reviewer";
    selected.reviewedAt = "2026-11-02T08:10:00.000Z";
    await writeFile(approvalPath, JSON.stringify(approval));
    expect(await createApprovedOnlyLibrary(library, approvalPath, join(work, "shareable")))
      .toMatchObject({ ready: 1, held: 0 });
  });

  it("rejects stale and duplicate decision identities before creating output", async () => {
    const { root, decisionsPath, decisions, output } = await fixture();
    decisions.records[0].questionSha256 = sha("stale");
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output)).rejects.toThrow(/no longer matches/);
    decisions.records[0].questionSha256 = sha("still-stale");
    decisions.records.push(structuredClone(decisions.records[0]));
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output)).rejects.toThrow(/more than one answer decision/);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("refuses a private decision file placed inside the library being copied", async () => {
    const { root, decisionsPath, output } = await fixture();
    const insidePath = join(root, "private-decisions.json");
    await writeFile(insidePath, await readFile(decisionsPath));
    await expect(applyReviewedAnswers(root, insidePath, output))
      .rejects.toThrow(/separate from the input library/);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("removes its own incomplete staging copy if a source contains a symlink", async () => {
    const { work, root, decisionsPath, output } = await fixture();
    await symlink(join(work, "answer-decisions.json"), join(root, "untrusted-link.json"));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/copy-on-write clone failed/);
    expect((await readdir(work)).some(name => name.startsWith("reviewed.pending-"))).toBe(false);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("removes its own staging copy when a later private approval template check fails", async () => {
    const { work, root, decisionsPath, decisions, output } = await fixture();
    const catalogPath = join(root, "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as PrivateLibraryCatalog;
    catalog.sources[1].name = "wrong-source.pdf";
    const bytes = JSON.stringify(catalog);
    await writeFile(catalogPath, bytes);
    decisions.catalogSha256 = sha(bytes);
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/different catalog source/);
    expect((await readdir(work)).some(name => name.startsWith("reviewed.pending-"))).toBe(false);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("rejects generic local paths in rationale and citation metadata", async () => {
    const { root, decisionsPath, decisions, output } = await fixture();
    decisions.records[0].explanationText =
      "The invented rationale is kept at /private/course/notes.pdf and the second choice is selected.";
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/contain no local path/);
    decisions.records[0].explanationText =
      "The invented rationale explains why the second synthetic choice fits the source question.";
    decisions.records[0].explanationOrigin = "axom";
    decisions.records[0].explanationCitation = "/private/course/notes.pdf";
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/shareable medical citation/);
  });

  it("rejects two catalog rows that point to one bank file", async () => {
    const { root, decisionsPath, decisions, output } = await fixture();
    const catalogPath = join(root, "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as PrivateLibraryCatalog;
    catalog.sources[1].bankFile = catalog.sources[0].bankFile;
    const bytes = JSON.stringify(catalog);
    await writeFile(catalogPath, bytes);
    decisions.catalogSha256 = sha(bytes);
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/same bank file/);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("preserves an already printed key when a reviewer confirms the same label", async () => {
    const { root, decisionsPath, decisions, output, bankFile } = await fixture(true, false, "printed-key");
    decisions.records[0].answerLabel = "A";
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await applyReviewedAnswers(root, decisionsPath, output);
    const bank = JSON.parse(await readFile(join(output, "library", bankFile), "utf8")) as PreparedBank;
    expect(bank.pkg.questions[0].correctAnswer).toEqual({ labels: ["A"], evidence: "printed-key" });
    expect(bank.pkg.questions[0].flags?.some(flag => flag.type === "answer_needs_review") ?? false).toBe(false);
  });

  it("requires an evidence anchor for an approved PDF answer", async () => {
    const { root, decisionsPath, decisions, output } = await fixture();
    decisions.records[0].answerEvidenceSourcePage = null;
    decisions.records[0].answerEvidenceSourceLine = null;
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/inspected source page/);
    decisions.records[0].answerEvidenceNote = "";
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/inspectable source-key evidence/);
  });

  it("rejects a conflicting stored key and incomplete source or rights review", async () => {
    const { root, decisionsPath, decisions, output } = await fixture(true);
    await expect(applyReviewedAnswers(root, decisionsPath, output)).rejects.toThrow(/conflicts with the stored key/);
    decisions.records[0].answerLabel = "A";
    decisions.records[0].rightsStatus = "pending";
    await writeFile(decisionsPath, JSON.stringify(decisions));
    await expect(applyReviewedAnswers(root, decisionsPath, output)).rejects.toThrow(/lacks source, clinical, explanation, filing, or rights review/);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });

  it("keeps a question held when an independent source or media doubt remains", async () => {
    const { root, decisionsPath, output } = await fixture(false, true);
    await expect(applyReviewedAnswers(root, decisionsPath, output))
      .rejects.toThrow(/still held by source, choice, or media validation/);
    await expect(readFile(join(output, "library", "catalog.json"))).rejects.toThrow();
  });
});
