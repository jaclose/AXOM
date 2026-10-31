import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";
import { PRIVATE_REVIEW_DOCUMENT } from "../src/lib/privateLibrary/types";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Real PNG bytes keep this test independent of image mocks and private sources. */
function sourceFigure(marked: boolean) {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, body: Buffer) => {
    const label = Buffer.from(kind), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(body.length); checksum.writeUInt32BE(crc(Buffer.concat([label, body])));
    return Buffer.concat([size, label, body, checksum]);
  };
  const width = 160, height = 80, raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3;
    const curve = Math.abs(y - (58 - x / 4)) < 2;
    const highlight = marked && (x - 112) ** 2 + (y - 30) ** 2 < 50;
    raw.set(highlight ? [225, 165, 70] : curve ? [90, 190, 190] : [23, 37, 58], offset);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function flatExportZip() {
  const zip = new JSZip(), clean = sourceFigure(false), reveal = sourceFigure(true);
  const shared = { bankId: "synthetic-flat-export", bankTitle: "Synthetic flat export", course: "GOER", term: 5, week: 2,
    sourceRef: "synthetic-calibration.pdf", questionType: "single_best_answer", a: "Alpha", b: "Beta" };
  zip.file("wrapped/questions.json", JSON.stringify([
    { ...shared, id: "flat-ready", source: { filename: shared.sourceRef, page: 1, questionNumber: 1 },
      question: "Synthetic calibration: choose the source-defined Alpha mark.",
      stemBlocks: [{ type: "text", text: "Synthetic calibration: choose the source-defined Alpha mark." },
        { type: "image", assetId: "clean", role: "stem", alt: "Synthetic clean figure" }],
      correctAnswer: { labels: ["A"], evidence: "printed-key" },
      explanation: "The synthetic source defines Alpha as the marked position. Beta names the alternative position.",
      explanationBlocks: [{ type: "image", assetId: "reveal", role: "answer_reveal", alt: "Synthetic marked source reveal" }],
      assets: [
        { id: "clean", path: "assets/clean.png", mimeType: "image/png", role: "stem", questionId: "flat-ready", sha256: hash(clean) },
        { id: "reveal", path: "assets/reveal.png", mimeType: "image/png", role: "answer_reveal", questionId: "flat-ready", revealOf: "clean", sha256: hash(reveal) },
      ] },
    { ...shared, id: "flat-review", source: { filename: shared.sourceRef, page: 2, questionNumber: 2 },
      question: "Synthetic candidate: this bare key has no verification evidence.", correctAnswer: "B" },
    { ...shared, id: "flat-unresolved", source: { filename: shared.sourceRef, page: 3, questionNumber: 3 },
      question: "Synthetic unresolved item: the source does not supply a key." },
  ]));
  zip.file("wrapped/assets/clean.png", clean); zip.file("wrapped/assets/reveal.png", reveal);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function snapshot(page: Page) {
  return page.evaluate(async (reviewType) => {
    type State = { questions: { id: string; correctKey?: string; attempts: unknown[]; attachments?: { role?: string }[]; content?: { id: string } }[];
      questionSets: { questionIds: string[] }[]; documents: { fileType: string; rawText: string }[] };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ flushVault: () => Promise<void>; useStore: { getState: () => State } }> }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    return {
      questions: state.questions.map(question => ({ id: question.id, sourceId: question.content?.id, key: question.correctKey,
        attempts: question.attempts.length, roles: question.attachments?.map(asset => asset.role).sort() })),
      setCount: state.questionSets.length,
      reviewIds: state.documents.filter(document => document.fileType === reviewType)
        .flatMap(document => JSON.parse(document.rawText).pkg.questions.map((question: { id: string }) => question.id)),
    };
  }, PRIVATE_REVIEW_DOCUMENT);
}

