// Development only. The whole import of a PDF a person chooses, in a real
// browser and on the app's real store: read the file, show what was found,
// say which questions are ready, save the ready ones through the canonical
// import, and after a reload check that what was saved is all still there.
//
// Everything written to the summary, the result and the workspace panels is a
// count. A question's words are only in the preview below them.
import { flushLocalVaultWrites } from "../lib/localVault";
import { getQuestionAttachmentBlob } from "../lib/questionAttachments";
import { sha256 } from "../lib/question-content/assets";
import { saveBank } from "../lib/question-content/bankImport";
import type { QuestionBlock } from "../lib/question-content/blocks";
import { legacyQuestionFields } from "../lib/question-content/legacyFields";
import type { PackageManifest, PackageQuestion, QuestionAsset } from "../lib/question-content/package";
import { readManifest } from "../lib/question-content/packageJson";
import { assessBank, extractPdfBank, type PdfBankExtraction } from "../lib/question-content/pdf/extractPdfBank";
import { withReviewedAnswer } from "../lib/question-content/readiness";
import { effectiveRole, isAssetVisible, visibleBlocks, type ContentViewMode } from "../lib/question-content/visibility";
import { useStore } from "../lib/store";

type Bank = Extract<PdfBankExtraction, { tagged: true }>;
type State = "idle" | "reading" | "preview" | "saving" | "saved" | "already-saved" | "nothing-ready" | "failed" | "not-tagged" | "error";

const DIGEST = "axom.harness.pdf-import.expected";
const FILING = "axom.harness.pdf-import.filing";
const FIELDS = ["bank-id", "bank-title", "discipline", "module", "term", "week"] as const;
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const field = (id: string): string => element<HTMLInputElement>(id).value.trim();
const encoder = new TextEncoder();
const hash = (words: string): Promise<string> => sha256(encoder.encode(words));

let bank: Bank | undefined;
const pictures = new Map<string, { url: string; inked: number; width: number; height: number }>();

function setState(state: State, words: string): void {
  const status = element("status");
  status.dataset.state = state;
  status.textContent = words;
  element<HTMLButtonElement>("import").disabled = !bank || state === "reading" || state === "saving";
}

/** A bank's own manifest, when one was chosen. It is used whole: its topic and what it records of the source come with it. */
let chosenManifest: PackageManifest | undefined;

/** Where the questions are filed is kept for the tab, so a reload does not quietly file the next import somewhere else. */
function rememberFiling(): void {
  sessionStorage.setItem(FILING, JSON.stringify({ fields: Object.fromEntries(FIELDS.map((id) => [id, field(id)])), manifest: chosenManifest ?? null }));
  element("filing").textContent = chosenManifest ? `Filed by the manifest of ${chosenManifest.bank.id}.` : "";
}

function restoreFiling(): void {
  const stored = sessionStorage.getItem(FILING);
  if (!stored) return;
  const { fields, manifest } = JSON.parse(stored) as { fields: Record<string, string>; manifest: PackageManifest | null };
  for (const id of FIELDS) if (fields[id] !== undefined) element<HTMLInputElement>(id).value = fields[id];
  chosenManifest = manifest ?? undefined;
  element("filing").textContent = chosenManifest ? `Filed by the manifest of ${chosenManifest.bank.id}.` : "";
}

async function takeManifest(file: File): Promise<void> {
  const problems: Parameters<typeof readManifest>[1] = [];
  const manifest = readManifest(JSON.parse(await file.text()), problems);
  if (!manifest) {
    element("errors").textContent = problems.map((problem) => problem.message).join("\n") || "The manifest could not be read.";
    return;
  }
  chosenManifest = manifest;
  const values: Record<(typeof FIELDS)[number], string> = { "bank-id": manifest.bank.id, "bank-title": manifest.bank.title, discipline: manifest.bank.discipline, module: manifest.course.name, term: String(manifest.course.term), week: String(manifest.course.week) };
  for (const id of FIELDS) element<HTMLInputElement>(id).value = values[id];
  rememberFiling();
}

function manifestFor(fileName: string): PackageManifest {
  if (chosenManifest) return chosenManifest;
  const week = Number(field("week"));
  return {
    schemaVersion: 1,
    course: { name: field("module"), term: Number(field("term")), week },
    bank: { id: field("bank-id"), title: field("bank-title"), discipline: field("discipline") },
    source: { filename: fileName, sourceWeekDeclared: false, axomAssignedWeek: week },
    questionsFile: "questions.json",
    assetsDirectory: "assets/",
  };
}

/** A picture's size as the browser decodes it, and how many of its pixels are not white. */
async function measure(file: File): Promise<{ url: string; inked: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let inked = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 700) inked += 1;
  }
  return { url, inked, width: image.naturalWidth, height: image.naturalHeight };
}

