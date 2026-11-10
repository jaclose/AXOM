import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createPlatformDatabase, PLATFORM_USERS } from "./fixtures/platformDatabase";

const TITLE = "Synthetic source-checked set";
const STEM = "Which synthetic label is the reviewed answer?";

async function seedLocalWorkspace(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
  await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } }; flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    dev.useStore.getState().updateProfile({
      onboarded: true, tourDone: true, name: "AXOM E2E",
      promisePromptStatus: { state: "skipped", updatedAt: new Date().toISOString(), promptVersion: "promise-prompt-v1" },
      dailyLoopReminders: { checkInEnabled: false, closeoutEnabled: false },
    });
    await dev.flushVault();
  });
  // This page keeps live account requests open, so networkidle is not a stable readiness gate.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
}

async function seedLocalSet(page: Page) {
  await page.evaluate(async ({ title, stem }) => {
    type Dev = {
      useStore: { getState: () => {
        addQuestion: (input: unknown) => { ok: boolean; errors: string[]; id?: string };
        addQuestionSet: (set: unknown) => void;
      } };
      flushVault: () => Promise<void>;
    };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const result = dev.useStore.getState().addQuestion({
      id: "fixture-library-question", source: "manual", stem,
      options: [{ key: "A", text: "First synthetic label" }, { key: "B", text: "Second synthetic label" }],
      correctKey: "B",
      explanation: "AXOM AI-assisted explanation (verify against source): The synthetic source explicitly marks B.",
      choiceRationales: {
        A: "AXOM AI-assisted rationale (verify against source): A conflicts with the synthetic source.",
        B: "AXOM AI-assisted rationale (verify against source): B matches the synthetic source.",
      },
      citation: "Synthetic review fixture, page 1", tags: ["synthetic", "reviewed-synthetic-keyword"],
    });
    if (!result.ok || !result.id) throw new Error(result.errors.join(" "));
    dev.useStore.getState().addQuestionSet({
      id: "fixture-library-set", title, questionIds: [result.id], sourceDocumentIds: [],
      createdAt: new Date().toISOString(), tags: ["synthetic"], parserWarnings: [], aiEnhanced: false,
    });
    await dev.flushVault();
  }, { title: TITLE, stem: STEM });
}

async function openLocalSets(page: Page) {
  await page.goto("/#questions");
  await page.getByRole("tab", { name: /Library/ }).click();
  await page.getByRole("button", { name: "Weeks & sets", exact: true }).click();
  const submit = page.getByRole("button", { name: "Submit to library", exact: true });
  if (!await submit.isVisible()) await page.getByRole("button", { name: TITLE, exact: true }).click();
  await expect(submit).toBeVisible();
}

async function openSharedLibrary(page: Page) {
  await page.goto("/#questions");
  const tab = page.getByRole("tab", { name: /Library/ });
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  const courses = page.getByRole("button", { name: "Courses", exact: true });
  if (await courses.getAttribute("aria-pressed") !== "true") await courses.click();
  const summary = page.getByText("Browse learner Question Sets", { exact: true });
  const heading = page.getByRole("heading", { name: "Find a Question Set" });
  if (!await heading.isVisible()) await summary.click();
  await expect(heading).toBeVisible();
}

