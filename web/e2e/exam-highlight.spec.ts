import type { Locator, Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";

// Highlighting is one tool in every exam interface and for every kind of
// question: drag across stem text to mark it, drag from inside a mark past its
// end to grow the same mark. Imported questions (ExamSoft banks among them)
// keep their paragraphs, tables and formatting, and still take highlights.

const STEM = "A 54-year-old man has crushing chest pain radiating to the left arm and diaphoresis for two hours.";
const IMPORTED = {
  id: "highlight-imported", source: { filename: "synthetic.pdf", questionNumber: 1, page: 1 },
  stem: [
    { type: "text", text: "A 54-year-old man has crushing chest pain radiating to the left arm." },
    { type: "table", headers: ["Lab", "Value"], rows: [["pH", "7.55"]] },
    { type: "rich_text", html: "Serum HCO<sub>3</sub><sup>-</sup> is 38 mEq/L and he is diaphoretic." },
  ],
  choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Aortic dissection" }] },
    { id: "b", label: "B", blocks: [{ type: "text", text: "Myocardial infarction" }] }],
  correctAnswer: { labels: ["B"], evidence: "printed-key" }, assets: [],
  provenance: { method: "pdf-import", sourceChecksum: "sha256:" + "a".repeat(64) },
};
// The plain stem every highlight is saved against: the blocks read as text.
const IMPORTED_STEM = "A 54-year-old man has crushing chest pain radiating to the left arm.\n\nLab | Value\npH | 7.55\n\nSerum HCO3- is 38 mEq/L and he is diaphoretic.";

const SKINS = [
  { name: /ExamSoft \(Examplify\)/, dialog: "ExamSoft (Examplify) exam simulation", tool: true },
  { name: /UWorld-style/, dialog: "UWorld-style exam simulation", tool: false },
];

for (const skin of SKINS) test(`highlights stem text and extends a highlight in ${skin.dialog}`, async ({ page }) => {
  const errors = collectErrors(page);
  const stem = await startBlock(page, skin, "plain");
  await drag(page, stem, "crushing", "pain");
  const marks = stem.locator("mark.question-highlight");
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText("crushing chest pain");

  // Start inside the mark and drag past its end: the same mark grows.
  await drag(page, stem, "chest", "arm");
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText("crushing chest pain radiating to the left arm");

  // And from before it into it.
  await drag(page, stem, "man", "crushing");
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText("man has crushing chest pain radiating to the left arm");
  expect(errors).toEqual([]);
});

for (const skin of SKINS) test(`highlights an imported question's paragraphs in ${skin.dialog}`, async ({ page }) => {
  const errors = collectErrors(page);
  const stem = await startBlock(page, skin, "imported");
  await expect(stem.locator("table")).toBeVisible();
  await drag(page, stem, "crushing", "pain");
  const marks = stem.locator("mark.question-highlight");
  await expect(marks).toHaveCount(1);
  await drag(page, stem, "chest", "arm");
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText("crushing chest pain radiating to the left arm");

  // Across subscript and superscript: one highlight, drawn in pieces.
  await drag(page, stem, "HCO", "38");
  await expect(stem.locator("sub mark, sup mark")).toHaveCount(2);
  expect(await savedHighlights(page)).toEqual(["crushing chest pain radiating to the left arm", "HCO3- is 38"]);

  // The eraser removes a whole highlight, every piece of it.
  if (skin.tool) await page.getByRole("button", { name: "Erase highlighting" }).click();
  else await marks.last().focus();
  if (skin.tool) await stem.locator("sub mark").click();
  else await page.keyboard.press("Delete");
  await expect(stem.locator("sub mark, sup mark")).toHaveCount(0);
  await expect(marks).toHaveCount(1);
  expect(await savedHighlights(page)).toEqual(["crushing chest pain radiating to the left arm"]);
  expect(errors).toEqual([]);
});