// --- the preview ---------------------------------------------------------------

function drawBlocks(into: HTMLElement, blocks: readonly QuestionBlock[], question: PackageQuestion, section: QuestionAsset["role"], mode: ContentViewMode): void {
  const assets = new Map(question.assets.map((asset) => [asset.id, asset]));
  const shown = visibleBlocks(blocks, mode, (block) => effectiveRole(block.role, assets.get(block.assetId)?.role, section));
  for (const block of shown) {
    if (block.type === "text") {
      const paragraph = document.createElement("p");
      paragraph.textContent = block.text;
      into.append(paragraph);
    } else if (block.type === "rich_text") {
      const paragraph = document.createElement("p");
      paragraph.textContent = block.html.replace(/<[^>]+>/g, "");
      into.append(paragraph);
    } else if (block.type === "table") {
      const table = document.createElement("table");
      for (const [index, row] of [...(block.headers ? [block.headers] : []), ...block.rows].entries()) {
        const line = table.insertRow();
        for (const cell of row) {
          const box = document.createElement(block.headers && index === 0 ? "th" : "td");
          box.textContent = cell;
          line.append(box);
        }
      }
      into.append(table);
    } else if (block.type === "image") {
      const asset = assets.get(block.assetId);
      const picture = asset ? pictures.get(asset.filename) : undefined;
      if (!asset || !picture) continue;
      const image = document.createElement("img");
      image.src = picture.url;
      image.alt = block.alt ?? "";
      image.dataset.role = effectiveRole(block.role, asset.role, section);
      image.dataset.placed = "block";
      into.append(image);
    }
  }
}

function drawPreview(): void {
  const list = element("questions");
  list.replaceChildren();
  if (!bank) return;
  const mode = element<HTMLSelectElement>("mode").value as ContentViewMode;
  list.dataset.mode = mode;
  for (const question of bank.pkg.questions) {
    const verdict = bank.verdicts.get(question.id)!;
    const card = document.createElement("article");
    card.dataset.testid = "question";
    card.dataset.question = question.id;
    card.dataset.readiness = verdict.readiness;
    const heading = document.createElement("h3");
    heading.textContent = `${question.source.set !== undefined ? `Set ${question.source.set}, ` : ""}question ${question.source.questionNumber ?? "?"}: ${verdict.readiness}`;
    card.append(heading);
    drawBlocks(card, question.stem, question, "stem", mode);
    const choices = document.createElement("ol");
    choices.type = "A";
    for (const choice of question.choices) {
      const item = document.createElement("li");
      drawBlocks(item, choice.blocks, question, "choice", mode);
      choices.append(item);
    }
    card.append(choices);
    if (mode !== "question" && question.explanation?.length) drawBlocks(card, question.explanation, question, "explanation", mode);
    // Pictures kept beside the question and not in a block of it: an answer slide, a source page.
    const placed = new Set([question.stem, ...question.choices.map((choice) => choice.blocks), question.explanation ?? []].flat().flatMap((block) => (block.type === "image" ? [block.assetId] : [])));
    for (const asset of question.assets) {
      const picture = pictures.get(asset.filename);
      if (placed.has(asset.id) || !picture || !isAssetVisible(asset.role, mode)) continue;
      const image = document.createElement("img");
      image.src = picture.url;
      image.alt = "";
      image.dataset.role = asset.role;
      image.dataset.placed = "beside";
      card.append(image);
    }
    for (const reason of verdict.reasons) {
      const line = document.createElement("p");
      line.className = "held";
      line.textContent = reason;
      card.append(line);
    }
    if (verdict.readiness !== "ready") {
      // Only a person presses this. Nothing in the harness fills it in.
      const pick = document.createElement("select");
      pick.dataset.testid = "answer-for";
      pick.dataset.question = question.id;
      for (const choice of question.choices) pick.add(new Option(choice.label, choice.label));
      const set = document.createElement("button");
      set.type = "button";
      set.dataset.testid = "set-answer";
      set.dataset.question = question.id;
      set.textContent = "I have checked the source: set this answer";
      set.addEventListener("click", () => reviewed(question.id, pick.value));
      card.append(pick, set);
    }
    list.append(card);
  }
}

