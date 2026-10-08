// The committed fixtures: the invented bank, the three Term 5 GOER Week 2
// manifests, and the DOCX template. Real course material is never committed;
// where a real bank has been built on this machine it is checked too, and only
// counts are printed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM } from "../curricula";
import { blockShape } from "./blocks";
import { DOCX_MARKERS } from "./docx/markers";
import { legacyQuestionFields } from "./legacyFields";
import type { PackageIssue } from "./package";
import { parsePackage, readManifest, serializeManifest, serializeQuestionsFile } from "./packageJson";
import { isRunnable, summarizePackage, validatePackage } from "./validate";
import { effectiveRole, visibleBlocks } from "./visibility";

// vitest runs from the web/ package root.
const repository = join(process.cwd(), "..");
const fixtures = join(repository, "fixtures", "qbank");

describe("the invented multimodal bank", () => {
  const directory = join(fixtures, "synthetic", "multimodal-shapes");
  const manifestText = readFileSync(join(directory, "manifest.json"), "utf8");
  let questionsText = readFileSync(join(directory, "questions.json"), "utf8");
  const parsed = parsePackage(manifestText, questionsText);
  const pkg = parsed.package!;
  if (process.env.AXOM_WRITE_FIXTURES) {
    questionsText = serializeQuestionsFile(pkg);
    writeFileSync(join(directory, "questions.json"), questionsText);
  }
  const files = new Set(readdirSync(join(directory, "assets")));
  const issues = [...parsed.issues, ...validatePackage(pkg, { assetFiles: files })];
  const question = (id: string) => pkg.questions.find((entry) => entry.id === id)!;

  it("reads with nothing refused and every question runnable", () => {
    expect(parsed.issues).toEqual([]);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(pkg.questions.every((entry) => isRunnable(entry.id, issues))).toBe(true);
  });

  it("is stored exactly as AXOM writes it, so export and re-import change nothing", () => {
    expect(serializeQuestionsFile(pkg), "rewrite with AXOM_WRITE_FIXTURES=1").toBe(questionsText);
    expect(serializeManifest(pkg.manifest)).toBe(manifestText);
    expect(parsePackage(serializeManifest(pkg.manifest), serializeQuestionsFile(pkg)).package).toEqual(pkg);
  });

  it("shows the import preview what it found", () => {
    expect(summarizePackage(pkg, issues)).toEqual({
      questions: 8, images: 4, tables: 9, equations: 1, explanations: 7, answerKeys: 8, answerReveals: 1,
      blockedQuestions: 0, importable: true,
      issues: { answer_reveal_asset: 1, missing_explanation: 1, source_inconsistency: 1 },
    });
  });

  it("A: text, table, text, picture and prompt stay in that order", () => {
    expect(blockShape(question("syn-q04").stem)).toEqual(["text", "table", "text", "image", "text"]);
    expect(legacyQuestionFields(pkg.manifest, question("syn-q04")).stem.split("\n\n").map((part) => part.slice(0, 12))).toEqual([
      "A volunteer ", "Test | Resul", "A tissue sam", "[Image: Inve", "Which marker",
    ]);
  });

  it("B: a question that depends on a picture cannot be run when the picture is absent", () => {
    const without = new Set(files);
    without.delete("syn-q07-field-left.png");
    const found = validatePackage(pkg, { assetFiles: without });
    expect(found).toContainEqual(expect.objectContaining({ severity: "error", code: "missing_required_media", questionId: "syn-q07", path: "stem[1]" }));
    expect(isRunnable("syn-q07", found)).toBe(false);
    expect(isRunnable("syn-q04", found)).toBe(true);
  });

  it("C: the clean graph is in the stem and the answer-marked copy is held back", () => {
    const graph = question("syn-q03");
    const [clean, marked] = graph.assets;
    expect(marked).toMatchObject({ role: "answer_reveal", revealOf: clean.id });
    expect(clean.checksum).not.toBe(marked.checksum);
    const placed = JSON.stringify([graph.stem, graph.choices, graph.explanation]);
    expect(placed).toContain(clean.id);
    expect(placed).not.toContain(marked.id);
    const roleOf = new Map(graph.assets.map((asset) => [asset.id, asset.role]));
    expect(visibleBlocks(graph.stem, "question", (block) => effectiveRole(block.role, roleOf.get(block.assetId), "stem"))).toEqual(graph.stem);
    expect(graph.correctAnswer).toEqual({ labels: ["B"], evidence: "answer-reveal-slide" });
  });

  it("D: time and level values are a table with their units in the headings", () => {
    expect(question("syn-q08").stem[1]).toEqual({
      type: "table",
      headers: ["Time after infusion (h)", "Plasma level (μg/mL)"],
      rows: [["0", "16"], ["2", "8"], ["4", "4"], ["6", "2"]],
    });
  });

  it("E: a 2x2 table keeps its row names, columns and totals", () => {
    expect(question("syn-q02").stem[1]).toEqual({
      type: "table",
      headers: ["", "Rash", "No rash", "Total"],
      rowHeaders: true,
      rows: [["Additive", "40", "160", "200"], ["No additive", "30", "270", "300"], ["Total", "70", "430", "500"]],
    });
  });

  it("answer choices can be one shared table or a table each", () => {
    expect(legacyQuestionFields(pkg.manifest, question("syn-q05")).options[1]).toEqual({ key: "B", text: "Pituitary signal ↑; Gland hormone ↓; Target tissue effect ↓" });
    expect(question("syn-q06").choices.every((choice) => blockShape(choice.blocks).join() === "table")).toBe(true);
    expect(legacyQuestionFields(pkg.manifest, question("syn-q06")).options[2]).toEqual({ key: "C", text: "Na⁺ (mEq/L) | HCO₃⁻ (mEq/L)\n140 | 25" });
  });

  it("every picture is the file its checksum, size and dimensions say it is", () => {
    for (const asset of pkg.questions.flatMap((entry) => entry.assets)) {
      const bytes = readFileSync(join(directory, "assets", asset.filename));
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, asset.filename).toBe(asset.checksum);
      expect(bytes.length, asset.filename).toBe(asset.byteSize);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], asset.filename).toEqual([asset.width, asset.height]);
    }
  });
});

