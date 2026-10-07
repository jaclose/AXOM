import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

// One source file, start to finish: its name files it under a module and week,
// its image comes with it, the answers are recorded with how sure the learner
// was, and those answers become a finding, a review set and a week's progress
// without the learner reporting anything. Invented content throughout.
const SOURCE = `Sample practice set
Source: Sample practice set
Questions: 1–2

Question 1
A tracing is shown. Which rhythm is present?

A. Rhythm one
B. Rhythm two
C. Rhythm three
D. Rhythm four

Answer: C
Explanation: The third rhythm matches the tracing.
Review: Cardiology
Attachment: tracing-1.png

Question 2
Which enzyme is deficient in the sample disorder?

A. Enzyme one
B. Enzyme two
C. Enzyme three
D. Enzyme four

Answer: B
Explanation: The second enzyme is the deficient one.
Review: Biochemistry
Attachment: None
`;

/** A valid 1x1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a source file becomes a filed set, recorded answers, a finding and a review set", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#questions");

  // --- import: the name proposes where the set belongs -----------------------
  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles({
    name: "FTM 1 Week 2 Practice Questions.txt", mimeType: "text/plain", buffer: Buffer.from(SOURCE),
  });
  await expect(page.getByText("Review 2 parsed questions", { exact: false })).toBeVisible();
  await page.getByRole("region", { name: "Images" }).getByLabel("Add image files for this import")
    .setInputFiles({ name: "tracing-1.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByLabel("Module", { exact: true })).toHaveValue("FTM 1");
  await expect(page.getByLabel("Week", { exact: true })).toHaveValue("2");
  await expect(page.getByText(/Mapped automatically: the file name/)).toBeVisible();
  await page.getByLabel("Set title").fill("Week 2 practice");
  await page.getByRole("button", { name: "Finalize import" }).click();

  // --- question bank: filed by module, then week ------------------------------
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  const group = page.locator("details.qset-group").filter({ hasText: "FTM 1" });
  await expect(group).toHaveAttribute("open", "");
  await expect(group.getByRole("heading", { name: "Week 2", exact: true })).toBeVisible();
  await group.locator("article.qset-card").filter({ hasText: "Week 2 practice" }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Start tutor block" }).click();

  // --- answer both: one sure and wrong, one right but unsure -----------------
  for (let item = 0; item < 2; item += 1) {
    const stem = (await page.locator(".question-stem").innerText()).trim();
    await page.getByLabel("Question stem").focus();
    if (stem.startsWith("A tracing is shown")) {
      // The image came in with the question and shows before answering.
      await expect(page.locator(".question-exhibit img")).toBeVisible();
      await page.keyboard.press("A");
      await page.keyboard.press("3");
      await page.keyboard.press("Enter");
      await expect(page.locator(".result-banner[role='status']")).toContainText("Incorrect");
    } else {
      await page.keyboard.press("B");
      await page.keyboard.press("2");
      await page.keyboard.press("Enter");
      await expect(page.locator(".result-banner[role='status']")).toContainText("Correct");
    }
    await page.getByRole("button", { name: item === 0 ? "Next question" : "Finish block" }).click();
  }

  // --- results: reasons read from the attempts, and a review set -------------
  const results = page.getByRole("dialog", { name: "Block results" });
  await expect(results).toContainText("1 sure, and wrong");
  await expect(results).toContainText("1 right, but not sure");
  await results.getByRole("button", { name: "Create set from missed" }).click();
  await results.getByRole("button", { name: "Done" }).click();

  // --- analysis: the finding, its footing, one action ------------------------
  await page.getByRole("tab", { name: /Insights/ }).click();
  const analysis = page.locator(".analysis-panel");
  await expect(analysis.getByRole("heading", { name: "1 answer you were sure of was wrong" })).toBeVisible();
  await expect(analysis).toContainText("Observed · 1 answer");
  await expect(analysis).toContainText("2 answers on 2 questions.");
  await expect(analysis.getByRole("button", { name: /Review 1 question/ })).toBeVisible();
  await expect(analysis.getByText("What AXOM cannot say yet")).toBeVisible();

  // --- all of it is on disk ---------------------------------------------------
  await reloadAfterSave(page);
  const saved = await readPersistedWorkspace(page);
  const tracing = saved.questions.find((question: SavedQuestion) => question.stem.startsWith("A tracing is shown"));
  const enzyme = saved.questions.find((question: SavedQuestion) => question.stem.startsWith("Which enzyme"));
  expect(tracing).toMatchObject({ module: "FTM 1", week: 2, status: "incorrect" });
  expect(tracing.attachments).toEqual([expect.objectContaining({ fileName: "tracing-1.png", role: "exhibit" })]);
  expect(tracing.attempts).toEqual([expect.objectContaining({ answerKey: "A", status: "incorrect", certainty: "sure", mode: "tutor" })]);
  expect(enzyme.attempts).toEqual([expect.objectContaining({ answerKey: "B", status: "correct", certainty: "unsure" })]);
  // Both answers belong to the one finished block.
  expect(saved.quizSessions).toHaveLength(1);
  expect(tracing.attempts[0].quizSessionId).toBe(saved.quizSessions[0].id);

  const source = saved.questionSets.find((set: SavedSet) => set.title === "Week 2 practice");
  const review = saved.questionSets.find((set: SavedSet) => set.kind === "review");
  expect(source).toMatchObject({ kind: "source", scope: { module: "FTM 1", week: 2 } });
  // The review set points at the same question and sits in the same week.
  expect(review).toMatchObject({ parentSetId: source.id, scope: { module: "FTM 1", week: 2 }, questionIds: [tracing.id] });
  expect(saved.questions).toHaveLength(2);

  await page.getByRole("tab", { name: /Question Sets \(2\)/ }).click();
  await expect(page.locator("details.qset-group").filter({ hasText: "FTM 1" }).locator("summary")).toContainText("2 sets");
  expect(errors).toEqual([]);
});

interface SavedQuestion { id: string; stem: string }
interface SavedSet { id: string; title: string; kind?: string }

async function readPersistedWorkspace(page: Page) {
  return page.evaluate(async ({ dbName, stateKey }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const raw = await new Promise<string>((resolve, reject) => {
      const request = db.transaction("state", "readonly").objectStore("state").get(stateKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.parse(raw).state;
  }, { dbName: STORAGE_KEYS.vaultDb, stateKey: STORAGE_KEYS.persistedState });
}
