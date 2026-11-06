import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";
import { academicCatalogFixture } from "./academicCatalogFixture";
import { academicPublishFixture } from "./academicPublishFixture";
import { seedOnboarded } from "./fixtures";

const course = { id: "11111111-1111-4111-8111-111111111111", title: "Community NCRS review",
  module: "NCRS", term: "Term 4", current_revision_id: "22222222-2222-4222-8222-222222222222",
  ready_questions: 8, review_questions: 2, submitted_at: "2026-11-01T12:00:00Z",
  owned: false, status: "unreviewed" };
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

for (const width of [1440, 390]) test(`community uploads stay separate, filter by term and preview at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await academicCatalogFixture(page);
  await page.route("**/rpc/academic_community_catalog", route => {
    const body = route.request().postDataJSON() as { term_filter?: string };
    return route.fulfill({ headers, json: body.term_filter && body.term_filter !== "Term 4" ? [] : [course] });
  });
  await page.route("**/rpc/academic_community_preview", route => route.fulfill({ headers, json: {
    id: course.current_revision_id, collection_id: course.id,
    template_text: "T4 - NCRS - Lectures:\nWeek 1:\nSynthetic review [Lecture]",
    ready_questions: 8, review_questions: 2,
  } }));
  await page.getByRole("tab", { name: "Community" }).click();
  const community = page.getByRole("region", { name: "Community Uploads" });
  await expect(community.getByRole("heading", { name: "NCRS" })).toBeVisible();
  await page.screenshot({ path: `/tmp/axom-community-first-${width}.png` });
  await expect(community.getByText("Unreviewed", { exact: true })).toBeVisible();
  await community.getByRole("combobox", { name: "Term" }).selectOption("Term 2");
  await expect(community.getByText("No unreviewed uploads here yet")).toBeVisible();
  await community.getByRole("combobox", { name: "Term" }).selectOption("Term 4");
  const card = community.getByRole("article").filter({ hasText: "Community NCRS review" });
  await card.getByRole("button", { name: "Preview course" }).click();
  await expect(card.getByText("Synthetic review [Lecture]", { exact: false })).toBeVisible();
  await community.getByText("Choose an AXOM course folder or ZIP").click();
  await expect(community.getByRole("button", { name: "Choose AXOM folder" })).toBeVisible();
  await expect(community.getByRole("button", { name: "Choose ZIP" })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    await page.screenshot({ path: `/tmp/axom-community-${width}-${theme}.png`, fullPage: true });
    expect(await community.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("a reviewed saved source is checked, privately saved, then submitted as Unreviewed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  const backend = await academicPublishFixture(page);
  const sourceText = "Question 1. Which synthetic option comes first? A. First. B. Second. Answer: A. Explanation: First is listed before Second.";
  const checksum = `sha256:${createHash("sha256").update(sourceText).digest("hex")}`;
  const events: string[] = [];
  let submitted: { collection: string; revision: string; rights_attested: boolean } | undefined;
  let metadata: { term: string; module: string; ready_questions: number } | undefined;
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  await page.route("https://academic-publish.invalid/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/rpc/academic_community_catalog")) {
      const collection = submitted && backend.collections().find(item => item.id === submitted!.collection);
      return route.fulfill({ headers, json: collection?.revision ? [{ id: collection.id, title: collection.title,
        module: collection.module, term: collection.term, current_revision_id: collection.revision.id,
        ready_questions: collection.revision.ready_questions, review_questions: 0,
        submitted_at: "2026-11-02T00:00:00Z", owned: true, status: "unreviewed" }] : [] });
    }
    if (path.endsWith("/rpc/academic_submit_community")) {
      submitted = request.postDataJSON() as typeof submitted;
      const collection = backend.collections().find(item => item.id === submitted?.collection);
      expect(collection?.revision?.status).toBe("ready");
      expect(collection?.current_revision_id).toBe(submitted?.revision);
      events.push("submit");
      return route.fulfill({ status: 204, headers });
    }
    if (path.endsWith("/rpc/academic_create_revision")) {
      metadata = (request.postDataJSON() as { metadata: typeof metadata }).metadata;
      events.push("create");
    } else if (path.endsWith("/rpc/academic_finish_revision")) events.push("finish");
    else if (path.includes("/storage/v1/object/academic-content/") && request.method() === "POST") events.push("store");
    return route.fallback();
  });
  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Community" }).click();
  const community = page.getByRole("region", { name: "Community Uploads" });
  await expect(community.getByText("No saved source with its original file is ready here yet.")).toBeVisible();
  await page.evaluate(async ({ sourceText, checksum }) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
      addDocument: (value: unknown) => void; addQuestionSet: (value: unknown) => void;
      addQuestion: (value: unknown) => { ok: boolean; errors: string[] };
    } } }> }).__AXOM_DEV__;
    const sourceModuleUrl = "/src/lib/decode/sources.ts";
    const { saveSourceOriginal } = await import(sourceModuleUrl) as typeof import("../src/lib/decode/sources");
    const original = new Blob([sourceText], { type: "text/plain" });
    const now = new Date().toISOString();
    const document = { id: "community-synthetic-document", title: "Synthetic reviewed source", fileName: "source.txt",
      fileType: "txt", uploadedAt: now, rawText: sourceText, sizeBytes: original.size, checksum,
      originalFile: { version: 1, sha256: checksum.slice(7), byteSize: original.size, mimeType: "text/plain" },
      tags: [], linkedQuestionSetIds: ["community-synthetic-set"], libraryOnly: false };
    await saveSourceOriginal(document, original);
    const state = dev.useStore.getState();
    state.addDocument(document);
    state.addQuestionSet({ id: "community-synthetic-set", title: "Synthetic reviewed set", kind: "source",
      sourceDocumentIds: [document.id], createdAt: now, questionIds: ["community-synthetic-question"], tags: [],
      aiEnhanced: false, parserWarnings: [] });
    const result = state.addQuestion({ id: "community-synthetic-question", source: "imported", status: "unseen",
      stem: "Which synthetic option comes first?", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
      correctKey: "A", explanation: "First is listed before Second.", module: "NCRS", setId: "community-synthetic-set",
      sourceDocumentId: document.id, sourceFile: { name: document.fileName, type: document.fileType, size: original.size, addedAt: now },
      extraction: { confidence: "high", reviewed: true, reviewedAt: now },
      tags: [], attempts: [], createdAt: now, updatedAt: now });
    if (!result.ok) throw new Error(`Synthetic source could not be seeded: ${result.errors.join("; ")}`);
  }, { sourceText, checksum });
  await community.getByRole("combobox", { name: "Saved source" }).selectOption("community-synthetic-document");
  await expect(community.getByText(/all 1 questions from 1 saved set/)).toBeVisible();
  await community.getByRole("combobox", { name: "Term confirmed from the source" }).selectOption("Term 4");
  await community.getByRole("textbox", { name: "Module confirmed from the source" }).fill("NCRS");
  await community.getByRole("checkbox", { name: /checked this source's term, module, answers and explanations/ }).check();
  await community.getByRole("button", { name: "Check saved source" }).click();
  await expect(community.getByText("Ready to share")).toBeVisible();
  expect(events).toEqual([]);
  const share = community.getByRole("button", { name: "Save and share as Unreviewed" });
  await expect(share).toBeDisabled();
  await community.getByRole("checkbox", { name: /right to share these questions/ }).check();
  await share.click();
  await expect(community.getByText(/Shared in Community Uploads as Unreviewed/)).toBeVisible();
  await expect(community.getByRole("article").filter({ hasText: "NCRS" })).toBeVisible();
  expect(metadata).toMatchObject({ term: "Term 4", module: "NCRS", ready_questions: 1 });
  expect(submitted?.rights_attested).toBe(true);
  expect(events[0]).toBe("create");
  expect(events).toContain("store");
  expect(events.at(-2)).toBe("finish");
  expect(events.at(-1)).toBe("submit");
  expect(backend.calls).toContain("GET /rest/v1/academic_revisions");
  expect(backend.calls).toContain("HEAD /rest/v1/academic_files");
  expect(errors).toEqual([]);
});

test("standalone QBank sets submit from Community without course filing or private overlays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await academicCatalogFixture(page);
  const submissionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const submittedAt = "2026-11-06T12:00:00Z";
  const submittedRows: Array<Record<string, unknown>> = [];
  let payload: Record<string, unknown> | undefined;
  await page.route("**/rpc/my_question_set_library", route => route.fulfill({ headers, json: submittedRows }));
  await page.route("**/rpc/submit_question_set_library", route => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    submittedRows.push({ id: submissionId, source_id: "synthetic-independent-set",
      title: "Independent clinical cases", credit: "", question_count: 1,
      status: "pending", review_note: "", created_at: submittedAt });
    return route.fulfill({ headers, json: submissionId });
  });
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {
      addQuestionSet: (value: unknown) => void;
      addQuestion: (value: unknown) => { ok: boolean; errors: string[] };
    } } }> }).__AXOM_DEV__;
    const now = new Date().toISOString();
    const state = dev.useStore.getState();
    const result = state.addQuestion({ id: "synthetic-independent-question", source: "manual", status: "unseen",
      stem: "Which synthetic letter comes first?", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
      correctKey: "A", explanation: "A is first in alphabetical order.", notes: "Private learner note.",
      tags: [], attempts: [], createdAt: now, updatedAt: now });
    if (!result.ok) throw new Error(`Synthetic question rejected: ${result.errors.join("; ")}`);
    state.addQuestionSet({ id: "synthetic-independent-set", title: "Independent clinical cases", kind: "custom",
      sourceDocumentIds: [], questionIds: ["synthetic-independent-question"], tags: ["synthetic"],
      createdAt: now, aiEnhanced: false, parserWarnings: [] });
  });
  await page.getByRole("tab", { name: "Community" }).click();
  const community = page.getByRole("region", { name: "Community Uploads" });
  const selector = community.getByRole("combobox", { name: "Saved Question Set" });
  await selector.selectOption("synthetic-independent-set");
  await expect(community.getByText(/1 question selected/)).toBeVisible();
  await community.getByRole("button", { name: "Review and submit set" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit Independent clinical cases" });
  await expect(dialog.getByRole("button", { name: "Send for review" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I own this content/ }).check();
  await dialog.getByRole("checkbox", { name: /I checked every answer/ }).check();
  await dialog.getByRole("button", { name: "Send for review" }).click();
  await expect(dialog.getByText(/Submission received/)).toBeVisible();
  expect(payload?.p_source_id).toBe("synthetic-independent-set");
  expect(payload?.p_rights_confirmed).toBe(true);
  expect(payload?.p_answers_confirmed).toBe(true);
  const snapshot = payload?.p_snapshot as { questions: Array<Record<string, unknown>> };
  expect(snapshot.questions).toHaveLength(1);
  expect(snapshot.questions[0]).not.toHaveProperty("notes");
  expect(fixture.requests).not.toContain("/rest/v1/rpc/academic_submit_community");
  expect(await community.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
