import { createHash } from "node:crypto";
import JSZip from "jszip";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Deliberately invented source material. No clinical facts, licensed media,
// personal learner data or privileged backend are used in this acceptance case.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function onePageSource() {
  const stream = "BT /F1 20 Tf 30 160 Td (Synthetic keyboard figure.) Tj ET";
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 550 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, part] of parts.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${part}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function sourceZip() {
  const pdf = onePageSource();
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "reg-canonical-figure", title: "Synthetic keyboard figures", discipline: "Software QA" },
    source: { filename: "synthetic.pdf", sourceWeekDeclared: true },
    questionsFile: "questions.json", assetsDirectory: "assets",
  }));
  zip.file("source/synthetic.pdf", pdf);
  zip.file("questions.json", JSON.stringify({
    schemaVersion: 1, bankId: "reg-canonical-figure",
    questions: [{
      id: "reg-canonical-figure-q1",
      source: { filename: "synthetic.pdf", page: 1, questionNumber: 1 },
      stem: [
        { type: "text", text: "Synthetic visual question: choose the option labeled Alpha." },
        { type: "image", assetId: "reg-figure-stem", alt: "Synthetic keyboard figure" },
      ],
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] },
      ],
      correctAnswer: { labels: ["A"], evidence: "printed-key" },
      assets: [{
        id: "reg-figure-stem", questionId: "reg-canonical-figure-q1",
        filename: "synthetic-figure.png", mimeType: "image/png",
        role: "stem", checksum: `sha256:${hash(PNG)}`,
      }],
      provenance: { method: "authored", sourceChecksum: `sha256:${hash(pdf)}` },
    }],
  }));
  zip.file("assets/synthetic-figure.png", PNG);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

for (const width of [320, 390, 1440]) {
  test(`canonical rich question image survives reload and restores keyboard focus at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto("/#questions", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    const prepared = page.getByRole("region", { name: "Prepared library" });
    if (!await prepared.isVisible()) {
      await page.getByText("Import status and source review", { exact: true }).click();
    }
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Install prepared library", exact: true }).click();
    await (await chooser).setFiles({
      name: "synthetic-keyboard-figure.zip", mimeType: "application/zip", buffer: await sourceZip(),
    });
    await expect(prepared.getByRole("status")).toContainText("Library installed.");

    await page.locator(".qb-hero-actions").getByRole("button", { name: "Quick practice", exact: true }).click();
    await page.getByLabel("Custom question count").fill("1");
    await page.getByRole("button", { name: "Slides", exact: true }).click();
    await page.getByRole("button", { name: "Tutor (feedback per question)" }).click();
    await page.getByRole("button", { name: "Start tutor block", exact: true }).click();

    const player = page.locator(".quiz-player-modal");
    const tip = player.getByRole("button", { name: "Got it", exact: true });
    if (await tip.isVisible()) await tip.click();
    const enlarge = player.getByRole("button", { name: "Enlarge Synthetic keyboard figure", exact: true });
    await expect(enlarge).toBeVisible();

    // Reload a persisted learner session before opening the canonical content
    // image. A passing render before reload alone cannot prove vault durability.
    await reloadAfterSave(page);
    await expect(player.locator('[data-question-view="slides"]')).toBeVisible();
    await expect(enlarge).toBeVisible();
    await enlarge.focus();
    await expect(enlarge).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Synthetic keyboard figure", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Synthetic keyboard figure" })).toBeVisible();
    expect(await dialog.getByRole("img", { name: "Synthetic keyboard figure" }).evaluate(
      (img: HTMLImageElement) => img.naturalWidth,
    )).toBeGreaterThan(0);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(enlarge).toBeFocused();
    await expect(enlarge).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
