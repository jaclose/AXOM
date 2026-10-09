import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// A question PDF with a figure on the page: the figure is cut out of the page,
// attached to the question it sits with, and shown with the stem. Nothing is
// typed in, and the image survives a reload. The PDF is built here from
// invented content.

/** One page: a question as text, a small image drawn under its options, and the answer below that. */
function questionPdfWithFigure(): Buffer {
  const lines = [
    "1. A tracing is shown. Which rhythm is present?",
    "A. Rhythm one",
    "B. Rhythm two",
    "C. Rhythm three",
    "D. Rhythm four",
    "Answer: C",
    "Explanation: The third rhythm matches the tracing.",
  ];
  // The stem and options sit above the image (which spans 420 to 540 points); the answer and explanation sit below it.
  const text = lines.map((line, index) => `BT /F1 12 Tf 72 ${index < 5 ? 720 - index * 18 : 390 - (index - 5) * 18} Td (${line}) Tj ET`).join("\n");
  // The image fills the unit square scaled to 200 x 120 points at (72, 420).
  const content = Buffer.from(`${text}\nq 200 0 0 120 72 420 cm /Im1 Do Q\n`, "latin1");
  const pixels = Buffer.from([200, 30, 30, 30, 160, 60, 40, 60, 200, 230, 210, 40]);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

test("a figure in a question PDF is cut out, attached to its question and shown with the stem", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles({
    name: "FTM 1 Week 2 IMCQ 1.pdf", mimeType: "application/pdf", buffer: questionPdfWithFigure(),
  });
  await expect(page.getByText("Review 1 parsed question", { exact: false })).toBeVisible();

  // The import says what it found and why it attached it, before anything is saved.
  await expect(page.getByText("1 image found in this PDF, 1 attached to a question by its place on the page.")).toBeVisible();
  const draft = page.locator(".import-draft").first();
  await expect(draft).toContainText("image FTM-1-Week-2-IMCQ-1-p1-fig1.png");
  await expect(draft).not.toContainText("not added yet");
  await expect(page.getByRole("region", { name: "Images" }).getByRole("listitem")).toContainText("ready");

  await page.getByLabel("Set title").fill("PDF with a figure");
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();

  await reloadAfterSave(page);
  const saved = await page.evaluate(async () => {
    type Question = { sourcePage?: number; correctKey?: string; attachments?: Array<{ fileName: string; role?: string; mimeType: string; width?: number }> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions?: Question[] } } }> }).__AXOM_DEV__;
    return dev.useStore.getState().questions ?? [];
  });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ sourcePage: 1, correctKey: "C" });
  expect(saved[0].attachments).toEqual([
    expect.objectContaining({ fileName: "FTM-1-Week-2-IMCQ-1-p1-fig1.png", role: "exhibit", mimeType: "image/png" }),
  ]);

  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  await page.getByRole("button", { name: "Practice PDF with a figure", exact: true }).click();
  await page.getByRole("button", { name: "Start tutor block" }).click();
  const exhibit = page.locator(".question-exhibit img");
  await expect(exhibit).toBeVisible();
  // A real picture of the figure, wider than tall like the region it was cut from.
  const size = await exhibit.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  expect(size.width).toBeGreaterThan(300);
  expect(size.width / size.height).toBeCloseTo(200 / 120, 1);
  expect(errors).toEqual([]);
});
