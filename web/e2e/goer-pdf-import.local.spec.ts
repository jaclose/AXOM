// A local check, skipped unless asked for. It takes each real bank's own PDF
// through the browser import on the development harness page, in a browser
// profile made for the test and thrown away after it, and prints counts.
//
//   AXOM_QBANK_SOURCES="/folder/with/the/PDFs" AXOM_E2E_BASE_URL=http://127.0.0.1:5197 \
//     npx playwright test e2e/goer-pdf-import.local.spec.ts --output=/a/folder/outside/the/repository
//
// Nothing a question says is printed: no stem, no choice, no answer letter.
// No trace, screenshot or video is kept, since each would hold the questions.
// When a test fails, Playwright still writes a snapshot of the page into its
// output folder, and that snapshot holds the questions: give --output a
// folder outside the repository and delete it afterwards.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/harness/pdf-import.html";
const sources = process.env.AXOM_QBANK_SOURCES;
const fixtures = join(process.cwd(), "..", "fixtures", "qbank");

test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(!sources, "Set AXOM_QBANK_SOURCES to the folder that holds the PDFs.");

function manifests(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "synthetic" || !statSync(path).isDirectory()) return [];
    return existsSync(join(path, "manifest.json")) ? [path] : manifests(path);
  });
}
const read = async (page: Page, id: string) => JSON.parse((await page.getByTestId(id).textContent())!);
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const pick = (object: Record<string, unknown>, keys: string[]): string => keys.map((key) => `${key} ${JSON.stringify(object[key])}`).join("  ");

