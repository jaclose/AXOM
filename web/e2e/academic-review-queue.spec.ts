import { expect, seedOnboarded, test } from "./fixtures";
import { academicReviewFixture } from "./academicReviewFixture";

for (const width of [1440, 390]) test(`reviewers preview and decide shared submissions across owners at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const backend = await academicReviewFixture(page);
  const submissions = Array.from({ length: 26 }, (_, index) => backend.seedSubmission(index, index !== 1));
  await seedOnboarded(page);
  await page.goto("/?app=1&course-library=1#tracker");
  const queue = page.getByRole("region", { name: "Submitted QBank review", exact: true });
  await expect(queue).toBeVisible();
  await expect(queue.getByRole("article")).toHaveCount(24);
  await expect(queue).toContainText("Synthetic owner Taylor");
  await expect(queue).toContainText("Synthetic owner Rowan");
  expect(backend.previewRequests).toEqual([]);
  expect(backend.decisionRequests).toEqual([]);

  const first = queue.getByRole("article", { name: submissions[0].title, exact: true });
  await expect(first).toContainText("Term 4 · NCRS");
  await expect(first).toContainText("2 ready · 0 awaiting review");
  await expect(first.locator("time")).toHaveAttribute("datetime", submissions[0].submitted_at);
  await expect(first.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  expect(await first.getByRole("button", { name: "Open preview", exact: true }).getAttribute("aria-controls")).toBeNull();
  await first.getByRole("button", { name: "Open preview", exact: true }).focus();
  await page.keyboard.press("Enter");
  const preview = first.getByRole("group", { name: `Preview ${submissions[0].title}`, exact: true });
  await expect(preview).toContainText("Synthetic submitted plan 1");
  expect(await first.getByRole("button", { name: "Close preview", exact: true }).getAttribute("aria-controls")).toBe(await preview.getAttribute("id"));
  expect(backend.previewRequests).toEqual([{ collection: submissions[0].id, revision: submissions[0].current_revision_id }]);
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((element, value) => element.setAttribute("data-theme", value), theme);
    await first.scrollIntoViewIfNeeded();
    expect(await first.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-review-preview-${width}-${theme}.png` });
  }
  await first.getByRole("button", { name: "Close preview", exact: true }).click();
  await expect(first.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await first.getByRole("button", { name: "Open preview", exact: true }).click();
  await first.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(queue).toContainText(`Approved: ${submissions[0].title}.`);
  expect(backend.decisionRequests).toEqual([{ collection: submissions[0].id, approved: true, expected_revision: submissions[0].current_revision_id }]);

  // A plan-less collection is still reviewable, but an unavailable preview
  // never leaves a decision control active. Retry rechecks its exact revision.
  const second = queue.getByRole("article", { name: submissions[1].title, exact: true });
  backend.unavailablePreview(submissions[1].id);
  await second.getByRole("button", { name: "Open preview", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("no longer available for review");
  await expect(second.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  backend.recoverPreview(submissions[1].id);
  await second.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(second).toContainText("No weekly plan was submitted for this question collection.");
  await second.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(second).toHaveCount(0);
  await expect(queue).toContainText(`Rejected: ${submissions[1].title}.`);
  expect(backend.decisionRequests.at(-1)).toEqual({ collection: submissions[1].id, approved: false, expected_revision: submissions[1].current_revision_id });

  await queue.getByRole("button", { name: "Load more submissions", exact: true }).click();
  await expect(queue.getByRole("article")).toHaveCount(24);
  await expect(queue.getByRole("article", { name: submissions[25].title, exact: true })).toBeVisible();
  expect(backend.queueRequests.at(-1)).toEqual({ after_submitted_at: submissions[23].submitted_at, after_id: submissions[23].id });
  await expect(queue.getByRole("button", { name: "Load more submissions", exact: true })).toHaveCount(0);
  expect(await queue.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  backend.invalidateQueue();
  await queue.getByRole("button", { name: "Refresh review queue", exact: true }).click();
  await expect(queue.getByRole("alert")).toContainText("response is invalid");
  backend.recoverQueue();
  await queue.getByRole("button", { name: "Retry submissions", exact: true }).click();
  await expect(queue.getByRole("article")).toHaveCount(24);
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  await queue.getByRole("heading", { name: "Submitted QBank review", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/axom-review-result-${width}.png` });
  expect(backend.calls.filter(call => /\/storage\/|\/academic_files|\/academic_revisions/.test(call))).toEqual([]);

  // Membership is checked again on refresh. Revocation hides all metadata
  // without sending another queue request from this non-reviewer session.
  const beforeRevocation = backend.queueRequests.length;
  backend.setReviewer(false);
  await queue.getByRole("button", { name: "Refresh review queue", exact: true }).click();
  await expect(queue).toHaveCount(0);
  expect(backend.queueRequests).toHaveLength(beforeRevocation);
  expect(errors).toEqual([]);
});

test("non-reviewers never see or request the submission queue", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  const backend = await academicReviewFixture(page, { reviewer: false });
  backend.seedSubmission(0);
  await seedOnboarded(page);
  await page.goto("/?app=1&course-library=1#tracker");
  await expect(page.getByRole("heading", { name: "Course Library", exact: true })).toBeVisible();
  await expect.poll(() => backend.calls.filter(call => call.endsWith("/rpc/academic_is_reviewer")).length).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Submitted QBank review", exact: true })).toHaveCount(0);
  expect(backend.queueRequests).toEqual([]);
  expect(backend.previewRequests).toEqual([]);
  expect(backend.decisionRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("signing out while a preview is pending never exposes its late response", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  const backend = await academicReviewFixture(page);
  const submission = backend.seedSubmission(0);
  const release = backend.holdPreview(submission.id);
  await seedOnboarded(page);
  await page.goto("/?app=1&course-library=1#tracker");
  const queue = page.getByRole("region", { name: "Submitted QBank review", exact: true });
  try {
    await queue.getByRole("button", { name: "Open preview", exact: true }).click();
    await expect.poll(() => backend.previewRequests.length).toBe(1);
    await expect(queue).toContainText("Opening the submitted preview…");
    await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useAccount: { setState: (patch: object) => void } }> }).__AXOM_DEV__;
      dev.useAccount.setState({ phase: "signed-out", user: null });
    });
    await expect(queue).toHaveCount(0);
    const completed = page.waitForResponse(response => response.url().endsWith("/rpc/academic_review_preview"));
    release();
    await completed;
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    expect(backend.decisionRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { release(); }
});
