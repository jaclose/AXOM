// @vitest-environment jsdom
// A package, saved by the code every import is saved by, into the real
// workspace store: filed, linked to its pictures, read back, and not written
// twice. The content is the invented fixture.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getQuestionAttachmentBlob } from "../questionAttachments";
import { parsePackage } from "./packageJson";
import { closeWorkspace, importPackage, openEmptyWorkspace, reloadWorkspace, storedImageCount, workspaceOnDisk } from "./persistenceHarness.testing";
import type { ImportPackage, PackageIssue } from "./package";
import { packageToReviewedImport } from "./toReviewedImport";
import { validatePackage } from "./validate";

const folder = join(process.cwd(), "..", "fixtures", "qbank", "synthetic", "multimodal-shapes");

function invented(): { pkg: ImportPackage; issues: PackageIssue[]; files: File[] } {
  const parsed = parsePackage(readFileSync(join(folder, "manifest.json"), "utf8"), readFileSync(join(folder, "questions.json"), "utf8"));
  const names = readdirSync(join(folder, "assets")).filter((name) => name.endsWith(".png"));
  const pkg = parsed.package!;
  return {
    pkg,
    issues: [...parsed.issues, ...validatePackage(pkg, { assetFiles: new Set(names) })],
    files: names.map((name) => new File([new Uint8Array(readFileSync(join(folder, "assets", name)))], name, { type: "image/png" })),
  };
}

beforeEach(openEmptyWorkspace);
afterEach(closeWorkspace);

