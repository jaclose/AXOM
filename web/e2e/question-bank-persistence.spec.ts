import { expect, test, type Page } from "@playwright/test";
import { STORAGE_KEYS } from "../src/lib/brand";

const PPD_FIXTURE = [
  "1. A 36-year-old man with tuberculosis exposure has a positive PPD skin test. Which cell type primarily mediates this reaction?",
  "A. B lymphocytes",
  "B. CD4+ T lymphocytes",
  "C. Mast cells",
  "D. Eosinophils",
  "E. Neutrophils",
  "Answer: B. CD4+ T lymphocytes",
  "Explanation: The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
  "Learning Objective: Recognize delayed-type hypersensitivity.",
].join("\n");

test("onboarding → import → block → repair → reload retains the full question journey", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/#questions", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Question Bank" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Questions" })).toBeVisible();

  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles({
    name: "ppd-regression.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(PPD_FIXTURE),
  });
  await expect(page.getByText("Review 1 parsed question", { exact: false })).toBeVisible();

  const draft = page.locator(".import-draft").first();
  await draft.locator("button.card-row-main").click();
  await expect(draft.getByLabel("Correct answer")).toHaveValue("B");
  await expect(draft.getByRole("textbox", { name: "Option E" })).toHaveValue("Neutrophils");
  await expect(draft.getByLabel("Explanation or rationale")).toHaveValue(
    "The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
  );

  await draft.getByLabel("Question number").fill("12");
  await draft.getByLabel("Stem").fill(
    "A 36-year-old man with tuberculosis exposure has a positive PPD skin test. Which cell type primarily mediates this reaction? Select the best answer.",
  );
  await draft.getByRole("textbox", { name: "Option B" }).fill("CD4+ T lymphocytes (Th1)");
  await draft.getByLabel("Correct answer").selectOption("C");
  await draft.getByLabel("Correct answer").selectOption("B");
  await draft.getByLabel("Reference / source").fill("Reviewed immunology handout");
  await draft.getByLabel("Explanation or rationale").fill(
    "The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages. Reviewed before finalization.",
  );
  await draft.getByRole("button", { name: "+ Add option", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finalize import" })).toBeDisabled();
  await draft.getByRole("textbox", { name: "Option F" }).fill("Transient review choice");
  await draft.getByRole("button", { name: "Remove option F" }).click();
  await expect(page.getByRole("button", { name: "Finalize import" })).toBeEnabled();

  await page.getByLabel("Set title").fill("AXOM persisted journey");
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  const setCard = page.locator("article.qset-card").filter({ hasText: "AXOM persisted journey" });
  await expect(setCard).toBeVisible();

  await setCard.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("dialog", { name: "Set up a tutor block" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("AXOM persisted block"));
  await page.getByRole("button", { name: "Save as block" }).click();
  await page.getByRole("button", { name: /Start tutor block/ }).click();

  const questionRegion = page.locator(".tutor-question-region");
  const stemBox = await page.getByLabel("Question stem").boundingBox();
  const firstOptionBox = await page.getByRole("button", { name: "A. B lymphocytes" }).boundingBox();
  expect(stemBox).toBeTruthy();
  expect(firstOptionBox).toBeTruthy();
  expect(firstOptionBox!.y - (stemBox!.y + stemBox!.height)).toBeGreaterThanOrEqual(24);

  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.getByRole("dialog", { name: "Calculator" })).toBeVisible();
  expect(await questionRegion.evaluate((region) => region.contains(document.querySelector('[role="dialog"][aria-label="Calculator"]')))).toBe(false);
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Close calculator tools" }).click();
  await expect(page.getByRole("button", { name: "Calculator" })).toBeFocused();
  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.locator(".quiz-calc-expr")).toHaveText("7");
  await page.getByRole("button", { name: "Close calculator tools" }).click();

  await page.getByRole("button", { name: "Question notes" }).click();
  await page.getByRole("textbox", { name: "Question note" }).fill("Persistent local Tutor note");
  await page.getByRole("button", { name: "Close notes tools" }).click();
  await page.getByRole("button", { name: "Text settings" }).click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Increase reading size" }).click();
  }
  await expect(page.getByText("140% question text")).toBeVisible();
  await page.getByRole("button", { name: "Close text tools" }).click();

  await page.getByRole("button", { name: "Highlight tools" }).click();
  await page.getByRole("button", { name: "Yellow persistent highlight" }).click();
  await selectTutorText(page, "positive PPD");
  await expect(page.locator("mark.question-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "Cyan persistent highlight" }).click();
  await selectTutorText(page, "cell type");
  await expect(page.locator("mark.question-highlight")).toHaveCount(2);
  await page.getByRole("button", { name: "Erase highlights" }).click();
  await page.locator("mark.question-highlight").first().click();
  await expect(page.locator("mark.question-highlight")).toHaveCount(1);

  for (const viewport of [
    { width: 768, height: 900 },
    { width: 430, height: 880 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Question notes" }).click();
    await expect(page.getByRole("region", { name: "notes tools" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await questionRegion.evaluate((region) => region.scrollWidth <= region.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-tutor-workspace-phase2-${viewport.width}px.png`, fullPage: true });
    await page.getByRole("button", { name: "Close notes tools" }).click();
    await expect(page.getByRole("button", { name: "Question notes" })).toBeFocused();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "/tmp/axom-tutor-workspace-phase2-desktop.png", fullPage: true });

  await page.getByLabel("Question stem").focus();
  await page.keyboard.press("A");
  await expect(page.getByRole("button", { name: "A. B lymphocytes" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator(".result-banner[role='status']")).toContainText("Incorrect — you picked A, answer is B");
  await expect(page.locator(".feedback-explanation p")).toHaveText(
    "The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages. Reviewed before finalization.",
  );

  await page.getByRole("button", { name: "Repair card" }).click();
  await page.getByLabel("Why did this go wrong?").selectOption("knowledge-gap");
  await page.getByRole("button", { name: "Confidence 4 of 5" }).click();
  await page.getByRole("button", { name: "Finish block" }).click();
  await expect(page.getByRole("dialog", { name: "Block results" })).toContainText("0/1 correct (0%)");
  await expect(page.getByText("What next?")).toBeVisible();
  await page.getByRole("button", { name: "Create set from missed" }).click();
  await expect(page.getByRole("button", { name: "Review set created", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Done" }).click();

  await expect.poll(async () => (await readPersistedWorkspace(page)).questions?.[0]?.attempts?.length ?? 0).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Question Sets/ }).click();
  const reloadedCard = page.locator("article.qset-card").filter({ hasText: "AXOM persisted journey" });
  await expect(reloadedCard).toBeVisible();
  await expect(reloadedCard.getByLabel("0% current mastery")).toHaveClass(/red/);
  await expect(reloadedCard.getByText("Attempt accuracy 0% · 1 total attempt")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((root, resolvedTheme) => root.setAttribute("data-theme", resolvedTheme), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(reloadedCard).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator(".surface-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  const persisted = await readPersistedWorkspace(page);
  expect(persisted.schemaVersion).toBe(34);
  expect(persisted.questions).toHaveLength(1);
  expect(persisted.questions[0]).toMatchObject({
    correctKey: "B",
    correctAnswerText: "CD4+ T lymphocytes (Th1)",
    questionNumber: 12,
    citation: "Reviewed immunology handout",
    stem: expect.stringContaining("Select the best answer"),
    explanation: expect.stringContaining("Reviewed before finalization"),
    notes: "Persistent local Tutor note",
  });
  expect(persisted.questions[0].annotations).toHaveLength(1);
  expect(persisted.questions[0].options.map((option: { key: string }) => option.key)).toEqual(["A", "B", "C", "D", "E"]);
  expect(persisted.questions[0].attempts[0]).toMatchObject({
    answerKey: "A",
    status: "incorrect",
    confidence: 4,
    errorType: "knowledge-gap",
  });
  expect(persisted.questionSets).toHaveLength(2);
  const importedSet = persisted.questionSets.find((set: { title: string }) => set.title === "AXOM persisted journey");
  const missedSet = persisted.questionSets.find((set: { tags: string[] }) => set.tags.includes("missed-review"));
  expect(persisted.documents[0].linkedQuestionSetIds).toEqual([importedSet!.id]);
  expect(importedSet!.sourceDocumentIds).toEqual([persisted.documents[0].id]);
  expect(missedSet!.questionIds).toEqual([persisted.questions[0].id]);
  expect(persisted.quizBlocks[0]).toMatchObject({ title: "AXOM persisted block" });
  expect(persisted.quizBlocks[0].lastRunAt).toBeTruthy();
  expect(persisted.ankiCards).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "error-repair", questionId: persisted.questions[0].id }),
  ]));

  const storageEvidence = await page.evaluate(async ({ dbName, stateKey }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...db.objectStoreNames];
    db.close();
    return {
      stores,
      workspaceInLocalStorage: localStorage.getItem(stateKey),
      scopedWorkspaceInLocalStorage: Object.keys(localStorage).some((key) => key.startsWith(`${stateKey}:user:`)),
    };
  }, { dbName: STORAGE_KEYS.vaultDb, stateKey: STORAGE_KEYS.persistedState });
  expect(storageEvidence.stores.sort()).toEqual(["backups", "questionAttachmentBlobs", "state"]);
  expect(storageEvidence.workspaceInLocalStorage).toBeNull();
  expect(storageEvidence.scopedWorkspaceInLocalStorage).toBe(false);
  expect(browserErrors).toEqual([]);
});

async function selectTutorText(page: Page, phrase: string): Promise<void> {
  await page.getByLabel("Question stem").evaluate((root, selectedPhrase) => {
    const fullText = root.textContent ?? "";
    const start = fullText.indexOf(selectedPhrase);
    if (start < 0) throw new Error(`Could not find selection phrase: ${selectedPhrase}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let cursor = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      nodes.push({ node, start: cursor, end: cursor + node.data.length });
      cursor += node.data.length;
    }
    const startNode = nodes.find((entry) => start >= entry.start && start <= entry.end);
    const endOffset = start + selectedPhrase.length;
    const endNode = nodes.find((entry) => endOffset >= entry.start && endOffset <= entry.end);
    if (!startNode || !endNode) throw new Error("Could not resolve selection text nodes.");
    const range = document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, endOffset - endNode.start);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, phrase);
}

async function completeOnboarding(page: Page): Promise<void> {
  await page.getByLabel("Display name (optional)").fill("AXOM E2E");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
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
