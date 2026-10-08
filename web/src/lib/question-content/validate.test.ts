import { describe, expect, it } from "vitest";
import type { ImportPackage, PackageManifest, PackageQuestion, QuestionAsset } from "./package";
import { legacyQuestionFields } from "./legacyFields";
import { isRunnable, summarizePackage, validatePackage } from "./validate";

const manifest: PackageManifest = {
  schemaVersion: 1,
  course: { name: "EXAMPLE", term: 1, week: 3 },
  bank: { id: "example-bank", title: "Example bank", discipline: "Example" },
  source: { filename: "invented.pdf", sourceWeekDeclared: false, axomAssignedWeek: 3 },
  questionsFile: "questions.json",
  assetsDirectory: "assets/",
};

const asset = (id: string, over: Partial<QuestionAsset> = {}): QuestionAsset => ({
  id, filename: `${id}.png`, mimeType: "image/png", role: "stem", questionId: "q1", ...over,
});

const question = (over: Partial<PackageQuestion> = {}): PackageQuestion => ({
  id: "q1",
  source: { filename: "invented.pdf" },
  stem: [{ type: "text", text: "Stem." }],
  choices: [
    { id: "q1-a", label: "A", blocks: [{ type: "text", text: "one" }] },
    { id: "q1-b", label: "B", blocks: [{ type: "text", text: "two" }] },
  ],
  correctAnswer: { labels: ["A"] },
  explanation: [{ type: "text", text: "Because." }],
  assets: [],
  provenance: { method: "authored" },
  ...over,
});

const pack = (...questions: PackageQuestion[]): ImportPackage => ({ manifest, questions });
const codes = (pkg: ImportPackage, options = {}) => validatePackage(pkg, options).map((issue) => `${issue.severity}:${issue.code}`);

