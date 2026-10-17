import { createHash } from "node:crypto";
import JSZip from "jszip";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";
// Optional for shared machines under graphics pressure; never a GPU performance test.
test.use({ launchOptions: process.env.AXOM_E2E_SOFTWARE_GRAPHICS === "1" ? { args: ["--disable-gpu"] } : {} });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const EDITED_STEM = "Reviewer clarification: identify the option labeled Alpha without removing the source figure.";

function originalPdf() {
  const content = "BT /F1 20 Tf 30 160 Td (Synthetic source slide. Answer A.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 550 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
async function bundle() {
  const zip = new JSZip(), source = originalPdf();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  zip.file("manifest.json", JSON.stringify({ schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "slides-test", title: "Synthetic Slides PQ", discipline: "Software testing" },
    source: { filename: "source.pdf", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" }));
  zip.file("source/source.pdf", source);
  zip.file("questions.json", JSON.stringify({ schemaVersion: 1, bankId: "slides-test", questions: [1, 2].map(n => ({
    id: `slides-${n}`, source: { filename: "source.pdf", page: 1, questionNumber: n },
    stem: [{ type: "text", text: `Synthetic item ${n}: choose Alpha. This fixture tests view switching, not medical knowledge.` },
      { type: "image", assetId: `stem-${n}`, alt: "Question figure" }],
    choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
    correctAnswer: { labels: ["A"], evidence: "printed-key" },
    explanation: [{ type: "text", text: "This synthetic fixture defines Alpha as the answer." }],
    assets: (n === 1 ? ["stem", "answer_reveal", "source_page"] : ["stem", "answer_reveal"]).map(role => ({ id: `${role}-${n}`, filename: `${role}-${n}.png`,
      mimeType: "image/png", role, questionId: `slides-${n}`, checksum: `sha256:${hash(png)}` })),
    provenance: { method: "authored", sourceChecksum: `sha256:${hash(source)}` },
  })) }));
  for (const n of [1, 2]) for (const role of ["stem", "answer_reveal", "source_page"]) zip.file(`assets/${role}-${n}.png`, png);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

for (const width of [1440, 390]) for (const mode of ["tutor", "exam"] as const) {
  test(`${mode} Questions and Slides share answers, reveal rules and saved review at ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: mode === "exam" ? "dark" : "light", reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto("/#questions", { waitUntil: "networkidle" }); await seedOnboarded(page);
    await page.getByText("Local collection transfer and source review", { exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Install prepared library", exact: true }).click();
    await (await chooser).setFiles({ name: "slides-test.zip", mimeType: "application/zip", buffer: await bundle() });
    await expect(page.getByRole("region", { name: "Prepared library" }).getByRole("status")).toContainText("Library installed.");
    await page.evaluate(async (stem) => {
      type Question = { id: string; content?: { id?: string } };
      type State = { questions: Question[]; updateQuestion: (id: string, patch: { stem: string }) => void };
      type Dev = { useStore: { getState: () => State }; flushVault: () => Promise<void> };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const questions = state.questions.filter(candidate => ["slides-1", "slides-2"].includes(candidate.content?.id ?? ""));
      if (questions.length !== 2) throw new Error("The synthetic image-bearing questions were not installed.");
      // Practice deliberately randomizes order. Edit both distinct fixtures so
      // this regression checks the current question rather than assuming a draw.
      for (const question of questions) state.updateQuestion(question.id, { stem: `${stem} (${question.content?.id})` });
      await dev.flushVault();
    }, EDITED_STEM);
    await page.locator(".qb-hero-actions").getByRole("button", { name: "Create Quiz", exact: true }).click();
    await page.getByLabel("Custom question count").fill("2");
    await page.getByRole("button", { name: "Slides", exact: true }).click();
    await page.getByRole("button", { name: mode === "tutor" ? "Tutor (feedback per question)" : "Exam (feedback at the end)" }).click();
    await page.getByRole("button", { name: `Start ${mode} block`, exact: true }).click();
    const player = page.locator(".quiz-player-modal");
    const tip = player.getByRole("button", { name: "Got it", exact: true });
    if (await tip.isVisible()) await tip.click();
    await expect(player.locator('[data-question-view="slides"]')).toBeVisible();
    await expect(player.getByText(EDITED_STEM, { exact: false })).toBeVisible();
    await expect(player.locator('[data-asset-role="stem"] img')).toBeVisible();
    await expect(player.locator('[data-asset-role="answer_reveal"], [data-asset-role="source_page"], canvas')).toHaveCount(0);
    await player.getByRole("button", { name: "A. Alpha", exact: true }).click();
    await player.getByRole("button", { name: "Eliminate option B", exact: true }).click();
    await player.getByRole("button", { name: "Questions", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(player.getByRole("button", { name: "A. Alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(player.getByRole("button", { name: "Restore option B", exact: true })).toHaveAttribute("aria-pressed", "true");
    await player.getByRole("button", { name: "Slides", exact: true }).click();
    expect(await player.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`slides-${mode}-${width}.png`), fullPage: true });
    await reloadAfterSave(page);
    await expect(player.locator('[data-question-view="slides"]')).toBeVisible();
    await expect(player.getByText(EDITED_STEM, { exact: false })).toBeVisible();
    await expect(player.locator('[data-asset-role="stem"] img')).toBeVisible();
    await expect(player.locator('[data-asset-role="answer_reveal"], [data-asset-role="source_page"], canvas')).toHaveCount(0);
    await expect(player.getByRole("button", { name: "A. Alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
    if (mode === "tutor") {
      await player.getByRole("button", { name: "Check answer", exact: true }).click();
      await expect(player.locator('[data-asset-role="answer_reveal"] img')).toBeVisible();
      await expect(player.locator('[data-asset-role="source_page"], canvas')).toHaveCount(0);
    }
    await player.getByRole("button", { name: mode === "tutor" ? "Next question" : "Submit & next", exact: true }).click();
    await expect(player.locator('[data-asset-role="answer_reveal"], [data-asset-role="source_page"], canvas')).toHaveCount(0);
    await player.getByRole("button", { name: "A. Alpha", exact: true }).click();
    if (mode === "tutor") await player.getByRole("button", { name: "Check answer", exact: true }).click();
    await player.getByRole("button", { name: mode === "tutor" ? "Finish block" : "Submit & finish", exact: true }).click();
    await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review saved block", exact: true });
    await expect(review).toContainText("Your answer: A");
    const originals = review.locator('canvas, [data-asset-role="source_page"] img');
    await expect(originals).toBeVisible();
    await review.getByRole("button", { name: "Questions", exact: true }).click();
    await expect(originals).toHaveCount(0);
    await review.getByRole("button", { name: "Slides", exact: true }).click();
    await expect(originals).toBeVisible();
    const wasPdf = await review.locator("canvas").count();
    await review.getByRole("button", { name: "Next", exact: true }).click();
    await expect(originals).toBeVisible();
    expect(await review.locator("canvas").count()).toBe(wasPdf ? 0 : 1);
    const saved = await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: { attempts: unknown[] }[]; quizSessions: { questionIds: string[]; answers: unknown[] }[] } } }> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      return { attempts: state.questions.map(q => q.attempts.length), sessions: state.quizSessions.map(s => ({ ids: s.questionIds, answers: s.answers.length })) };
    });
    expect(saved.attempts).toEqual([1, 1]); expect(saved.sessions).toHaveLength(1); expect(saved.sessions[0].answers).toBe(2);
    expect(errors).toEqual([]);
  });
}
