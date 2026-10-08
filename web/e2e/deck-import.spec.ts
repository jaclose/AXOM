import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// A review deck: a title slide, then each question on one slide and printed
// again on the next with its answer, an explanation and (once) a picture. It
// comes in as one question per question slide, each on its own page; the
// picture on the question slide is attached and the one on the answer slide is
// not; and all of that is still true after a reload. Built here from invented
// content.

interface Slide { lines: string[]; image?: boolean }

/** A PDF with one page per slide: each line as its own text run, and an optional small image low on the page. */
function deckPdf(slides: Slide[]): Buffer {
  const pixels = Buffer.from([200, 30, 30, 30, 160, 60, 40, 60, 200, 230, 210, 40]);
  const font = 3 + slides.length * 2;
  const image = font + 1;
  const kids = slides.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${slides.length} >>`),
  ];
  slides.forEach((slide, index) => {
    const text = slide.lines.map((line, at) => `BT /F1 12 Tf 72 ${720 - at * 18} Td (${line}) Tj ET`).join("\n");
    // The image fills the unit square scaled to 200 x 120 points at (72, 300).
    const content = Buffer.from(`${text}\n${slide.image ? "q 200 0 0 120 72 300 cm /Im1 Do Q\n" : ""}`, "latin1");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]));
  });
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from("\nendstream")]));

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

const QUESTIONS = [
  { stem: ["A tracing is shown for a man with crushing chest pain.", "Which coronary artery is most likely blocked?"], options: ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main"], answer: "C", why: "Inferior changes usually come from the right coronary artery." },
  { stem: ["A woman who injects drugs has a fever and a new murmur.", "Which valve is most likely infected?"], options: ["A. Aortic valve", "B. Tricuspid valve", "C. Mitral valve", "D. Pulmonary valve"], answer: "B", why: "Injected organisms reach the tricuspid valve first." },
  { stem: ["An older man faints while climbing a flight of stairs.", "What is the most likely diagnosis?"], options: ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Atrial septal defect", "D. Pulmonary stenosis"], answer: "A", why: "Fainting on exertion with an ejection murmur points to aortic stenosis." },
];

const DECK: Slide[] = [
  { lines: ["Cardiology review session"] },
  ...QUESTIONS.flatMap((question, index): Slide[] => [
    // The first question has a picture on its own slide, and another on its answer slide.
    { lines: [...question.stem, ...question.options], image: index === 0 },
    { lines: [...question.stem, ...question.options, `Answer: ${question.answer}`, `Explanation: ${question.why}`], image: index === 0 },
  ]),
];

test("a review deck comes in as one question per slide, with only the question slide's picture", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Choose a question file to import").setInputFiles({
    name: "FTM 1 Week 2 IMCQ 3 Key.pdf", mimeType: "application/pdf", buffer: deckPdf(DECK),
  });

  // Three questions, not six, and AXOM says how it read the file.
  await expect(page.getByText("Review 3 parsed questions", { exact: false })).toBeVisible();
  await expect(page.getByText("Read slide by slide: 3 questions, one to a slide, 3 printed again on an answer slide. 1 slide with no question was left out (page 1).")).toBeVisible();
  await expect(page.getByText("2 images found in this PDF, 1 attached to a question by its place on the page.")).toBeVisible();
  await expect(page.getByText("FTM-1-Week-2-IMCQ-3-Key-p3-fig1.png was not attached. Page 3 is the answer slide for the question on page 2, so this image was kept out of the question to avoid giving the answer away.")).toBeVisible();

  const drafts = page.locator(".import-draft");
  await expect(drafts).toHaveCount(3);
  await expect(drafts.nth(0)).toContainText("answer C");
  await expect(drafts.nth(0)).toContainText("page 2");
  await expect(drafts.nth(0)).toContainText("image FTM-1-Week-2-IMCQ-3-Key-p2-fig1.png");
  await expect(drafts.nth(0)).not.toContainText("p3-fig1");
  await expect(drafts.nth(1)).toContainText("page 4");
  await expect(drafts.nth(1)).not.toContainText("image ");
  await expect(drafts.nth(2)).toContainText("page 6");
  // The answer slide's picture is kept in the review, unplaced, and the learner is told it will not be saved as it stands.
  const images = page.getByRole("region", { name: "Images" });
  await expect(images.getByRole("list", { name: "Named images" }).getByRole("listitem")).toHaveCount(1);
  const unplaced = images.getByRole("list", { name: "Images not on a question" }).getByRole("listitem");
  await expect(unplaced).toHaveCount(1);
  await expect(unplaced).toContainText("FTM-1-Week-2-IMCQ-3-Key-p3-fig1.png");
  await expect(unplaced.getByLabel("Attach FTM-1-Week-2-IMCQ-3-Key-p3-fig1.png to a question")).toBeVisible();
  await expect(page.getByText("The reviewed import is ready to finalize. 1 image is not on any question and will be left out.")).toBeVisible();

  await page.getByLabel("Set title").fill("Deck with answer slides");
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();

  await reloadAfterSave(page);
  const saved = await page.evaluate(async () => {
    type Question = {
      id: string; stem: string; sourcePage?: number; correctKey?: string; explanation?: string; sourceFile?: { name: string };
      attachments?: Array<{ fileName: string; role?: string }>;
      extraction?: { questionSourcePage?: number; answerEvidencePage?: number; explanationSourcePage?: number };
    };
    type State = { questions?: Question[]; questionSets?: Array<{ questionIds: string[] }> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => State } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    const byId = new Map((state.questions ?? []).map((question) => [question.id, question]));
    return (state.questionSets?.[0]?.questionIds ?? []).map((id) => byId.get(id)!);
  });
  expect(saved.map((question) => [question.sourcePage, question.correctKey])).toEqual([[2, "C"], [4, "B"], [6, "A"]]);
  expect(saved.map((question) => question.stem)).toEqual(QUESTIONS.map((question) => question.stem.join(" ")));
  expect(saved.map((question) => question.explanation)).toEqual(QUESTIONS.map((question) => question.why));
  expect(saved.every((question) => question.sourceFile?.name === "FTM 1 Week 2 IMCQ 3 Key.pdf")).toBe(true);
  expect(saved.map((question) => question.extraction)).toEqual([
    expect.objectContaining({ questionSourcePage: 2, answerEvidencePage: 3, explanationSourcePage: 3 }),
    expect.objectContaining({ questionSourcePage: 4, answerEvidencePage: 5, explanationSourcePage: 5 }),
    expect.objectContaining({ questionSourcePage: 6, answerEvidencePage: 7, explanationSourcePage: 7 }),
  ]);
  // One exhibit in the whole set: the picture from the question slide.
  expect(saved.map((question) => (question.attachments ?? []).map((attachment) => attachment.fileName))).toEqual([["FTM-1-Week-2-IMCQ-3-Key-p2-fig1.png"], [], []]);

  // Before answering, the learner sees the question's picture and nothing from the answer slide.
  await page.getByRole("tab", { name: /Question Sets \(1\)/ }).click();
  await page.getByRole("button", { name: "Practice Deck with answer slides", exact: true }).click();
  await page.getByRole("button", { name: "Start tutor block" }).click();
  await expect(page.locator(".question-exhibit img")).toHaveCount(1);
  await expect(page.getByText("Inferior changes usually come from the right coronary artery.")).toHaveCount(0);
  expect(errors).toEqual([]);
});
