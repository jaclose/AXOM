import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

// What a learner answers in a block must be on disk whether or not they reach
// the end of it. Before this, a tutor answer was only written by "Next
// question": leaving from the explanation saved nothing, and leaving an exam
// block discarded every answer in it.

test("a checked tutor answer survives leaving the block and a reload", async ({ page }) => {
  await openSeededSet(page, 3);
  await page.getByRole("button", { name: /Start tutor block/ }).click();

  await page.getByLabel("Question stem").focus();
  await page.keyboard.press("A");
  // 1-3 says how sure, without leaving the keyboard: 3 is "Sure".
  await page.keyboard.press("3");
  await expect(page.getByRole("button", { name: "Sure", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator(".result-banner[role='status']")).toContainText("Incorrect");
  await page.getByLabel("Why did this go wrong?").selectOption("missed-clue");

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe("Leave this block? Answered questions are saved. Unanswered ones are not scored.");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await reloadAfterSave(page);
  const saved = await readPersistedWorkspace(page);
  const attempts = saved.questions.flatMap((question: SavedQuestion) => question.attempts);
  // One attempt, not one per write: the error type amended the checked answer.
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    answerKey: "A", status: "incorrect", mode: "tutor", certainty: "sure", errorType: "missed-clue",
  });
  expect(saved.quizSessions).toHaveLength(1);
  expect(saved.quizSessions[0]).toMatchObject({ id: attempts[0].quizSessionId, mode: "tutor", endedEarly: true });
});

test("the answered questions of an exam block survive leaving it early", async ({ page }) => {
  await openSeededSet(page, 3);
  await page.getByRole("button", { name: "Exam (feedback at the end)" }).click();
  await page.getByRole("button", { name: /Start exam block/ }).click();

  for (const key of ["B", "A"]) {
    await page.getByLabel("Question stem").focus();
    await page.keyboard.press(key);
    await page.getByRole("button", { name: "Submit & next" }).click();
  }
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await reloadAfterSave(page);
  const saved = await readPersistedWorkspace(page);
  const answered = saved.questions.filter((question: SavedQuestion) => question.attempts.length > 0);
  expect(answered).toHaveLength(2);
  expect(new Set(answered.map((question: SavedQuestion) => question.attempts[0].status))).toEqual(new Set(["correct", "incorrect"]));
  expect(saved.quizSessions[0]).toMatchObject({ mode: "exam", endedEarly: true, score: { correct: 1, scored: 2, total: 3 } });
});

test("a block in progress comes back after a reload as it was left", async ({ page }) => {
  await openSeededSet(page, 3);
  await page.getByRole("button", { name: "Exam (feedback at the end)" }).click();
  await page.getByRole("button", { name: /Start exam block/ }).click();

  // Question 1 answered; on question 2 a pick that was not submitted yet.
  await page.getByRole("button", { name: "B. Beta" }).click();
  await page.getByRole("button", { name: "Submit & next" }).click();
  await expect(page.getByRole("heading", { name: "Exam · 2 of 3" })).toBeVisible();
  await page.getByRole("button", { name: "A. Alpha" }).click();

  await reloadAfterSave(page);
  await page.evaluate(() => { window.location.hash = "questions"; });

  // The Question Bank reopens the block by itself: same question, same pick.
  await expect(page.getByRole("heading", { name: "Exam · 2 of 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "A. Alpha" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("button", { name: "B. Beta" })).toHaveAttribute("aria-pressed", "true");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await reloadAfterSave(page);
  const saved = await readPersistedWorkspace(page);
  const answered = saved.questions.filter((question: SavedQuestion) => question.attempts.length > 0);
  expect(answered.map((question: SavedQuestion) => question.attempts[0].answerKey).sort()).toEqual(["A", "B"]);
  expect(saved.quizSessions).toHaveLength(1);
  expect(saved.quizSessions[0]).toMatchObject({ mode: "exam", endedEarly: true, score: { correct: 1, scored: 2, total: 3 } });
});

interface SavedQuestion {
  attempts: Array<{ status: string; answerKey?: string; quizSessionId?: string }>;
}

/** A finished profile, a small synthetic set, and its tutor setup dialog open. */
async function openSeededSet(page: Page, count: number): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await page.evaluate(async (total) => {
    type Dev = {
      useStore: { getState: () => {
        addQuestion: (input: unknown) => { ok: boolean; errors: string[]; id?: string };
        addQuestionSet: (set: unknown) => void;
      } };
      flushVault: () => Promise<void>;
    };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const ids: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const result = dev.useStore.getState().addQuestion({
        id: `block-save-${index + 1}`,
        source: "manual",
        stem: `Synthetic question ${index + 1}: which option is correct?`,
        options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
        correctKey: "B",
        explanation: "Beta is correct in this synthetic item.",
        tags: [],
      });
      if (!result.ok || !result.id) throw new Error(result.errors.join(" "));
      ids.push(result.id);
    }
    dev.useStore.getState().addQuestionSet({
      id: "block-save-set", title: "Block save set", sourceDocumentIds: [], createdAt: new Date().toISOString(),
      questionIds: ids, tags: [], aiEnhanced: false, parserWarnings: [],
    });
    await dev.flushVault();
  }, count);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Practice Block save set", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up a tutor block" })).toBeVisible();
}

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
