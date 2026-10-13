import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { completeSetup, deferPromisePrompt, expect, test } from "./fixtures";

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot = process.env.AXOM_ACADEMIC_PILOT;
test.skip(!statusFile || !pilot, "Requires the isolated loopback backend and authorized private pilot.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("real sign-in, private course upload, catalog preview and selective download", async ({ page }) => {
  test.setTimeout(120_000);
  const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
  const url = new URL(env.API_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local acceptance refuses a hosted backend.");
  const admin = createClient(url.href, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `academic-browser-${randomUUID()}@example.test`; const password = `${randomUUID()}-A1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`Synthetic account could not be created: ${created.error.message}`);
  const errors: string[] = [];
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
  await page.getByRole("button", { name: "Preview FTM 1, Fall 2026", exact: true }).click();
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
  await page.getByRole("button", { name: "Quiz week 2", exact: true }).click();
  await expect(page.getByText("Question 1 of 11", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.AXOM_ACADEMIC_EVIDENCE) writeFileSync(process.env.AXOM_ACADEMIC_EVIDENCE, JSON.stringify({ apiUrl: url.href, result: "passed", workflow: "real sign-in, private upload, preview, Week 2 activation, downloaded course reload, exact 11-question quiz" }, null, 2));
});
