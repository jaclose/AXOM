// The academic bookshelf, driven in a real browser on its development harness
// page (/harness/bookshelf.html), which mounts it on the app's real store.
// Covers what a unit test cannot: the shelf as drawn, keyboard and focus, the
// open book, a load that survives a reload, and a phone-sized screen.
import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/harness/bookshelf.html";
const shots = process.env.AXOM_BOOKSHELF_SHOTS;

async function openHarness(page: Page) {
  await page.goto(HARNESS);
  await expect(page.getByRole("region", { name: "Course library" })).toBeVisible();
}

// AXOM is dark first. One test below looks at the light theme.
test.use({ colorScheme: "dark" });

// The harness page exists on the dev server only. Against a built app there is nothing to test here.
test.beforeEach(async ({ request }) => {
  const response = await request.get(HARNESS);
  test.skip(!response.ok() || !(await response.text()).includes("bookshelfHarness"), "The bookshelf harness is served by the dev server only.");
});

const spine = (page: Page, name: RegExp) => page.getByRole("button", { name });
const width = async (page: Page, name: RegExp) => (await spine(page, name).boundingBox())!.width;

test.describe("academic bookshelf", () => {
  test("shows a real book for each module, thicker where there is more in it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    // ER, DM and GOER are modules in the course map the app carries. Nothing is invented for the shelf.
    await expect(spine(page, /^ER, BPM 501, Term 2\./)).toBeVisible();
    await expect(spine(page, /^DM, BPM 501, Term 2\./)).toBeVisible();
    await expect(spine(page, /^GOER, PPM 501, Term 5\. 0 activities\. Not loaded yet\./)).toBeVisible();
    const empty = await width(page, /^ER, BPM 501/);

    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("harness-log")).toContainText("saved on this device");
    await expect(spine(page, /^ER, BPM 501, Term 2\. 72 activities\./)).toBeVisible();
    await expect(spine(page, /^DM, BPM 501, Term 2\. 17 activities\./)).toBeVisible();
    const [er, dm, nb1, nb2] = [await width(page, /^ER, BPM 501/), await width(page, /^DM, BPM 501/), await width(page, /^NB1, BPM 501/), await width(page, /^NB2, BPM 501/)];
    expect(er).toBeGreaterThan(dm);
    expect(dm).toBeGreaterThan(nb1);
    expect(nb1).toBeGreaterThan(nb2);
    expect(nb2).toBe(empty);
    // Seventy-two activities is not thirty-six times a two-activity book: the scale is logarithmic.
    expect(er).toBeLessThan(nb1 * 3);
    if (shots) await page.screenshot({ path: `${shots}/shelf-1440.png` });
  });

  test("opens from the keyboard, keeps focus inside, and returns it to the spine", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    const first = page.getByRole("region", { name: "Course library" }).getByRole("button").first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const chosen = page.locator(".shelf-book:focus");
    const label = await chosen.getAttribute("aria-label");
    expect(label).toMatch(/^MSK, BPM 500, Term 1\./);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "MSK" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close MSK and put it back" })).toBeFocused();
    // Tab never leaves the open book.
    for (let presses = 0; presses < 12; presses += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".shelf-book:focus")).toHaveAttribute("aria-label", label!);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".shelf-book:focus")).toHaveAttribute("aria-label", /Term 2\./);
  });

  test("loads a course into Course Tracker and still has it after a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    await spine(page, /^GOER, PPM 501, Term 5\. 0 activities\. Not loaded yet\./).click();
    const dialog = page.getByRole("dialog", { name: "GOER" });
    await expect(dialog.getByText(/^Adds .*the module GOER to your Course Tracker\. Nothing you already have is changed or removed\.$/)).toBeVisible();
    await dialog.getByTestId("load-course").click();
    await expect(dialog.getByRole("status")).toContainText("Saved on this device.");
    await page.keyboard.press("Escape");
    await expect(spine(page, /^GOER, PPM 501, Term 5\. 0 activities\. In your Course Tracker, with no activities yet\./)).toBeVisible();

    await page.reload();
    await expect(spine(page, /^GOER, PPM 501, Term 5\. 0 activities\. In your Course Tracker, with no activities yet\./)).toBeVisible();
    // Loading again adds nothing: the book says so and offers no second load.
    await spine(page, /^GOER, PPM 501, Term 5\./).click();
    const again = page.getByRole("dialog", { name: "GOER" });
    await expect(again.getByText("GOER is already in your Course Tracker. Nothing will change.")).toBeVisible();
    await expect(again.getByTestId("load-course")).toHaveCount(0);
    // The other Term 5 modules are still one book each, not doubled.
    await page.keyboard.press("Escape");
    await expect(spine(page, /^NMI, PPM 501, Term 5\./)).toHaveCount(1);
  });

  test("question banks: real counts, and Term 5 GOER Week 2 shown as what it is", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("harness-log")).toContainText("saved on this device");
    await page.getByRole("button", { name: "Question banks", exact: true }).click();
    await expect(spine(page, /^ER, BPM 501, Term 2\. 185 questions\./)).toBeVisible();
    await expect(spine(page, /^DM, BPM 501, Term 2\. 12 questions\./)).toBeVisible();
    expect(await width(page, /^ER, BPM 501/)).toBeGreaterThan(await width(page, /^DM, BPM 501/));

    // GOER has three known banks and no question on this device: an honest, empty book.
    await spine(page, /^GOER, PPM 501, Term 5\. 0 questions\. 3 banks known, none on this device yet\./).click();
    const goer = page.getByRole("dialog", { name: "GOER" });
    await expect(goer.getByRole("button", { name: "Week 2 · 0" })).toBeVisible();
    for (const title of ["Biostatistics & Epidemiology", "Endocrine Pathophysiology", "Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics"]) {
      await expect(goer.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(goer.getByText("Source file missing")).toHaveCount(3);
    await expect(goer.getByTestId("start-practice")).toBeDisabled();
    await page.keyboard.press("Escape");

    await spine(page, /^ER, BPM 501, Term 2\. 185 questions\./).click();
    const er = page.getByRole("dialog", { name: "ER" });
    // Six of the practice questions have no confirmed answer, so 99 of week 1's 105 are ready.
    await expect(er.getByText("of 99 ready")).toBeVisible();
    await expect(er.getByText("Awaiting review")).toBeVisible();
    await er.getByTestId("start-practice").click();
    await expect(page.getByTestId("harness-log")).toHaveText("Practice asked for: 20 questions from 2 set(s), ER week 1.");
    if (shots) await page.screenshot({ path: `${shots}/open-bank-1440.png` });
  });

  test("works on a phone: no sideways page scroll, spines a thumb can hit, a readable open book", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page);
    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("harness-log")).toContainText("saved on this device");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    const boxes = await page.locator(".shelf-book").evaluateAll((books) => books.map((book) => book.getBoundingClientRect().width));
    expect(Math.min(...boxes)).toBeGreaterThanOrEqual(44);
    if (shots) await page.screenshot({ path: `${shots}/shelf-390.png` });
    await spine(page, /^ER, BPM 501, Term 2\. 72 activities\./).click();
    const dialog = page.getByRole("dialog", { name: "ER" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await expect(dialog.getByText("Week 6", { exact: true })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/open-course-390.png` });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("academic bookshelf, with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("the book comes off the shelf, turns, opens, and goes back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("harness-log")).toContainText("saved on this device");
    const er = spine(page, /^ER, BPM 501, Term 2\. 72 activities\./);
    await er.hover();
    await page.waitForTimeout(450);
    if (shots) await page.screenshot({ path: `${shots}/hover-1440.png` });
    await er.click();
    const layer = page.locator(".open-book-layer");
    await expect(layer).toHaveAttribute("data-phase", /lifting|turning/);
    // The gap stays on the shelf while the book is out, so nothing beside it moves.
    const gap = page.locator('.shelf-book[data-out="true"]');
    await expect(gap).toHaveCSS("visibility", "hidden");
    const gapBox = await gap.evaluate((book) => book.getBoundingClientRect().width);
    expect(gapBox).toBeGreaterThan(40);
    await page.waitForTimeout(330);
    if (shots) await page.screenshot({ path: `${shots}/turning-1440.png` });
    await expect(layer).toHaveAttribute("data-phase", "opening");
    await page.waitForTimeout(240);
    if (shots) await page.screenshot({ path: `${shots}/opening-1440.png` });
    await expect(layer).toHaveAttribute("data-phase", "open");
    await expect(page.getByRole("dialog", { name: "ER" })).toBeVisible();
    await page.waitForTimeout(350);
    if (shots) await page.screenshot({ path: `${shots}/open-course-1440.png` });
    await page.keyboard.press("Escape");
    await expect(layer).toHaveAttribute("data-phase", /closing|returning/);
    await expect(layer).toHaveCount(0);
    await expect(er).toBeFocused();
    await expect(er).toHaveCSS("visibility", "visible");
  });
});

test.describe("academic bookshelf, light theme", () => {
  test.use({ colorScheme: "light" });

  test("is drawn from the same tokens", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHarness(page);
    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("harness-log")).toContainText("saved on this device");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (shots) await page.screenshot({ path: `${shots}/shelf-1440-light.png` });
  });
});
