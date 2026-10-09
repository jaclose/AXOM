// The import of a PDF a person chooses, in a real browser, on the development
// harness page (/harness/pdf-import.html) and the app's real store:
// select, read, preview, classify, confirm, save, reload, verify.
// Every PDF here is written in the test from invented content.
import { expect, test, type Page } from "@playwright/test";
import { inventedDeckPdf, inventedTwoSetPdf, taggedPdf } from "../src/lib/question-content/pdf/buildTaggedPdf.testing";

const HARNESS = "/harness/pdf-import.html";

// The harness page exists on the dev server only. Against a built app there is nothing to test here.
test.beforeEach(async ({ request }) => {
  const response = await request.get(HARNESS);
  test.skip(!response.ok() || !(await response.text()).includes("pdfImportHarness"), "The PDF import harness is served by the dev server only.");
});

async function open(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
}
const choose = (page: Page, name: string, bytes: Uint8Array) => page.getByTestId("file").setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
const read = async (page: Page, id: string) => JSON.parse((await page.getByTestId(id).textContent())!);
const state = (page: Page) => page.getByTestId("status");
const card = (page: Page, id: string) => page.locator(`[data-testid="question"][data-question="${id}"]`);

test("a document with two sets: read, previewed, classified, saved as two sets of one source, intact after a reload, and not saved twice", async ({ page }) => {
  await open(page);
  expect(await read(page, "workspace")).toMatchObject({ documents: [], sets: [], questions: 0 });

  // SELECT and EXTRACT
  await choose(page, "invented-two-sets.pdf", inventedTwoSetPdf());
  await expect(state(page)).toHaveAttribute("data-state", "preview", { timeout: 30_000 });

  // PREVIEW and CLASSIFY
  expect(await read(page, "summary")).toMatchObject({
    slides: false, pages: 2, questions: 4, ready: 3, needsReview: 0, unresolved: 1,
    sets: [{ set: 1, questions: 2, ready: 2, numbers: [1, 2] }, { set: 2, questions: 2, ready: 1, numbers: [1, 2] }],
    tables: 1, figures: 1, answerSlides: 0, pictureFiles: 1, picturesDecoded: 1, picturesBlank: 0, notPlaced: 0, withAPage: 4, drawWarnings: 0,
  });
  await expect(page.getByTestId("question")).toHaveCount(4);
  await expect(card(page, "invented-bank-s1-q01")).toHaveAttribute("data-readiness", "ready");
  await expect(card(page, "invented-bank-s2-q02")).toHaveAttribute("data-readiness", "unresolved");
  // The table is a table, with the cells the source prints, and the figure is drawn from the page.
  await expect(card(page, "invented-bank-s1-q01").locator("table tr")).toHaveCount(3);
  await expect(card(page, "invented-bank-s1-q01").locator("td").nth(1)).toHaveText("10");
  const figure = card(page, "invented-bank-s1-q02").locator("img");
  await expect(figure).toHaveCount(1);
  expect(await figure.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(300);

  // CONFIRM and SAVE
  await page.getByTestId("import").click();
  await expect(state(page)).toHaveAttribute("data-state", "saved");
  expect(await read(page, "result")).toMatchObject({
    status: "saved", errors: 0, held: 1, heldUnresolved: 1, picturesWithheld: 0,
    sections: [
      { set: 1, saved: 2, reused: false, picturesAttached: 1, picturesMissing: 0, pictureProblems: 0 },
      { set: 2, saved: 1, reused: false, picturesAttached: 0 },
    ],
    filing: { module: "EXAMPLE", week: 1, term: 1 },
  });

  // RELOAD and VERIFY: one source, two sets, each with the numbers its source gave.
  await page.reload();
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
  const afterReload = await read(page, "workspace");
  expect(afterReload).toMatchObject({
    documents: [{ sets: 2, hasChecksum: true, hasText: true }],
    questions: 3, picturesLinked: 1, picturesDecoded: 1, picturesRightSize: 1,
    check: { expected: 3, found: 3, sameStem: 3, sameKey: 3, sameNumber: 3, samePage: 3, samePictures: 3, tableCells: 9, tableCellsFound: 9, withheldPicturesStored: 0 },
  });
  expect(afterReload.sets).toHaveLength(2);
  expect(afterReload.sets).toEqual(expect.arrayContaining([
    { questions: 2, module: "EXAMPLE", week: 1, documents: 1, numbers: [1, 2] },
    { questions: 1, module: "EXAMPLE", week: 1, documents: 1, numbers: [1] },
  ]));

  // The same file again: recognised, nothing written.
  await choose(page, "invented-two-sets.pdf", inventedTwoSetPdf());
  await expect(state(page)).toHaveAttribute("data-state", "preview", { timeout: 30_000 });
  await page.getByTestId("import").click();
  await expect(state(page)).toHaveAttribute("data-state", "already-saved");
  expect(await read(page, "workspace")).toMatchObject({ documents: [{ sets: 2 }], questions: 3, picturesLinked: 1 });
  expect((await read(page, "workspace")).sets).toHaveLength(2);
});

test("a deck whose answers are drawn marks: nothing is scored until a person sets the answer, and the answer slide is never shown with the open question", async ({ page }) => {
  await open(page);
  await choose(page, "invented-deck.pdf", inventedDeckPdf());
  await expect(state(page)).toHaveAttribute("data-state", "preview", { timeout: 30_000 });
  expect(await read(page, "summary")).toMatchObject({ slides: true, deck: true, questions: 3, ready: 0, needsReview: 3, unresolved: 0, figures: 1, answerSlides: 3, pictureFiles: 4, picturesDecoded: 4, picturesBlank: 0 });

  // While a question is open its graph shows and its answer slide does not.
  await expect(page.locator('img[data-role="answer_reveal"]')).toHaveCount(0);
  await expect(page.locator('img[data-role="stem"]')).toHaveCount(1);
  await page.getByTestId("mode").selectOption("review");
  await expect(page.locator('img[data-role="answer_reveal"]')).toHaveCount(3);
  await page.getByTestId("mode").selectOption("question");
  await expect(page.locator('img[data-role="answer_reveal"]')).toHaveCount(0);

  // Nothing is ready, so nothing is saved.
  await page.getByTestId("import").click();
  await expect(state(page)).toHaveAttribute("data-state", "nothing-ready");
  expect(await read(page, "result")).toMatchObject({ status: "nothing-ready", sections: [], held: 3, heldNeedingReview: 3, errors: 0 });
  expect(await read(page, "workspace")).toMatchObject({ questions: 0, sets: [], picturesLinked: 0 });

  // A person checks the first slide and sets its answer. That one becomes ready; the others stay held.
  await card(page, "invented-bank-q01").getByTestId("answer-for").selectOption("B");
  await card(page, "invented-bank-q01").getByTestId("set-answer").click();
  await expect(card(page, "invented-bank-q01")).toHaveAttribute("data-readiness", "ready");
  expect(await read(page, "summary")).toMatchObject({ ready: 1, needsReview: 2 });
  await page.getByTestId("import").click();
  await expect(state(page)).toHaveAttribute("data-state", "saved");
  expect(await read(page, "result")).toMatchObject({ status: "saved", held: 2, picturesWithheld: 0, sections: [{ saved: 1, picturesAttached: 2 }] });

  // After a reload: the question, its key and its graph are there. Its answer slide is stored for post-answer review.
  await page.reload();
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
  expect(await read(page, "workspace")).toMatchObject({
    questions: 1, picturesLinked: 2, picturesDecoded: 2,
    check: { expected: 1, found: 1, sameStem: 1, sameKey: 1, samePage: 1, samePictures: 1, withheldPicturesStored: 0 },
  });
});

test("a file that cannot be read is an error, a PDF with no tags is sent to the ordinary import, and neither saves anything", async ({ page }) => {
  await open(page);
  await choose(page, "not-a-pdf.pdf", new TextEncoder().encode("This is not a PDF at all."));
  await expect(state(page)).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(page.getByTestId("errors")).not.toBeEmpty();
  await expect(page.getByTestId("import")).toBeDisabled();
  await expect(page.getByTestId("question")).toHaveCount(0);

  await choose(page, "untagged.pdf", taggedPdf("An invented word processor", [], []));
  await expect(state(page)).toHaveAttribute("data-state", "not-tagged", { timeout: 30_000 });
  await expect(page.getByTestId("import")).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
  expect(await read(page, "workspace")).toMatchObject({ documents: [], sets: [], questions: 0, picturesLinked: 0 });
});
