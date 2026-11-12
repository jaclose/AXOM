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
      // Fresh submissions must use the exact source-recorded choice keys.
      // Invalid later edits are rejected by the live SQL integrity guard.
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

async function seedFourQuestionEvidenceSet(page: Page) {
  await page.evaluate(async ({ title }) => {
    type Dev = {
      useStore: { getState: () => {
        addQuestion: (input: unknown) => { ok: boolean; errors: string[]; id?: string };
        addQuestionSet: (set: unknown) => void;
      } };
      flushVault: () => Promise<void>;
    };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const questionIds: string[] = [];
    for (let index = 0; index < 4; index++) {
      const options = [{ key: "A", text: "First synthetic label" }, { key: "B", text: "Second synthetic label" }];
      const result = dev.useStore.getState().addQuestion({
        id: `fixture-coverage-q-${index + 1}`, source: "manual",
        stem: `Which synthetic label is reviewed in item ${index + 1}?`,
        options, correctKey: "B",
        explanation: "AXOM AI-assisted explanation (verify against source): The synthetic fixture records B.",
        // Q4 is an approved *synthetic* historical coverage gap, not a
        // license to synthesize its missing citation or B rationale.
        choiceRationales: index === 3
          ? { A: "AXOM AI-assisted rationale (verify against source): The synthetic fixture excludes A." }
          : {
            A: "AXOM AI-assisted rationale (verify against source): The synthetic fixture excludes A.",
            B: "AXOM AI-assisted rationale (verify against source): The synthetic fixture records B.",
          },
        ...(index < 3 ? { citation: `Synthetic source fixture, page ${index + 1}` } : {}),
        tags: ["synthetic", "reviewed-synthetic-keyword"],
      });
      if (!result.ok || !result.id) throw new Error(result.errors.join(" "));
      questionIds.push(result.id);
    }
    dev.useStore.getState().addQuestionSet({
      id: "fixture-coverage-set", title, questionIds, sourceDocumentIds: [],
      createdAt: new Date().toISOString(), tags: ["synthetic"], parserWarnings: [], aiEnhanced: false,
    });
    await dev.flushVault();
  }, { title: TITLE });
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

    // Source/rights attestations and submission precede these negative tests.
    // Even privileged direct writes must not launder whitespace-padded
    // rationales or answer keys into a pending set for academic approval.
    const beforeTamper = await database.rpc(owner.id, "get_question_set_library", { p_id: pending.id }) as {
      review_revision: number;
      snapshot_payload: { questions: Array<{ correctKey: string; choiceRationales?: Record<string, string> }> };
    };
    const submittedQuestion = beforeTamper.snapshot_payload.questions[0];
    expect(submittedQuestion.correctKey).toBe("B");
    expect(Object.keys(submittedQuestion.choiceRationales ?? {}).sort()).toEqual(["A", "B"]);
    const invalidRationales = Object.fromEntries(Object.entries(submittedQuestion.choiceRationales ?? {})
      .map(([key, rationale]) => [` ${key.toLowerCase()} `, rationale]));
    await expect(database.db.query(
      `update public.question_set_library_entries
          set snapshot_payload = jsonb_set(snapshot_payload, '{questions,0,choiceRationales}', $2::jsonb)
        where id = $1 and status = 'pending'`,
      [pending.id, JSON.stringify(invalidRationales)],
    )).rejects.toThrow(/Question Set choice rationales contain invalid scalar types/);
    await expect(database.db.query(
      `update public.question_set_library_entries
          set snapshot_payload = jsonb_set(snapshot_payload, '{questions,0,correctKey}', '" b "'::jsonb)
        where id = $1 and status = 'pending'`,
      [pending.id],
    )).rejects.toThrow(/Question Set snapshot has inconsistent membership or answer evidence/);
    const afterTamper = await database.rpc(owner.id, "get_question_set_library", { p_id: pending.id }) as typeof beforeTamper;
    expect(afterTamper).toEqual(beforeTamper);
    // Rejected mutations must not advance the protected review revision or
    // make the pending set public. Continue with the original valid snapshot.

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
    // The learner's restricted RPC must return precisely what was attested
    // and approved, never either rejected privileged mutation.
    const approvedEvidence = await database.rpc(member.id, "get_question_set_library", { p_id: pending.id }) as {
      status: string; review_revision: number;
      snapshot_payload: { questions: Array<{ correctKey?: string; choiceRationales?: Record<string, string> }> };
    };
    expect(approvedEvidence.status).toBe("approved");
    expect(approvedEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(approvedEvidence.snapshot_payload).toEqual(beforeTamper.snapshot_payload);
    expect(Object.keys(approvedEvidence.snapshot_payload.questions[0].choiceRationales ?? {}).sort()).toEqual(["A", "B"]);

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
    await expect(preview.getByText("Source: Synthetic review fixture, page 1")).toBeVisible();
    await expect(preview.getByText(/The synthetic source explicitly marks B/)).toBeVisible();
    await expect(preview.getByText(/A conflicts with the synthetic source/)).toBeVisible();
    await expect(preview.getByText(/B matches the synthetic source/)).toBeVisible();
    // Identity may leave and return before React renders account B. A preview
    // inspected in the old session must lose import permission even when the
    // final account ID equals the ID that originally opened the modal.
    await other.evaluate(async ({ memberId, ownerId }) => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useAccount: {
          getState: () => { user: { id: string } | null };
          setState: (patch: { user: { id: string } | null }) => void;
        };
      }> }).__AXOM_DEV__;
      const original = dev.useAccount.getState().user;
      if (original?.id !== memberId) throw new Error("Expected learner B before session epoch test");
      dev.useAccount.setState({ user: { ...original, id: ownerId } });
      dev.useAccount.setState({ user: original });
    }, { memberId: member.id, ownerId: owner.id });
    await expect(preview).toHaveCount(0);
    expect(await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => {
          questionSets: Array<{ importProvenance?: { shareId: string } }>;
        } };
      }> }).__AXOM_DEV__;
      return dev.useStore.getState().questionSets.some(set => set.importProvenance);
    })).toBe(false);
    // Interrupt the real learner flow after SQL import authorization, but
    // before the private vault commit. A completed server response must not
    // authorize persistence after an invisible B → A → B account round trip.
    await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: {
          getState: () => { commitSharedQuestionSetImport: (value: unknown) => Promise<unknown> };
          setState: (patch: { commitSharedQuestionSetImport: (value: unknown) => Promise<unknown> }) => void;
        };
      }> }).__AXOM_DEV__;
      const original = dev.useStore.getState().commitSharedQuestionSetImport;
      let release!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      const boundary = {
        reached: false, completed: false,
        resume: () => {
          dev.useStore.setState({ commitSharedQuestionSetImport: original });
          release();
        },
      };
      (window as unknown as { __qslImportBoundary?: typeof boundary }).__qslImportBoundary = boundary;
      dev.useStore.setState({
        commitSharedQuestionSetImport: async (payload: unknown) => {
          boundary.reached = true;
          await hold;
          try { return await original(payload); }
          finally { boundary.completed = true; }
        },
      });
    });
    await card.getByRole("button", { name: "Preview set" }).click();
    await expect(preview.getByText(STEM, { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect.poll(() => other.evaluate(() =>
      (window as unknown as { __qslImportBoundary?: { reached: boolean } }).__qslImportBoundary?.reached ?? false,
    )).toBe(true);
    await other.evaluate(async ({ memberId, ownerId }) => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useAccount: {
          getState: () => { user: { id: string } | null };
          setState: (patch: { user: { id: string } | null }) => void;
        };
      }> }).__AXOM_DEV__;
      const original = dev.useAccount.getState().user;
      if (original?.id !== memberId) throw new Error("Expected learner B at vault import boundary");
      dev.useAccount.setState({ user: { ...original, id: ownerId } });
      dev.useAccount.setState({ user: original });
    }, { memberId: member.id, ownerId: owner.id });
    await expect(preview).toHaveCount(0);
    await other.evaluate(() => {
      (window as unknown as { __qslImportBoundary?: { resume: () => void } }).__qslImportBoundary?.resume();
    });
    await expect.poll(() => other.evaluate(() =>
      (window as unknown as { __qslImportBoundary?: { completed: boolean } }).__qslImportBoundary?.completed ?? false,
    )).toBe(true);
    expect(await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { questionSets: Array<{ importProvenance?: { shareId: string } }> } };
      }> }).__AXOM_DEV__;
      return dev.useStore.getState().questionSets.some(set => set.importProvenance);
    })).toBe(false);
    await other.evaluate(() => {
      delete (window as unknown as { __qslImportBoundary?: unknown }).__qslImportBoundary;
    });
    // Retain the unchanged public approval; a fresh learner inspection should
    // be able to obtain a new revision-bound import grant.
    await card.getByRole("button", { name: "Preview set" }).click();
    await expect(preview.getByText(STEM, { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect(preview.getByRole("button", { name: "Already in my AXOM" })).toBeDisabled();

    // Real Chromium acceptance for the Community teaching disclosures.
    // jsdom cannot validate native <summary> Enter/Space activation.
    // The imported set still offers Practice, while Add is now disabled.
    const teachingSummary = preview.getByText("Reveal recorded answer and teaching notes");
    const topicSummary = preview.getByText("Reveal set topic tags");
    const teachingDetails = teachingSummary.locator("..");
    const topicDetails = topicSummary.locator("..");
    await expect(teachingSummary).toHaveAccessibleName("Reveal recorded answer and teaching notes for question 1");
    await expect(teachingSummary).toHaveAttribute("tabindex", "0");
    await expect(topicSummary).toHaveAttribute("tabindex", "0");
    await expect(teachingDetails).not.toHaveAttribute("open", "");
    await expect(topicDetails).not.toHaveAttribute("open", "");
    await expect(preview.getByText(/Submitted answer: B/)).toBeHidden();
    await expect(preview.getByText("Source: Synthetic review fixture, page 1")).toBeHidden();

    await preview.getByRole("button", { name: "Practice this set" }).focus();
    await other.keyboard.press("Shift+Tab");
    await expect(teachingSummary).toBeFocused();
    await other.keyboard.press("Enter");
    await expect(teachingDetails).toHaveAttribute("open", "");
    await expect(preview.getByText(/Submitted answer: B/)).toBeVisible();
    await expect(preview.getByText("Source: Synthetic review fixture, page 1")).toBeVisible();
    await other.keyboard.press("Shift+Tab");
    await expect(topicSummary).toBeFocused();
    await other.keyboard.press("Space");
    await expect(topicDetails).toHaveAttribute("open", "");
    await other.keyboard.press("Space");
    await expect(topicDetails).not.toHaveAttribute("open", "");

    expect(await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
        questionSets: Array<{ title: string; importProvenance?: { shareId: string } }>;
        questions: Array<{ stem: string; correctKey?: string; explanation?: string; choiceRationales?: Record<string, string>; citation?: string; tags: string[] }>;
      } } }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const imported = state.questions.find(question => question.stem === "Which synthetic label is the reviewed answer?");
      return {
        importedSet: state.questionSets.some(set => set.title === "Synthetic source-checked set" && Boolean(set.importProvenance)),
        importedKey: imported?.correctKey,
        aiProvenance: imported?.explanation?.startsWith("AXOM AI-assisted explanation (verify against source):"),
        choiceProvenance: ["A", "B"].every(key => imported?.choiceRationales?.[key]?.startsWith("AXOM AI-assisted rationale (verify against source):")),
        recordedRationaleKeys: Object.keys(imported?.choiceRationales ?? {}).sort(),
        sourceCitation: imported?.citation === "Synthetic review fixture, page 1",
        reviewedKeyword: imported?.tags.includes("reviewed-synthetic-keyword"),
      };
    })).toEqual({ importedSet: true, importedKey: "B", aiProvenance: true, choiceProvenance: true,
      recordedRationaleKeys: ["A", "B"], sourceCitation: true, reviewedKeyword: true });
    // Neither a rejected tamper attempt nor a valid private import may
    // rewrite the reviewer-approved snapshot or revision-bound evidence.
    const afterImportEvidence = await database.rpc(member.id, "get_question_set_library", { p_id: pending.id }) as typeof approvedEvidence;
    expect(afterImportEvidence.snapshot_payload).toEqual(approvedEvidence.snapshot_payload);
    expect(afterImportEvidence.review_revision).toBe(approvedEvidence.review_revision);
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

