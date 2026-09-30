import type { Page } from "@playwright/test";
import { deferPromisePrompt, expect, openMedicalSchools, reloadAfterSave, test } from "./fixtures";

/** Dev-only live-store handle installed by src/main.tsx (see comment there). */
type DevWindow = Window & {
  __AXOM_DEV__: Promise<{
    useStore: {
      getState: () => Record<string, unknown> & {
        profile: Record<string, unknown>;
        terms: Array<{ id: string }>;
        activeDayKey: string;
        sessions: Array<{ status: string; link?: unknown; resources?: string[] }>;
      };
      setState: (patch: Record<string, unknown>) => void;
    };
  }>;
};


const viewports = [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 430, height: 880 }, { width: 390, height: 844 }];

async function skipSetup(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  const skip = page.getByRole("button", { name: "Skip setup", exact: true });
  if (await skip.isVisible()) {
    await skip.click();
    await deferPromisePrompt(page);
  }
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".surface-scroll");
    return document.documentElement.scrollWidth <= innerWidth + 1 && (!surface || surface.scrollWidth <= surface.clientWidth + 1);
  })).toBe(true);
}

async function settleViewport(page: Page, width: number) {
  if (width <= 880) {
    await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  }
  await expect.poll(async () => {
    const bounds = await page.locator(".surface").boundingBox();
    return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width + 1;
  }).toBe(true);
  await noOverflow(page);
}

test("real school research supports search, saved schools, review checks and reload", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await skipSetup(page);
  await page.goto("/#appchecker");
  await openMedicalSchools(page);
  await expect(page.getByText("292 schools", { exact: true })).toBeVisible();
  await page.getByLabel("Has collected research").check();
  await expect(page.getByRole("status").filter({ hasText: "Showing 24 of 60" })).toBeVisible();
  await page.getByLabel("Search schools").fill("Stanford");
  const school = page.getByRole("article").filter({ hasText: "Stanford University School of Medicine" });
  await school.getByRole("button", { name: "Save school", exact: true }).click();
  await school.locator("summary").click();
  const review = school.getByRole("checkbox", { name: "Reviewed MCAT minimum (read exceptions)", exact: true });
  await review.check();
  await expect(school).toContainText("Official-page capture");
  await expect(school.getByRole("link", { name: "Review source" }).first()).toHaveAttribute("href", /^https:\/\//);
  await reloadAfterSave(page);
  await page.getByRole("checkbox", { name: /Saved schools/ }).check();
  await expect(school.getByRole("button", { name: "Saved school" })).toHaveAttribute("aria-pressed", "true");
  await school.locator("summary").click();
  await expect(review).toBeChecked();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await settleViewport(page, viewport.width);
    await school.getByRole("button", { name: "Saved school" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`schools-${viewport.width}.png`), animations: "disabled" });
  }
  await review.uncheck();
  await school.getByRole("button", { name: "Saved school" }).click();
  await expect(page.getByText("No matching schools")).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.getByText("292 schools", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("onboarding retains method follow-ups across refresh and makes them editable later", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("How do you usually study? (optional)", { exact: true }).click();
  await page.getByLabel("Noji", { exact: true }).check();
  await page.getByLabel("Quizlet", { exact: true }).check();
  await page.getByText("How do you use Noji?", { exact: true }).click();
  await page.getByLabel("When do you use Noji?").selectOption("ongoing");
  const original = "  I make my own cards.\n".repeat(30);
  await page.getByLabel("Your Noji approach (optional)").fill(original);
  await page.getByLabel("Other: tell AXOM how you study").fill(original);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("onboarding-390.png"), animations: "disabled" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("How do you usually study? (optional)", { exact: true }).click();
  await expect(page.getByLabel("Noji", { exact: true })).toBeChecked();
  await page.getByText("How do you use Noji?", { exact: true }).click();
  await expect(page.getByLabel("When do you use Noji?")).toHaveValue("ongoing");
  await expect(page.getByLabel("Your Noji approach (optional)")).toHaveValue(original);
  for (let step = 0; step < 2; step++) await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await deferPromisePrompt(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Personalization", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quizlet", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("How do you use Noji?", { exact: true }).click();
  await expect(page.getByLabel("Your Noji approach (optional)")).toHaveValue(original);
  await page.getByLabel("Your Noji approach (optional)").fill("My edited approach");
  await noOverflow(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(errors).toEqual([]);
});

test("personal standings use real logs, separate partial weeks and survive reload", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await skipSetup(page);
  // Isolated browser context: deterministic study logs, never the owner's data.
  await page.evaluate(async () => {
    const { useStore } = await (window as unknown as DevWindow).__AXOM_DEV__;
    const monday = new Date(); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const log = (id: string, offset: number, minutes: number, cards: number) => {
      const date = new Date(monday); date.setDate(date.getDate() - offset);
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { id, dayKey, ts: date.toISOString(), type: "Manual", academic: true, minutes, cards };
    };
    useStore.setState({ logs: [log("current", 0, 300, 500), log("last", 7, 90, 30), log("previous", 14, 60, 30)] });
  });
  await page.goto("/#leaderboards");
  await expect(page.getByText("Personal standings", { exact: true })).toBeVisible();
  const standings = page.getByRole("list", { name: "Personal weekly standings" });
  await expect(standings.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Study time", exact: true }).click();
  await expect(standings).toContainText("1.5 hours");
  await expect(standings.getByText("5 hours", { exact: true })).toHaveCount(0);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await settleViewport(page, viewport.width);
    // Close actual reminders through their controls so they do not cover the review.
    const dismiss = page.locator(".toast:not(.is-leaving) .toast-close");
    // A notice can start leaving on its own between count() and click(); that is fine.
    for (let count = 0; count < 5 && await dismiss.count() > 0; count++) await dismiss.first().click({ timeout: 2_000 }).catch(() => undefined);
    await standings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`standings-${viewport.width}.png`), animations: "disabled" });
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Logged cards", exact: true }).click();
  await expect(standings.getByRole("listitem")).toHaveCount(2);
  await expect(standings.locator(".lb-rank")).toHaveText(["1", "1"]);
  await expect(page.getByText("Study with friends", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