test("Question Set Library submit, review, import, like and withdrawal use real SQL authorization", async ({ page, browser, baseURL }) => {
  test.setTimeout(210_000);
  const database = await createPlatformDatabase();
  const [owner, member] = PLATFORM_USERS;
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const errors: string[] = [];
  const unexpected: string[][] = [];
  for (const target of [page, other]) {
    target.setDefaultTimeout(15_000);
    target.setDefaultNavigationTimeout(30_000);
    target.on("pageerror", error => errors.push(error.message));
    target.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    target.on("dialog", dialog => dialog.accept());
  }
  try {
    await database.db.query("insert into public.academic_reviewers(user_id) values($1)", [owner.id]);
    console.info("Question Set Library fixture: migration and reviewer seed complete.");
    for (const [index, target] of [page, other].entries()) {
      unexpected.push(await database.attach(target, index as 0 | 1));
      await target.goto(`${baseURL}/#questions`);
      await seedLocalWorkspace(target);
    }
    console.info("Question Set Library fixture: two synthetic account workspaces ready.");
    await seedLocalSet(page);
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const submit = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await expect(submit).toBeVisible();
    await submit.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await submit.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await submit.getByRole("button", { name: "Send for review" }).click();
    await expect(submit.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();
    console.info("Question Set Library fixture: pending submission created.");
    const [pending] = await database.rpc(owner.id, "my_question_set_library") as Array<{ id: string; status: string }>;
    expect(pending.status).toBe("pending");

    await openSharedLibrary(other);
    await expect(other.getByRole("heading", { name: TITLE })).toHaveCount(0);
    await expect(other.getByText("No sets found", { exact: true })).toBeVisible();
    expect(await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    await page.goto(`${baseURL}/#host`);
    const queue = page.locator(".qsl-review-queue");
    await expect(queue.getByRole("heading", { name: "Question Set Library review" })).toBeVisible();
    await expect(queue.getByText(TITLE, { exact: true })).toBeVisible();
    await queue.getByRole("button", { name: "Inspect" }).click();
    const review = page.getByRole("dialog", { name: `Review ${TITLE}` });
    await expect(review.getByText(STEM, { exact: true })).toBeVisible();
    await review.getByRole("textbox", { name: "Review note" }).fill("Synthetic source and distribution rights checked.");
    await review.getByRole("checkbox", { name: /I checked the set's distribution rights/ }).check();
    await review.getByRole("button", { name: "Approve for library" }).click();
    await expect(queue.getByText("Question Set approved for search.", { exact: true })).toBeVisible();
    console.info("Question Set Library fixture: academic approval recorded.");

    const library = other.locator(".qsl-library");
    await library.getByRole("button", { name: "Refresh", exact: true }).click();
    const card = library.locator(".qsl-card").filter({ hasText: TITLE });
    await expect(card).toBeVisible();
    await card.screenshot({ path: "/tmp/axom-question-set-library-1440.png" });
    await card.getByRole("button", { name: `Like ${TITLE}` }).click();
    await expect(card.getByRole("button", { name: `Unlike ${TITLE}` })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: `Unlike ${TITLE}` }).click();
    await expect(card.getByRole("button", { name: `Like ${TITLE}` })).toHaveAttribute("aria-pressed", "false");
    await card.getByRole("button", { name: "Preview set" }).click();
    const preview = other.getByRole("dialog", { name: TITLE });
    await expect(preview.getByText(STEM, { exact: true })).toBeVisible();
    const revealTeaching = preview.getByText("Reveal recorded answer and teaching notes");
    await expect(revealTeaching).toBeVisible();
    await revealTeaching.click();
    await expect(preview.getByText(/Submitted answer: B/)).toBeVisible();
    await expect(preview.getByText(/AI-assisted teaching text/)).toBeVisible();
    await expect(preview.getByText(/The synthetic source explicitly marks B/)).toBeVisible();
    await expect(preview.getByText(/A conflicts with the synthetic source/)).toBeVisible();
    await expect(preview.getByText(/B matches the synthetic source/)).toBeVisible();
    await preview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect(preview.getByRole("button", { name: "Already in my AXOM" })).toBeDisabled();
    expect(await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
        questionSets: Array<{ title: string; importProvenance?: { shareId: string } }>;
        questions: Array<{ stem: string; correctKey?: string; explanation?: string; choiceRationales?: Record<string, string>; tags: string[] }>;
      } } }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const imported = state.questions.find(question => question.stem === "Which synthetic label is the reviewed answer?");
      return {
        importedSet: state.questionSets.some(set => set.title === "Synthetic source-checked set" && Boolean(set.importProvenance)),
        importedKey: imported?.correctKey,
        aiProvenance: imported?.explanation?.startsWith("AXOM AI-assisted explanation (verify against source):"),
        choiceProvenance: ["A", "B"].every(key => imported?.choiceRationales?.[key]?.startsWith("AXOM AI-assisted rationale (verify against source):")),
        reviewedKeyword: imported?.tags.includes("reviewed-synthetic-keyword"),
      };
    })).toEqual({ importedSet: true, importedKey: "B", aiProvenance: true, choiceProvenance: true, reviewedKeyword: true });
    console.info("Question Set Library fixture: second account previewed, liked and imported.");
    await other.setViewportSize({ width: 390, height: 844 });
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await other.screenshot({ path: "/tmp/axom-question-set-library-390.png" });

    await preview.getByRole("button", { name: "Practice this set" }).click();
    await expect(other.getByRole("dialog", { name: "Set up a tutor block" })).toBeVisible();
    await other.getByRole("button", { name: /Start tutor block/ }).click();
    await other.getByRole("button", { name: "B. Second synthetic label" }).click();
    await other.getByLabel("Question stem").focus();
    await other.keyboard.press("Enter");
    await expect(other.locator(".result-banner[role='status']")).toContainText("Correct");
    await other.getByRole("button", { name: "Finish block" }).click();
    await expect(other.getByRole("dialog", { name: "Block results" })).toContainText("1/1 correct (100%)");
    await other.getByRole("button", { name: "Done", exact: true }).click();
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
        questions: Array<{ stem: string; attempts: Array<{ status: string }> }>;
      } } }> }).__AXOM_DEV__;
      return dev?.useStore.getState().questions.find(question => question.stem === "Which synthetic label is the reviewed answer?")?.attempts;
    })).toMatchObject([{ status: "correct" }]);
    console.info("Question Set Library fixture: imported set practiced and attempt survived reload.");

    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const approved = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await expect(approved.getByText("This set is searchable now.", { exact: true })).toBeVisible();
    await approved.getByRole("button", { name: "Withdraw submission" }).click();
    await expect(approved.getByText("The submission was withdrawn from the library.", { exact: true })).toBeVisible();
    await other.goto(`${baseURL}/#questions`);
    await openSharedLibrary(other);
    expect(await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);
    await library.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(unexpected.flat()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await database.close();
  }
});