test("four-question SQL-approved set discloses unseen citation and distractor gaps before private import", async ({ page, browser, baseURL }) => {
  test.setTimeout(210_000);
  const database = await createPlatformDatabase();
  const [owner, member] = PLATFORM_USERS;
  const learnerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const learner = await learnerContext.newPage();
  try {
    await database.db.query("insert into public.academic_reviewers(user_id) values($1)", [owner.id]);
    await database.attach(page, 0);
    await database.attach(learner, 1);
    for (const target of [page, learner]) {
      await target.goto(`${baseURL}/#questions`);
      await seedLocalWorkspace(target);
    }
    await seedFourQuestionEvidenceSet(page);
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const submit = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await submit.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await submit.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await submit.getByRole("button", { name: "Send for review" }).click();
    await expect(submit.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [pending] = await database.rpc(owner.id, "my_question_set_library") as Array<{ id: string; status: string }>;
    expect(pending.status).toBe("pending");
    const pendingEvidence = await database.rpc(owner.id, "get_question_set_library", { p_id: pending.id }) as {
      snapshot_payload: { questions: Array<{
        stem: string; correctKey: string; citation?: string; choiceRationales?: Record<string, string>;
      }> };
      review_revision: number;
    };
    expect(pendingEvidence.review_revision).toBeGreaterThan(0);
    const submittedQuestions = pendingEvidence.snapshot_payload.questions;
    expect(submittedQuestions).toHaveLength(4);
    expect(submittedQuestions.every(question => question.correctKey === "B")).toBe(true);
    expect(submittedQuestions.slice(0, 3).every(question => Boolean(question.citation?.trim()))).toBe(true);
    expect(submittedQuestions[3].citation?.trim()).toBeFalsy();
    expect(Object.keys(submittedQuestions[3].choiceRationales ?? {})).toEqual(["A"]);
    // No unsigned set is searchable by the other learner.
    expect(await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    await page.goto(`${baseURL}/#host`);
    const queue = page.locator(".qsl-review-queue");
    await expect(queue.getByRole("heading", { name: "Question Set Library review" })).toBeVisible();
    await queue.getByRole("button", { name: "Inspect" }).click();
    const review = page.getByRole("dialog", { name: `Review ${TITLE}` });
    await review.getByRole("textbox", { name: "Review note" })
      .fill("Synthetic four-item fixture reviewed; fourth item intentionally has incomplete recorded teaching evidence.");
    await review.getByRole("checkbox", { name: /I checked the set's distribution rights/ }).check();
    await review.getByRole("button", { name: "Approve for library" }).click();
    await expect(queue.getByText("Question Set approved for search.", { exact: true })).toBeVisible();

    const approvedEvidence = await database.rpc(member.id, "get_question_set_library", { p_id: pending.id }) as
      typeof pendingEvidence & { status: string };
    expect(approvedEvidence.status).toBe("approved");
    expect(approvedEvidence.snapshot_payload).toEqual(pendingEvidence.snapshot_payload);
    expect(approvedEvidence.review_revision).toBeGreaterThan(pendingEvidence.review_revision);

    await openSharedLibrary(learner);
    const library = learner.locator(".qsl-library");
    await library.getByRole("button", { name: "Refresh", exact: true }).click();
    const card = library.locator(".qsl-card").filter({ hasText: TITLE });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Preview set" }).click();
    const preview = learner.getByRole("dialog", { name: TITLE });
    await expect(preview.getByText("Source citations recorded for 3 of 4 questions.", { exact: false })).toBeVisible();
    await expect(preview.getByText("Choice-by-choice rationales recorded for all options in 3 of 4 questions.", { exact: false })).toBeVisible();
    await expect(preview.getByText("Which synthetic label is reviewed in item 1?", { exact: true })).toBeVisible();
    await expect(preview.getByText("Which synthetic label is reviewed in item 4?", { exact: true })).toHaveCount(0);
    await preview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect(preview.getByRole("button", { name: "Already in my AXOM" })).toBeDisabled();

    const imported = await learner.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => {
          questionSets: Array<{ title: string; questionIds: string[]; importProvenance?: { shareId: string } }>;
          questions: Array<{ stem: string; correctKey?: string; citation?: string; choiceRationales?: Record<string, string> }>;
        } };
      }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const fourth = state.questions.find(question => question.stem === "Which synthetic label is reviewed in item 4?");
      return {
        importedSet: state.questionSets.some(set => set.title === "Synthetic source-checked set"
          && set.questionIds.length === 4 && Boolean(set.importProvenance)),
        fourthKey: fourth?.correctKey,
        fourthHasCitation: Boolean(fourth?.citation?.trim()),
        fourthRationaleKeys: Object.keys(fourth?.choiceRationales ?? {}),
      };
    });
    expect(imported).toEqual({ importedSet: true, fourthKey: "B", fourthHasCitation: false, fourthRationaleKeys: ["A"] });
    // Import must neither fill missing teaching claims nor rewrite the reviewed
    // SQL snapshot or review revision. Account-bound private data stays private.
    const afterImportEvidence = await database.rpc(member.id, "get_question_set_library", { p_id: pending.id }) as typeof approvedEvidence;
    expect(afterImportEvidence.snapshot_payload).toEqual(approvedEvidence.snapshot_payload);
    expect(afterImportEvidence.review_revision).toBe(approvedEvidence.review_revision);
  } finally {
    await learnerContext.close();
    await database.close();
  }
});

