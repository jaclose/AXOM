import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// The layout JD's question mapping produces (Ideas 5), with invented content:
// a quiz header, Review and Attachment lines, and a key the source disputes.
const MAPPED = `Sample Quiz 4
Source: Course Sample Quiz 4
Questions: 1–3

Question 1
A 45-year-old patient has a serum finding. Which of the following is the most likely cause?

A. Cause one
B. Cause two
C. Cause three
D. Cause four
E. Cause five

Answer: B
Explanation: The second mechanism explains the finding.
Review: Renal; Diuretics
Attachment: None

Question 2
A tracing is shown. Which rhythm is present?

A. Rhythm one
B. Rhythm two
C. Rhythm three
D. Rhythm four
E. Rhythm five

Answer: C
Explanation: The third rhythm matches the tracing.
Review: Cardiology; ECG
Attachment: figure-2.png

Question 3
Two answers were marked in the source. Which is correct?

A. First
B. Second
C. Third
D. Fourth

Correct Answer: UNRESOLVED
Source marks: A and D
Status: SOURCE-KEY CONFLICT
Explanation: The source key is disputed.
Review: Pharmacology
Attachment: None
`;

/** A valid 1x1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a mapped paste imports with its tags, attaches the named image, and shows it with the question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles({ name: "sample-quiz-4.txt", mimeType: "text/plain", buffer: Buffer.from(MAPPED) });
  await expect(page.getByText("Review 3 parsed questions", { exact: false })).toBeVisible();

  const drafts = page.locator(".import-draft");
  await expect(drafts).toHaveCount(3);
  await expect(drafts.nth(0)).toContainText("answer B");
  await expect(drafts.nth(1)).toContainText("image figure-2.png (not added yet)");
  // The disputed key is never guessed.
  await expect(drafts.nth(2)).toContainText("answer missing");
  await expect(drafts.nth(2)).toContainText("Invalid");

  const images = page.getByRole("region", { name: "Images" });
  await images.getByLabel("Add image files for this import").setInputFiles({ name: "Figure-2.PNG", mimeType: "image/png", buffer: PNG });
  await expect(images.getByRole("listitem")).toContainText("ready");

  await page.getByRole("checkbox", { name: "Include question 3" }).uncheck();
  await page.getByLabel("Set title").fill("Mapped sample");
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();

  // The tab above appears when the questions are saved; the image is attached in a later step
  // of the same save. So read until the attachment is there, instead of once and too early.
  const readSaved = () => page.evaluate(async () => {
    type Question = { questionNumber?: number; correctKey?: string; tags?: string[]; citation?: string; attachments?: Array<{ fileName: string; role?: string }> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions?: Question[] } } }> }).__AXOM_DEV__;
    return (dev.useStore.getState().questions ?? [])
      .map((question) => ({ number: question.questionNumber, key: question.correctKey, tags: question.tags, source: question.citation, images: (question.attachments ?? []).map((item) => `${item.fileName}:${item.role}`) }))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  });
  await expect.poll(readSaved).toEqual([
    { number: 1, key: "B", tags: expect.arrayContaining(["renal", "diuretics"]), source: "Course Sample Quiz 4", images: [] },
    { number: 2, key: "C", tags: expect.arrayContaining(["cardiology", "ecg"]), source: "Course Sample Quiz 4", images: ["Figure-2.PNG:exhibit"] },
  ]);

  // The image is part of the question: it shows with the stem, before answering,
  // and is still there after a reload (its bytes live in the device vault).
  await reloadAfterSave(page);
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  await page.getByRole("button", { name: "Practice Mapped sample", exact: true }).click();
  await page.getByRole("button", { name: "Start tutor block" }).click();
  for (let item = 0; item < 2; item += 1) {
    const stem = (await page.locator(".question-stem").innerText()).trim();
    if (stem.startsWith("A tracing is shown")) {
      const exhibit = page.locator(".question-exhibit img");
      await expect(exhibit).toBeVisible();
      expect(await exhibit.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await page.locator(".question-exhibit").click();
      await expect(page.getByRole("dialog", { name: "Question image, enlarged" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".question-exhibit-lightbox")).toHaveCount(0);
      await expect(page.locator(".question-stem")).toBeVisible();
      break;
    }
    await expect(page.locator(".question-exhibit")).toHaveCount(0);
    await page.locator(".option-pick").first().click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await page.getByRole("button", { name: "Next question" }).click();
  }
  expect(errors).toEqual([]);
});
