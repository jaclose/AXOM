import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

for (const width of [1440, 390]) test(`Journal scroll stays inside the page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((theme) => localStorage.setItem("axom.theme", theme), width === 390 ? "light" : "dark");
  await seedOnboarded(page);
  await page.goto("/#journal");
  await page.getByRole("dialog", { name: "Make this notebook yours" })
    .getByRole("button", { name: "Skip for now" }).click();

  const shell = page.locator(".shell");
  const pageScroll = page.locator(".surface-scroll");
  const shelf = page.locator(".journal-library-shelf");

  // Reproduce the browser focus/scrollIntoView path that shifted the whole app out of view.
  await shell.evaluate((element) => { element.scrollTop = 300; });
  expect(await shell.evaluate((element) => element.scrollTop)).toBe(0);

  await pageScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(shelf).toBeInViewport();
  expect(await shell.evaluate((element) => element.scrollTop)).toBe(0);
});

for (const width of [1440, 768, 390]) test(`Journal saves and reloads a page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((theme) => localStorage.setItem("axom.theme", theme), width === 390 ? "light" : "dark");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await seedOnboarded(page);
  await page.goto("/#journal");
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Write at your desk" })).toBeVisible();
  await page.getByRole("button", { name: "Write full page" }).click();

  const notebook = page.getByRole("dialog", { name: "Full journal" });
  await expect(notebook).toBeVisible();
  await expect(notebook).toHaveAttribute("data-motion", "reduced");
  const entry = `A durable synthetic journal page at ${width}px.`;
  await page.getByLabel("Free writing").fill(entry);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to this workspace", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Put down on desk" }).click();
  await expect(page.getByRole("button", { name: "Write full page" })).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByText("Recent pages", { exact: true })).toBeVisible();
  await expect(page.getByText(entry, { exact: true })).toBeVisible();
  await reloadAfterSave(page);
  await page.getByText(entry, { exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();
  await expect(page.getByLabel("Free writing")).toHaveValue(entry);

  await page.screenshot({ path: `/tmp/axom-journal-notebook-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("A deliberate page turn keeps yesterday open beyond the untouched-preview pause", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#journal");
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();
  await page.getByRole("button", { name: "Previous journal page" }).click();
  await expect(page.getByRole("heading", { name: "Yesterday’s page" })).toBeVisible();
  await page.waitForTimeout(5600);
  await expect(page.getByRole("dialog", { name: "Full journal" })).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) test(`Journal zoom toolbar stays readable at 390px in ${colorScheme} mode`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await seedOnboarded(page);
  await page.goto("/#journal");
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();
  const position = page.locator(".journal-book-stage.is-zoomed .journal-page-position");
  await expect(position.locator("b")).toHaveCSS("color", "rgb(241, 234, 219)");
  await expect(position.locator("span")).toHaveCSS("color", "rgba(248, 240, 220, 0.72)");
  await page.screenshot({ path: `/tmp/axom-journal-zoom-390-${colorScheme}.png` });
});

test("A first journal visit offers setup before writing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedOnboarded(page);
  await page.goto("/#journal");
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await expect(setup.getByText("Why do you come to the journal?")).toBeVisible();
  await expect(setup.getByText("How do you like to start writing?")).toBeVisible();
  await expect(setup.getByText("What light helps you settle?")).toBeVisible();
  await expect(setup.getByText("Before the day closes")).toBeVisible();
  await page.screenshot({ path: "/tmp/axom-journal-first-open-setup.png" });
});

test("Completion folds the book and reveals the kept day", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("axom.announcements.dismissed.v1", '["journal-energy-explanation-v1"]'));
  await seedOnboarded(page);
  await page.goto("/#journal");
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();
  await page.getByLabel("Free writing").fill("One useful hour, kept for tomorrow.");
  await page.getByRole("button", { name: "Done for today" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Day kept." })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/axom-journal-completion-fold.png" });
  await page.waitForTimeout(1250);
  await page.screenshot({ path: "/tmp/axom-journal-completion-reveal.png" });
});


for (const [width, scheme] of [[320, "light"], [390, "dark"], [1440, "light"]] as const) {
  test(`Journal repeated Enter removes only the chosen private reflection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((theme) => localStorage.setItem("axom.theme", theme), scheme);
    await seedOnboarded(page);
    await page.goto("/#journal");

    const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
    if (await setup.isVisible()) await setup.getByRole("button", { name: "Skip for now" }).click();

    // This is a synthetic local workspace with a pre-existing multi-note entry.
    // No account or remote provider is used. Keep the ID to detect a replacement.
    await page.evaluate(async () => {
      type Entry = { id: string; wins?: string[]; losses?: string[] };
      type Dev = {
        useStore: { getState: () => {
          addJournal: (entry: Record<string, unknown>) => void;
          journal: Entry[];
        } };
        flushVault: () => Promise<void>;
      };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const now = new Date();
      const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")].join("-");
      dev.useStore.getState().addJournal({
        id: "journal-repeat-key-fixture",
        date: `${day}T12:00:00`,
        today: "Synthetic day",
        tomorrow: "",
        blockers: "",
        energy: "Medium",
        rating: "Useful",
        freeWriting: "Synthetic private writing",
        wins: ["Keep A", "Keep B", "Keep C"],
        losses: ["Release A", "Release B"],
        notebookStatus: "draft",
      });
      await dev.flushVault();
    });
    await reloadAfterSave(page);

    await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
    await page.getByRole("button", { name: "Write full page" }).click();
    const journal = page.getByRole("dialog", { name: "Full journal" });
    await journal.getByText("Keep something. Release something.").click();
    await expect(journal.getByLabel("Something to keep 2")).toHaveValue("Keep B");

    // Native Chromium key events, not a synthetic fireEvent.click. A second
    // keydown while Enter remains held must not activate the recycled button.
    await journal.getByRole("button", { name: "Remove keep 2" }).focus();
    await page.keyboard.down("Enter");
    await expect(journal.getByLabel("Something to keep 2")).toHaveValue("Keep C");
    await expect(journal.getByLabel("Something to keep", { exact: true })).toBeFocused();
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(journal.getByLabel("Something to keep 2")).toHaveValue("Keep C");
    await expect(journal.getByLabel("A loose thread 2")).toHaveValue("Release B");

    await journal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved to this workspace", { exact: true })).toBeVisible();
    await reloadAfterSave(page);

    const saved = await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
        useStore: { getState: () => { journal: Array<{
          id: string; wins?: string[]; losses?: string[]; notebookStatus?: string;
        }> } };
      }> }).__AXOM_DEV__;
      return dev.useStore.getState().journal.filter((entry) => entry.id === "journal-repeat-key-fixture");
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: "journal-repeat-key-fixture",
      wins: ["Keep A", "Keep C"],
      losses: ["Release A", "Release B"],
      notebookStatus: "draft",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
