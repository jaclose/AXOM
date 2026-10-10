// Local, resumable preparation. The destination must stay outside public assets/Git.
// Run: node scripts/prepare-private-library.mjs <inventory.json> <private-output>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadTaggedPdf } from "../src/lib/question-content/pdf/loadTaggedPdf";
import { readTaggedPage } from "../src/lib/question-content/pdf/taggedPdf";
import { taggedPdfToQuestions } from "../src/lib/question-content/pdf/taggedPdfToQuestions";
import { describeAssets } from "../src/lib/question-content/assets";
import { assessBank } from "../src/lib/question-content/assessBank";
import { docxToQuestions } from "../src/lib/question-content/docx/docxToQuestions";
import { draftsToQuestions } from "../src/lib/question-content/fromDrafts";
import { parseQuestionBlocks } from "../src/lib/questionParse";
import { extractPdfText } from "../src/lib/extractText";
import { parsePdfQuestions } from "../src/lib/pdfQuestionImport";
import { figureBoxes, withoutDecorations, locateQuestionPages, placeFigures, type PageLine } from "../src/lib/pdfFigures";
import { pdfDraftsToQuestions } from "../src/lib/question-content/pdf/pdfToQuestions";
import { parseCourseTemplate } from "../src/lib/course-engine/templateParse";
import { CURRICULA } from "../src/lib/curricula";
import { knownBankManifests } from "../src/lib/question-content/knownBanks";
import type { PackageManifest } from "../src/lib/question-content/package";
import { PRIVATE_LIBRARY_FORMAT, type PreparedBank, type PrivateLibraryCatalog } from "../src/lib/privateLibrary/types";

