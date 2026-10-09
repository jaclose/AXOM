import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

// A block sat in an exam interface is saved by the course engine as one run:
// every answered question gets an attempt that names the run, and the run is
// in the history after a reload.

test("a submitted Examplify block is saved as one run and survives a reload", async ({ page }) => {
  const errors = collectPageErrors(page);
  await openSeededSet(page, 3);
  await page.getByText("Advanced: order, category & exam interface", { exact: true }).click();
  await page.getByRole("radio", { name: /ExamSoft \(Examplify\)/ }).click();
  await page.getByRole("button", { name: "Exam (feedback at the end)" }).click();
  await page.getByRole("button", { name: /Start exam block/ }).click();

  const exam = page.getByRole("dialog", { name: "ExamSoft (Examplify) exam simulation" });
  await expect(exam).toBeVisible();
  // Question 1 right, question 2 wrong, question 3 left unanswered.
  await exam.getByRole("radio", { name: "B. Beta" }).click();
  await exam.getByRole("button", { name: "Next", exact: true }).click();
  await exam.getByRole("radio", { name: "A. Alpha" }).click();

  await exam.getByRole("button", { name: "Exam Controls" }).click();
  await exam.getByRole("menuitem", { name: "Submit Exam" }).click();
  const submit = page.getByRole("alertdialog", { name: "Submit exam?" });
  await expect(submit).toContainText("1 unanswered");
  // The exam makes you mean it: Submit works only after the tick.
  await expect(submit.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await submit.getByRole("checkbox", { name: "I am ready to submit my exam" }).check();
  await submit.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(exam).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review in the exam interface" })).toBeVisible();

  await reloadAfterSave(page);
  const saved = await readPersistedWorkspace(page);
  expect(saved.quizSessions).toHaveLength(1);
  const run = saved.quizSessions[0];
  // A blank in a submitted exam is a wrong answer, so all three are scored. It
  // is not an attempt on the question, so only two attempts are written.
  expect(run).toMatchObject({ simulation: { skin: "examsoft" }, score: { correct: 1, scored: 3, total: 3 } });
  const attempts = saved.questions.flatMap((question: SavedQuestion) => question.attempts);
  expect(attempts).toHaveLength(2);
  expect(attempts.map((attempt: SavedAttempt) => attempt.status).sort()).toEqual(["correct", "incorrect"]);
  for (const attempt of attempts) expect(attempt).toMatchObject({ mode: "simulation", quizSessionId: run.id });
  expect(errors).toEqual([]);
});

interface SavedAttempt {
  status: string;
  answerKey?: string;
  mode?: string;
  quizSessionId?: string;
}
interface SavedQuestion {
  attempts: SavedAttempt[];
}

/** Uncaught errors and console errors, read at the end of a test. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

/** A finished profile, a small synthetic set, and its block setup dialog open. */
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
        id: `sim-save-${index + 1}`,
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
      id: "sim-save-set", title: "Simulation save set", sourceDocumentIds: [], createdAt: new Date().toISOString(),
      questionIds: ids, tags: [], aiEnhanced: false, parserWarnings: [],
    });
    await dev.flushVault();
  }, count);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  await page.getByRole("button", { name: "Practice Simulation save set", exact: true }).click();
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
