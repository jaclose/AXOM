// @vitest-environment node
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPreparedUploadExplanations } from "../src/lib/academicLibrary/explanationReview";
import { planPublication, publicationJobs, readPublicationInventory } from "../src/lib/academicLibrary/publication";
import type { PackageQuestion } from "../src/lib/question-content/package";
import type { PreparedBank, PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";
import { createApprovalTemplate, createApprovedOnlyLibrary, type ApprovalDecisions } from "./approved-only-library";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const execFile = promisify(execFileCallback);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(options: { image?: boolean; explanation?: string; week?: number; duplicateSource?: boolean;
  duplicateLinkedCount?: number; uniqueLinkedId?: boolean; privateBankPath?: boolean; privateToolPath?: boolean;
  metadataPath?: "manifest" | "question" | "asset"; metadataTitle?: string; manifestPaths?: boolean;
  imageMetadataPath?: "stem-alt" | "choice-caption" | "explanation-caption"; disguisedPdf?: boolean;
  wrappedPdf?: boolean; trailingImageBytes?: boolean; tableCaptionPath?: boolean;
  mutateReady?: (question: PackageQuestion) => void } = {}) {
  const work = await mkdtemp(join(tmpdir(), "axom-approved-test-")); roots.push(work);
  const root = join(work, "prepared"); await mkdir(root);
  const original = Buffer.from("%PDF-1.4 synthetic fixture only");
  const checksum = sha(original);
  const bankFile = options.privateBankPath ? "private/operator-course/bank.json" : `banks/${checksum}/bank.json`;
  const originalFile = `sources/${checksum}.pdf`;
  const imageBytes = options.disguisedPdf ? Buffer.from("%PDF-1.4 synthetic source disguised as PNG")
    : options.wrappedPdf ? Buffer.concat([png, Buffer.from("%PDF-1.4 synthetic source appended to PNG")])
      : options.trailingImageBytes ? Buffer.concat([png, Buffer.from("synthetic trailing bytes")]) : png;
  const asset = { id: "synthetic-figure", filename: "synthetic-figure.png", mimeType: "image/png", width: 1, height: 1,
    byteSize: imageBytes.length, sourceFile: "synthetic.pdf", sourcePage: 1, role: "stem" as const, questionId: "q-ready",
    checksum: `sha256:${sha(imageBytes)}`, derivation: "embedded" as const,
    ...(options.metadataPath === "asset" ? { revealOf: "file:///Users/tester/private.png" } : {}) };
  const imageBlock = { type: "image" as const, assetId: asset.id, role: "stem" as const,
    ...(options.imageMetadataPath === "stem-alt" ? { alt: "Source [/Users/tester/private/figure.png]" } : {}) };
  const question: PackageQuestion = {
    id: "q-ready", source: { filename: "synthetic.pdf", page: 1, questionNumber: 1 },
    ...(options.week ? { week: options.week } : {}),
    stem: [{ type: "text", text: "Which synthetic choice is named?" },
      ...(options.image ? [imageBlock] : []),
      ...(options.tableCaptionPath ? [{ type: "table" as const, caption: "Source [/Users/tester/private/table.csv]",
        rows: [["Synthetic", "value"]] }] : [])],
    choices: [
      { id: "a", label: "A", blocks: [{ type: "text", text: "First synthetic choice" },
        ...(options.imageMetadataPath === "choice-caption" ? [{ type: "image" as const, assetId: asset.id,
          caption: "Source,/Volumes/TestDisk/private/figure.png" }] : [])] },
      { id: "b", label: "B", blocks: [{ type: "text", text: "Second synthetic choice" }] },
    ], correctAnswer: { labels: ["A"], evidence: "printed-key" },
    explanation: options.explanation === "" ? [] : [{ type: "text", text: options.explanation ?? "The synthetic source states that the first choice is correct for this invented fixture." },
      ...(options.imageMetadataPath === "explanation-caption" ? [{ type: "image" as const, assetId: asset.id,
        caption: "Source;file:///Users/tester/private/figure.png" }] : [])],
    ...(options.metadataPath === "question" ? { topic: "/Users/tester/private/topic" } : {}),
    assets: options.image ? [asset] : [], provenance: { method: "authored", sourceChecksum: `sha256:${checksum}`,
      notes: "PRIVATE LOCAL NOTE", ...(options.privateToolPath ? { tool: "/Users/tester/private/parser" } : {}) },
  };
  options.mutateReady?.(question);
  const held: PackageQuestion = { ...structuredClone(question), id: "q-held", source: { filename: "synthetic.pdf", page: 2, questionNumber: 2 },
    correctAnswer: undefined, explanation: undefined, stem: [{ type: "text", text: "PRIVATE HELD STEM" }], assets: [] };
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "FTM 1", term: 1, week: options.week ?? 0 },
    bank: { id: "synthetic-bank", title: options.metadataTitle ?? (options.metadataPath === "manifest" ? "file:///Users/tester/private/source" : "Synthetic source"), discipline: "Example" },
    source: { filename: "synthetic.pdf", sourceWeekDeclared: false,
      ...(options.week ? { axomAssignedWeek: options.week } : {}) },
    questionsFile: options.manifestPaths ? "/Users/tester/private/questions.json" : "questions.json",
    assetsDirectory: options.manifestPaths ? "file:///Users/tester/private/assets" : "assets" },
    questions: [question, held] }, issues: [], sourceText: { rawText: "PRIVATE RAW TEXT", pageTexts: ["PRIVATE PAGE TEXT"] },
    sourceBytes: original.length, notes: ["PRIVATE BANK NOTE"] };
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: "synthetic-library", version: "synthetic-v1",
    templates: [{ file: "templates/private-plan.txt", name: "private-plan.txt", checksum: sha("PRIVATE PLAN") }],
    sources: [{ id: `source-${checksum}`, name: "synthetic.pdf", sourcePath: "PRIVATE/FOLDER/synthetic.pdf", checksum,
      module: "FTM 1", status: "prepared", reason: "Synthetic", bankFile, originalFile, ready: 1, review: 1 }] };
  async function put(path: string, bytes: Uint8Array | string) {
    const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
  await put(originalFile, original); await put(bankFile, JSON.stringify(bank));
  if (options.duplicateSource) {
    const otherOriginal = Buffer.from("%PDF-1.4 second synthetic fixture");
    const otherChecksum = sha(otherOriginal);
    const otherFile = `banks/${otherChecksum}/bank.json`;
    const repeated = structuredClone(question);
    repeated.id = "q-repeated-appearance";
    repeated.source = { filename: "synthetic-two.pdf", page: 1, questionNumber: 1 };
    repeated.provenance.sourceChecksum = `sha256:${otherChecksum}`;
    const otherBank = structuredClone(bank);
    otherBank.pkg.manifest.bank.id = "synthetic-bank-two";
    otherBank.pkg.manifest.source.filename = "synthetic-two.pdf";
    otherBank.pkg.questions = [repeated];
    await put(`sources/${otherChecksum}.pdf`, otherOriginal);
    await put(otherFile, JSON.stringify(otherBank));
    catalog.sources.push({ id: `source-${otherChecksum}`, name: "synthetic-two.pdf", sourcePath: "PRIVATE/OTHER/synthetic-two.pdf",
      checksum: otherChecksum, module: "FTM 1", status: "prepared", reason: "Synthetic repeated source",
      bankFile: otherFile, originalFile: `sources/${otherChecksum}.pdf`, ready: 1, review: 0 });
  }
  for (let index = 0; index < (options.duplicateLinkedCount ?? 0); index++) {
    catalog.sources.push({ id: options.uniqueLinkedId ? `duplicate-${index}-${checksum}` : `source-${checksum}`,
      name: `synthetic-copy-${index}.pdf`, sourcePath: `PRIVATE/COPY-${index}/synthetic.pdf`, checksum,
      module: "FTM 1", status: "duplicate-linked", reason: "Identical synthetic bytes",
      duplicateOf: "PRIVATE/FOLDER/synthetic.pdf", ready: 0, review: 0 });
  }
  await put("templates/private-plan.txt", "PRIVATE PLAN");
  await put(`${dirname(bankFile)}/assets/held.png`, png);
  if (options.image) await put(`${dirname(bankFile)}/assets/${asset.filename}`, imageBytes);
  await put("catalog.json", JSON.stringify(catalog));
  const decisions = join(work, "decisions.json");
  await createApprovalTemplate(root, decisions);
  const payload = JSON.parse(await readFile(decisions, "utf8")) as ApprovalDecisions;
  const approved = payload.records.find(row => row.questionId === "q-ready")!;
  approved.status = "approved"; approved.sourceChecked = true; approved.filingChecked = true; approved.clinicalChecked = true;
  approved.explanationChecked = true; approved.assetContentChecked = options.image ?? false;
  approved.rightsStatus = "cleared"; approved.rightsEvidence = "Synthetic fixture owned for this test";
  approved.reviewer = "Synthetic reviewer"; approved.reviewedAt = "2026-11-02T00:00:00.000Z";
  await writeFile(decisions, JSON.stringify(payload));
  return { work, root, bank, catalog, decisions, payload, output: join(work, "approved") };
}