describe("the three Term 5 GOER Week 2 banks", () => {
  const banks = ["biostats-epidemiology", "pharmacodynamics-pk", "endocrine-pathophysiology"];
  const directoryOf = (bank: string) => join(fixtures, "goer", "t5", "week-02", bank);
  const manifests = banks.map((bank) => {
    const issues: PackageIssue[] = [];
    return { bank, issues, manifest: readManifest(JSON.parse(readFileSync(join(directoryOf(bank), "manifest.json"), "utf8")), issues)! };
  });

  it("are three separate banks, each with a valid manifest", () => {
    expect(manifests.flatMap((entry) => entry.issues)).toEqual([]);
    expect(new Set(manifests.map((entry) => entry.manifest.bank.id)).size).toBe(3);
    expect(manifests.map((entry) => entry.manifest.bank.discipline)).toEqual(["Biostatistics / Epidemiology", "Pharmacology", "Pathophysiology"]);
  });

  it("are filed under Term 5, GOER, Week 2 without claiming the source says which week", () => {
    const termFive = SGU_CURRICULUM.terms.find((term) => term.name === "Term 5")!;
    for (const { manifest } of manifests) {
      expect(manifest.course).toEqual({ name: "GOER", term: 5, week: 2 });
      expect(termFive.courses.some((course) => course.modules.includes(manifest.course.name))).toBe(true);
      expect(manifest.source).toMatchObject({ sourceWeekDeclared: false, axomAssignedWeek: 2 });
    }
  });

  // Asks git itself: a rule that reads right and matches nothing would pass a text check.
  it.skipIf(!existsSync(join(repository, ".git")))("keep real course material out of the repository", () => {
    const ignored = (path: string): boolean => {
      try {
        execFileSync("git", ["check-ignore", "-q", path], { cwd: repository });
        return true;
      } catch {
        return false;
      }
    };
    for (const bank of banks) {
      const directory = join("fixtures", "qbank", "goer", "t5", "week-02", bank);
      for (const file of ["source/any course file.pdf", "assets/any-picture.png", "questions.json", "questions.docx"]) {
        expect(ignored(join(directory, file)), `${bank}/${file}`).toBe(true);
      }
      expect(ignored(join(directory, "manifest.json"))).toBe(false);
    }
    const invented = join("fixtures", "qbank", "synthetic", "multimodal-shapes");
    expect(ignored(join(invented, "questions.json"))).toBe(false);
    expect(ignored(join(invented, "assets", "syn-q03-curves.png"))).toBe(false);
  });

  for (const bank of banks) {
    const questionsPath = join(directoryOf(bank), "questions.json");
    // Built locally from JD's own course file. Counts only: never print a question.
    it.skipIf(!existsSync(questionsPath))(`${bank}: the bank built on this machine validates`, () => {
      const parsed = parsePackage(readFileSync(join(directoryOf(bank), "manifest.json"), "utf8"), readFileSync(questionsPath, "utf8"));
      const assets = join(directoryOf(bank), "assets");
      const issues = [...parsed.issues, ...validatePackage(parsed.package!, { assetFiles: new Set(existsSync(assets) ? readdirSync(assets) : []) })];
      const summary = summarizePackage(parsed.package!, issues);
      console.info(bank, JSON.stringify(summary));
      expect(summary.importable).toBe(true);
    });
  }
});

describe("the DOCX import template", () => {
  it("holds every marker as a line of its own, a real table and a real picture, in document order", async () => {
    const zip = await JSZip.loadAsync(readFileSync(join(repository, "docs", "templates", "AXOM_QBANK_IMPORT_TEMPLATE.docx")));
    const body = await zip.file("word/document.xml")!.async("string");
    const lines = [...body.matchAll(/<w:p>.*?<\/w:p>/g)].map(([paragraph]) => [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((run) => run[1]).join(""));
    const markers = lines.filter((line) => /^\[[A-Z ]+\]$/.test(line)).map((line) => line.slice(1, -1));
    expect(markers.slice(0, 13)).toEqual([
      "AXOM META", "STEM", "TABLE", "STEM CONTINUED", "IMAGE", "STEM CONTINUED", "CHOICES", "ANSWER", "EXPLANATION", "SOURCE", "FLAGS", "END QUESTION", "AXOM META",
    ]);
    expect(new Set(markers)).toEqual(new Set(DOCX_MARKERS));
    expect(body.match(/<w:tbl>/g)).toHaveLength(2);
    expect(body.indexOf("[TABLE]")).toBeLessThan(body.indexOf("<w:tbl>"));
    expect(body.indexOf("<w:tbl>")).toBeLessThan(body.indexOf("<w:drawing>"));
    // Typed letters, never Word's automatic lettering, which is not in the text.
    expect(body).not.toContain("<w:numPr>");
    expect(lines).toContain("A. 0.5 h");
    const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(relationships).toContain("Target=\"media/image1.png\"");
    expect(zip.file("word/media/image1.png")).not.toBeNull();
  });
});
