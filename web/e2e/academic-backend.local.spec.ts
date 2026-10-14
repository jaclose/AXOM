import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { completeSetup, deferPromisePrompt, expect, test, waitForWorkspace } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";
import type { Page } from "@playwright/test";
import { STORAGE_KEYS } from "../src/lib/brand";

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot = process.env.AXOM_ACADEMIC_PILOT;
test.skip(!statusFile || !pilot, "Requires the isolated loopback backend and authorized private pilot.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("real sign-in, private course, scoped study and cross-device recovery", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const verifyOriginals = async (target: Page) => target.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState } }> }).__AXOM_DEV__;
      const { readSourceOriginal } = await import("/src/lib/decode/sources.ts" /* @vite-ignore */);
      const { sha256Hex } = await import("/src/lib/checksum.ts" /* @vite-ignore */);
      const state = dev.useStore.getState();
      const references = state.documents.filter(document => document.fileType === "axom-academic-reference")
        .flatMap(document => JSON.parse(document.rawText).bindings?.originals ?? []) as Array<{ documentId: string; asset: { sha256: string } }>;
      let verified = 0;
      for (const reference of references) {
        const blob = await readSourceOriginal(reference.documentId, reference.asset.sha256);
        if (!blob || await sha256Hex(await blob.arrayBuffer()) !== reference.asset.sha256) throw new Error("The saved course original is missing or damaged.");
        verified++;
      }
      return verified;
    });
  const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
  const url = new URL(env.API_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local acceptance refuses a hosted backend.");
  const admin = createClient(url.href, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `academic-browser-${randomUUID()}@example.test`; const password = `${randomUUID()}-A1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`Synthetic account could not be created: ${created.error.message}`);
  const errors: string[] = [];
  const writes: { endpoint: string; bytes: number }[] = [];
  const bootstrapSources: string[] = [];
  page.on("request", request => {
    const endpoint = new URL(request.url()).pathname;
    if (endpoint.includes("/rpc/push_workspace_")) writes.push({ endpoint, bytes: Buffer.byteLength(request.postData() ?? "") });
  });
  page.on("pageerror", error => errors.push(error.message));
  // This configures the existing development account seam, with a real local
  // Auth/REST/Storage service. No request is intercepted or answered by the test.
  await page.addInitScript(({ url, key }) => { Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url, key } }); }, { url: url.href, key: env.ANON_KEY });
  await page.goto("/#dashboard");
  await completeSetup(page, "Academic acceptance"); await deferPromisePrompt(page);
  await page.getByTitle("Account and protection").click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Email", { exact: true }).fill(email);
  await panel.getByLabel(/^Password/).fill(password);
  await panel.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
  await page.getByText("Manage sources and custom courses", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose course package", exact: true }).click();
  await (await chooser).setFiles(pilot!);
  await page.getByRole("button", { name: "Save private course", exact: true }).click();
  await expect(page.getByText("Private course saved. Open it from Available courses.", { exact: true })).toBeVisible();
  const collection = await page.locator(".course-card").filter({ hasText: "Your upload" }).getAttribute("data-course-id");
  await page.goto("/#questions");
  await page.getByRole("region", { name: "Available question banks" }).locator(`[data-course-id="${collection}"]`).click();
  await expect(page.getByRole("region", { name: "FTM 1 course plan" })).toBeVisible();
  await expect(page.getByText("75", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByRole("checkbox", { name: "Week 2", exact: true }).check();
  await page.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(page.getByText("Course downloaded and enrollment saved to your account.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quiz week 2", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "FTM 1 course plan" })).toBeVisible();
  await expect(page.getByText("Downloaded on this device", { exact: true })).toBeVisible();
  console.info("Academic acceptance: course downloaded and reloaded");
  await page.getByTitle("Account and protection").click();
  await page.getByRole("button", { name: "Protect this workspace", exact: true }).click();
  await expect(page.getByText("This workspace is protected. Changes now back up in the background.", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  console.info("Academic acceptance: first account checkpoint acknowledged");
  await page.getByRole("button", { name: "Quiz week 2", exact: true }).click();
  await expect(page.getByText("Question 1 of 11", { exact: false }).first()).toBeVisible();
  let imageSeen = false;
  for (let i = 0; i < 11; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of 11`, exact: true })).toBeAttached();
    const image = page.locator(".tutor-question-region img").first();
    if (await page.locator(".tutor-question-region figure").count()) {
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
      imageSeen = true;
    }
    await page.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A"); await page.keyboard.press("Enter");
    if (i < 10) await page.getByRole("button", { name: "Next question", exact: true }).click();
  }
  expect(imageSeen).toBe(true);
  console.info("Academic acceptance: image-rich questions answered");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Review answers and Decode", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review saved block", exact: true })).toBeVisible();
  const progress = async (target: Page) => {
    await waitForWorkspace(target);
    return target.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState }; useAccount: { getState: () => { protection: string } }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    await dev.flushVault(); const state = dev.useStore.getState();
    return { questions: state.questions.length, attempts: [...state.questions, ...(state.deferredContent?.questions ?? [])].flatMap(q => (q.attempts ?? []).map(attempt => ({ questionId: q.id, ...attempt }))).sort((a,b) => a.questionId.localeCompare(b.questionId)), protection: dev.useAccount.getState().protection };
    });
  };
  await expect.poll(async () => (await progress(page)).attempts.length).toBe(11);
  await expect.poll(() => writes.filter(write => write.endpoint.endsWith("push_workspace_delta_v2")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await progress(page)).protection, { timeout: 30_000 }).toBe("protected");
  const saved = await progress(page);
  console.info("Academic acceptance: saved progress", JSON.stringify({ questions: saved.questions, attempts: saved.attempts.length, protection: saved.protection }));
  expect(saved.attempts).toHaveLength(11);
  expect(saved.attempts.every(attempt => Boolean(attempt.quizSessionId && attempt.answerKey && attempt.at))).toBe(true);
  expect(new Set(saved.attempts.map(attempt => attempt.questionId)).size).toBe(11);
  console.info("Academic acceptance: incremental answer checkpoint acknowledged");
  const acknowledged = await admin.from("workspace_revisions").select("snapshot_payload").eq("user_id", created.data.user!.id).neq("reason", "conflict").order("revision", { ascending: false }).limit(1).single();
  expect(acknowledged.error).toBeNull();
  const protectedSources = acknowledged.data!.snapshot_payload.sources as Array<{ collection: string; hash: string; academic?: unknown }>;
  const sharedQuestions = protectedSources.filter(ref => ref.collection === "questions" && ref.academic);
  expect(sharedQuestions).toHaveLength(25);
  const protectedMedia = acknowledged.data!.snapshot_payload.media as Array<{ academic?: unknown }>;
  expect(protectedMedia.length).toBeGreaterThan(0);
  expect(protectedMedia.every(ref => ref.academic)).toBe(true);
  const privateFiles = await admin.storage.from("workspace-content").list(created.data.user!.id);
  expect(privateFiles.error).toBeNull();
  expect(privateFiles.data!.some(file => sharedQuestions.some(ref => ref.hash === file.name))).toBe(false);
  const privateImages = await admin.storage.from("workspace-media").list(created.data.user!.id);
  expect(privateImages.error).toBeNull(); expect(privateImages.data).toEqual([]);

  await page.reload();
  await expect.poll(async () => (await progress(page)).questions).toBe(25);
  expect((await progress(page)).attempts).toEqual(saved.attempts);
  // A second clean browser context exercises actual account recovery and lazy
  // image download. It has no IndexedDB, cookies or source files from device A.
  const other = await browser.newContext({ reducedMotion: "reduce" });
  try {
    await other.addInitScript(({ url, key }) => { Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url, key } }); }, { url: url.href, key: env.ANON_KEY });
    const device = await other.newPage();
    device.on("pageerror", error => errors.push(error.message));
    device.on("request", request => { const path = new URL(request.url()).pathname; if (path.includes("/storage/v1/object/") && request.method() === "GET") bootstrapSources.push(path); });
    await device.goto(`${new URL(page.url()).origin}/#dashboard`);
    await completeSetup(device, "Second device"); await deferPromisePrompt(device);
    await device.getByTitle("Account and protection").click();
    await device.getByLabel("Email", { exact: true }).fill(email);
    await device.getByLabel(/^Password/).fill(password);
    await device.getByRole("button", { name: "Sign in", exact: true }).click();
    console.info("Academic acceptance: second device signed in");
    await expect.poll(async () => (await progress(device)).protection, { timeout: 60_000 }).toBe("protected");
    expect((await progress(device)).questions).toBe(0);
    expect(bootstrapSources).toEqual([]);
    const pending = await device.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState } }> }).__AXOM_DEV__;
      return dev.useStore.getState().deferredContent?.questions.length;
    });
    expect(pending).toBe(25);
    await device.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
    // A reference-only device must be able to protect personal progress offline.
    await device.getByTitle("Settings", { exact: true }).click();
    await device.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    for (const [width, height, theme] of [[1440, 900, "light"], [390, 844, "dark"], [1024, 540, "light"]] as const) {
      await device.setViewportSize({ width, height });
      await device.locator("html").evaluate((element, value) => element.setAttribute("data-theme", value), theme);
      const button = device.getByRole("button", { name: "Export saved work", exact: true });
      await button.scrollIntoViewIfNeeded(); await expect(button).toBeVisible();
      expect(await button.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await device.screenshot({ path: `/tmp/axom-saved-work-${width}.png` });
    }
    await device.locator("html").evaluate(element => { element.style.zoom = "2"; });
    await device.getByRole("button", { name: "Export saved work", exact: true }).scrollIntoViewIfNeeded();
    await expect(device.getByRole("button", { name: "Export saved work", exact: true })).toBeVisible();
    expect(await device.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await device.locator("html").evaluate(element => { element.style.zoom = ""; });
    await other.setOffline(true);
    const savedWorkDownload = device.waitForEvent("download");
    await device.getByRole("button", { name: "Export saved work", exact: true }).focus(); await device.keyboard.press("Enter");
    const savedWork = await savedWorkDownload;
    expect(savedWork.suggestedFilename()).toMatch(/^axom-saved-work-.*\.zip$/);
    await expect(device.getByRole("status")).toContainText("sources remain as download references");
    expect(bootstrapSources).toEqual([]);
    const savedWorkPath = await savedWork.path();
    if (!savedWorkPath) throw new Error("Saved-work export was not written.");
    await other.setOffline(false);
    await device.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();

    const offlineRecovery = await browser.newContext();
    try {
      const recovered = await offlineRecovery.newPage();
      recovered.on("pageerror", error => errors.push(error.message));
      await recovered.goto(`${new URL(page.url()).origin}/#dashboard`);
      await completeSetup(recovered, "Saved work recovery"); await deferPromisePrompt(recovered);
      await recovered.getByTitle("Settings", { exact: true }).click();
      await recovered.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
      await offlineRecovery.setOffline(true);
      const chooser = recovered.waitForEvent("filechooser");
      await recovered.getByRole("button", { name: "Import / restore", exact: true }).click();
      recovered.once("dialog", dialog => { expect(dialog.message()).toContain("download references"); void dialog.accept(); });
      await (await chooser).setFiles({ name: savedWork.suggestedFilename(), mimeType: "application/zip", buffer: readFileSync(savedWorkPath) });
      await expect(recovered.getByRole("status")).toContainText("Some course files still need downloading");
      expect((await progress(recovered)).attempts).toEqual(saved.attempts);
      expect((await progress(recovered)).questions).toBe(0);
      await offlineRecovery.setOffline(false);
      await recovered.reload(); await waitForWorkspace(recovered);
      expect((await progress(recovered)).attempts).toEqual(saved.attempts);
      expect((await progress(recovered)).questions).toBe(0);
    } finally { await offlineRecovery.close(); }
    await device.goto(`${new URL(page.url()).origin}/#questions`);
    const downloads = device.getByRole("region", { name: "Saved account content" });
    await expect(downloads).toBeVisible();
    for (const [width, height, theme] of [[1440, 900, "light"], [390, 844, "dark"], [1440, 540, "light"]] as const) {
      await device.setViewportSize({ width, height });
      await device.locator("html").evaluate((element, value) => element.setAttribute("data-theme", value), theme);
      await downloads.scrollIntoViewIfNeeded();
      for (const button of await downloads.getByRole("button").all()) {
        expect(await button.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      }
      await device.screenshot({ path: `/tmp/axom-account-downloads-${width}-${height}.png` });
      expect(await device.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await device.setViewportSize({ width: 1440, height: 900 });
    await downloads.getByRole("button").first().focus(); await device.keyboard.press("Enter");
    await expect.poll(async () => (await progress(device)).questions).toBeGreaterThan(0);
    expect((await progress(device)).questions).toBeLessThan(25);

    await device.goto(`${new URL(page.url()).origin}/#tracker`);
    await device.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    await device.locator(".course-card").filter({ hasText: "Your upload" }).click();
    await device.getByRole("button", { name: "Download course to this device", exact: true }).click();
    await expect.poll(async () => (await progress(device)).questions).toBe(25);
    expect((await progress(device)).attempts).toEqual(saved.attempts);
    const originalFiles = await verifyOriginals(device);
    expect(originalFiles).toBeGreaterThan(0);
    // Restoring the earlier reference-only copy keeps verified local source bytes.
    await device.getByTitle("Settings", { exact: true }).click();
    await device.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    const restoreSaved = device.waitForEvent("filechooser");
    await device.getByRole("button", { name: "Import / restore", exact: true }).click();
    device.once("dialog", dialog => dialog.accept());
    await (await restoreSaved).setFiles({ name: savedWork.suggestedFilename(), mimeType: "application/zip", buffer: readFileSync(savedWorkPath) });
    await expect(device.getByRole("dialog").getByRole("status")).toContainText("Saved on this device.");
    expect((await progress(device)).questions).toBe(25);
    expect((await progress(device)).attempts).toEqual(saved.attempts);
    expect(await verifyOriginals(device)).toBe(originalFiles);
    await device.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
    await other.setOffline(true);
    await device.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(device.getByText("Question 1 of 11", { exact: false }).first()).toBeVisible();
    const figures = device.locator(".tutor-question-region img");
    for (let index = 0; index < 11; index++) {
      await expect(device.getByRole("heading", { name: `Question ${index + 1} of 11`, exact: true })).toBeAttached();
      const expectsImage = await device.evaluate(async (key) => {
        const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState } }> }).__AXOM_DEV__;
        const active = JSON.parse(localStorage.getItem(key) ?? "null") as { poolIds: string[]; index: number } | null;
        return dev.useStore.getState().questions.find(question => question.id === active?.poolIds[active.index])?.attachments?.some(attachment => ["question", "stem", "choice"].includes(attachment.role ?? ""));
      }, STORAGE_KEYS.quizActiveSession);
      if (expectsImage || await device.locator(".tutor-question-region figure").count()) break;
      if (index === 10) break;
      await device.getByLabel("Question stem", { exact: true }).focus();
      await device.keyboard.press("B");
      const check = device.getByRole("button", { name: "Check answer", exact: true });
      if (await check.isVisible()) {
        await expect(check).toBeEnabled(); await check.click();
        await expect(device.getByRole("button", { name: "Next question", exact: true })).toBeVisible();
        await device.getByRole("button", { name: "Next question", exact: true }).click();
      } else {
        await device.getByRole("button", { name: "Submit & next", exact: true }).click();
      }
    }
    await expect(figures.first()).toBeVisible();
    await expect.poll(() => figures.first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await other.setOffline(false);
    // Existing quiz engine owns answer/review state; no second progress engine.
    expect((await progress(device)).attempts).toEqual(expect.arrayContaining(saved.attempts));
  } finally { await other.close(); }
  // Export and restore through the supported controls in a third, empty profile.
  // The original source bytes remain private in the Playwright temp download.
  await page.goto("/#dashboard");
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const backup = await downloaded;
  expect(backup.suggestedFilename()).toMatch(/\.zip$/);
  const backupPath = await backup.path();
  if (!backupPath) throw new Error("Portable export was not written.");
  await expect(page.getByRole("status")).toContainText("original files");
  const recovery = await browser.newContext();
  let recoveredOriginals: number;
  try {
    const restored = await recovery.newPage();
    restored.on("pageerror", error => errors.push(error.message));
    await restored.route("**/*.supabase.co/**", route => route.abort());
    await restored.goto(`${new URL(page.url()).origin}/#dashboard`);
    await completeSetup(restored, "Portable recovery acceptance"); await deferPromisePrompt(restored);
    await restored.getByTitle("Settings", { exact: true }).click();
    await restored.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    const chooser = restored.waitForEvent("filechooser");
    await restored.getByRole("button", { name: "Import / restore", exact: true }).click();
    restored.once("dialog", dialog => dialog.accept());
    await (await chooser).setFiles({ name: backup.suggestedFilename(), mimeType: "application/zip", buffer: readFileSync(backupPath) });
    await expect(restored.getByRole("status")).toContainText("Saved on this device.");
    await expect(restored.getByRole("status")).toContainText("original files");
    await restored.reload(); await waitForWorkspace(restored);
    expect((await progress(restored)).attempts).toEqual(saved.attempts);
    recoveredOriginals = await verifyOriginals(restored);
    expect(recoveredOriginals).toBeGreaterThan(0);
  } finally { await recovery.close(); }
  expect(errors).toEqual([]);
  if (process.env.AXOM_ACADEMIC_EVIDENCE) writeFileSync(process.env.AXOM_ACADEMIC_EVIDENCE, JSON.stringify({ apiUrl: url.href, result: "passed", recoveredOriginals, portableBackupBytes: readFileSync(backupPath).byteLength, writes, bootstrapSourceDownloads: 0, sharedQuestionReferences: 25, privateCourseImageCopies: 0,
    workflow: "real sign-in, private upload, Week 2 activation, image-rich 11-question quiz, Decode, incremental save, reload, clean second-device recovery" }, null, 2));
});
