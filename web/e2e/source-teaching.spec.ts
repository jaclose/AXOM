import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// A deck that explains its questions in headed sections ("Why it's right",
// "Why not the others", "High-yield"). After the learner checks an answer,
// AXOM offers what those slides teach, the learner keeps it, it is still there
// after a reload, and the page it rests on can be opened from the original
// file. The PDF is built here from invented content.

const STEMS = [
  ["A 54-year-old man has crushing chest pain that spreads to his left arm.", "His electrocardiogram shows ST elevation in leads II, III and aVF.", "Which coronary artery is most likely blocked?"],
  ["A 23-year-old woman has a fever, a new murmur and painful spots on her fingertips.", "Blood cultures grow gram-positive cocci in clusters.", "Which valve is most likely infected?"],
  ["A 67-year-old man faints while climbing a flight of stairs.", "He has a harsh systolic murmur that spreads to the neck.", "What is the most likely diagnosis?"],
];
const OPTIONS = [
  ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main"],
  ["A. Aortic valve", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve"],
  ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Hypertrophic cardiomyopathy", "D. Atrial septal defect"],
];
const ANSWERS = ["Answer: C", "Answer: D", "Answer: A"];
const TEACHING = [
  ["Inferior wall infarction", "WHY IT'S RIGHT", "Leads II, III and aVF look at the inferior wall,", "which the right coronary artery supplies in most people.",
    "WHY NOT THE OTHERS", "A. The left anterior descending supplies the anterior wall.", "B. The circumflex supplies the lateral wall.", "D. Left main disease gives widespread changes.",
    "HIGH-YIELD", "Match the leads to the wall, then the wall to the artery."],
  ["Right-sided endocarditis", "WHY IT'S RIGHT", "Injected organisms reach the tricuspid valve first.",
    "WHY NOT THE OTHERS", "A. Aortic disease is left sided and embolises to the body.", "B. Mitral disease follows rheumatic damage.",
    "HIGH-YIELD", "Venous entry, right-sided valve."],
  ["Exertional syncope with an ejection murmur points to aortic stenosis.", "The murmur spreads to the neck because the jet is aimed at the aorta."],
];
const questionSlide = (index: number) => [`${index + 1}. ${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]];
const PAGES = [
  ["Cardiology review"],
  ...[0, 1, 2].flatMap((index) => [questionSlide(index), [...questionSlide(index), ANSWERS[index]], TEACHING[index]]),
];

/** A text-only PDF with one page per entry, one line of text per string. */
function deckPdf(pages: string[][]): Buffer {
  const escaped = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  pages.forEach((lines, index) => {
    const content = Buffer.from(`${lines.map((line, at) => `BT /F1 11 Tf 72 ${740 - at * 18} Td (${escaped(line)}) Tj ET`).join("\n")}\n`, "latin1");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]));
  });
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

test("what a deck's own slides teach is offered after an answer, kept, and traced to its page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = { name: "Cardiology review.pdf", mimeType: "application/pdf", buffer: deckPdf(PAGES) };

  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles(pdf);
  await expect(page.getByText("Review 3 parsed questions", { exact: false })).toBeVisible();
  await page.getByLabel("Set title").fill("Cardiology review");
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Browse weeks", exact: true }).click();
  await page.getByRole("button", { name: "Practice Cardiology review", exact: true }).click();
  await page.getByText("Advanced: order, category & exam interface", { exact: true }).click();
  await page.getByText("Keep document order (instead of shuffling)").click();
  await page.getByRole("button", { name: "Start tutor block" }).click();

  // Nothing about the source's teaching is shown before the learner commits to an answer.
  await expect(page.getByText("Match the leads to the wall, then the wall to the artery.")).toHaveCount(0);
  await page.getByLabel("Question stem").focus();
  await page.keyboard.press("A");
  await page.keyboard.press("Enter");

  const offered = page.getByRole("region", { name: "From the source's slides" });
  await expect(offered).toContainText("Inferior wall infarction");
  await expect(offered).toContainText("Match the leads to the wall, then the wall to the artery.");
  await expect(offered).toContainText("Why A is not the answer");
  await offered.getByRole("button", { name: "Keep" }).click();
  const kept = page.getByRole("region", { name: "From the source", exact: true });
  await expect(kept).toContainText("Match the leads to the wall, then the wall to the artery.");

  // It is on the question, so it is there after a reload. The Question Bank reopens the block by itself.
  await reloadAfterSave(page);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await expect(kept).toContainText("Match the leads to the wall, then the wall to the artery.");
  const saved = await page.evaluate(async () => {
    type Question = { sourcePage?: number; analyses?: Array<{ origin: string; status: string; references: Array<{ page: number }> }> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions?: Question[] } } }> }).__AXOM_DEV__;
    return (dev.useStore.getState().questions ?? []).filter((question) => question.analyses?.length);
  });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ sourcePage: 2, analyses: [{ origin: "source", status: "reviewed" }] });
  expect(saved[0].analyses![0].references.map((reference) => reference.page)).toEqual([2, 3, 4]);

  // The page it rests on: the saved text at once, and the page as drawn once the original file is attached.
  await kept.getByRole("button", { name: "See the source, page 2" }).click();
  await expect(kept.getByText("The original file is not on this device", { exact: false })).toBeVisible();
  await kept.getByRole("button", { name: "Page 4" }).click();
  await kept.getByLabel("Attach the original file of Cardiology review").setInputFiles(pdf);
  const drawn = kept.getByRole("img", { name: "Cardiology review, page 4" });
  await expect(drawn).toBeVisible();
  const size = await drawn.evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height, shown: canvas.getBoundingClientRect().width }));
  expect(size.width).toBeGreaterThan(900);
  expect(size.height / size.width).toBeCloseTo(792 / 612, 1);
  expect(size.shown).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});