test("withdrawn publication cannot be imported from an already-open learner preview", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const database = await createPlatformDatabase();
  const [owner, member] = PLATFORM_USERS;
  const learnerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const learner = await learnerContext.newPage();
  try {
    await database.db.query("insert into public.academic_reviewers(user_id) values($1)", [owner.id]);
    await database.attach(page, 0);
    await database.attach(learner, 1);
    for (const target of [page, learner]) {
      await target.goto(`${baseURL}/#questions`);
      await seedLocalWorkspace(target);
    }
    await seedLocalSet(page);
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const submit = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await submit.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await submit.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await submit.getByRole("button", { name: "Send for review" }).click();
    await expect(submit.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [pending] = await database.rpc(owner.id, "my_question_set_library") as Array<{ id: string; status: string }>;
    expect(pending.status).toBe("pending");
    await page.goto(`${baseURL}/#host`);
    const queue = page.locator(".qsl-review-queue");
    await expect(queue.getByRole("heading", { name: "Question Set Library review" })).toBeVisible();
    await queue.getByRole("button", { name: "Inspect" }).click();
    const review = page.getByRole("dialog", { name: `Review ${TITLE}` });
    await review.getByRole("textbox", { name: "Review note" }).fill("Synthetic source and distribution rights verified for this fixture.");
    await review.getByRole("checkbox", { name: /I checked the set's distribution rights/ }).check();
    await review.getByRole("button", { name: "Approve for library" }).click();
    await expect(queue.getByText("Question Set approved for search.", { exact: true })).toBeVisible();

    const approvedEvidence = await database.rpc(member.id, "get_question_set_library", { p_id: pending.id }) as {
      status: string; review_revision: number;
      snapshot_payload: { questions: Array<{ correctKey: string }> };
    };
    expect(approvedEvidence.status).toBe("approved");
    expect(approvedEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    await openSharedLibrary(learner);
    const library = learner.locator(".qsl-library");
    await library.getByRole("button", { name: "Refresh", exact: true }).click();
    const card = library.locator(".qsl-card").filter({ hasText: TITLE });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Preview set" }).click();
    const preview = learner.getByRole("dialog", { name: TITLE });
    await expect(preview.getByText(STEM, { exact: true })).toBeVisible();
    await expect(preview.getByRole("button", { name: "Add to my AXOM" })).toBeEnabled();

    const privateBefore = await learner.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { questions: unknown[]; questionSets: unknown[] } };
      }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      return { questions: state.questions.length, sets: state.questionSets.length };
    });

    // The contributor withdraws *after* the learner has inspected an
    // approved snapshot, but before the learner's import RPC. The UI may
    // still display stale content; it must never treat that as authority.
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const existing = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await expect(existing.getByText("This set is searchable now.", { exact: true })).toBeVisible();
    // Playwright auto-dismisses native confirms when no listener is attached.
    // A dismissed confirm is a cancelled withdrawal, not a server failure.
    const confirmationEvent = page.waitForEvent("dialog");
    const withdrawalClick = existing.getByRole("button", { name: "Withdraw submission" }).click();
    const confirmation = await confirmationEvent;
    expect(confirmation.type()).toBe("confirm");
    expect(confirmation.message()).toContain("Withdraw this Question Set from the shared library?");
    await confirmation.accept();
    await withdrawalClick;
    await expect(existing.getByText("The submission was withdrawn from the library.", { exact: true })).toBeVisible();
    expect(await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    // The installed withdrawal RPC deletes the owner's listing rather
    // than rewriting an approved snapshot. A deleted approval cannot be
    // used as authority by an already-open learner preview.
    const withdrawnResult = await database.db.query(
      "select id from public.question_set_library_entries where id = $1",
      [pending.id],
    );
    expect(withdrawnResult.rows).toEqual([]);
    expect(approvedEvidence.snapshot_payload.questions[0].correctKey).toBe("B");

    // The author can resubmit the *identical* source snapshot, but withdrawal
    // must terminate the old attestations and approval. This creates a distinct
    // publication identity and requires a new academic decision.
    const freshRights = existing.getByRole("checkbox", { name: /permission to distribute every question/ });
    const freshAnswers = existing.getByRole("checkbox", { name: /checked every answer against its source/ });
    const freshSend = existing.getByRole("button", { name: "Send for review" });
    await expect(freshRights).not.toBeChecked();
    await expect(freshAnswers).not.toBeChecked();
    await expect(freshSend).toBeDisabled();
    await freshRights.check();
    await expect(freshSend).toBeDisabled();
    await freshAnswers.check();
    await freshSend.click();
    await expect(existing.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [resubmitted] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(resubmitted.status).toBe("pending");
    expect(resubmitted.id).not.toBe(pending.id);
    const newPending = await database.rpc(owner.id, "get_question_set_library", { p_id: resubmitted.id }) as
      typeof approvedEvidence;
    // Re-serialization intentionally stamps a fresh createdAt; compare the
    // source projection, not the new submission's independently timed receipt.
    const firstSource = approvedEvidence.snapshot_payload as typeof approvedEvidence.snapshot_payload & { createdAt: string };
    const secondSource = newPending.snapshot_payload as typeof newPending.snapshot_payload & { createdAt: string };
    expect({ ...secondSource, createdAt: firstSource.createdAt }).toEqual(firstSource);
    expect(newPending.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    await page.goto(`${baseURL}/#host`);
    const newQueue = page.locator(".qsl-review-queue");
    await expect(newQueue.getByRole("heading", { name: "Question Set Library review" })).toBeVisible();
    await newQueue.getByRole("button", { name: "Inspect" }).click();
    const newReview = page.getByRole("dialog", { name: `Review ${TITLE}` });
    await expect(newReview.getByText(STEM, { exact: true })).toBeVisible();
    await newReview.getByRole("textbox", { name: "Review note" })
      .fill("Independently rechecked identical synthetic source and distribution rights for this new submission.");
    await newReview.getByRole("checkbox", { name: /I checked the set's distribution rights/ }).check();
    await newReview.getByRole("button", { name: "Approve for library" }).click();
    await expect(newQueue.getByText("Question Set approved for search.", { exact: true })).toBeVisible();
    const newApproval = await database.rpc(member.id, "get_question_set_library", { p_id: resubmitted.id }) as
      typeof approvedEvidence;
    expect(newApproval.status).toBe("approved");
    expect(newApproval.snapshot_payload).toEqual(newPending.snapshot_payload);
    expect(newApproval.review_revision).toBeGreaterThan(newPending.review_revision);
    const relisted = await database.rpc(member.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 }) as
      Array<{ id: string }>;
    expect(relisted.map(item => item.id)).toEqual([resubmitted.id]);
    expect((await database.db.query(
      "select id from public.question_set_library_entries where id = $1", [pending.id],
    )).rows).toEqual([]);

    // A previously inspected snapshot is not a durable import grant.
    await expect(preview.getByText(STEM, { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect(learner.locator(".qsl-error")).toContainText(/changed or was withdrawn/i);
    await expect(learner.getByRole("button", { name: "Add to my AXOM" })).toHaveCount(0);
    expect(await learner.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { questions: unknown[]; questionSets: unknown[] } };
      }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      return { questions: state.questions.length, sets: state.questionSets.length };
    })).toEqual(privateBefore);
    await learner.getByRole("dialog", { name: "Question Set preview" })
      .getByRole("button", { name: "Close" }).click();
    await library.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Preview set" }).click();
    const newPreview = learner.getByRole("dialog", { name: TITLE });
    await expect(newPreview.getByText(STEM, { exact: true })).toBeVisible();
    await newPreview.getByRole("button", { name: "Add to my AXOM" }).click();
    await expect(newPreview.getByRole("button", { name: "Already in my AXOM" })).toBeDisabled();
    const privateAfter = await learner.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => {
          questions: Array<{ stem: string; correctKey?: string }>;
          questionSets: Array<{ importProvenance?: { shareId: string } }>;
        } };
      }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      return {
        key: state.questions.find(question => question.stem === "Which synthetic label is the reviewed answer?")?.correctKey,
        importedShareIds: state.questionSets.map(set => set.importProvenance?.shareId).filter(Boolean),
      };
    });
    expect(privateAfter).toEqual({ key: "B", importedShareIds: [resubmitted.id] });
    const afterImport = await database.rpc(member.id, "get_question_set_library", { p_id: resubmitted.id }) as
      typeof newApproval;
    expect(afterImport.snapshot_payload).toEqual(newApproval.snapshot_payload);
    expect(afterImport.review_revision).toBe(newApproval.review_revision);
  } finally {
    await learnerContext.close();
    await database.close();
  }
});