async function appendSyntheticBank(root: string, catalog: PrivateLibraryCatalog, template: PreparedBank,
  index: number, blocked: boolean) {
  const original = Buffer.from(JSON.stringify({ syntheticSource: index }));
  const checksum = sha(original);
  const sourceName = `synthetic-${index}.json`;
  const catalogName = blocked ? `review-${index}.json` : sourceName;
  const originalFile = `sources/${checksum}.json`;
  const bankFile = `banks/${checksum}/bank.json`;
  const bank = structuredClone(template);
  bank.pkg.manifest.bank.id = `synthetic-bank-${index}`;
  bank.pkg.manifest.source.filename = sourceName;
  for (const question of bank.pkg.questions) {
    question.source.filename = sourceName;
    question.provenance.sourceChecksum = `sha256:${checksum}`;
  }
  catalog.sources.push({ id: `source-${checksum}`, name: catalogName, sourcePath: `PRIVATE/SYNTHETIC/${catalogName}`,
    checksum, module: "FTM 1", status: "prepared", reason: "Synthetic source binding fixture",
    bankFile, originalFile, ready: 1, review: 1 });
  for (const [path, bytes] of [[originalFile, original], [bankFile, Buffer.from(JSON.stringify(bank))]] as const) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}

function syntheticTeaching(): NonNullable<PackageQuestion["teaching"]> {
  return { version: 1, answerLabel: "A", whyCorrect: "The invented first option matches the synthetic source.",
    mechanism: "The synthetic mechanism follows from the invented finding.",
    highYieldRule: "Use the reviewed source relationship for this synthetic case.",
    distractors: [{ label: "B", option: "Second synthetic choice", explanation: "The second choice does not match." }],
    sourceReferences: [], factCheck: { status: "SOURCE_CHECKED", humanReviewerApproved: false,
      answerChanged: false, limitations: [], supportingExcerpts: [] } };
}

