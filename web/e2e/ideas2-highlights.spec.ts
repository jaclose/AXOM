import type { Page } from "@playwright/test";
import { deferPromisePrompt, expect, reloadAfterSave, test } from "./fixtures";

type DevWindow = Window & { __AXOM_DEV__?: Promise<{ useStore: typeof import("../src/lib/store").useStore }> };

async function openWorkspace(page: Page, route: string) {
  await page.goto(`/#${route}`);
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await deferPromisePrompt(page);
  await page.evaluate((hash) => { location.hash = hash; }, route);
  await expect(page.locator(".route-loading")).toHaveCount(0);
}

async function dragText(page: Page, start: number, end: number) {
  const root = page.getByLabel("Question stem", { exact: true });
  await root.scrollIntoViewIfNeeded();
  const points = await root.evaluate((element, offsets) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Node; start: number; end: number }> = [];
    let cursor = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, start: cursor, end: cursor + (node.textContent?.length ?? 0) });
      cursor += node.textContent?.length ?? 0;
    }
    return offsets.map((offset) => {
      const entry = nodes.find((item) => offset >= item.start && offset < item.end)!;
      const range = document.createRange();
      range.setStart(entry.node, offset - entry.start);
      range.setEnd(entry.node, offset - entry.start + 1);
      const box = range.getBoundingClientRect();
      return { x: box.x + .1, y: box.y + box.height / 2 };
    });
  }, [start, end]);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 15 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Highlight selection", exact: true }).click();
}

test("real pointer selections extend into, out of and across persisted highlights", async ({ page }, info) => {
  await openWorkspace(page, "questions");
  const text = "Start middle end passage with enough words for selection.";
  await page.evaluate(async (stem) => {
    const { useStore } = await (window as DevWindow).__AXOM_DEV__!;
    useStore.getState().addQuestion({ stem, options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }], correctKey: "A" });
  }, text);
  await page.getByRole("tab", { name: /^Bank/ }).click();
  await page.getByRole("button", { name: text, exact: true }).click();
  await dragText(page, 6, 12);
  await expect(page.locator("mark.question-highlight")).toHaveText(["middle"]);
  await dragText(page, 0, 9);
  await expect(page.locator("mark.question-highlight")).toHaveText(["Start middle"]);
  await dragText(page, 8, 24);
  await expect(page.locator("mark.question-highlight")).toHaveText(["Start middle end passage"]);
  await dragText(page, 0, 29);
  await expect(page.locator("mark.question-highlight")).toHaveCount(1);
  const marked = await page.locator("mark.question-highlight").textContent();
  await page.screenshot({ path: info.outputPath("highlight-merged.png") });
  await reloadAfterSave(page);
  await page.getByRole("tab", { name: /^Bank/ }).click();
  await page.getByRole("button", { name: text, exact: true }).click();
  await expect(page.locator("mark.question-highlight")).toHaveText([marked!]);
  await page.locator("mark.question-highlight").focus();
  await page.keyboard.press("Delete");
  await expect(page.locator("mark.question-highlight")).toHaveCount(0);
  await reloadAfterSave(page);
  await page.getByRole("tab", { name: /^Bank/ }).click();
  await page.getByRole("button", { name: text, exact: true }).click();
  await expect(page.locator("mark.question-highlight")).toHaveCount(0);
});