function writeSummary(): void {
  if (!bank) return;
  const questions = bank.pkg.questions;
  const sets = [...new Set(questions.map((question) => question.source.set ?? 0))].map((set) => ({
    set,
    questions: questions.filter((question) => (question.source.set ?? 0) === set).length,
    ready: questions.filter((question) => (question.source.set ?? 0) === set && bank!.verdicts.get(question.id)!.readiness === "ready").length,
    numbers: questions.filter((question) => (question.source.set ?? 0) === set).map((question) => question.source.questionNumber ?? null),
  }));
  const all = [...pictures.values()];
  element("summary").textContent = JSON.stringify({
    slides: bank.slides,
    deck: bank.report.deck,
    pages: bank.report.pages,
    questions: questions.length,
    ready: bank.counts.ready,
    needsReview: bank.counts["needs-review"],
    unresolved: bank.counts.unresolved,
    sets,
    tables: bank.report.tablesPlaced,
    figures: questions.reduce((sum, question) => sum + question.assets.filter((asset) => asset.role !== "answer_reveal").length, 0),
    answerSlides: questions.reduce((sum, question) => sum + question.assets.filter((asset) => asset.role === "answer_reveal").length, 0),
    pictureFiles: bank.files.length,
    picturesDecoded: all.length,
    picturesBlank: all.filter((picture) => picture.inked < 50).length,
    notPlaced: bank.unplaced.length,
    withAPage: questions.filter((question) => question.source.page !== undefined).length,
    advisories: [...bank.verdicts.values()].reduce((sum, verdict) => sum + verdict.advisories.length, 0),
    drawWarnings: bank.warnings.length,
  }, null, 1);
}

function reviewed(questionId: string, label: string): void {
  if (!bank) return;
  bank.pkg.questions = bank.pkg.questions.map((question) => (question.id === questionId ? withReviewedAnswer(question, label) : question));
  Object.assign(bank, assessBank(bank.pkg, bank.conversionIssues, bank.files));
  writeSummary();
  drawPreview();
}

async function read(file: File): Promise<void> {
  bank = undefined;
  for (const picture of pictures.values()) URL.revokeObjectURL(picture.url);
  pictures.clear();
  element("questions").replaceChildren();
  element("summary").textContent = "{}";
  element("result").textContent = "{}";
  element("errors").textContent = "";
  setState("reading", "Reading the file…");
  try {
    const extraction = await extractPdfBank(file, manifestFor(file.name));
    if (!extraction.tagged) {
      setState("not-tagged", "This PDF has no structure tags. Use the ordinary PDF import for it.");
      return;
    }
    bank = extraction;
    for (const picture of extraction.files) pictures.set(picture.name, await measure(picture));
    writeSummary();
    drawPreview();
    setState("preview", `Found ${extraction.pkg.questions.length} questions.`);
  } catch (error) {
    element("errors").textContent = error instanceof Error ? error.message : String(error);
    setState("error", "The file could not be read. Nothing was saved.");
  }
}

// --- saving ------------------------------------------------------------------

interface Expected { id: string; stem: string; key?: string; number?: number; page?: number; pictures: number; cells: string[] }

async function save(): Promise<void> {
  if (!bank) return;
  const current = bank;
  setState("saving", "Saving…");
  const saved = await saveBank(current.pkg, current.issues, current.files, {
    library: () => {
      const state = useStore.getState();
      return { questions: state.questions, questionSets: state.questionSets, documents: state.documents };
    },
    store: () => useStore.getState(),
  }, { sourceText: current.sourceText, sourceBytes: current.sourceBytes, notes: current.notes });
  await flushLocalVaultWrites();

  // What a reload should find, written down before the page is left.
  const expected: Expected[] = [];
  for (const section of saved.sections) {
    for (const [index, packageId] of section.questionIds.entries()) {
      const question = current.pkg.questions.find((entry) => entry.id === packageId)!;
      const fields = legacyQuestionFields(current.pkg.manifest, question);
      expected.push({
        id: section.savedIds[index],
        stem: await hash(fields.stem),
        ...(fields.correctKey ? { key: fields.correctKey } : {}),
        ...(question.source.questionNumber !== undefined ? { number: question.source.questionNumber } : {}),
        ...(fields.sourcePage !== undefined ? { page: fields.sourcePage } : {}),
        pictures: question.assets.filter((asset) => isAssetVisible(asset.role, "question")).length,
        cells: question.stem.flatMap((block) => (block.type === "table" ? [...(block.headers ?? []), ...block.rows.flat()].filter(Boolean) : [])),
      });
    }
  }
  if (expected.length) sessionStorage.setItem(DIGEST, JSON.stringify({ expected, withheld: saved.withheldAssets.map((asset) => asset.filename) }));

  element("result").textContent = JSON.stringify({
    status: saved.status,
    sections: saved.sections.map((section) => ({ set: section.set ?? 0, saved: section.savedIds.length, reused: section.reused, picturesAttached: section.images.attached, picturesMissing: section.images.missing, pictureProblems: section.images.problems.length })),
    held: saved.held.length,
    heldNeedingReview: saved.held.filter((entry) => entry.readiness === "needs-review").length,
    heldUnresolved: saved.held.filter((entry) => entry.readiness === "unresolved").length,
    picturesWithheld: saved.withheldAssets.length,
    filing: saved.filing,
    errors: saved.errors.length,
  }, null, 1);
  element("errors").textContent = saved.errors.join("\n");
  const words: Record<typeof saved.status, string> = {
    saved: "Saved.",
    "already-saved": "These questions were already saved. Nothing was written.",
    "nothing-ready": "No question is ready, so nothing was saved.",
    failed: "The import failed. See the errors.",
  };
  // The workspace panel first, so whoever reads the state after it reads the workspace as it now is.
  await showWorkspace();
  setState(saved.status, words[saved.status]);
}