describe("checking a package", () => {
  it("has nothing to say about a complete question", () => {
    expect(validatePackage(pack(question()))).toEqual([]);
  });

  it("reports an answer key that is not a choice and leaves the key alone", () => {
    const pkg = pack(question({ correctAnswer: { labels: ["F"] } }));
    expect(codes(pkg)).toEqual(["error:answer_key_not_a_choice"]);
    expect(pkg.questions[0].correctAnswer).toEqual({ labels: ["F"] });
    expect(isRunnable("q1", validatePackage(pkg))).toBe(false);
  });

  it("notes a missing answer key and a missing explanation without blocking the question", () => {
    const pkg = pack(question({ correctAnswer: undefined, explanation: undefined }));
    expect(codes(pkg)).toEqual(["warning:missing_answer_key", "info:missing_explanation"]);
    expect(isRunnable("q1", validatePackage(pkg))).toBe(true);
  });

  it("does not say a missing explanation twice when the package already flags it", () => {
    const pkg = pack(question({ explanation: undefined, flags: [{ type: "missing_explanation", message: "None in the source." }] }));
    expect(codes(pkg)).toEqual(["info:missing_explanation"]);
  });

  it("stops a question whose stem image is not among its assets, or whose file is not in the package", () => {
    const placed = question({ stem: [{ type: "text", text: "See the diagram." }, { type: "image", assetId: "q1-img-1" }], assets: [asset("q1-img-1")] });
    expect(codes(pack(question({ stem: placed.stem })))).toEqual(["error:missing_required_media"]);
    expect(codes(pack(placed), { assetFiles: new Set<string>() })).toEqual(["error:missing_required_media"]);
    expect(codes(pack(placed), { assetFiles: new Set(["q1-img-1.png"]) })).toEqual([]);
  });

  it("only warns when it is an explanation image that is missing", () => {
    const pkg = pack(question({ explanation: [{ type: "image", assetId: "gone" }] }));
    expect(codes(pkg)).toEqual(["warning:asset_reference_broken"]);
  });

  it("asks where an image belongs when it is listed but placed nowhere", () => {
    const pkg = pack(question({ assets: [asset("q1-img-1")] }));
    expect(validatePackage(pkg)).toEqual([expect.objectContaining({ severity: "warning", code: "media_association_uncertain", path: "assets[q1-img-1]" })]);
  });

  it("expects an answer-marked copy to be held, not placed, and warns if it sits in the stem", () => {
    const held = pack(question({
      stem: [{ type: "image", assetId: "q1-img-1" }],
      assets: [asset("q1-img-1"), asset("q1-img-2", { role: "answer_reveal", revealOf: "q1-img-1" })],
    }));
    expect(codes(held)).toEqual(["info:answer_reveal_asset"]);
    const placed = pack(question({ stem: [{ type: "image", assetId: "q1-img-2" }], assets: [asset("q1-img-2", { role: "answer_reveal" })] }));
    expect(codes(placed)).toEqual(["info:answer_reveal_asset", "warning:answer_reveal_asset"]);
  });

  it("reports a reveal that points at an image the question does not have", () => {
    const pkg = pack(question({ assets: [asset("q1-img-2", { role: "answer_reveal", revealOf: "nowhere" })] }));
    expect(codes(pkg)).toContain("error:asset_reference_broken");
  });

  it("needs every choice to have content, from its own blocks or from the shared table", () => {
    const empty = pack(question({ choices: [{ id: "q1-a", label: "A", blocks: [] }, { id: "q1-b", label: "B", blocks: [] }] }));
    expect(codes(empty)).toEqual(["error:choices_incomplete", "error:choices_incomplete"]);
    const tabled = pack(question({
      choices: [{ id: "q1-a", label: "A", blocks: [] }, { id: "q1-b", label: "B", blocks: [] }],
      choiceTable: { type: "table", headers: ["Signal", "Hormone"], rowKeys: ["A", "B"], rows: [["↑", "↓"], ["↓", "↑"]] },
    }));
    expect(codes(tabled)).toEqual([]);
    expect(legacyQuestionFields(manifest, tabled.questions[0]).options).toEqual([
      { key: "A", text: "Signal ↑; Hormone ↓" },
      { key: "B", text: "Signal ↓; Hormone ↑" },
    ]);
  });

  it("will not let one asset id mean two pictures, or one id mean two questions", () => {
    const pkg = pack(
      question({ stem: [{ type: "image", assetId: "shared" }], assets: [asset("shared")] }),
      question({ id: "q2", stem: [{ type: "image", assetId: "shared" }], assets: [asset("shared", { questionId: "q2" })] }),
      question({ id: "q2" }),
    );
    expect(codes(pkg).filter((code) => code === "error:duplicate_id")).toHaveLength(2);
    expect(summarizePackage(pkg, validatePackage(pkg)).importable).toBe(false);
  });

  it("keeps both weeks and says so when a question disagrees with its bank", () => {
    expect(codes(pack(question({ week: 4 })))).toEqual(["warning:scope_mismatch"]);
  });

  it("carries a flag written in the package into the preview", () => {
    const pkg = pack(question({ flags: [{ type: "source_inconsistency", message: "Stem says 12, key says 21." }] }));
    expect(validatePackage(pkg)).toEqual([{ severity: "warning", code: "source_inconsistency", message: "Stem says 12, key says 21.", questionId: "q1" }]);
  });
});

describe("the plain-text reading", () => {
  it("gives every older part of AXOM the strings it has always read", () => {
    const fields = legacyQuestionFields(manifest, question({
      source: { filename: "invented.pdf", page: 5, questionNumber: 9 },
      stem: [{ type: "text", text: "Vignette." }, { type: "table", headers: ["Test", "Result"], rows: [["TSH", "0.2 μU/mL"]] }, { type: "text", text: "Prompt?" }],
    }));
    expect(fields).toEqual({
      stem: "Vignette.\n\nTest | Result\nTSH | 0.2 μU/mL\n\nPrompt?",
      options: [{ key: "A", text: "one" }, { key: "B", text: "two" }],
      correctKey: "A",
      explanation: "Because.",
      module: "EXAMPLE",
      week: 3,
      bank: "Example bank",
      questionNumber: 9,
      sourcePage: 5,
    });
  });

  it("leaves the key out when the source marks more than one answer", () => {
    expect(legacyQuestionFields(manifest, question({ correctAnswer: { labels: ["A", "B"] } }))).not.toHaveProperty("correctKey");
  });
});
