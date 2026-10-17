import { expect, seedOnboarded, test } from "./fixtures";

// Isolated browser contexts and synthetic records only. Image reference counts
// must never imply that the bytes were downloaded or reveal an answer image.
for (const width of [1440, 768, 390]) {
  test(`course discovery and image-linked collections remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    await seedOnboarded(page);
    await page.goto("/#tracker");
    await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    await page.getByRole("button", { name: "Course map", exact: true }).click();
    const library = page.locator(".course-library-page");
    await expect(library.getByRole("heading", { name: "Term 1", exact: true })).toBeVisible();
    await expect(library.getByRole("status")).toContainText("in the course map");
    await expect(library.getByText("On this device", { exact: true })).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await page.emulateMedia({ reducedMotion: theme === "light" ? "reduce" : "no-preference" });
      await library.getByRole("button", { name: "Preview FTM 1, Term 1", exact: true }).focus();
      await expect(library.getByRole("button", { name: "Preview FTM 1, Term 1", exact: true })).toBeFocused();
      expect(await library.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await library.getByRole("heading", { name: "Course Library", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/axom-course-interface-${width}-${theme}.png` });
    }
    await library.getByRole("button", { name: "Preview FTM 1, Term 1", exact: true }).hover();
    await expect(library.getByRole("button", { name: "Preview FTM 1, Term 1", exact: true })).toHaveCSS("transform", "none");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "FTM 1 course plan", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All courses", exact: true }).click();
    await library.getByRole("searchbox", { name: "Search courses", exact: true }).fill("unmatched-course");
    await expect(library.getByRole("heading", { name: "No courses to show" })).toBeVisible();
    await library.getByRole("searchbox", { name: "Search courses", exact: true }).fill("FTM 1");
    await expect(library.locator(".course-card")).toHaveCount(1);

    await page.evaluate(async () => {
      const { useStore, flushVault } = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { addQuestion: (value: unknown) => { ok: boolean }; addQuestionSet: (value: unknown) => void } };
        flushVault: () => Promise<void>;
      }> }).__AXOM_DEV__;
      const store = useStore.getState();
      const now = "2026-10-17T00:00:00Z";
      for (const [id, title, needsReview] of [
        ["ready", "IMCQ image interpretation", false], ["held", "IMCQ source review", true],
      ] as const) {
        if (!store.addQuestion({ id, source: "manual", stem: "Synthetic interface check: choose Beta.", module: "FTM 1", week: 1,
          options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }], correctKey: "B", needsReview, tags: [],
          ...(id === "ready" ? { attachments: [{ id: "source-reference", blobKey: "source-reference", fileName: "source.png",
            mimeType: "image/png", byteSize: 100, role: "answer_reveal", altText: "Answer-bearing synthetic source",
            createdAt: now, updatedAt: now }] } : {}),
        }).ok) throw new Error("Question fixture refused");
        store.addQuestionSet({ id: `set-${id}`, title, scope: { module: "FTM 1", week: 1 }, questionIds: [id],
          sourceDocumentIds: [], createdAt: now, tags: [], parserWarnings: [], aiEnhanced: false });
      }
      await flushVault();
    });
    await page.goto("/#questions");
    await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
    const bank = page.getByRole("region", { name: "Course question bank", exact: true });
    await expect(bank.getByRole("heading", { name: "Week 1", exact: true })).toBeVisible();
    await expect(bank.getByText("1 with image references", { exact: true })).toBeVisible();
    await expect(bank.getByRole("img")).toHaveCount(0);
    await expect(bank.getByRole("button", { name: "Practice IMCQ source review", exact: true })).toBeDisabled();
    await expect(bank.getByRole("button", { name: "Resolve unresolved questions for IMCQ source review" })).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
      await bank.scrollIntoViewIfNeeded();
      expect(await bank.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/axom-qbank-interface-${width}-${theme}.png` });
    }
    await bank.getByRole("combobox", { name: "Filter by readiness" }).selectOption("unresolved");
    await expect(bank.locator(".cb-set-row")).toHaveCount(1);
    await bank.getByRole("combobox", { name: "Filter by readiness" }).selectOption("ready");
    await expect(bank.locator(".cb-set-row")).toHaveCount(1);
    await bank.getByRole("button", { name: "Practice IMCQ image interpretation", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Set up a tutor block", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