for (const width of [390, 360]) for (const skin of SKINS) test(`keeps the whole question and its controls on a ${width}px phone in ${skin.dialog}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const stem = await startBlock(page, skin, "plain");
  const exam = page.getByRole("dialog", { name: skin.dialog });
  // Nothing reaches past the screen, so no word or button is cut off. A toolbar
  // that scrolls sideways on purpose may hold more than fits.
  expect(await exam.evaluate((root) => {
    const scrolls = (node: Element) => /auto|scroll/.test(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth;
    const inScroller = (node: Element) => {
      for (let up = node.parentElement; up && up !== root; up = up.parentElement) if (scrolls(up)) return true;
      return false;
    };
    return Math.max(...[...root.querySelectorAll("*")].filter((node) => !inScroller(node)).map((node) => node.getBoundingClientRect().right));
  })).toBeLessThanOrEqual(width + 0.5);
  await expect(stem).toBeInViewport({ ratio: 1 });
  await expect(exam.getByRole("button", { name: skin.tool ? "Exam Controls" : /End Block/ })).toBeInViewport({ ratio: 1 });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function startBlock(page: Page, skin: (typeof SKINS)[number], kind: "plain" | "imported"): Promise<Locator> {
  await openSeededQuestion(page, kind);
  await page.getByRole("radio", { name: skin.name }).click();
  await page.getByRole("button", { name: "Exam (feedback at the end)" }).click();
  await page.getByRole("button", { name: /Start exam block/ }).click();
  const exam = page.getByRole("dialog", { name: skin.dialog });
  await expect(exam).toBeVisible();
  if (skin.tool) await exam.getByRole("button", { name: "Highlight text" }).click();
  return exam.getByLabel("Question stem");
}

/** Press on the first letter of `from` and release after the last letter of `to`, as a person drags. */
async function drag(page: Page, stem: Locator, from: string, to: string) {
  const points = await stem.evaluate((root, [start, end]) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    const locate = (word: string, last: boolean) => {
      const text = nodes.map((node) => node.data).join("");
      let at = text.indexOf(word) + (last ? word.length - 1 : 0);
      for (const node of nodes) {
        if (at < node.data.length) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          const box = range.getBoundingClientRect();
          return { x: last ? box.right - 1 : box.left + 1, y: box.top + box.height / 2 };
        }
        at -= node.data.length;
      }
      throw new Error(`"${word}" is not in the stem`);
    };
    return [locate(start, false), locate(end, true)];
  }, [from, to]);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2, { steps: 4 });
  await page.mouse.move(points[1].x, points[1].y, { steps: 4 });
  await page.mouse.up();
}

type Dev = {
  useStore: { getState: () => {
    questions: Array<{ id: string; annotations?: Array<{ exactText: string; startOffset: number }> }>;
    addQuestion: (input: unknown) => { ok: boolean; errors: string[]; id?: string };
    addQuestionSet: (set: unknown) => void;
  } };
  flushVault: () => Promise<void>;
};

/** What the question keeps, in stem order. */
async function savedHighlights(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const question = dev.useStore.getState().questions.find((entry) => entry.id.startsWith("highlight-"));
    return [...(question?.annotations ?? [])].sort((a, b) => a.startOffset - b.startOffset).map((annotation) => annotation.exactText);
  });
}

/** A finished profile, one synthetic question in a set, and its block setup open. */
async function openSeededQuestion(page: Page, kind: "plain" | "imported"): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await page.evaluate(async ({ stem, content }) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const result = dev.useStore.getState().addQuestion({
      id: content ? "highlight-imported" : "highlight-plain", source: content ? "imported" : "manual", stem,
      options: [{ key: "A", text: "Aortic dissection" }, { key: "B", text: "Myocardial infarction" }],
      correctKey: "B", explanation: "Synthetic item.", tags: [], ...(content ? { content } : {}),
    });
    if (!result.ok || !result.id) throw new Error(result.errors.join(" "));
    dev.useStore.getState().addQuestionSet({
      id: "highlight-set", title: "Highlight set", sourceDocumentIds: [], createdAt: new Date().toISOString(),
      questionIds: [result.id], tags: [], aiEnhanced: false, parserWarnings: [],
    });
    await dev.flushVault();
  }, kind === "imported" ? { stem: IMPORTED_STEM, content: IMPORTED } : { stem: STEM, content: undefined });
  await page.evaluate(() => { window.location.hash = "questions"; });
  await page.getByRole("tab", { name: /Library \(1\)/ }).click();
  await page.getByRole("button", { name: "Weeks & sets", exact: true }).click();
  await page.getByRole("button", { name: "Practice Highlight set", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up a tutor block" })).toBeVisible();
}
