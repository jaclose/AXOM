import { expect, test, seedOnboarded, reloadAfterSave } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";

for (const width of [1440, 390]) test(`Productivity opens the recommended questions and records the repair loop at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  await seedOnboarded(page);
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { addQuestion: (value: unknown) => { ok: boolean } } }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    const added = dev.useStore.getState().addQuestion({ id: "study-loop-fixture", source: "manual",
      stem: "Which label is first in the supplied sequence A, B?",
      options: [{ key: "A", text: "First label" }, { key: "B", text: "Second label" }],
      correctKey: "A", explanation: "The supplied sequence starts with A.", citation: "Synthetic workflow fixture", tags: [] });
    if (!added.ok) throw new Error("Fixture could not be added");
    await dev.flushVault();
  });
  await page.goto("/#productivity");
  const next = page.getByRole("region", { name: "Up next", exact: true });
  await expect(next).toContainText("Start 1 unseen question");
  await next.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(next).toContainText("no recorded attempts");
  await page.screenshot({ path: `/tmp/axom-study-loop-next-${width}.png` });
  await next.getByRole("button", { name: "Start", exact: true }).click();
  const stem = page.getByLabel("Question stem", { exact: true });
  await expect(stem).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Set up a tutor block" })).toHaveCount(0);
  await stem.focus(); await page.keyboard.press("B"); await page.keyboard.press("Enter");
  await expect(page.locator(".result-banner[role='status']")).toContainText("Incorrect");
  await expect(page.getByText("The supplied sequence starts with A.", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await reloadAfterSave(page);
  await page.goto("/#productivity");
  await expect(next).toContainText("Retry 1 missed question");
  await next.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(next).toContainText("latest recorded answer was incorrect");
  const saved = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState } }> }).__AXOM_DEV__;
    const s = dev.useStore.getState();
    return { attempts: s.questions.find(q => q.id === "study-loop-fixture")?.attempts.length,
      quizLogs: s.logs.filter(log => log.id.startsWith("qbank-session:")).length,
      timers: s.sessions?.length ?? 0 };
  });
  expect(saved).toEqual({ attempts: 1, quizLogs: 1, timers: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
