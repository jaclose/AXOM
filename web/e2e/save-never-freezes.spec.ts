import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

// INC-04, fault F2: the 27 Nov "Saving…" freeze. Exit block waited for a
// workspace write that never settled, so every control stayed disabled and
// read "Saving…". Saving must never block studying (owner decision D13).
// Set AXOM_PROOF_DIR to also write screenshots for the private proof folder.

const PROOF_DIR = process.env.AXOM_PROOF_DIR;

const VARIANTS = [
  { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 900, theme: "light" },
  { name: "phone-dark", width: 390, height: 844, theme: "dark" },
  { name: "phone-light", width: 390, height: 844, theme: "light" },
] as const;

for (const variant of VARIANTS) {
  test(`F2 ${variant.name}: a save that never answers gives the block back within five seconds`, async ({ page }) => {
    const errors = collectPageErrors(page);
    await prepare(page, variant);
    page.on("dialog", (dialog) => { void dialog.accept(); });
    await startTutorBlock(page, 2);

    const block = page.getByRole("dialog", { name: "Tutor · 1 of 2" });
    await block.getByRole("button", { name: "B. Beta" }).click();
    await block.getByRole("button", { name: "Check answer" }).click();
    await neverAnswerIndexedDb(page);
    await block.getByRole("button", { name: "Exit block" }).click();
    await expect(page.getByRole("button", { name: "Saving…" }).first()).toBeVisible();
    const startedWaiting = Date.now();

    const prompt = page.getByRole("dialog", { name: "Not saved yet" });
    await expect(prompt).toBeVisible({ timeout: 6_000 });
    expect(Date.now() - startedWaiting).toBeLessThan(6_000);
    await expect(page.getByRole("button", { name: "Saving…" })).toHaveCount(0);
    await expect(prompt.getByRole("button", { name: "Keep studying" })).toBeEnabled();
    await expect(prompt.getByRole("button", { name: "Download a copy" })).toBeEnabled();
    if (PROOF_DIR) await page.screenshot({ path: `${PROOF_DIR}/after-${variant.name}-1-not-saved-yet.png` });

    // Keep studying: the block is usable again and says what is true.
    await prompt.getByRole("button", { name: "Keep studying" }).click();
    await expect(block.getByRole("button", { name: "Not saved yet · Retry" })).toBeVisible();
    await expect(block.getByRole("button", { name: "Flag question" })).toBeEnabled();
    await expect(block.getByRole("button", { name: /save & exit/ })).toBeEnabled();
    if (PROOF_DIR) await page.screenshot({ path: `${PROOF_DIR}/after-${variant.name}-2-keep-studying.png` });

    // Exit anyway: the block closes and its recovery copy stays for next time.
    await block.getByRole("button", { name: /save & exit/ }).click();
    await page.getByRole("dialog", { name: "Not saved yet" }).getByRole("button", { name: "Exit anyway" }).click({ timeout: 8_000 });
    await expect(page.getByRole("dialog", { name: /Tutor ·/ })).toHaveCount(0);
    const recoveryCopies = await page.evaluate((prefix) => Object.keys(localStorage)
      .filter((key) => key.startsWith(`${prefix}:run:`)).length, STORAGE_KEYS.quizActiveSession);
    expect(recoveryCopies).toBe(1);
    expect(errors).toEqual([]);
  });
}

test("F11: a squeezed storage quota never freezes finishing a block", async ({ page }) => {
  const errors = collectPageErrors(page);
  await prepare(page, VARIANTS[0]);
  await startTutorBlock(page, 1);
  const cdp = await page.context().newCDPSession(page);
  const origin = new URL(page.url()).origin;
  await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: 0 });
  try {
    const block = page.getByRole("dialog", { name: "Tutor · 1 of 1" });
    await block.getByRole("button", { name: "B. Beta" }).click();
    await block.getByRole("button", { name: "Check answer" }).click();
    await block.getByRole("button", { name: "Finish block" }).click();
    // Either the fallback keeps the save and the results open, or the block
    // says "Not saved yet · Retry" with every control usable. Never frozen.
    const results = page.getByRole("dialog", { name: "Block results" });
    const retry = block.getByRole("button", { name: "Not saved yet · Retry" });
    await expect(results.or(retry)).toBeVisible({ timeout: 6_000 });
    await expect(page.getByRole("button", { name: "Saving…" })).toHaveCount(0);
    if (await retry.isVisible()) await expect(block.getByRole("button", { name: "Retry finish" })).toBeEnabled();
  } finally {
    await cdp.send("Storage.overrideQuotaForOrigin", { origin });
  }
  expect(errors.filter((message) => !/QuotaExceeded|quota/i.test(message))).toEqual([]);
});

async function prepare(page: Page, variant: (typeof VARIANTS)[number]): Promise<void> {
  await page.setViewportSize({ width: variant.width, height: variant.height });
  await page.emulateMedia({ colorScheme: variant.theme });
  await page.addInitScript(({ key, theme }) => { localStorage.setItem(key, theme); }, { key: STORAGE_KEYS.themePreference, theme: variant.theme });
}

/** Every IndexedDB open from now on never answers: a storage backend that
 * stopped responding, as on the nearly full disk behind the 27 Nov freeze. */
async function neverAnswerIndexedDb(page: Page): Promise<void> {
  await page.evaluate(() => {
    IDBFactory.prototype.open = function open() { return {} as IDBOpenDBRequest; };
  });
}

/** Uncaught errors and console errors, read at the end of a test. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

/** A finished profile, a small synthetic set, and a running tutor block. */
async function startTutorBlock(page: Page, count: number): Promise<void> {
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
        id: `save-freeze-${index + 1}`,
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
      id: "save-freeze-set", title: "Save freeze set", sourceDocumentIds: [], createdAt: new Date().toISOString(),
      questionIds: ids, tags: [], aiEnhanced: false, parserWarnings: [],
    });
    await dev.flushVault();
  }, count);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await page.getByRole("region", { name: "Question bank library" }).getByRole("button", { name: /Unfiled & mixed/ }).click();
  const book = page.getByRole("dialog", { name: /Unfiled & mixed/ });
  await expect(book.getByRole("checkbox", { name: "Practise from Save freeze set" })).toBeChecked();
  await book.getByRole("button", { name: "Create Quiz" }).click();
  const setup = page.getByRole("dialog", { name: "Set up a tutor block" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Start tutor block" }).click();
  await expect(page.getByRole("dialog", { name: new RegExp(`Tutor · 1 of ${count}`) })).toBeVisible();
}