// --- the workspace, as it is in storage -----------------------------------------

async function showWorkspace(): Promise<void> {
  const state = useStore.getState();
  const attachments = state.questions.flatMap((question) => question.attachments ?? []);
  let decoded = 0;
  let sized = 0;
  for (const attachment of attachments) {
    const stored = await getQuestionAttachmentBlob(attachment.blobKey);
    if (!stored) continue;
    try {
      const bitmap = await createImageBitmap(stored.blob);
      if (bitmap.width > 0 && bitmap.height > 0) decoded += 1;
      if (stored.byteSize === attachment.byteSize) sized += 1;
      bitmap.close();
    } catch { /* counted as not decoded */ }
  }
  const stored = sessionStorage.getItem(DIGEST);
  let check: Record<string, number> | undefined;
  if (stored) {
    const { expected, withheld } = JSON.parse(stored) as { expected: Expected[]; withheld: string[] };
    check = { expected: expected.length, found: 0, sameStem: 0, sameKey: 0, sameNumber: 0, samePage: 0, samePictures: 0, tableCells: 0, tableCellsFound: 0, withheldPicturesStored: 0 };
    for (const want of expected) {
      const have = state.questions.find((question) => question.id === want.id);
      if (!have) continue;
      check.found += 1;
      if ((await hash(have.stem)) === want.stem) check.sameStem += 1;
      if (have.correctKey === want.key && have.options.some((option) => option.key === have.correctKey)) check.sameKey += 1;
      if (have.questionNumber === want.number) check.sameNumber += 1;
      if (have.sourcePage === want.page) check.samePage += 1;
      if ((have.attachments?.length ?? 0) === want.pictures) check.samePictures += 1;
      check.tableCells += want.cells.length;
      check.tableCellsFound += want.cells.filter((cell) => have.stem.includes(cell)).length;
    }
    check.withheldPicturesStored = attachments.filter((attachment) => withheld.includes(attachment.fileName)).length;
  }
  const panel = element("workspace");
  panel.textContent = JSON.stringify({
    documents: state.documents.map((document) => ({ sets: document.linkedQuestionSetIds.length, hasChecksum: Boolean(document.checksum), hasText: document.rawText.length > 0 })),
    sets: state.questionSets.map((set) => ({
      questions: set.questionIds.length,
      module: set.scope?.module ?? null,
      week: set.scope?.week ?? null,
      documents: set.sourceDocumentIds.length,
      numbers: set.questionIds.map((id) => state.questions.find((question) => question.id === id)?.questionNumber ?? null),
    })),
    questions: state.questions.length,
    picturesLinked: attachments.length,
    picturesDecoded: decoded,
    picturesRightSize: sized,
    ...(check ? { check } : {}),
  }, null, 1);
  panel.dataset.ready = "true";
}

async function start(): Promise<void> {
  if (!useStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const stop = useStore.persist.onFinishHydration(() => {
        stop();
        resolve();
      });
    });
  }
  restoreFiling();
  await showWorkspace();
  for (const id of FIELDS) {
    element<HTMLInputElement>(id).addEventListener("input", () => {
      // Typing a filing by hand sets the chosen manifest aside.
      chosenManifest = undefined;
      rememberFiling();
    });
  }
  element<HTMLInputElement>("manifest").addEventListener("change", (event) => {
    const [file] = (event.target as HTMLInputElement).files ?? [];
    if (file) void takeManifest(file);
  });
  element<HTMLInputElement>("file").addEventListener("change", (event) => {
    const [file] = (event.target as HTMLInputElement).files ?? [];
    if (file) void read(file);
  });
  element<HTMLSelectElement>("mode").addEventListener("change", drawPreview);
  element<HTMLButtonElement>("import").addEventListener("click", () => {
    save().catch((error: unknown) => {
      element("errors").textContent = error instanceof Error ? error.message : String(error);
      setState("failed", "The import failed. See the errors.");
    });
  });
}

void start();