const [inventoryPath, outputPath] = process.argv.slice(2);
if (!inventoryPath || !outputPath) throw new Error("Provide inventory.json and a private output directory.");
const out = resolve(outputPath);
if (/(?:^|\/)(?:public|dist)(?:\/|$)/.test(out)) throw new Error("Private content cannot go in public assets.");
mkdirSync(out, { recursive: true, mode: 0o700 });
type Entry = { root: string; path: string; fileName: string; extension: string; sha256: string; size: number; duplicateOf?: string; mapping: { module?: { value: string }; term?: { value: string }; week?: { value: number }; referenceCandidate?: boolean } };
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as { entries: Entry[] };
const catalogFile = join(out, "catalog.json");
const catalog: PrivateLibraryCatalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) : {
  format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "academic-library", version: "", templates: [], sources: [],
};
const write = (file: string, value: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.pending`, JSON.stringify(value)); renameSync(`${file}.pending`, file); };
const checkpoint = () => {
  catalog.version = createHash("sha256").update(JSON.stringify([catalog.templates, catalog.sources])).digest("hex").slice(0, 16);
  write(catalogFile, catalog);
};
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const previousVersion = catalog.preparerVersion ?? 1;
for (const entry of inventory.entries) {
  const known = knownBankManifests.find(m => m.source.filename.toLowerCase() === entry.fileName.toLowerCase());
  const previous = catalog.sources.find(s => s.sourcePath === entry.path && s.checksum === entry.sha256 && !["failed", "missing"].includes(s.status));
  const sourcePath = join(dirname(entry.root), entry.path);
  const originalFile = `sources/${entry.sha256}.${entry.extension}`;
  // Original bytes are portable too; no launched app depends on the feature checkout.
  if (!entry.duplicateOf && existsSync(sourcePath) && !/Examplify UI/i.test(entry.root)) {
    mkdirSync(join(out, "sources"), { recursive: true });
    if (!existsSync(join(out, originalFile))) copyFileSync(sourcePath, join(out, originalFile));
    if (previous && previous.status !== "missing") previous.originalFile = originalFile;
  }
  if (previous && !(previousVersion < 3 && known && !entry.duplicateOf) && !(previousVersion < 2 && entry.extension === "pdf" && previous.status === "reference/template-only" && !/Course update|Examplify UI/i.test(entry.root))) { checkpoint(); continue; }
  const id = `source-${entry.sha256}`;
  const row: PrivateLibraryCatalog["sources"][number] = { id, name: entry.fileName, sourcePath: entry.path, checksum: entry.sha256,
    module: entry.mapping.module?.value, status: "failed", reason: "Not processed", ready: 0, review: 0,
    ...(!entry.duplicateOf && existsSync(join(out, originalFile)) ? { originalFile } : {}) };
  try {
    const file = join(dirname(entry.root), entry.path);
    if (entry.duplicateOf) { row.status = "duplicate-linked"; row.duplicateOf = entry.duplicateOf; row.reason = "Identical source bytes; uses the original bank."; }
    else if (!existsSync(file)) { row.status = "missing"; row.reason = "Source path is unavailable. Restore the original file and resume preparation."; }
    else if (/Examplify UI/i.test(entry.root)) { row.status = "reference/template-only"; row.reason = "Interface reference, excluded from the question corpus."; }
    else {
      const bytes = readFileSync(file);
      if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Source changed since inventory. Refresh this source identity before processing.");
      if (bytes.subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/v1")) throw new Error("Git LFS pointer: the original document bytes are missing. Hydrate the matching LFS object, refresh this source identity, and resume preparation.");
      const section = entry.extension === "txt" ? parseCourseTemplate(bytes.toString("utf8"), entry.fileName) : undefined;
      if (section?.module && section.items.length) {
        const target = `templates/${entry.sha256}.txt`;
        mkdirSync(join(out, "templates"), { recursive: true }); writeFileSync(join(out, target), bytes);
        if (!catalog.templates.some(t => t.checksum === entry.sha256)) catalog.templates.push({ file: target, name: entry.fileName, checksum: entry.sha256 });
        row.status = "reference/template-only"; row.reason = "Available course template; activation is the learner's choice.";
      } else if (!["pdf", "docx", "txt"].includes(entry.extension)) {
        row.status = "unsupported"; row.reason = `The ${entry.extension} source needs a supported document export; original retained.`;
      } else if (/Course update/i.test(entry.root)) {
        row.status = "reference/template-only"; row.reason = "Current schedule authority retained. Cohort and schedule reconciliation is still required before replacing older activity templates.";
      } else {
        const module = row.module ?? "Unfiled";
        const mappedTerm = entry.mapping.term?.value ?? CURRICULA.flatMap(c => c.terms).find(t => t.courses.some(c => c.modules.some(m => m.replace(/\s/g, "").toLowerCase() === module.replace(/\s/g, "").toLowerCase())))?.name;
        const term = Number(mappedTerm?.match(/\d+/)?.[0] ?? 0);
        const week = Number(entry.mapping.week?.value ?? (module === "GOER" ? 2 : 0));
        const bankId = known?.bank.id ?? `private-${entry.sha256.slice(0, 24)}`;
        const manifest: PackageManifest = known ? structuredClone(known) : { schemaVersion: 1, course: { name: module, term, week }, bank: { id: bankId, title: entry.fileName.replace(/\.[^.]+$/, ""), discipline: module },
          source: { filename: entry.fileName, sourceWeekDeclared: Boolean(entry.mapping.week), ...(module === "GOER" && !entry.mapping.week ? { axomAssignedWeek: 2 } : {}) }, questionsFile: "questions.json", assetsDirectory: "assets" };
        const defaults = { bankId, sourceFilename: entry.fileName };
        let bank: PreparedBank;
        let assets = new Map<string, Uint8Array>();
        if (entry.extension === "pdf") {
          const loaded = await loadTaggedPdf(pdfjs as unknown as typeof import("pdfjs-dist"), new Uint8Array(bytes));
          let converted = taggedPdfToQuestions({ pages: loaded.pages.map(readTaggedPage) }, defaults);
          if (!converted.questions.length) {
            const extracted = await extractPdfText(new Uint8Array(bytes).buffer, pdfjs as unknown as typeof import("pdfjs-dist"), `file://${resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")}`);
            const read = parsePdfQuestions(extracted.text, extracted.pages);
            const byPage = withoutDecorations(loaded.pages.map(p => ({ page: p.page, boxes: figureBoxes(p.imageBoxes ?? [], p).figures })));
            const figures = [...byPage].flatMap(([page, boxes]) => boxes.map((box, n) => ({ ...box, page, name: `${bankId}-p${page}-fig${n}.png` })));
            const lines = new Map<number, PageLine[]>(loaded.pages.map(p => {
              const rows = new Map<number, string>();
              for (const item of p.items) if (item.str && item.transform) { const top = Math.round(p.height - item.transform[5]); rows.set(top, `${rows.get(top) ?? ""} ${item.str}`.trim()); }
              return [p.page, [...rows].sort((a,b) => a[0]-b[0]).map(([top, text]) => ({ top, text }))];
            }));
            const pages = locateQuestionPages(read.drafts, extracted.pages);
            const placements = placeFigures(figures, read.drafts.map((d,i) => ({ ...d, sourcePage: pages[i].page, repeatsOn: pages[i].repeatsOn })), lines, read.deckPages);
            const result = pdfDraftsToQuestions({ drafts: read.drafts, figures, placements, questionPages: pages, linesByPage: lines, deckPages: read.deckPages }, defaults);
            const renders = new Map([...result.figureOfAsset].flatMap(([id, name]) => { const f = figures.find(f => f.name === name); return f ? [[id, { page: f.page, box: f }] as const] : []; }));
            converted = { ...converted, questions: result.questions, issues: result.issues, renders, sourceText: { rawText: extracted.text, pageTexts: extracted.pages }, notes: [...read.notes, ...extracted.warnings] };
          }
          const drawn = new Map<string, Uint8Array>();
          const scratch = join(out, "renders", entry.sha256); mkdirSync(scratch, { recursive: true });
          for (const [assetId, request] of converted.renders) {
            const target = join(scratch, assetId.replace(/[^a-zA-Z0-9_-]/g, "_"));
            const b = request.box;
            const region = b ? ["-x", String(Math.max(0, Math.floor(b.left * 2 - 4))), "-y", String(Math.max(0, Math.floor(b.top * 2 - 4))), "-W", String(Math.ceil(b.width * 2 + 8)), "-H", String(Math.ceil(b.height * 2 + 8))] : [];
            execFileSync("pdftocairo", ["-png", "-singlefile", "-r", "144", "-f", String(request.page), "-l", String(request.page), ...region, file, target], { stdio: "pipe", timeout: 30_000 });
            drawn.set(assetId, readFileSync(`${target}.png`));
          }
          assets = await describeAssets(converted.questions, asset => drawn.get(asset.id));
          bank = { pkg: { manifest, questions: converted.questions }, issues: converted.issues, sourceText: converted.sourceText, sourceBytes: bytes.length, notes: converted.notes };
        } else if (entry.extension === "docx") {
          const converted = await docxToQuestions(new Uint8Array(bytes), defaults);
          assets = converted.files;
          bank = { pkg: { manifest, questions: converted.questions }, issues: converted.issues, sourceText: { rawText: "" }, sourceBytes: bytes.length, notes: [] };
        } else {
          const rawText = bytes.toString("utf8");
          const converted = draftsToQuestions(parseQuestionBlocks(rawText), { media: [] }, { ...defaults, method: "manual-transcription" });
          bank = { pkg: { manifest, questions: converted.questions }, issues: converted.issues, sourceText: { rawText }, sourceBytes: bytes.length, notes: [] };
        }
        for (const q of bank.pkg.questions) q.provenance.sourceChecksum = `sha256:${entry.sha256}`;
        const assessed = assessBank(bank.pkg, bank.issues, [...assets.keys()].map(name => ({ name })));
        bank.issues = assessed.issues;
        row.ready = assessed.counts.ready; row.review = bank.pkg.questions.length - row.ready;
        row.status = row.ready ? "prepared" : bank.pkg.questions.length ? "review-required" : "reference/template-only";
        row.reason = bank.pkg.questions.length ? "Validated package; counts become available only after installation. Unmapped weeks remain unfiled." : "No MCQs recognized. Original available for source review; may need OCR or a supported question layout.";
        if (!bank.pkg.questions.length && /question|pq|imcq|quiz|esoft|examsoft/i.test(entry.fileName)) row.status = "review-required";
        if (bank.pkg.questions.length) {
          row.bankFile = `banks/${entry.sha256}/bank.json`;
          write(join(out, row.bankFile), bank);
          for (const [name, data] of assets) { const target = join(out, "banks", entry.sha256, "assets", name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data); }
        }
      }
    }
  } catch (error) {
    row.reason = error instanceof Error ? error.message.slice(0, 250) : "Preparation failed; resume this source.";
    row.status = row.reason.startsWith("Git LFS pointer:") ? "missing" : "failed";
    if (row.status === "missing") delete row.originalFile;
  }
  catalog.sources = [...catalog.sources.filter(s => s.sourcePath !== entry.path), row];
  checkpoint();
  console.log(`${catalog.sources.length}/${inventory.entries.length} ${row.status} ready=${row.ready} review=${row.review}`);
}
catalog.preparerVersion = 3;
checkpoint();
