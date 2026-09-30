import type { Page } from "@playwright/test";
import { completeSetup, expect, reloadAfterSave, test } from "./fixtures";

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


test("study defaults and item overrides drive the dashboard, survive reload, and start the right session", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await prepareWorkspace(page);

  const brief = page.locator('[data-tour="command-brief"]');
  await expect(brief.locator(".up-next-title")).toHaveText("Review: Renal transport");
  await brief.getByRole("button", { name: "Why?", exact: true }).click();
  const plan = brief.getByRole("region", { name: "Study plan used for this suggestion" });
  await expect(plan).toContainText("3 of 4 passes complete");
  await expect(brief.locator(".up-next-meta")).toContainText("Notes");
  await expect(brief.locator(".up-next-meta")).not.toContainText("Anki");

  // Edit the real settings controls; no test-only settings UI or persistence path.
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Personalization", exact: true }).click();
  await page.getByLabel("Usual lecture passes").fill("5");
  await page.getByLabel("Review again after (days)").fill("6");
  await page.getByRole("button", { name: "Noji", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(plan).toContainText("3 of 5 passes complete · Review after 6 days");
  await expect(brief.locator(".up-next-meta")).toContainText("Noji");

  await page.reload({ waitUntil: "networkidle" });
  await brief.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(plan).toContainText("3 of 5 passes complete · Review after 6 days");

  await page.goto("/#tracker");
  const row = page.locator('[data-item-id="recommendation-renal"]');
  await row.getByRole("button", { name: "Edit study plan" }).click();
  const editor = page.getByRole("dialog", { name: "Study plan · Renal transport" });
  await expect(editor.getByRole("button", { name: "Anki", exact: true })).toHaveAttribute("aria-pressed", "false");
  await editor.getByLabel("Lecture passes").fill("6");
  await editor.getByRole("button", { name: "Save plan" }).click();
  await page.goto("/#dashboard");
  await brief.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(plan).toContainText("3 of 6 passes complete");
  await expect(plan).toContainText("item override");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 430, height: 880 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(plan).toBeVisible();
    await expect(brief.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    expect(await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(".surface-scroll")!;
      return document.documentElement.scrollWidth <= innerWidth + 1 && surface.scrollWidth <= surface.clientWidth + 1;
    })).toBe(true);
  }

  await brief.getByRole("button", { name: "Start", exact: true }).click();
  // The running session moves to the focus dock; Up next steps aside until it ends.
  await expect(brief).toHaveCount(0);
  await expect(page.locator(".focus-dock")).toBeVisible();
  await reloadAfterSave(page);
  await expect(page.locator(".focus-dock")).toBeVisible();
  await expect(brief).toHaveCount(0);
  const session = await page.evaluate(async () => {
    const { useStore } = await (window as unknown as DevWindow).__AXOM_DEV__;
    return useStore.getState().sessions.find((value) => value.status === "active");
  });
  expect(session?.link).toMatchObject({ kind: "tracker", id: "recommendation-renal" });
  expect([...(session?.resources ?? [])].sort()).toEqual(["Noji", "Notes"]);
  await page.goto("/#tracker");
  const sixthPass = row.getByTitle("6 lecture passes", { exact: true });
  // Right after navigation a lazy part of the page can remount the row and
  // swallow the key; press only while the sixth pass is still unset (pressing
  // a set level steps back), and retry until the keyboard press lands.
  await expect(async () => {
    if ((await sixthPass.getAttribute("aria-pressed")) !== "true") {
      await sixthPass.focus();
      await page.keyboard.press("Enter");
    }
    await expect(sixthPass).toHaveAttribute("aria-pressed", "true", { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("This scope is complete", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".surface-scroll")!;
    return surface.scrollWidth <= surface.clientWidth + 1;
  })).toBe(true);
  await reloadAfterSave(page);
  await expect(sixthPass).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("tracker progress follows edited targets, preserves history, and remains usable on mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await prepareWorkspace(page);
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Personalization", exact: true }).click();
  await page.getByLabel("Usual lecture passes").fill("6");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/#tracker");

  const row = page.locator('[data-item-id="recommendation-renal"]');
  const progress = page.getByRole("progressbar", { name: "Study-plan progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "50");
  await row.getByTitle("4 lecture passes", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(row.getByText("4 of 6 passes · 2 remaining", { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "67");
  // The Course Tracker intro is an anchored first-visit hint now (quiet in e2e), not a toast.

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 430, height: 880 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await row.scrollIntoViewIfNeeded();
    if (viewport.width <= 880) {
      await expect.poll(() => page.locator(".sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    }
    await expect(row.getByRole("button", { name: "Edit study plan" })).toBeInViewport();
    await expect(row.getByTitle("6 lecture passes")).toBeInViewport();
    const bounds = await page.locator(".surface").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(".surface-scroll")!;
      return document.documentElement.scrollWidth <= innerWidth + 1 && surface.scrollWidth <= surface.clientWidth + 1;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`study-progress-${viewport.width}.png`), animations: "disabled" });
  }

  await row.getByRole("button", { name: "Edit study plan" }).click();
  const editor = page.getByRole("dialog", { name: "Study plan · Renal transport" });
  await editor.getByLabel("Lecture passes").fill("2");
  await editor.getByRole("button", { name: "Save plan" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "100");
  await expect(row.getByText("4 passes recorded · Target of 2 reached", { exact: true })).toBeVisible();
  await expect(page.getByText("This scope is complete", { exact: true })).toBeVisible();
  await reloadAfterSave(page);
  await expect(progress).toHaveAttribute("aria-valuenow", "100");
  await expect(row.getByText("4 passes recorded · Target of 2 reached", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Edit study plan" }).click();
  await editor.getByRole("button", { name: "Use inherited plan" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "67");
  await expect(row.getByText("4 of 6 passes · 2 remaining", { exact: true })).toBeVisible();
  await row.getByTitle("Cycle yield").click();
  await expect(progress).toHaveAttribute("aria-valuenow", "67");
  await reloadAfterSave(page);
  await expect(progress).toHaveAttribute("aria-valuenow", "67");
  await expect(row.getByTitle("4 lecture passes", { exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

async function prepareWorkspace(page: Page) {
  await page.goto("/#dashboard", { waitUntil: "networkidle" });
  if (await completeSetup(page, "Study workflow test", { ifVisible: true })) {
    const later = page.getByRole("button", { name: "Review later", exact: true });
    if (await later.count()) await later.click();
  }
  await page.evaluate(async () => {
    const { useStore } = await (window as unknown as DevWindow).__AXOM_DEV__;
    const state = useStore.getState();
    const timestamp = new Date().toISOString();
    await useStore.setState({
      profile: { ...state.profile, studyWorkflow: { configured: true, lecturePasses: 4, reviewAfterDays: 3, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }] } },
      courses: [{ id: "renal", termId: state.terms[0]?.id ?? "term", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: [{ id: "recommendation-renal", path: "RENAL/Lectures", label: "Renal transport", kind: "Lecture", passes: 3, ankiPasses: 0, yield: "high", updated: timestamp }],
      dayPlans: [{ dayKey: state.activeDayKey, intention: "Renal transport", wins: [], createdAt: timestamp }],
      tasks: [], logs: [], sessions: [], closeouts: [], questions: [], ankiCards: [], habits: [], habitEntries: [],
    });
  });
}
