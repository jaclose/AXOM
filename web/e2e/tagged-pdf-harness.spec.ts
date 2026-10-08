// A tagged PDF through the browser import, in a real browser, on its
// development harness page (/harness/tagged-pdf.html). The PDF is written in
// the page from invented content. Covers what a unit test cannot: pdf.js with
// its worker, and the pictures drawn on a canvas and cut out of the page.
import { expect, test } from "@playwright/test";

const HARNESS = "/harness/tagged-pdf.html";

// The harness page exists on the dev server only. Against a built app there is nothing to test here.
test.beforeEach(async ({ request }) => {
  const response = await request.get(HARNESS);
  test.skip(!response.ok() || !(await response.text()).includes("taggedPdfHarness"), "The tagged PDF harness is served by the dev server only.");
});

test("reads a tagged PDF and cuts the figure its question names out of the page", async ({ page }) => {
  await page.goto(HARNESS);
  const result = page.getByTestId("result");
  await expect(result).not.toHaveAttribute("data-done", "false", { timeout: 30_000 });
  expect(await result.getAttribute("data-done"), await result.textContent() ?? "").toBe("true");
  const read = JSON.parse((await result.textContent())!);

  expect(read).toMatchObject({ tagged: true, slides: false, creator: "An invented word processor", warnings: [] });
  expect(read.questions).toHaveLength(1);
  const [question] = read.questions;
  expect(question).toMatchObject({ id: "invented-bank-q01", stem: ["text", "table", "image", "text"], choices: 3, key: ["A"] });

  // The figure is 300 by 180 points. With its margin, at three times the page, that is 924 by 564 pixels.
  expect(question.assets).toEqual([{ filename: "invented-bank-q01-img-1.png", role: "stem", mimeType: "image/png", width: 924, height: 564, byteSize: expect.any(Number), hasChecksum: true }]);
  expect(read.pictures).toHaveLength(1);
  const [picture] = read.pictures;
  expect(picture).toMatchObject({ name: "invented-bank-q01-img-1.png", width: 924, height: 564, bytes: question.assets[0].byteSize });
  // Not a blank rectangle: the frame and the line across it are there.
  expect(picture.inked).toBeGreaterThan(5_000);
  expect(picture.inked).toBeLessThan(924 * 564 * 0.2);
});
