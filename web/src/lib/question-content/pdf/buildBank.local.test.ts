// A local tool, skipped unless asked for. It builds a real question bank from
// its own PDF, on this machine only, and prints a report made of counts.
//
//   AXOM_QBANK_SOURCES="/folder/with/the/PDFs" \
//     npx vitest run src/lib/question-content/pdf/buildBank.local.test.ts
//
// For every bank under fixtures/qbank (except the invented one) whose
// manifest names a PDF found in that folder or in the bank's own source/
// folder, it writes questions.json and assets/ beside the manifest. Git
// ignores both there. Nothing a question says is printed: no stem, no choice,
// no answer letter. Figures are cut out with poppler's pdftocairo.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeAssets } from "../assets";
import { blockShape } from "../blocks";
import type { ImportPackage, PackageManifest } from "../package";
import { readManifest, serializeQuestionsFile } from "../packageJson";
import { questionReadiness } from "../readiness";
import { summarizePackage, validatePackage } from "../validate";
import { loadTaggedPdf } from "./loadTaggedPdf";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";

const sources = process.env.AXOM_QBANK_SOURCES;
const only = process.env.AXOM_QBANK_ONLY;
const fixtures = join(process.cwd(), "..", "fixtures", "qbank");

// Straight to the terminal: the test runner keeps a passing test's console output to itself.
const say = (...parts: unknown[]): void => void process.stdout.write(`${parts.join(" ")}\n`);

function manifestsUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "synthetic" || !statSync(path).isDirectory()) return [];
    return existsSync(join(path, "manifest.json")) ? [path] : manifestsUnder(path);
  });
}

/** One PNG of a page, or of a region of it given in page points from the top left, at twice the page's own scale. */
function render(pdf: string, page: number, box: { left: number; top: number; width: number; height: number } | undefined, scratch: string): Uint8Array {
  const out = join(scratch, `p${page}-${box ? `${Math.round(box.left)}-${Math.round(box.top)}` : "page"}`);
  const region = box ? ["-x", String(Math.max(0, Math.floor(box.left * 2 - 4))), "-y", String(Math.max(0, Math.floor(box.top * 2 - 4))), "-W", String(Math.ceil(box.width * 2 + 8)), "-H", String(Math.ceil(box.height * 2 + 8))] : [];
  execFileSync("pdftocairo", ["-png", "-singlefile", "-r", "144", "-f", String(page), "-l", String(page), ...region, pdf, out]);
  return readFileSync(`${out}.png`);
}

