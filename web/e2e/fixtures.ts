import { expect, test as base } from "@playwright/test";

/**
 * First-run courtesy nudges (the guide offer, "Overwhelmed?", page hints) have
 * their own unit tests. In every other spec they stay quiet, so a floating card
 * never sits on the control a test is about to click. A spec that wants them
 * opts in with `test.use({ quietNudges: false })`. Values are only seeded when
 * absent, so a spec can still set its own.
 */
export const QUIET_NUDGES: Record<string, string> = {
  "axom.guideOffer.v1": "declined",
  "axom.coach.v1": JSON.stringify({ seen: ["overwhelmed"], off: true }),
};

export const test = base.extend<{ quietNudges: boolean }>({
  quietNudges: [true, { option: true }],
  page: async ({ page, quietNudges }, use) => {
    if (quietNudges) {
      await page.addInitScript((entries) => {
        try {
          for (const [key, value] of Object.entries(entries)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        } catch { /* storage blocked: nothing to quiet */ }
      }, QUIET_NUDGES);
    }
    await use(page);
  },
});

/**
 * Medical tracks open the Application Checker on Residency (I1-23); specs that
 * exercise the medical-school dataset switch to it the way a learner would.
 */
export async function openMedicalSchools(page: import("@playwright/test").Page) {
  const tab = page.getByRole("tab", { name: /Medical school/ });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * Reload only after the workspace save has reached IndexedDB. Saves are
 * coalesced and asynchronous, so an immediate reload can race the last write.
 */
export async function reloadAfterSave(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__?: Promise<{ flushVault?: () => Promise<void> }> }).__AXOM_DEV__;
    await dev?.flushVault?.();
  });
  await page.reload({ waitUntil: "networkidle" });
}

/**
 * Skip the setup wizard by writing a finished profile through the dev store,
 * then reload once the save is on disk. For specs about screens, not setup.
 */
export async function seedOnboarded(page: import("@playwright/test").Page, patch: Record<string, unknown> = {}) {
  if (!page.url().startsWith("http")) await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
  await page.evaluate(async (profilePatch) => {
    type Dev = { useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } }; flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    dev.useStore.getState().updateProfile({
      onboarded: true,
      tourDone: true,
      name: "AXOM E2E",
      promisePromptStatus: { state: "skipped", updatedAt: new Date().toISOString(), promptVersion: "promise-prompt-v1" },
      ...profilePatch,
    });
    await dev.flushVault();
  }, patch);
  await page.reload({ waitUntil: "networkidle" });
}

export { deferPromisePrompt } from "../scripts/promise-prompt.mjs";
export { expect };