for (const { width, height, theme } of [
  { width: 1440, height: 900, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
]) {
  test(`flat ZIP retains review gates, figures and saved practice at ${width}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme as "dark" | "light", reducedMotion: "reduce" });
    const browserProblems: string[] = [];
    page.on("pageerror", error => browserProblems.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) browserProblems.push(message.text()); });
    await page.goto("/#questions", { waitUntil: "networkidle" });
    await page.evaluate(({ key, theme }) => localStorage.setItem(key, theme), { key: STORAGE_KEYS.themePreference, theme });
    await seedOnboarded(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const screenshots = process.env.AXOM_ACCEPTANCE_SCREENSHOTS;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    const capture = async (name: string) => {
      if (screenshots) await page.screenshot({ path: join(screenshots, `flat-${width}-${theme}-${name}.png`) });
    };
    const library = page.getByRole("region", { name: "Prepared library" });
    const buffer = await flatExportZip();
    await page.getByText("Local collection transfer and source review", { exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await library.getByRole("button", { name: "Install prepared library", exact: true }).click();
    await (await chooser).setFiles({ name: "synthetic-flat-export.zip", mimeType: "application/zip", buffer });
    await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 90_000 });
    const installed = await snapshot(page);
    expect(installed.questions).toHaveLength(1);
    expect(installed.questions[0]).toMatchObject({ sourceId: "flat-ready", key: "A", attempts: 0, roles: ["answer_reveal", "stem"] });
    expect(installed.setCount).toBe(1);
    expect(installed.reviewIds).toEqual(["flat-ready", "flat-review", "flat-unresolved"]);
    await library.getByText("Source coverage & review (2 held)", { exact: true }).click();
    await expect(library.locator(".prepared-source-list li")).toHaveCount(1);
    await expect(library.getByRole("button", { name: "Review source", exact: true })).toHaveCount(1);
    await library.locator(".prepared-source-list li").filter({ has: page.getByText("synthetic-flat-export.questions.json", { exact: true }) })
      .getByRole("button", { name: "Review source", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Source review", exact: true });
    const preview = dialog.getByRole("region", { name: "Source question bank preview" });
    await expect(preview).toContainText("3 questions · 1 ready for import · 1 need review · 1 unresolved");
    await expect(preview.getByRole("img", { name: "Synthetic clean figure", exact: true })).toHaveCount(1);
    await expect(preview.getByRole("img", { name: "Synthetic marked source reveal", exact: true })).toHaveCount(0);
    await expect.poll(() => preview.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(160);
    await capture("counts");
    await preview.getByRole("button", { name: "Enlarge Synthetic clean figure", exact: true }).click();
    const enlarged = page.getByRole("dialog", { name: "Synthetic clean figure", exact: true });
    await expect(enlarged.getByRole("img", { name: "Synthetic clean figure", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(enlarged).toHaveCount(0);
    await preview.getByRole("img", { name: "Synthetic clean figure", exact: true }).scrollIntoViewIfNeeded();
    await capture("answering");
    await preview.getByLabel("Preview mode").selectOption("answered");
    await expect(preview.getByText("Source key: A", { exact: true })).toBeVisible();
    await expect(preview.getByRole("img")).toHaveCount(2);
    const revealed = preview.getByRole("img", { name: "Synthetic marked source reveal", exact: true });
    await expect(revealed).toHaveCount(1);
    await expect.poll(() => revealed.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(160);
    await revealed.scrollIntoViewIfNeeded(); await capture("reveal");
    await preview.getByLabel("Preview mode").selectOption("review");
    await expect(preview.getByRole("img")).toHaveCount(2);
    await expect(preview.getByText("Source key: A", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Next question", exact: true }).click();
    await expect(preview).toContainText("NEEDS REVIEW · Source page 2");
    await expect(preview.getByText("Candidate key (unverified): B", { exact: true })).toBeVisible();
    await expect(preview.getByRole("img")).toHaveCount(0);
    await capture("candidate");
    await preview.getByRole("button", { name: "Next question", exact: true }).click();
    await expect(preview).toContainText("UNRESOLVED · Source page 3");
    await expect(preview.getByText("Answer: Requires verification", { exact: true })).toBeVisible();
    await expect(preview.getByRole("button", { name: "Confirm answer from source", exact: true })).toBeDisabled();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await capture("unresolved");
    await dialog.getByRole("button", { name: "Close", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await reloadAfterSave(page);
    expect(await snapshot(page)).toEqual(installed);
    await page.getByText("Local collection transfer and source review", { exact: true }).click();
    const repeatChooser = page.waitForEvent("filechooser");
    await library.getByRole("button", { name: "Update library", exact: true }).click();
    await (await repeatChooser).setFiles({ name: "synthetic-flat-export.zip", mimeType: "application/zip", buffer });
    await expect(library.getByRole("status")).toContainText("Library installed.", { timeout: 90_000 });
    expect(await snapshot(page)).toEqual(installed);

    await page.locator(".qb-hero-actions").getByRole("button", { name: "Create Quiz", exact: true }).click();
    await page.getByLabel("Custom question count").fill("1");
    await page.getByRole("button", { name: "Start tutor block", exact: true }).click();
    const player = page.locator(".quiz-player-modal");
    await expect(player.getByRole("img", { name: "Synthetic clean figure", exact: true })).toBeVisible();
    const tip = player.getByRole("button", { name: "Got it", exact: true });
    if (await tip.isVisible()) await tip.click();
    await expect(player.getByRole("img", { name: "Synthetic marked source reveal", exact: true })).toHaveCount(0);
    await capture("practice");
    await player.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A"); await page.keyboard.press("Enter");
    await expect(player.getByRole("img", { name: "Synthetic marked source reveal", exact: true })).toHaveCount(1);
    await expect.poll(() => player.getByRole("img", { name: "Synthetic marked source reveal", exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(160);
    await player.getByRole("button", { name: "Finish block", exact: true }).click();
    await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review saved block", exact: true });
    await expect(review).toContainText("Your answer: A");
    await review.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await reloadAfterSave(page);
    const completed = await snapshot(page);
    expect(completed.questions).toHaveLength(1);
    expect(completed.questions[0]).toMatchObject({ id: installed.questions[0].id, sourceId: "flat-ready", key: "A", attempts: 1 });
    expect(completed.reviewIds).toEqual(installed.reviewIds);
    expect(completed.setCount).toBe(1);
    await capture("saved");
    expect(browserProblems).toEqual([]);
  });
}