describe.skipIf(!sources)("building real question banks from their PDFs, on this machine only", () => {
  it("writes each bank beside its manifest and reports counts", async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
    const scratch = mkdtempSync(join(tmpdir(), "axom-bank-"));
    const totals = { banks: 0, questions: 0, verified: 0, ready: 0, review: 0, unresolved: 0, tables: 0, figures: 0 };
    for (const directory of manifestsUnder(fixtures)) {
      const manifest = readManifest(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")), []) as PackageManifest;
      if (only && !manifest.bank.id.includes(only)) continue;
      const pdf = [join(directory, "source", manifest.source.filename), join(sources!, manifest.source.filename)].find((path) => existsSync(path));
      say(`\n=== ${manifest.bank.id}`);
      if (!pdf) {
        say("  source file: NOT FOUND under the bank's source folder or AXOM_QBANK_SOURCES");
        continue;
      }
      const bytes = readFileSync(pdf);
      const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const loaded = await loadTaggedPdf(pdfjs, new Uint8Array(bytes));
      say(`  source: matched by file name, ${bytes.length} bytes, ${checksum.slice(0, 19)}…  made by ${loaded.creator ?? "unknown"}  tagged: ${loaded.tagged ? "yes" : "NO"}  slides: ${loaded.slides ? "yes" : "no"}`);
      if (!loaded.tagged) {
        say("  not built: the file has no structure tags, and reading tables by position is not built");
        continue;
      }
      const pages = loaded.pages.map(readTaggedPage);
      const converted = taggedPdfToQuestions({ pages }, { bankId: manifest.bank.id, sourceFilename: manifest.source.filename, createdAt: new Date().toISOString() });
      for (const question of converted.questions) question.provenance.sourceChecksum = checksum;

      const drawn = new Map<string, Uint8Array>();
      for (const [assetId, request] of converted.renders) drawn.set(assetId, render(pdf, request.page, request.box, scratch));
      const files = await describeAssets(converted.questions, (asset) => drawn.get(asset.id));
      const assets = join(directory, "assets");
      mkdirSync(assets, { recursive: true });
      for (const name of readdirSync(assets)) if (name !== ".gitkeep") unlinkSync(join(assets, name));
      for (const [name, data] of files) writeFileSync(join(assets, name), data);
      const pkg: ImportPackage = { manifest, questions: converted.questions };
      writeFileSync(join(directory, "questions.json"), serializeQuestionsFile(pkg));

      const issues = [...converted.issues, ...validatePackage(pkg, { assetFiles: new Set(files.keys()) })];
      const summary = summarizePackage(pkg, issues);
      const verified = pkg.questions.filter((question) => question.correctAnswer).length;
      const verdicts = pkg.questions.map((question) => questionReadiness(question, issues).readiness);
      const ready = verdicts.filter((verdict) => verdict === "ready").length;
      const review = verdicts.filter((verdict) => verdict === "needs-review").length;
      const unresolved = verdicts.filter((verdict) => verdict === "unresolved").length;
      const numbers = pkg.questions.map((question) => question.source.questionNumber).filter((value): value is number => value !== undefined);
      const ids = new Set(pkg.questions.map((question) => question.id));
      const stems = new Map<string, number>();
      for (const question of pkg.questions) {
        const key = question.stem.map((block) => (block.type === "text" ? block.text : block.type)).join("|").toLowerCase().replace(/[^a-z0-9|]+/g, "");
        stems.set(key, (stems.get(key) ?? 0) + 1);
      }
      totals.banks += 1;
      totals.questions += summary.questions;
      totals.verified += verified;
      totals.ready += ready;
      totals.review += review;
      totals.unresolved += unresolved;
      totals.tables += summary.tables;
      totals.figures += summary.images;
      say(`  pages ${converted.report.pages}  inside the tags ${(converted.report.taggedShare * 100).toFixed(1)}% of the text  read by ${converted.report.readByPosition ? "position (slides)" : "tag order"}  deck: ${converted.report.deck ? "yes" : "no"}  sets ${converted.report.sets}  page numbers dropped ${converted.report.pageNumbersDropped}  figure labels kept with their drawing ${converted.report.figureLabels}`);
      say(`  questions ${summary.questions}  with a printed key ${verified}  READY ${ready}  NEEDS REVIEW ${review}  UNRESOLVED ${unresolved}  with an explanation ${summary.explanations}  with a topic ${pkg.questions.filter((question) => question.topic).length}`);
      say(`  numbering: ${numbers.length} numbered, unique ids ${ids.size} of ${summary.questions}`);
      say(`  choices per question: ${[...new Set(pkg.questions.map((question) => question.choices.length))].sort().map((count) => `${count}:${pkg.questions.filter((question) => question.choices.length === count).length}`).join("  ")}  (choices:questions)`);
      say(`  tables in the file ${converted.report.tables}, placed in a question ${converted.report.tablesPlaced}, read as an answer key ${converted.report.answerKeyTables}`);
      say(`  figures cut out ${converted.report.figures}, placed ${converted.report.figuresPlaced}; answer slides kept for review ${converted.report.answerPages}, of which with a drawn mark ${converted.report.answerPagesWithMarks}`);
      say(`  duplicates by stem: ${[...stems.values()].filter((count) => count > 1).length}  pages located: ${pkg.questions.filter((question) => question.source.page !== undefined).length} of ${summary.questions}`);
      say(`  runnable: ${summary.questions - summary.blockedQuestions} of ${summary.questions}  importable: ${summary.importable}`);
      say(`  issues: ${Object.entries(summary.issues).map(([code, count]) => `${code} ${count}`).join(", ") || "none"}`);
      // x text, T table, I image, E equation; then the number of choices, the same letters for a choice that is
      // more than text, "+e" for an explanation, and R, V or U for ready, review, unresolved.
      const letter = (kind: string): string => ({ text: "x", rich_text: "x", table: "T", image: "I", equation: "E" })[kind] ?? "?";
      const mark = { ready: "R", "needs-review": "V", unresolved: "U" } as const;
      say(`  shapes: ${pkg.questions.map((question, index) => `${question.id.slice(manifest.bank.id.length + 1)}:${blockShape(question.stem).map(letter).join("")}/${question.choices.length}${question.choices.flatMap((choice) => blockShape(choice.blocks).map(letter)).join("").replace(/x/g, "")}${question.explanation?.length ? "+e" : ""}${mark[verdicts[index]]}`).join(" ")}`);
      const longest = Math.max(0, ...pkg.questions.flatMap((question) => question.choices.map((choice) => choice.blocks.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0))));
      say(`  longest choice: ${longest} characters  choices ending in a bare number: ${pkg.questions.filter((question) => question.choices.some((choice) => /\s\d{1,3}$/.test(choice.blocks.map((block) => (block.type === "text" ? block.text : "")).join(" ")))).length}`);
      for (const entry of converted.unplaced) {
        const page = entry.media.kind === "image" ? /-p(\d+)-fig|^page:(\d+):/.exec(entry.media.element.target) : null;
        say(`  not placed: a ${entry.media.kind}${page ? ` on page ${page[1] ?? page[2]}` : ""}. ${entry.reason.replace(/[“”"][^“”"]{12,}[“”"]/g, "\"…\"").slice(0, 160)}`);
      }
      say(`  figure boxes (page: left,top,width,height): ${pkg.questions.flatMap((question) => question.assets.filter((asset) => asset.bounds).map((asset) => `p${asset.sourcePage}:${[asset.bounds!.x, asset.bounds!.y, asset.bounds!.width, asset.bounds!.height].map(Math.round).join(",")}`)).join("  ") || "none"}`);
      for (const note of converted.notes.slice(0, 8)) say(`  note: ${note.replace(/[“”"][^“”"]{12,}[“”"]/g, "\"…\"").slice(0, 260)}`);
      expect(summary.importable).toBe(true);
    }
    rmSync(scratch, { recursive: true, force: true });
    say(`\nTOTAL  banks ${totals.banks}  questions ${totals.questions}  printed key ${totals.verified}  READY ${totals.ready}  NEEDS REVIEW ${totals.review}  UNRESOLVED ${totals.unresolved}  tables ${totals.tables}  figures ${totals.figures}`);
  }, 600_000);
});
