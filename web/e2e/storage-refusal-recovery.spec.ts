import { expect, seedOnboarded, test } from "./fixtures";

/**
 * A browser that refuses AXOM's storage (seen on a nearly full disk) used to
 * trap the learner: the Journal would not let them leave, other screens would
 * not open, and refreshing needed a save that could never be verified. This
 * journey refuses every workspace write the way the browser does, then checks
 * that the learner can still move around, back up, and refresh.
 */
test("a learner whose browser refuses storage can leave the Journal, back up and refresh", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  const dialogs: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { dialogs.push(`${dialog.type()}: ${dialog.message()}`); void dialog.dismiss(); });

  await seedOnboarded(page);
  await page.goto("/#journal");
  // A fresh notebook always opens its setup first (journal-notebook.spec.ts).
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();

  // From here on the browser refuses every workspace write, like a full disk,
  // and keeps refusing after the refresh (only a browser restart clears it).
  // Chrome's per-origin quota override does not refuse small writes, so the
  // refusal is the QuotaExceededError a full browser throws.
  const refuseWorkspaceWrites = () => {
    const refuse = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "state") refuse();
      return put.apply(this, args);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key.startsWith("noctyrium-state")) refuse();
      return setItem.call(this, key, value);
    };
  };
  await page.addInitScript(refuseWorkspaceWrites);
  await page.evaluate(refuseWorkspaceWrites);

  const entry = "Written while the browser refused storage.";
  await page.getByLabel("Free writing").fill(entry);
  await expect(page.getByText("AXOM could not save on this device", { exact: true })).toBeVisible({ timeout: 15_000 });

  // Leaving the Journal is not trapped by the refused save (it used to be:
  // the Dashboard and every other screen stopped opening).
  await page.getByRole("button", { name: "Put down on desk" }).click();
  const started = Date.now();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/#dashboard$/, { timeout: 12_000 });
  expect(Date.now() - started).toBeLessThan(12_000);
  const kept = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { journal: Array<{ freeWriting?: string }> } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().journal.map((item) => item.freeWriting ?? "");
  });
  expect(kept).toContain(entry);

  // A screen that cannot load offers a backup, then a refresh.
  await page.route(/\/src\/pages\/ReportsPage\.tsx/, (route) => route.abort());
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This screen needs the latest AXOM" })).toBeVisible();
  await page.getByRole("button", { name: "Reload AXOM" }).click();
  const recovery = page.getByRole("group", { name: "Refresh after a backup" });
  await expect(recovery).toBeVisible({ timeout: 15_000 });
  await expect(recovery.getByRole("button", { name: "Refresh now" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Download backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/^axom-backup-.*\.(json|zip)$/);
  await expect(recovery.getByText(/^Backup downloaded at /)).toBeVisible();

  await Promise.all([
    page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame(), timeout: 15_000 }),
    recovery.getByRole("button", { name: "Refresh now" }).click(),
  ]);
  await expect(page.getByText("AXOM refreshed after your backup", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(dialogs).toEqual([]);
  expect(errors.filter((message) => !/dynamically imported module|ReportsPage/.test(message))).toEqual([]);
});
