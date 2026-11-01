// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import { assessBank } from "../question-content/assessBank";
import { resolveLibraryReader } from "./nativeInput";
import type { PreparedBank, PrivateLibraryCatalog } from "./types";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=", "base64"));
const row = (id = "example-1") => ({ id, bankId: "example", bankTitle: "Example export", course: "EXAMPLE", term: 1, week: null,
  question: "Which example is first?", a: "First", b: "Second", correctAnswer: "A", explanation: "",
  source: { filename: "Original.pdf", page: 9 }, questionType: "single_best_answer", flags: [], assets: [] });
async function fixture(rows: unknown[], extra: Array<[string, Uint8Array]> = []) {
  const original = encode(rows), files = new Map([["Wrapped/questions.json", original], ...extra]);
  const reads = new Map<string, number>();
  const read = await resolveLibraryReader([...files].map(([path, bytes]) => ({ path, byteSize: bytes.length })), async path => {
    reads.set(path, (reads.get(path) ?? 0) + 1);
    const bytes = files.get(path); if (!bytes) throw new Error(`Missing ${path}`); return bytes;
  });
  const catalog = decode(await read("catalog.json")) as PrivateLibraryCatalog;
  const banks: PreparedBank[] = [];
  for (const source of catalog.sources) if (source.bankFile) banks.push(decode(await read(source.bankFile)));
  return { read, catalog, banks, original, reads };
}
describe("flat question export preservation", () => {
  it("retains exact export bytes, unique records and candidate keys without inventing evidence", async () => {
    const raw = [{ ...row(), customSourceMetadata: { reviewWeeks: [1, 2] } }, row("example-2")];
    const { read, catalog, banks, original } = await fixture(raw);
    expect(await read(catalog.sources[0].originalFile!)).toEqual(original);
    const source = catalog.sources.find(source => source.bankFile)!;
    expect(decode(await read(source.originalFile!))).toEqual(raw);
    expect(await sha256(await read(source.originalFile!))).toBe(`sha256:${source.checksum}`);
    expect(source).toMatchObject({ ready: 0, review: 2 });
    expect(banks[0].pkg.questions.map(q => q.id)).toEqual(["example-1", "example-2"]);
    expect(banks[0].pkg.questions[0].correctAnswer).toEqual({ labels: ["A"] });
    expect(banks[0].pkg.questions[0].provenance.sourceChecksum).toBe(`sha256:${source.checksum}`);
    expect(banks[0].pkg.questions[0].provenance.notes).toContain("not the referenced PDF");
    expect(banks[0].pkg.questions[0].source.filename).toBe("Original.pdf");
    expect(banks[0].pkg.questions[0].week).toBe(0);
  });
  it("preserves explicit canonical evidence but never treats a legacy claim as reviewer approval", async () => {
    const { catalog } = await fixture([{ ...row(), answerEvidence: { type: "answered_source" } },
      { ...row("example-2"), correctAnswer: { labels: ["A"], evidence: "printed-key" } }]);
    expect(catalog.sources.find(source => source.bankFile)!).toMatchObject({ ready: 1, review: 1 });
  });
  it("lifts exact source-audit teaching fields without promoting human review", async () => {
    const sourceTeaching = {
      verifiedExistingAnswer: "A", whyCorrect: "A follows from the inspected source.",
      mechanism: "The source supplies one causal step.", highYieldPrinciple: "Carry the causal step forward.",
      distractors: [{ label: "B", option: "Second", explanation: "B reverses the relation." }],
      sourceReferences: [{ sourceId: "slides", pdfPages: [12], purpose: "Mechanism" }],
      factCheck: {
        status: "SOURCE_CHECKED", checkedOn: "2026-10-23", checkedBy: "Source comparison",
        humanReviewerApproved: false, answerChanged: false, limitations: [],
        answerKeyEvidence: { sourceId: "questions", pdfPage: 3, questionNumber: 1, printedAnswer: "A", method: "Rendered-page inspection" },
      },
    };
    const { banks } = await fixture([{ ...row(), correctAnswer: { labels: ["A"], evidence: "printed-key" }, ...sourceTeaching }]);
    expect(banks[0].pkg.questions[0].teaching).toMatchObject({
      version: 1, answerLabel: "A", highYieldRule: sourceTeaching.highYieldPrinciple,
      factCheck: { status: "SOURCE_CHECKED", humanReviewerApproved: false, answerChanged: false },
    });
  });
  it("accepts canonical teaching but never derives its answer label from correctAnswer", async () => {
    const canonical = {
      version: 1, answerLabel: "A", whyCorrect: "Why", mechanism: "How", highYieldRule: "Rule",
      distractors: [{ label: "B", explanation: "Why not" }], sourceReferences: [],
      factCheck: { status: "SOURCE_CHECKED", humanReviewerApproved: false, answerChanged: false, limitations: [] },
    };
    const { banks } = await fixture([
      { ...row(), correctAnswer: { labels: ["A"], evidence: "printed-key" }, teaching: canonical },
      { ...row("example-2"), correctAnswer: { labels: ["A"], evidence: "printed-key" },
        whyCorrect: "Why", mechanism: "How", highYieldPrinciple: "Rule", distractors: canonical.distractors,
        sourceReferences: [], factCheck: canonical.factCheck },
    ]);
    expect(banks[0].pkg.questions[0].teaching).toEqual(canonical);
    expect(banks[0].pkg.questions[1].teaching).toBeUndefined();
  });
  it.each(["H", "I"])("retains all nine lowercase choice fields and the source key %s", async (label) => {
    const labels = "ABCDEFGHI".split("");
    const choices = Object.fromEntries(labels.map(choice => [choice.toLowerCase(), `Source option ${choice}`]));
    const { banks, catalog } = await fixture([{ ...row(), ...choices, correctAnswer: { labels: [label], evidence: "printed-key" } }]);
    const question = banks[0].pkg.questions[0];
    expect(question.choices.map(choice => choice.label)).toEqual(labels);
    expect(question.choices.map(choice => choice.blocks)).toEqual(labels.map(choice => [{ type: "text", text: `Source option ${choice}` }]));
    expect(question.correctAnswer).toEqual({ labels: [label], evidence: "printed-key" });
    expect(catalog.sources.find(source => source.bankFile)!).toMatchObject({ ready: 1, review: 0 });
  });
  it("keeps structured stem once and maps explanation/reveal assets without exposing them in the stem", async () => {
    const asset = { id: "reveal", path: "assets/reveal.png", mimeType: "image/png", role: "answer_reveal", sha256: (await sha256(png)).slice(7) };
    const { banks, read, catalog } = await fixture([{ ...row(), assets: [asset], stem: [{ type: "text", text: "Structured text" }],
      explanationBlocks: [{ type: "image", assetId: "reveal", src: "assets/reveal.png", role: "answer_reveal", sourcePage: 10 }] }], [["Wrapped/assets/reveal.png", png]]);
    const q = banks[0].pkg.questions[0];
    expect(q.stem).toEqual([{ type: "text", text: "Structured text" }]);
    expect(q.assets[0]).toMatchObject({ role: "answer_reveal", width: 1, height: 1, questionId: q.id });
    expect(q.explanation).toEqual([{ type: "image", assetId: "reveal", role: "answer_reveal" }]);
    expect(await read(catalog.sources.find(source => source.bankFile)!.bankFile!.replace("bank.json", "assets/reveal.png"))).toEqual(png);
  });
  it("keeps missing keys unresolved and matching items out of single-answer scoring", async () => {
    const { banks } = await fixture([{ ...row(), correctAnswer: null }, { ...row("matching"), questionType: "matching", correctAnswer: { labels: ["A"], evidence: "printed-key" } }]);
    expect(assessBank(banks[0].pkg, banks[0].issues, []).counts).toEqual({ ready: 0, "needs-review": 0, unresolved: 2 });
  });
  it("preserves review flags and treats inferred filing as advisory", async () => {
    const { banks } = await fixture([{ ...row(), flags: ["ANSWER_UNVERIFIED", "WEEK_ASSIGNMENT_INFERRED"] }]);
    const verdict = assessBank(banks[0].pkg, banks[0].issues, []).verdicts.get("example-1")!;
    expect(verdict.readiness).toBe("needs-review");
    expect(verdict.reasons.join(" ")).toContain("ANSWER_UNVERIFIED");
    expect(verdict.advisories.join(" ")).toContain("inferred this week");
  });
  it("creates stable identities on repeat import and preserves separate bank IDs", async () => {
    const rows = [row(), { ...row("other-1"), bankId: "other", week: 3 }];
    const a = await fixture(rows), b = await fixture(rows);
    expect(a.catalog).toEqual(b.catalog);
    expect(a.banks.map(bank => bank.pkg.manifest.bank.id)).toEqual(["example", "other"]);
  });
  it("rejects duplicate IDs without removing a record", async () => { await expect(fixture([row(), row()])).rejects.toThrow(/unique/); });
  it("does not lose an unknown review hold when a key claims printed evidence", async () => {
    const { banks } = await fixture([{ ...row(), correctAnswer: { labels: ["A"], evidence: "printed-key" }, flags: [{ type: "SOURCE_RECHECK", message: "Ambiguous source" }] }]);
    expect(assessBank(banks[0].pkg, banks[0].issues, []).counts).toEqual({ ready: 0, "needs-review": 1, unresolved: 0 });
  });
  it("holds malformed flags, retains image ownership conflicts, and keeps structured aliases", async () => {
    const { banks } = await fixture([{ ...row(), correctAnswer: { labels: ["A"], evidence: "printed-key" },
      stemBlocks: [{ type: "text", text: "Full source detail" }], flags: [{ type: "answer_needs_review" }],
      assets: [{ id: "x", questionId: "different-question", path: "assets/x.png", role: "reference" }] }], [["Wrapped/assets/x.png", png]]);
    expect(banks[0].pkg.questions[0].stem).toEqual([{ type: "text", text: "Full source detail" }]);
    expect(banks[0].pkg.questions[0].assets[0].questionId).toBe("different-question");
    expect(assessBank(banks[0].pkg, banks[0].issues, [{ name: "x.png" }]).counts.ready).toBe(0);
  });
  it("rejects missing and mismatched image bytes", async () => {
    const input = { ...row(), assets: [{ id: "x", path: "assets/x.png", role: "stem", sha256: "0".repeat(64) }] };
    await expect(fixture([input])).rejects.toThrow(/Missing/);
    await expect(fixture([input], [["Wrapped/assets/x.png", png]])).rejects.toThrow(/recorded/);
  });
  it("rejects image path traversal and inconsistent scope", async () => {
    await expect(fixture([{ ...row(), assets: [{ id: "x", path: "assets/../x.png" }] }])).rejects.toThrow(/unsafe/);
    await expect(fixture([row(), { ...row("b"), term: 2 }])).rejects.toThrow(/inconsistent/);
  });
  it("preserves a shared figure with distinct canonical ownership and rejects conflicting aliases", async () => {
    const image = { id: "shared", path: "assets/shared.png", role: "stem" };
    const rows = ["first", "second"].map(id => ({ ...row(id), assets: [image], stem: [{ type: "text", text: id }, { type: "image", assetId: "shared" }] }));
    const { banks } = await fixture(rows, [["Wrapped/assets/shared.png", png]]);
    expect(banks[0].pkg.questions.map(q => q.assets[0].id)).toEqual(["first--shared", "second--shared"]);
    expect(banks[0].pkg.questions[1].stem[1]).toMatchObject({ assetId: "second--shared" });
    expect(assessBank(banks[0].pkg, banks[0].issues, [{ name: "shared.png" }]).counts.unresolved).toBe(0);
    await expect(fixture([rows[0], { ...rows[1], assets: [{ ...image, path: "assets/different.png" }] }])).rejects.toThrow(/conflicting files/);
  });
  it("reads a shared image once across banks without retaining separate source byte copies", async () => {
    const image = { id: "shared", path: "assets/shared.png", role: "reference", checksum: await sha256(png) };
    const { banks, reads } = await fixture([
      { ...row("first"), assets: [image] },
      { ...row("second"), bankId: "other", assets: [image] },
    ], [["Wrapped/assets/shared.png", png]]);
    expect(reads.get("Wrapped/assets/shared.png")).toBe(1);
    expect(banks).toHaveLength(2);
    for (const bank of banks) expect(bank.pkg.questions[0].assets[0]).toMatchObject({
      checksum: image.checksum, mimeType: "image/png", width: 1, height: 1, byteSize: png.length,
    });
  });
  it("rejects a conflicting checksum on a later declaration of the cached image", async () => {
    const image = { id: "shared", path: "assets/shared.png", role: "reference", checksum: await sha256(png) };
    await expect(fixture([
      { ...row("first"), assets: [image] },
      { ...row("second"), bankId: "other", assets: [{ ...image, checksum: `sha256:${"0".repeat(64)}` }] },
    ], [["Wrapped/assets/shared.png", png]])).rejects.toThrow(/recorded image metadata/);
  });
});
