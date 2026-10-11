import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
import { expect, seedOnboarded, test } from "./fixtures";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => JSON.stringify(value);

/** A real, CRC-correct one-pixel PNG; browser decode verifies image persistence. */
function smallPng() {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, body: Buffer) => {
    const label = Buffer.from(kind, "ascii");
    const size = Buffer.alloc(4); size.writeUInt32BE(body.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([label, body])));
    return Buffer.concat([size, label, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 46, 118, 183]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function nativeZip() {
  const zip = new JSZip(), image = smallPng();
  for (const [index, name] of ["Physiology", "Pharmacology"].entries()) {
    const prefix = `wrapped/bank-${index + 1}/`;
    const sourceName = `synthetic-${index + 1}.txt`;
    const source = Buffer.from(`Synthetic bank ${index + 1}: test content, not school material.`);
    const provenance = { method: "manual-transcription", sourceChecksum: `sha256:${hash(source)}` };
    const stem = [{ type: "text", text: `Synthetic item ${index + 1}: which option is A?` }];
    const assets = index === 0 ? [{
      id: "figure", filename: "figure.png", mimeType: "image/png",
      role: "stem", questionId: `native-${index + 1}-q1`,
      checksum: `sha256:${hash(image)}`,
    }] : [];
    if (assets.length) stem.push({ type: "image", assetId: "figure", role: "stem", alt: "A synthetic one-pixel illustration" } as never);
    const question = {
      id: `native-${index + 1}-q1`, source: { filename: sourceName, questionNumber: 1, page: 1 }, stem,
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "A" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "B" }] },
      ], correctAnswer: { labels: ["A"], evidence: "printed-key" }, assets, provenance,
    };
    const bankId = `native-test-${index + 1}`;
    zip.file(`${prefix}manifest.json`, encode({
      schemaVersion: 1, course: { name: "GOER", term: 5, week: index + 1 },
      bank: { id: bankId, title: `Synthetic bank ${index + 1}`, discipline: name },
      source: { filename: sourceName, sourceWeekDeclared: false, axomAssignedWeek: index + 1 },
      questionsFile: "questions.json", assetsDirectory: "assets",
    }));
    const questions = index === 1
      ? [question, { ...question, id: "native-2-held", source: { ...question.source, questionNumber: 2 },
          correctAnswer: { labels: ["A"], evidence: "answer-reveal-slide" } }]
      : [question];
    zip.file(`${prefix}questions.json`, encode({ schemaVersion: 1, bankId, questions }));
    zip.file(`${prefix}source/${sourceName}`, source);
    if (assets.length) zip.file(`${prefix}assets/figure.png`, image);
  }
  // No catalog.json exists anywhere in this archive.
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("native multi-bank ZIP installs without catalog.json and persists practice", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#questions", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  const buffer = await nativeZip();
  async function chooseBundle(button: string) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles({ name: "native-question-banks.zip", mimeType: "application/zip", buffer });
  }
  const library = page.getByRole("region", { name: "Prepared library" });
  await chooseBundle("Install prepared library");
  await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 90_000 });
  const snapshot = () => page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      flushVault: () => Promise<void>; useStore: { getState: () => {
        questions: { id: string; notes?: string; attempts: unknown[]; attachments?: unknown[] }[];
        questionSets: { id: string; questionIds: string[] }[];
        documents: { fileType: string }[];
        updateQuestion: (id: string, patch: { notes: string }) => void;
      } };
    }> }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    return {
      questions: state.questions.length, sets: state.questionSets.length,
      attempts: state.questions.reduce((total, q) => total + q.attempts.length, 0),
      ids: state.questions.map(q => q.id).sort(),
      notes: state.questions.map(q => q.notes ?? ""),
      imageQuestions: state.questions.filter(q => q.attachments?.length).length,
      reviewDocuments: state.documents.filter(d => d.fileType === "axom-private-review").length,
    };
  });
  const installed = await snapshot();
  expect(installed.questions).toBe(2);
  expect(installed.sets).toBe(2);
  expect(installed.imageQuestions).toBe(1);
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      flushVault: () => Promise<void>; useStore: { getState: () => {
        questions: { id: string }[]; updateQuestion: (id: string, patch: { notes: string }) => void;
      } };
    }> }).__AXOM_DEV__;
    const store = dev.useStore.getState();
    store.updateQuestion(store.questions[0].id, { notes: "My protected study note" });
    await dev.flushVault();
  });
  await page.reload({ waitUntil: "networkidle" });
  expect((await snapshot()).questions).toBe(2);
  await chooseBundle("Update library");
  await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 90_000 });
  const repeated = await snapshot();
  expect(repeated.questions).toBe(2);
  expect(repeated.sets).toBe(2);
  expect(repeated.ids).toEqual(installed.ids);
  expect(repeated.notes).toContain("My protected study note");

  const start = page.locator(".qb-hero-actions").getByRole("button", { name: "Create Quiz", exact: true });
  await start.click();
  await page.getByLabel("Custom question count").fill("2");
  await page.getByRole("button", { name: "Start tutor block", exact: true }).click();
  let sawImage = false;
  for (let index = 0; index < 2; index++) {
    const stem = page.getByLabel("Question stem", { exact: true });
    await expect(stem).toBeVisible();
    // The reading surface includes both in-order media and source exhibits.
    // A placed figure may live next to the accessible stem rather than inside it.
    const figure = page.locator(".quiz-reading img");
    if (await figure.count()) {
      sawImage = true;
      await expect.poll(() => figure.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await stem.focus(); await page.keyboard.press("A"); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: index === 1 ? "Finish block" : "Next question", exact: true }).click();
  }
  expect(sawImage).toBe(true);
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review saved block", exact: true });
  await expect(review).toContainText("Your answer: A");
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  expect((await snapshot()).attempts).toBe(2);
  expect(errors).toEqual([]);
});