test("same-owner tabs revoke stale attestations across SQL submission and withdrawal", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const database = await createPlatformDatabase();
  const [owner, learner] = PLATFORM_USERS;
  // Both pages intentionally share a browser context and owner account. This
  // exercises the real storage event, not a synthetic event dispatched by a test.
  const second = await page.context().newPage();
  try {
    const ownerUnexpected = await database.attach(page, 0);
    await page.goto(`${baseURL}/#questions`);
    await seedLocalWorkspace(page);
    await seedLocalSet(page);

    const secondUnexpected = await database.attach(second, 0);
    await second.goto(`${baseURL}/#questions`);
    await seedLocalWorkspace(second);
    await openLocalSets(second);
    await second.getByRole("button", { name: "Submit to library", exact: true }).click();
    const staleTab = second.getByRole("dialog", { name: `Submit ${TITLE}` });
    await expect(staleTab).toBeVisible();
    const staleRights = staleTab.getByRole("checkbox", { name: /permission to distribute every question/ });
    const staleAnswers = staleTab.getByRole("checkbox", { name: /checked every answer against its source/ });
    const staleSend = staleTab.getByRole("button", { name: "Send for review" });
    await staleRights.check();
    await staleAnswers.check();
    await expect(staleSend).toBeEnabled();

    // Tab A publishes the reviewed synthetic key. Tab B was already holding
    // both unchecked-by-server, browser-only attestations before that change.
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const authorTab = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await authorTab.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await authorTab.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await authorTab.getByRole("button", { name: "Send for review" }).click();
    await expect(authorTab.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();
    const [first] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(first.status).toBe("pending");
    const firstEvidence = await database.rpc(owner.id, "get_question_set_library", { p_id: first.id }) as {
      review_revision: number;
      snapshot_payload: { questions: Array<{ correctKey: string }> };
    };
    expect(firstEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    // This must be a genuine cross-page storage event. No manual event injection.
    await expect(staleRights).not.toBeChecked();
    await expect(staleAnswers).not.toBeChecked();
    await expect(staleSend).toBeDisabled();
    await expect(staleTab.getByText(/Another Question Set publication changed/)).toBeVisible();
    await staleRights.check();
    await staleAnswers.check();
    await expect(staleSend).toBeEnabled();

    // Tab A withdraws while tab B holds a second set of stale checkmarks.
    // SQL withdrawal deletes the original row; no old approval survives.
    const confirmationEvent = page.waitForEvent("dialog");
    const withdrawalClick = authorTab.getByRole("button", { name: "Withdraw submission" }).click();
    const confirmation = await confirmationEvent;
    expect(confirmation.type()).toBe("confirm");
    await confirmation.accept();
    await withdrawalClick;
    await expect(authorTab.getByText(/was withdrawn from the library/)).toBeVisible();
    expect(await database.rpc(owner.id, "my_question_set_library")).toEqual([]);
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    await expect(staleRights).not.toBeChecked();
    await expect(staleAnswers).not.toBeChecked();
    await expect(staleSend).toBeDisabled();
    // A single renewed grant must never be sufficient for resubmission.
    await staleRights.check();
    await expect(staleSend).toBeDisabled();
    await staleAnswers.check();
    await expect(staleSend).toBeEnabled();
    await staleSend.click();
    await expect(staleTab.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [replacement] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(replacement.status).toBe("pending");
    expect(replacement.id).not.toBe(first.id);
    const freshEvidence = await database.rpc(owner.id, "get_question_set_library", { p_id: replacement.id }) as
      typeof firstEvidence;
    expect(freshEvidence.snapshot_payload.questions).toEqual(firstEvidence.snapshot_payload.questions);
    expect(freshEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(freshEvidence.review_revision).toBeGreaterThan(0);
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);
    expect(ownerUnexpected).toEqual([]);
    expect(secondUnexpected).toEqual([]);
  } finally {
    await second.close();
    await database.close();
  }
});

test("SQL withdrawal readback outage requires a fresh rights and source attestation after recovery", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const database = await createPlatformDatabase();
  const [owner, learner] = PLATFORM_USERS;
  try {
    const unexpected = await database.attach(page, 0);
    await page.goto(`${baseURL}/#questions`);
    await seedLocalWorkspace(page);
    await seedLocalSet(page);
    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await dialog.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await dialog.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await dialog.getByRole("button", { name: "Send for review" }).click();
    await expect(dialog.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [first] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(first.status).toBe("pending");
    const original = await database.rpc(owner.id, "get_question_set_library", { p_id: first.id }) as {
      snapshot_payload: { questions: Array<{ correctKey: string }> };
    };
    expect(original.snapshot_payload.questions[0].correctKey).toBe("B");

    // The withdrawal RPC commits in real fixture SQL, but the immediate
    // authenticated status readback fails once. This must not be mistaken
    // for a failed withdrawal or permission to reuse old checkbox grants.
    let failNextStatusLookup = false;
    let injectedFailures = 0;
    await page.route(/\/rest\/v1\/rpc\/my_question_set_library(?:\?.*)?$/, async route => {
      if (!failNextStatusLookup) return route.fallback();
      failNextStatusLookup = false;
      injectedFailures += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
        body: JSON.stringify({ code: "PGRST503", message: "Synthetic readback outage" }),
      });
    });
    failNextStatusLookup = true;
    const confirmationEvent = page.waitForEvent("dialog");
    const withdrawalClick = dialog.getByRole("button", { name: "Withdraw submission" }).click();
    const confirmation = await confirmationEvent;
    expect(confirmation.type()).toBe("confirm");
    await confirmation.accept();
    await withdrawalClick;
    await expect(dialog.locator(".qsl-error")).toContainText(/submissions could not be loaded/i);
    expect(injectedFailures).toBe(1);
    // SQL already removed the publication despite the failed status readback.
    expect(await database.rpc(owner.id, "my_question_set_library")).toEqual([]);
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    // Recovery only after an authenticated retry clears the stale status.
    await dialog.getByRole("button", { name: "Retry status check" }).click();
    const rights = dialog.getByRole("checkbox", { name: /permission to distribute every question/ });
    const answers = dialog.getByRole("checkbox", { name: /checked every answer against its source/ });
    const send = dialog.getByRole("button", { name: "Send for review" });
    await expect(rights).toBeVisible();
    await expect(rights).not.toBeChecked();
    await expect(answers).not.toBeChecked();
    await expect(send).toBeDisabled();
    expect(await database.rpc(owner.id, "my_question_set_library")).toEqual([]);
    await rights.check();
    await expect(send).toBeDisabled();
    await answers.check();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(dialog.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [replacement] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(replacement.status).toBe("pending");
    expect(replacement.id).not.toBe(first.id);
    const replacementEvidence = await database.rpc(owner.id, "get_question_set_library", { p_id: replacement.id }) as
      typeof original;
    expect(replacementEvidence.snapshot_payload.questions).toEqual(original.snapshot_payload.questions);
    expect(replacementEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    await database.close();
  }
});


test("SQL withdrawal with a lost RPC response and failed readback revokes other-tab consent only after recovery", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const database = await createPlatformDatabase();
  const [owner, learner] = PLATFORM_USERS;
  const second = await page.context().newPage();
  try {
    const primaryUnexpected = await database.attach(page, 0);
    await page.goto(`${baseURL}/#questions`);
    await seedLocalWorkspace(page);
    await seedLocalSet(page);

    const secondUnexpected = await database.attach(second, 0);
    await second.goto(`${baseURL}/#questions`);
    await seedLocalWorkspace(second);
    await openLocalSets(second);
    await second.getByRole("button", { name: "Submit to library", exact: true }).click();
    const otherTab = second.getByRole("dialog", { name: `Submit ${TITLE}` });
    const otherRights = otherTab.getByRole("checkbox", { name: /permission to distribute every question/ });
    const otherAnswers = otherTab.getByRole("checkbox", { name: /checked every answer against its source/ });
    const otherSend = otherTab.getByRole("button", { name: "Send for review" });
    await otherRights.check();
    await otherAnswers.check();
    await expect(otherSend).toBeEnabled();

    await openLocalSets(page);
    await page.getByRole("button", { name: "Submit to library", exact: true }).click();
    const author = page.getByRole("dialog", { name: `Submit ${TITLE}` });
    await author.getByRole("checkbox", { name: /permission to distribute every question/ }).check();
    await author.getByRole("checkbox", { name: /checked every answer against its source/ }).check();
    await author.getByRole("button", { name: "Send for review" }).click();
    await expect(author.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();
    const [first] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(first.status).toBe("pending");
    const original = await database.rpc(owner.id, "get_question_set_library", { p_id: first.id }) as {
      snapshot_payload: { questions: Array<{ correctKey: string }> };
    };
    expect(original.snapshot_payload.questions[0].correctKey).toBe("B");

    // The acknowledged submission invalidates tab B's first set of grants.
    // Tab B then renews both, leaving an intentionally stale pair for withdrawal.
    await expect(otherRights).not.toBeChecked();
    await expect(otherAnswers).not.toBeChecked();
    await otherRights.check();
    await otherAnswers.check();
    await expect(otherSend).toBeEnabled();

    // A real PostgreSQL withdrawal commits, but the intercepted HTTP response
    // is replaced with a transport-like 503. Do not fake success at the RPC.
    let committedWithdrawals = 0;
    await page.route(/\/rest\/v1\/rpc\/withdraw_question_set_library(?:\?.*)?$/, async route => {
      if (route.request().method() !== "POST") return route.fallback();
      // The .invalid origin is served entirely by the PGlite route fixture:
      // route.fetch() would bypass that fixture and fail DNS resolution.
      // Execute the exact intercepted RPC under the authenticated SQL role
      // before delivering the deliberately lost-response status to the UI.
      const body = route.request().postDataJSON() as { p_id?: string };
      expect(body.p_id).toBe(first.id);
      await database.rpc(owner.id, "withdraw_question_set_library", { p_id: body.p_id });
      committedWithdrawals += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
        body: JSON.stringify({ code: "PGRST503", message: "Synthetic withdrawal response lost after SQL commit" }),
      });
    });
    let failFirstReadback = true;
    let statusFailures = 0;
    await page.route(/\/rest\/v1\/rpc\/my_question_set_library(?:\?.*)?$/, async route => {
      if (!failFirstReadback) return route.fallback();
      failFirstReadback = false;
      statusFailures += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
        body: JSON.stringify({ code: "PGRST503", message: "Synthetic status readback outage" }),
      });
    });

    const confirmationEvent = page.waitForEvent("dialog");
    const withdrawalClick = author.getByRole("button", { name: "Withdraw submission" }).click();
    const confirmation = await confirmationEvent;
    expect(confirmation.type()).toBe("confirm");
    await confirmation.accept();
    await withdrawalClick;
    await expect(author.locator(".qsl-error")).toContainText(/withdrawal response lost/i);
    expect(committedWithdrawals).toBe(1);
    expect(statusFailures).toBe(1);
    expect(await database.rpc(owner.id, "my_question_set_library")).toEqual([]);
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);

    // The status lookup failed. No browser-only consent revocation is evidence
    // of success until an authenticated readback actually establishes removal.
    await expect(otherRights).toBeChecked();
    await expect(otherAnswers).toBeChecked();
    await expect(otherSend).toBeEnabled();
    await expect(author.getByRole("button", { name: "Retry status check" })).toBeVisible();

    await author.getByRole("button", { name: "Retry status check" }).click();
    const freshRights = author.getByRole("checkbox", { name: /permission to distribute every question/ });
    const freshAnswers = author.getByRole("checkbox", { name: /checked every answer against its source/ });
    await expect(freshRights).not.toBeChecked();
    await expect(freshAnswers).not.toBeChecked();
    await expect(author.getByRole("button", { name: "Send for review" })).toBeDisabled();

    // The retry must emit a genuine cross-tab publication change event and
    // invalidate both stale authorizations, not merely update tab A's modal.
    await expect(otherRights).not.toBeChecked();
    await expect(otherAnswers).not.toBeChecked();
    await expect(otherSend).toBeDisabled();
    await expect(otherTab.getByText(/Another Question Set publication changed/)).toBeVisible();
    await otherRights.check();
    await expect(otherSend).toBeDisabled();
    await otherAnswers.check();
    await expect(otherSend).toBeEnabled();
    await otherSend.click();
    await expect(otherTab.getByText(/Submission received.*academic reviewer approves it/)).toBeVisible();

    const [replacement] = await database.rpc(owner.id, "my_question_set_library") as
      Array<{ id: string; status: string }>;
    expect(replacement.status).toBe("pending");
    expect(replacement.id).not.toBe(first.id);
    const newEvidence = await database.rpc(owner.id, "get_question_set_library", { p_id: replacement.id }) as
      typeof original;
    expect(newEvidence.snapshot_payload.questions).toEqual(original.snapshot_payload.questions);
    expect(newEvidence.snapshot_payload.questions[0].correctKey).toBe("B");
    expect(await database.rpc(learner.id, "list_question_set_library", { p_search: TITLE, p_offset: 0 })).toEqual([]);
    expect(committedWithdrawals).toBe(1);
    expect(primaryUnexpected).toEqual([]);
    expect(secondUnexpected).toEqual([]);
  } finally {
    await second.close();
    await database.close();
  }
});