describe("approved-only private candidate", () => {
  it("exports only explicit approval and passes the existing publisher without raw source content", async () => {
    const { root, output, decisions } = await fixture({ privateToolPath: true });
    expect(await createApprovedOnlyLibrary(root, decisions, output)).toMatchObject({ sources: 1, ready: 1, held: 0 });
    const library = join(output, "library");
    const catalog = JSON.parse(await readFile(join(library, "catalog.json"), "utf8")) as PrivateLibraryCatalog;
    expect(catalog.templates).toEqual([]);
    expect(catalog.sources[0]).toMatchObject({ ready: 1, review: 0 });
    expect(catalog.sources[0].originalFile).toBeUndefined();
    expect(catalog.sources[0].sourcePath).not.toContain("PRIVATE");
    const bank = JSON.parse(await readFile(join(library, catalog.sources[0].bankFile!), "utf8")) as PreparedBank;
    expect(bank.pkg.questions.map(question => question.id)).toEqual(["q-ready"]);
    expect(bank.sourceText).toEqual({ rawText: "" });
    expect(bank.notes).toEqual([]);
    expect(bank.pkg.questions[0].provenance.notes).toBeUndefined();
    expect(bank.pkg.questions[0].provenance.tool).toBeUndefined();
    expect(await readdir(join(library, "banks", catalog.sources[0].checksum))).toEqual(["bank.json"]);
    expect((await readFile(join(library, catalog.sources[0].bankFile!), "utf8"))).not.toMatch(/PRIVATE|q-held|\/Users\/tester/);
    const receipt = await readFile(join(output, "private-receipt.json"), "utf8");
    expect(JSON.parse(receipt)).toMatchObject({ approvedQuestions: 1, heldQuestionsIncluded: 0 });
    expect(receipt).not.toMatch(/PRIVATE|synthetic stem|sourcePath/);
    const read = async (path: string) => new Uint8Array(await readFile(join(library, path)));
    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory);
    expect(plan.courses).toHaveLength(1);
    expect(plan.courses[0]).toMatchObject({ term: "Term 1", module: "FTM 1", ready: 1, review: 0 });
    const { jobs } = publicationJobs(read, inventory, plan.courses);
    const upload = await jobs[0].prepare();
    expect(await inspectPreparedUploadExplanations(upload)).toEqual({ readyQuestions: 1, explainedReadyQuestions: 1, missingExplanations: 0 });
    expect(upload.files.some(file => file.path.includes("receipt"))).toBe(false);
    const archive = join(output, "..", "approved.zip");
    await execFile(process.execPath, [resolve(process.cwd(), "scripts/package-private-library.mjs"), library, archive]);
    const zip = await JSZip.loadAsync(await readFile(archive));
    expect(Object.keys(zip.files)).not.toContain("private-receipt.json");
  });

  it("copies only checked embedded figures and excludes unrelated asset files", async () => {
    const { root, output, decisions, catalog } = await fixture({ image: true });
    await createApprovedOnlyLibrary(root, decisions, output);
    const assets = join(output, "library", "banks", catalog.sources[0].checksum, "assets");
    expect(await readdir(assets)).toEqual(["synthetic-figure.png"]);
    expect(sha(await readFile(join(assets, "synthetic-figure.png")))).toBe(sha(png));
  });

  it("rejects a PDF renamed as an approved PNG even when its checksum matches", async () => {
    const { root, output, decisions } = await fixture({ image: true, disguisedPdf: true });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/not the declared, supported image bytes/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects a PDF appended after a valid PNG even when its checksum matches", async () => {
    const { root, output, decisions } = await fixture({ image: true, wrappedPdf: true });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/contains PDF source bytes/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects trailing bytes after a PNG image container", async () => {
    const { root, output, decisions } = await fixture({ image: true, trailingImageBytes: true });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/incomplete image structure or trailing bytes/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("uses content-addressed public paths even when the private bank path contains a folder name", async () => {
    const { root, output, decisions, catalog } = await fixture({ image: true, privateBankPath: true, manifestPaths: true });
    await createApprovedOnlyLibrary(root, decisions, output);
    const publicCatalog = JSON.parse(await readFile(join(output, "library", "catalog.json"), "utf8")) as PrivateLibraryCatalog;
    expect(publicCatalog.sources[0].bankFile).toBe(`banks/${catalog.sources[0].checksum}/bank.json`);
    expect(await readdir(join(output, "library", "banks", catalog.sources[0].checksum, "assets"))).toEqual(["synthetic-figure.png"]);
    expect((await readFile(join(output, "library", "catalog.json"), "utf8"))).not.toContain("operator-course");
    const publicBank = JSON.parse(await readFile(join(output, "library", publicCatalog.sources[0].bankFile!), "utf8")) as PreparedBank;
    expect(publicBank.pkg.manifest.questionsFile).toBe("questions.json");
    expect(publicBank.pkg.manifest.assetsDirectory).toBe("assets");
    expect(JSON.stringify(publicBank)).not.toContain("/Users/tester/private");
  });

  it.each(["manifest", "question", "asset"] as const)("rejects local paths in %s metadata", async metadataPath => {
    const { root, output, decisions } = await fixture({ image: metadataPath === "asset", metadataPath });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it.each([
    "Source [/Users/tester/private/file.pdf]",
    "Source,/Volumes/TestDisk/private/file.pdf",
    "Source:/opt/private/file.pdf",
    "Source;/tmp/private/file.pdf",
  ])("rejects a punctuation-boundary absolute path in a title", async metadataTitle => {
    const { root, output, decisions } = await fixture({ metadataTitle });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible bank title/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("allows a normal URL and clinical slash notation in a title", async () => {
    const { root, output, decisions } = await fixture({ metadataTitle: "AXOM https://example.org/course/module FEV1/FVC 2/3" });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).resolves.toMatchObject({ ready: 1 });
  });

  const privateContentCases: Array<[string, (question: PackageQuestion) => void]> = [
    ["stem text", question => { question.stem[0] = { type: "text", text: "Read /private/course/stem.txt" }; }],
    ["choice rich text", question => { question.choices[0].blocks.push({ type: "rich_text", html: "<b>See /private/course/choice.txt</b>" }); }],
    ["encoded rich text", question => { question.choices[0].blocks.push({ type: "rich_text", html: "<b>See &#47;private&#47;course&#47;choice.txt</b>" }); }],
    ["encoded file URL", question => { question.choices[0].blocks.push({ type: "rich_text", html: "<b>See file&#58;&#47;&#47;&#47;Users&#47;tester&#47;choice.txt</b>" }); }],
    ["explanation callout", question => { question.explanation?.push({ type: "callout", text: "See /private/course/explanation.txt" }); }],
    ["table header", question => { question.stem.push({ type: "table", headers: ["/private/course/header.csv"], rows: [["Synthetic"]] }); }],
    ["table cell", question => { question.stem.push({ type: "table", rows: [["/private/course/cell.csv"]] }); }],
    ["equation text", question => { question.stem.push({ type: "equation", latex: "\\includegraphics{/private/course/plot.png}" }); }],
    ["teaching explanation", question => { question.teaching = { ...syntheticTeaching(), whyCorrect: "See /private/course/teaching.txt" }; }],
    ["teaching distractor", question => { question.teaching = syntheticTeaching(); question.teaching.distractors[0].explanation = "See /private/course/distractor.txt"; }],
    ["teaching excerpt", question => { question.teaching = syntheticTeaching(); question.teaching.factCheck.supportingExcerpts = [
      { sourceId: "synthetic-source", pdfPage: 1, excerpt: "See /private/course/excerpt.txt" }]; }],
  ];
  it.each(privateContentCases)("rejects a local path in %s", async (_, mutateReady) => {
    const { root, output, decisions } = await fixture({ mutateReady });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible question/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it.each([
    "../private/file.pdf", "./private/file.pdf", "~/Documents/file.pdf",
    "file:///Users/tester/private/file.pdf", "C:\\Private\\file.pdf", "\\\\server\\share\\file.pdf",
  ])("rejects a local path form in question text: %s", async path => {
    const { root, output, decisions } = await fixture({ mutateReady: question => {
      question.stem[0] = { type: "text", text: `See ${path}` };
    } });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible question/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("allows a normal source link and clinical slash notation in question text", async () => {
    const { root, output, decisions } = await fixture({ mutateReady: question => {
      question.stem[0] = { type: "text", text: "Review https://example.org/source.pdf#page=4 and FEV1/FVC 2/3." };
      question.explanation = [{ type: "text", text: "The synthetic source explains the invented first choice at https://example.org/source.pdf#page=4." }];
    } });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).resolves.toMatchObject({ ready: 1 });
  });

  it.each(["stem-alt", "choice-caption", "explanation-caption"] as const)("rejects local paths in %s image metadata", async imageMetadataPath => {
    const { root, output, decisions } = await fixture({ image: true, imageMetadataPath });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible image (alt|caption)/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects a local path in a table caption", async () => {
    const { root, output, decisions } = await fixture({ tableCaptionPath: true });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/member-visible table caption/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects stale answers and missing review evidence before writing output", async () => {
    const { root, output, decisions, payload } = await fixture();
    const approved = payload.records.find(row => row.questionId === "q-ready")!;
    const originalAnswerSha = approved.answerSha256;
    approved.answerSha256 = "0".repeat(64);
    await writeFile(decisions, JSON.stringify(payload));
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/no longer matches/);
    approved.answerSha256 = originalAnswerSha;
    approved.rightsStatus = "pending";
    await writeFile(decisions, JSON.stringify(payload));
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/lacks source, clinical, explanation, or rights/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects a question without a substantive explanation", async () => {
    const { root, output, decisions } = await fixture({ explanation: "" });
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/substantive/);
  });

  it("unassigns positive source and question weeks while retaining review notes privately", async () => {
    const { root, output, decisions, payload, catalog } = await fixture({ week: 3 });
    const approved = payload.records.find(row => row.questionId === "q-ready")!;
    approved.weekChecked = true; approved.weekEvidence = "Synthetic source page labels week three";
    await writeFile(decisions, JSON.stringify(payload));
    await createApprovedOnlyLibrary(root, decisions, output);
    const bank = JSON.parse(await readFile(join(output, "library", catalog.sources[0].bankFile!), "utf8")) as PreparedBank;
    expect(bank.pkg.manifest.course.week).toBe(0);
    expect(bank.pkg.manifest.source.axomAssignedWeek).toBeUndefined();
    expect(bank.pkg.manifest.source.sourceWeekDeclared).toBe(false);
    expect(bank.pkg.questions[0].week).toBe(0);
    expect((await readFile(join(output, "library", catalog.sources[0].bankFile!), "utf8"))).not.toContain(approved.weekEvidence);
    const receipt = await readFile(join(output, "private-receipt.json"), "utf8");
    expect(receipt).toContain(approved.weekEvidence);
  });

  it("records a mismatched catalog source name in a private blocker receipt", async () => {
    const { root, work, catalog } = await fixture();
    catalog.sources[0].name = "other.pdf";
    await writeFile(join(root, "catalog.json"), JSON.stringify(catalog));
    const decisions = join(work, "new-decisions.json");
    await expect(createApprovalTemplate(root, decisions)).resolves.toMatchObject({ records: 0, blockedSources: 1 });
    const receipt = JSON.parse(await readFile(`${decisions}.blocked-sources.json`, "utf8"));
    expect(receipt.blockedSources).toMatchObject([{ sourceId: catalog.sources[0].id, reason: "A bank names a different catalog source file." }]);
  });

  it("emits pending decisions for 857 valid banks and separately binds two source-identity blockers", async () => {
    const { root, work, bank, catalog, output } = await fixture();
    for (let index = 1; index <= 858; index++) await appendSyntheticBank(root, catalog, bank, index, index > 856);
    const catalogBytes = JSON.stringify(catalog);
    await writeFile(join(root, "catalog.json"), catalogBytes);
    const decisionsFile = join(work, "partial-decisions.json");
    await expect(createApprovalTemplate(root, decisionsFile)).resolves.toMatchObject({ records: 857 * 2, blockedSources: 2 });
    const decisions = JSON.parse(await readFile(decisionsFile, "utf8")) as ApprovalDecisions;
    const receiptBytes = await readFile(`${decisionsFile}.blocked-sources.json`);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    expect(decisions.catalogSha256).toBe(sha(catalogBytes));
    expect(decisions.blockedSourcesReceiptSha256).toBe(sha(receiptBytes));
    expect(decisions.records).toHaveLength(857 * 2);
    expect(decisions.records.every(row => row.status === "pending" && row.rightsStatus === "pending"
      && !row.sourceChecked && !row.filingChecked && !row.weekChecked && !row.clinicalChecked
      && !row.explanationChecked && !row.assetContentChecked && !row.weekEvidence && !row.rightsEvidence
      && !row.reviewer && !row.reviewedAt)).toBe(true);
    expect(receipt).toMatchObject({ format: "axom-approved-template-blockers", catalogSha256: sha(catalogBytes) });
    expect(receipt.blockedSources).toHaveLength(2);
    expect(receipt.blockedSources.every((row: { sourceChecksum: string; bankSha256: string; reason: string }) =>
      /^[a-f0-9]{64}$/.test(row.sourceChecksum) && /^[a-f0-9]{64}$/.test(row.bankSha256)
      && /different catalog source/.test(row.reason))).toBe(true);
    await expect(readdir(output)).rejects.toThrow();
  }, 30_000);

  it("rejects blocked-source decisions and stale catalog, decision, or blocker receipt", async () => {
    const { root, work, bank, catalog, payload, output } = await fixture();
    await appendSyntheticBank(root, catalog, bank, 1, true);
    await appendSyntheticBank(root, catalog, bank, 2, true);
    const catalogBytes = JSON.stringify(catalog);
    await writeFile(join(root, "catalog.json"), catalogBytes);
    const decisionsFile = join(work, "partial-decisions.json");
    await createApprovalTemplate(root, decisionsFile);
    const decisions = JSON.parse(await readFile(decisionsFile, "utf8")) as ApprovalDecisions;
    const receiptFile = `${decisionsFile}.blocked-sources.json`;
    const receiptBytes = await readFile(receiptFile);
    decisions.records.push({ ...decisions.records[0], sourceId: catalog.sources[1].id });
    await writeFile(decisionsFile, JSON.stringify(decisions));
    await expect(createApprovedOnlyLibrary(root, decisionsFile, output)).rejects.toThrow(/unresolved source identity/);
    decisions.records.pop();
    catalog.version = "changed-catalog";
    await writeFile(join(root, "catalog.json"), JSON.stringify(catalog));
    await writeFile(decisionsFile, JSON.stringify(decisions));
    await expect(createApprovedOnlyLibrary(root, decisionsFile, output)).rejects.toThrow(/catalog changed since review/);
    catalog.version = "synthetic-v1";
    await writeFile(join(root, "catalog.json"), catalogBytes);
    const approved = payload.records.find(row => row.questionId === "q-ready")!;
    Object.assign(decisions.records.find(row => row.questionId === "q-ready")!, approved, { answerSha256: "0".repeat(64) });
    await writeFile(decisionsFile, JSON.stringify(decisions));
    await expect(createApprovedOnlyLibrary(root, decisionsFile, output)).rejects.toThrow(/no longer matches/);
    decisions.records.find(row => row.questionId === "q-ready")!.answerSha256 = approved.answerSha256;
    await writeFile(decisionsFile, JSON.stringify(decisions));
    await writeFile(receiptFile, `${receiptBytes.toString("utf8")} `);
    await expect(createApprovedOnlyLibrary(root, decisionsFile, output)).rejects.toThrow(/blocked-source receipt changed/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it.each([1, 2])("uses one canonical bank when %i same-ID duplicate-linked copies are present", async copies => {
    const { root, output, decisions, payload, catalog } = await fixture({ duplicateLinkedCount: copies });
    expect(catalog.sources).toHaveLength(copies + 1);
    expect(payload.records).toHaveLength(2);
    await expect(createApprovedOnlyLibrary(root, decisions, output)).resolves.toMatchObject({ sources: 1, ready: 1 });
    const publicCatalog = JSON.parse(await readFile(join(output, "library", "catalog.json"), "utf8")) as PrivateLibraryCatalog;
    expect(publicCatalog.sources).toHaveLength(1);
  });

  it("rejects a decision naming a duplicate-linked row", async () => {
    const { root, output, decisions, payload, catalog } = await fixture({ duplicateLinkedCount: 1, uniqueLinkedId: true });
    expect(payload.records).toHaveLength(2);
    payload.records.push({ ...payload.records[0], sourceId: catalog.sources[1].id });
    await writeFile(decisions, JSON.stringify(payload));
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/duplicate-linked source/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects an exact repeated appearance even when both source rows were approved", async () => {
    const { root, output, decisions, payload } = await fixture({ duplicateSource: true });
    const approved = payload.records.find(row => row.questionId === "q-ready")!;
    const repeated = payload.records.find(row => row.questionId === "q-repeated-appearance")!;
    Object.assign(repeated, { status: approved.status, sourceChecked: approved.sourceChecked,
      filingChecked: approved.filingChecked, clinicalChecked: approved.clinicalChecked,
      explanationChecked: approved.explanationChecked, rightsStatus: approved.rightsStatus,
      rightsEvidence: approved.rightsEvidence, reviewer: approved.reviewer, reviewedAt: approved.reviewedAt });
    await writeFile(decisions, JSON.stringify(payload));
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/repeated across source banks/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it.each(["ID", "checksum"])("rejects a collision between active bank source %s values", async collision => {
    const { root, work, output, decisions, payload, catalog } = await fixture();
    const source = catalog.sources[0];
    catalog.sources.push({ ...source, id: collision === "ID" ? source.id : "other-active-source",
      checksum: collision === "checksum" ? source.checksum : "e".repeat(64),
      bankFile: "alternate/bank.json", sourcePath: "PRIVATE/OTHER/synthetic.pdf" });
    const updatedCatalog = JSON.stringify(catalog);
    await writeFile(join(root, "catalog.json"), updatedCatalog);
    await expect(createApprovalTemplate(root, join(work, "collision-decisions.json")))
      .rejects.toThrow(new RegExp(`duplicate active source ${collision === "ID" ? "IDs" : "checksums"}`));
    payload.catalogSha256 = sha(updatedCatalog);
    await writeFile(decisions, JSON.stringify(payload));
    await expect(createApprovedOnlyLibrary(root, decisions, output))
      .rejects.toThrow(new RegExp(`duplicate active source ${collision === "ID" ? "IDs" : "checksums"}`));
    await expect(readdir(output)).rejects.toThrow();
  });

  it("keeps the final candidate absent when the private receipt write fails", async () => {
    const { root, output, decisions } = await fixture();
    await expect(createApprovedOnlyLibrary(root, decisions, output, {
      writePrivateReceipt: async () => { throw new Error("synthetic receipt failure"); },
    })).rejects.toThrow(/synthetic receipt failure/);
    await expect(readdir(output)).rejects.toThrow();
  });

  it("does not publish a candidate if a receipt writer silently writes nothing", async () => {
    const { root, output, decisions } = await fixture();
    await expect(createApprovedOnlyLibrary(root, decisions, output, {
      writePrivateReceipt: async () => {},
    })).rejects.toThrow();
    await expect(readdir(output)).rejects.toThrow();
  });

  it("rejects the original unanswered 17-question review format explicitly", async () => {
    const { root, output, decisions } = await fixture();
    await writeFile(decisions, JSON.stringify({ format: "axom-private-inline-rationale-decisions", schemaVersion: 1, records: [] }));
    await expect(createApprovedOnlyLibrary(root, decisions, output)).rejects.toThrow(/original unanswered questions/);
  });

  it("refuses a private output inside the repository", async () => {
    const { root, decisions } = await fixture();
    await expect(createApprovedOnlyLibrary(root, decisions, join(process.cwd(), "private-output"))).rejects.toThrow(/outside every repository/);
  });

  it("resolves a destination symlink before checking overlap with the prepared library", async () => {
    const { work, root, decisions } = await fixture();
    const alias = join(work, "library-alias");
    await symlink(root, alias);
    await expect(createApprovalTemplate(root, join(alias, "new-decisions.json"))).rejects.toThrow(/outside the prepared library/);
    await expect(createApprovedOnlyLibrary(root, decisions, join(alias, "approved"))).rejects.toThrow(/separate from the prepared library/);
    await expect(readdir(join(root, "approved"))).rejects.toThrow();
  });
});
