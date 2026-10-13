import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { completeSetup, deferPromisePrompt, expect, test } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";
import type { Page } from "@playwright/test";

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot = process.env.AXOM_ACADEMIC_PILOT;
test.skip(!statusFile || !pilot, "Requires the isolated loopback backend and authorized private pilot.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("real sign-in, private course, scoped study and cross-device recovery", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
  const url = new URL(env.API_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local acceptance refuses a hosted backend.");
  const admin = createClient(url.href, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `academic-browser-${randomUUID()}@example.test`; const password = `${randomUUID()}-A1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`Synthetic account could not be created: ${created.error.message}`);
  const errors: string[] = [];
  const writes: { endpoint: string; bytes: number }[] = [];
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
  await page.locator(".course-card").filter({ hasText: "Your upload" }).click();
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
  const progress = (target: Page) => target.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState }; useAccount: { getState: () => { protection: string } }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    await dev.flushVault(); const state = dev.useStore.getState();
    return { questions: state.questions.length, attempts: state.questions.flatMap(q => q.attempts.map(attempt => ({ questionId: q.id, ...attempt }))).sort((a,b) => a.questionId.localeCompare(b.questionId)), protection: dev.useAccount.getState().protection };
  });
  await expect.poll(async () => (await progress(page)).attempts.length).toBe(11);
  await expect.poll(() => writes.filter(write => write.endpoint.endsWith("push_workspace_delta_v2")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await progress(page)).protection, { timeout: 30_000 }).toBe("protected");
  const saved = await progress(page);
  console.info("Academic acceptance: saved progress", JSON.stringify({ questions: saved.questions, attempts: saved.attempts.length, protection: saved.protection }));
  expect(saved.attempts).toHaveLength(11);
  expect(saved.attempts.every(attempt => Boolean(attempt.quizSessionId && attempt.answerKey && attempt.at))).toBe(true);
  expect(new Set(saved.attempts.map(attempt => attempt.questionId)).size).toBe(11);
  console.info("Academic acceptance: incremental answer checkpoint acknowledged");
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
    await device.goto(`${new URL(page.url()).origin}/#dashboard`);
    await completeSetup(device, "Second device"); await deferPromisePrompt(device);
    await device.getByTitle("Account and protection").click();
    await device.getByLabel("Email", { exact: true }).fill(email);
    await device.getByLabel(/^Password/).fill(password);
    await device.getByRole("button", { name: "Sign in", exact: true }).click();
    console.info("Academic acceptance: second device signed in");
    await expect.poll(async () => (await progress(device)).questions, { timeout: 60_000 }).toBe(25);
    await expect.poll(async () => (await progress(device)).attempts, { timeout: 60_000 }).toEqual(saved.attempts);
    expect((await progress(device)).questions).toBe(25);
    await device.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
    await device.goto(`${new URL(page.url()).origin}/#tracker`);
    await device.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    await device.locator(".course-card").filter({ hasText: "Your upload" }).click();
    await device.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(device.getByText("Question 1 of 11", { exact: false }).first()).toBeVisible();
    // Existing quiz engine owns answer/review state; no second progress engine.
    expect((await progress(device)).attempts).toEqual(saved.attempts);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
  if (process.env.AXOM_ACADEMIC_EVIDENCE) writeFileSync(process.env.AXOM_ACADEMIC_EVIDENCE, JSON.stringify({ apiUrl: url.href, result: "passed", writes,
    workflow: "real sign-in, private upload, Week 2 activation, image-rich 11-question quiz, Decode, incremental save, reload, clean second-device recovery" }, null, 2));
});