describe("a package through the canonical import", () => {
  it("offers only the ready questions, and says why each other one is held", () => {
    const { pkg, issues } = invented();
    const adapted = packageToReviewedImport(pkg, issues);
    expect(adapted.questionIds).toEqual(["syn-q01", "syn-q02", "syn-q03", "syn-q04", "syn-q05", "syn-q06", "syn-q07"]);
    expect(adapted.held).toEqual([{ questionId: "syn-q08", readiness: "needs-review", reasons: [expect.any(String)] }]);
    expect(adapted.request.scope).toEqual({ module: "EXAMPLE", week: 1 });
    expect(adapted.request.destination).toBe("set");
    expect(adapted.renumbered).toBe(false);
  });

  it("never offers a picture that gives the answer away as a picture of the question", () => {
    const { pkg, issues } = invented();
    const adapted = packageToReviewedImport(pkg, issues);
    expect(adapted.imageNames).toEqual(["syn-q03-curves.png", "syn-q04-micrograph.png", "syn-q07-field-left.png", "syn-q07-field-right.png"]);
    expect(adapted.withheldAssets.map((asset) => [asset.questionId, asset.filename, asset.role])).toEqual([["syn-q03", "syn-q03-curves-answer.png", "answer_reveal"]]);
  });

  it("takes a question that needs review only once a person has accepted it", () => {
    const { pkg, issues } = invented();
    const adapted = packageToReviewedImport(pkg, issues, { acknowledged: new Set(["syn-q08"]) });
    expect(adapted.held).toEqual([]);
    const draft = adapted.request.drafts[adapted.questionIds.indexOf("syn-q08")];
    expect(draft.reviewAcknowledged).toBe(true);
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  it("never takes a question with no key, accepted or not", () => {
    const { pkg, issues } = invented();
    const unkeyed = { ...pkg, questions: pkg.questions.map((question) => (question.id === "syn-q02" ? { ...question, correctAnswer: undefined, flags: [{ type: "answer_needs_review" as const, message: "The answer is only shown by a mark." }] } : question)) };
    const adapted = packageToReviewedImport(unkeyed, issues, { acknowledged: new Set(["syn-q02"]) });
    expect(adapted.questionIds).not.toContain("syn-q02");
    expect(adapted.held.find((entry) => entry.questionId === "syn-q02")?.readiness).toBe("needs-review");
  });

  it("numbers the questions in running order when the source's own numbers repeat, and keeps each one's place in its label", () => {
    const { pkg, issues } = invented();
    const twoSets = { ...pkg, questions: pkg.questions.slice(0, 4).map((question, index) => ({ ...question, source: { ...question.source, questionNumber: (index % 2) + 1, set: index < 2 ? 1 : 2 } })) };
    const adapted = packageToReviewedImport(twoSets, issues);
    expect(adapted.renumbered).toBe(true);
    expect(adapted.request.drafts.map((draft) => draft.questionNumber)).toEqual([1, 2, 3, 4]);
    expect(adapted.request.drafts[2].sourceLabel).toBe("invented.pdf, set 2, question 1");
  });

  it("saves the questions as one set, filed where the manifest says, with their pictures", async () => {
    const { pkg, issues, files } = invented();
    const { adapted, saved } = await importPackage(pkg, issues, files);
    expect(saved).toMatchObject({ ok: true, reused: false, images: { attached: 4, missing: 0, problems: [] } });
    if (!saved?.ok) return;

    const disk = await workspaceOnDisk();
    expect(disk.questionSets).toHaveLength(1);
    expect(disk.questionSets[0]).toMatchObject({ id: saved.setId, title: "Invented multimodal shapes", scope: { module: "EXAMPLE", week: 1 }, questionIds: saved.questionIds });
    expect(disk.questions).toHaveLength(7);
    expect(disk.documents).toHaveLength(0);
    for (const question of disk.questions) expect(question).toMatchObject({ module: "EXAMPLE", week: 1, setId: saved.setId, bank: "Invented multimodal shapes" });

    // Each saved question is the package question in the same place.
    const byId = new Map(disk.questions.map((question) => [question.id, question]));
    const savedOf = (packageId: string) => byId.get(saved.questionIds[adapted.questionIds.indexOf(packageId)])!;
    expect(savedOf("syn-q03").attachments?.map((attachment) => [attachment.fileName, attachment.role])).toEqual([["syn-q03-curves.png", "exhibit"]]);
    expect(savedOf("syn-q07").attachments?.map((attachment) => attachment.fileName)).toEqual(["syn-q07-field-left.png", "syn-q07-field-right.png"]);
    expect(savedOf("syn-q01").attachments ?? []).toEqual([]);
    expect(savedOf("syn-q01").correctKey).toBe(pkg.questions[0].correctAnswer!.labels[0]);

    // The picture bytes are in the vault, and the answer-reveal picture is not.
    expect(await storedImageCount()).toBe(4);
    const blob = await getQuestionAttachmentBlob(savedOf("syn-q03").attachments![0].blobKey);
    expect(blob?.byteSize).toBe(files.find((file) => file.name === "syn-q03-curves.png")!.size);
    expect(disk.questions.flatMap((question) => question.attachments ?? []).some((attachment) => /answer/.test(attachment.fileName))).toBe(false);
  });

  it("is all there after a reload", async () => {
    const { pkg, issues, files } = invented();
    const { saved } = await importPackage(pkg, issues, files);
    if (!saved?.ok) throw new Error("not saved");
    const before = await workspaceOnDisk();
    const after = await reloadWorkspace();
    expect(after.questions.map((question) => question.id).sort()).toEqual([...saved.questionIds].sort());
    expect(after.questionSets.map((set) => [set.id, set.scope, set.questionIds])).toEqual([[saved.setId, { module: "EXAMPLE", week: 1 }, saved.questionIds]]);
    expect(after.questions.map((question) => [question.id, question.stem, question.correctKey, question.attachments?.length ?? 0]).sort())
      .toEqual(before.questions.map((question) => [question.id, question.stem, question.correctKey, question.attachments?.length ?? 0]).sort());
  });

  it("writes nothing the second time", async () => {
    const { pkg, issues, files } = invented();
    const first = await importPackage(pkg, issues, files);
    const again = await importPackage(pkg, issues, files);
    expect(again.saved).toMatchObject({ ok: true, reused: true });
    if (!first.saved?.ok || !again.saved?.ok) return;
    expect(again.saved.setId).toBe(first.saved.setId);
    expect(again.saved.questionIds).toEqual(first.saved.questionIds);
    const disk = await workspaceOnDisk();
    expect([disk.questions.length, disk.questionSets.length, disk.documents.length, await storedImageCount()]).toEqual([7, 1, 0, 4]);

    // And after a reload, still once.
    await reloadWorkspace();
    const third = await importPackage(pkg, issues, files);
    expect(third.saved).toMatchObject({ ok: true, reused: true });
    expect((await workspaceOnDisk()).questions).toHaveLength(7);
  });
});