for (const directory of sources ? manifests(fixtures) : []) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  test(`browser import of ${manifest.bank.id}`, async ({ page }) => {
    const pdf = [join(directory, "source", manifest.source.filename), join(sources!, manifest.source.filename)].find((path) => existsSync(path));
    test.skip(!pdf, "The bank's PDF is not on this machine.");
    const complaints: Record<string, number> = {};
    page.on("console", (message) => {
      if (message.type() !== "warning" && message.type() !== "error") return;
      // The kind of complaint only: its first words, with anything quoted or numbered taken out.
      const kind = message.text().replace(/["'“”][^"'“”]*["'“”]/g, "…").replace(/\d+/g, "#").split(/[:.(]/)[0].trim().slice(0, 48) || "other";
      complaints[`${message.type()}: ${kind}`] = (complaints[`${message.type()}: ${kind}`] ?? 0) + 1;
    });

    await page.goto(HARNESS);
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
    // The bank's own committed manifest says where its questions are filed.
    await page.getByTestId("manifest").setInputFiles(join(directory, "manifest.json"));
    await expect(page.getByTestId("filing")).toContainText(manifest.bank.id);

    // SELECT, EXTRACT, PREVIEW, CLASSIFY
    await page.getByTestId("file").setInputFiles(pdf!);
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "preview", { timeout: 120_000 });
    const summary = await read(page, "summary");
    say(`\n=== ${manifest.bank.id}`);
    say(`  read: ${pick(summary, ["slides", "pages", "questions", "ready", "needsReview", "unresolved", "tables", "figures", "answerSlides", "notPlaced", "withAPage", "advisories"])}`);
    say(`  sets: ${summary.sets.map((set: { set: number; questions: number; ready: number }) => `set ${set.set}: ${set.questions} questions, ${set.ready} ready`).join("; ")}`);
    say(`  pictures: ${pick(summary, ["pictureFiles", "picturesDecoded", "picturesBlank", "drawWarnings"])}`);
    expect(summary.picturesDecoded).toBe(summary.pictureFiles);
    expect(summary.picturesBlank).toBe(0);
    expect(summary.withAPage).toBe(summary.questions);
    expect(await page.getByTestId("question").count()).toBe(summary.questions);
    // While a question is open, no answer slide is on the page. In review, every one is,
    // and so is a table that belongs to an explanation.
    const hidden = await page.locator('img[data-role="answer_reveal"]').count();
    const figuresShown = await page.locator('img[data-role="stem"]').count();
    const tablesWhileOpen = await page.locator('[data-testid="question"] table').count();
    await page.getByTestId("mode").selectOption("review");
    const shownInReview = await page.locator('img[data-role="answer_reveal"]').count();
    const tablesDrawn = await page.locator('[data-testid="question"] table').count();
    const emptyTables = await page.locator('[data-testid="question"] table').evaluateAll((tables) => tables.filter((table) => !(table.textContent ?? "").trim()).length);
    await page.getByTestId("mode").selectOption("question");
    say(`  tables drawn: ${tablesWhileOpen} while a question is open, ${tablesDrawn} in review, ${emptyTables} of them empty`);
    expect(tablesDrawn).toBe(summary.tables);
    expect(emptyTables).toBe(0);
    say(`  answer slides on the page while a question is open: ${hidden}; in review: ${shownInReview}; figures shown with their questions: ${figuresShown}`);
    expect(hidden).toBe(0);
    expect(shownInReview).toBe(summary.answerSlides);
    expect(figuresShown).toBe(summary.figures);

    // CONFIRM, SAVE
    await page.getByTestId("import").click();
    await expect(page.getByTestId("status")).not.toHaveAttribute("data-state", "saving", { timeout: 60_000 });
    const result = await read(page, "result");
    say(`  import: ${pick(result, ["status", "held", "heldNeedingReview", "heldUnresolved", "picturesWithheld", "errors"])}  sections ${JSON.stringify(result.sections)}  filing ${JSON.stringify(result.filing)}`);
    expect(result.errors).toBe(0);
    expect(result.filing.agrees).toBe(true);
    const savedCount = result.sections.reduce((sum: number, section: { saved: number }) => sum + section.saved, 0);
    expect(savedCount).toBe(summary.ready);
    expect(result.status).toBe(summary.ready > 0 ? "saved" : "nothing-ready");
    expect(result.held).toBe(summary.questions - summary.ready);

    // RELOAD, VERIFY
    await page.reload();
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-ready", "true");
    const workspace = await read(page, "workspace");
    say(`  after a reload: ${pick(workspace, ["questions", "picturesLinked", "picturesDecoded", "picturesRightSize"])}  documents ${JSON.stringify(workspace.documents)}`);
    say(`  sets: ${JSON.stringify(workspace.sets.map((set: { questions: number; module: string; week: number; documents: number; numbers: number[] }) => ({ questions: set.questions, module: set.module, week: set.week, documents: set.documents, firstNumber: set.numbers[0], lastNumber: set.numbers[set.numbers.length - 1], numbersRepeat: new Set(set.numbers).size !== set.numbers.length })))}`);
    say(`  check against what was saved: ${JSON.stringify(workspace.check ?? "nothing was saved")}`);
    expect(workspace.questions).toBe(savedCount);
    expect(workspace.picturesDecoded).toBe(workspace.picturesLinked);
    if (savedCount > 0) {
      expect(workspace.documents).toEqual([{ sets: result.sections.length, hasChecksum: true, hasText: true }]);
      expect(workspace.sets).toHaveLength(result.sections.length);
      for (const set of workspace.sets) expect(set).toMatchObject({ module: manifest.course.name, week: manifest.course.week, documents: 1 });
      const { check } = workspace;
      for (const key of ["found", "sameStem", "sameKey", "sameNumber", "samePage", "samePictures"]) expect(check[key], key).toBe(check.expected);
      expect(check.tableCellsFound).toBe(check.tableCells);
      expect(check.withheldPicturesStored).toBe(0);
    } else {
      expect(workspace).toMatchObject({ documents: [], sets: [], picturesLinked: 0 });
    }

    // The same file again, filed the same way (the filing is kept across the reload): nothing is written twice.
    await expect(page.getByTestId("filing")).toContainText(manifest.bank.id);
    await page.getByTestId("file").setInputFiles(pdf!);
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "preview", { timeout: 120_000 });
    await page.getByTestId("import").click();
    await expect(page.getByTestId("status")).not.toHaveAttribute("data-state", "saving", { timeout: 60_000 });
    const again = await read(page, "result");
    const afterAgain = await read(page, "workspace");
    say(`  second import: ${again.status}; now ${afterAgain.questions} questions, ${afterAgain.sets.length} sets, ${afterAgain.documents.length} documents, ${afterAgain.picturesLinked} pictures`);
    expect(again.status).toBe(savedCount > 0 ? "already-saved" : "nothing-ready");
    expect([afterAgain.questions, afterAgain.sets.length, afterAgain.documents.length, afterAgain.picturesLinked]).toEqual([workspace.questions, workspace.sets.length, workspace.documents.length, workspace.picturesLinked]);
    say(`  browser complaints by kind: ${Object.entries(complaints).map(([kind, count]) => `${kind} x${count}`).join("; ") || "none"}`);
  });
}
