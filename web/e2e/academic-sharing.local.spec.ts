import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { completeSetup, deferPromisePrompt, expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot = process.env.AXOM_ACADEMIC_PILOT;
test.skip(!statusFile || !pilot, "Requires isolated loopback services and the authorized private pilot.");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("owner sharing controls enforce review, group access and private withdrawal", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
  const url = new URL(env.API_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local acceptance refuses hosted services.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, env.SERVICE_ROLE_KEY, options);
  const users = [];
  for (const alias of ["owner", "reader"]) {
    const email = `sharing-${alias}-${randomUUID()}@example.test`; const password = `${randomUUID()}-A1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Synthetic account creation failed.");
    const client = createClient(url.href, env.ANON_KEY, options);
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    users.push({ email, password, client, id: created.data.user.id });
  }
  const [owner, reader] = users;
  const groupId = randomUUID();
  expect((await admin.from("academic_groups").insert({ id: groupId, name: `Acceptance cohort ${groupId.slice(0, 8)}` })).error).toBeNull();
  expect((await admin.from("academic_group_members").insert({ group_id: groupId, user_id: owner.id })).error).toBeNull();
  const errors: string[] = [];
  async function signIn(target: Page, user: typeof owner) {
    target.on("pageerror", error => errors.push(error.message));
    target.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    await target.addInitScript(({ url, key }) => Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url, key } }), { url: url.href, key: env.ANON_KEY });
    await target.goto(`${baseURL}/#dashboard`);
    await completeSetup(target, "Sharing acceptance"); await deferPromisePrompt(target);
    const menu = target.getByRole("button", { name: "Open navigation menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await target.getByTitle("Account and protection").click();
    const panel = target.getByRole("dialog");
    await expect(panel.getByLabel("Email", { exact: true })).toBeVisible();
    await panel.getByLabel("Email", { exact: true }).fill(user.email);
    await panel.getByLabel(/^Password/).fill(user.password);
    await panel.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
    await panel.getByRole("button", { name: "Done", exact: true }).click();
    const closeMenu = target.getByRole("button", { name: "Close navigation menu", exact: true });
    if (await closeMenu.isVisible()) await target.keyboard.press("Escape");
  }
  await test.step("Sign in as the owner", () => signIn(page, owner));
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
  const collection = new URL(page.url()).searchParams.get("course")!.replace("remote:", "");
  const contains = async () => {
    const result = await reader.client.rpc("academic_catalog"); expect(result.error).toBeNull();
    return result.data.some((entry: { id: string }) => entry.id === collection);
  };
  expect(await contains()).toBe(false);
  await page.getByText("Sharing settings", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Who can discover this course?").selectOption("shared");
  await page.getByRole("button", { name: "Save sharing choice" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sharing requested." })).toBeVisible();
  expect(await contains()).toBe(false);
  expect((await owner.client.rpc("academic_review", { collection, approved: true })).error).not.toBeNull();
  // A reviewer is provisioned only by the local acceptance administrator.
  expect((await admin.from("academic_reviewers").insert({ user_id: owner.id })).error).toBeNull();
  expect((await owner.client.rpc("academic_review", { collection, approved: true })).error).toBeNull();
  expect(await contains()).toBe(true);
  const other = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  try {
    const second = await other.newPage();
    second.setDefaultTimeout(20_000);
    await test.step("Sign in as the reader", () => signIn(second, reader));
    await second.goto(`${new URL(page.url()).origin}/#tracker`);
    await second.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    await second.locator(`.course-card[data-course-id="${collection}"]`).click();
    await expect(second.getByRole("region", { name: "FTM 1 course plan" })).toBeVisible();
    expect(new URL(second.url()).searchParams.get("course")).toBe(`remote:${collection}`);
    await expect(second.getByText("Sharing settings", { exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByText("Sharing settings", { exact: true }).click();
    await page.getByLabel("Who can discover this course?").selectOption("group");
    await page.getByRole("combobox", { name: "Group or cohort", exact: true }).selectOption(groupId);
    await page.getByRole("button", { name: "Save sharing choice" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sharing saved." })).toBeVisible();
    expect(await contains()).toBe(false);
    expect((await admin.from("academic_group_members").insert({ group_id: groupId, user_id: reader.id })).error).toBeNull();
    expect(await contains()).toBe(true);
    // Inspect all requested layouts without saving course or question source text.
    for (const [width, height] of [[1440, 900], [390, 844], [1024, 540]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ["dark", "light"]) {
        await page.locator("html").evaluate((root, theme) => root.setAttribute("data-theme", theme), theme);
        await page.locator(".course-sharing").scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (process.env.AXOM_SHARING_SCREENSHOTS) await page.locator(".course-sharing").screenshot({ path: `/tmp/axom-sharing-${width}-${height}-${theme}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("html").evaluate(root => root.style.zoom = "2");
    await expect(page.getByRole("button", { name: "Save sharing choice" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("html").evaluate(root => root.style.zoom = "1");
    await page.getByLabel("Who can discover this course?").selectOption("private");
    await page.getByRole("button", { name: "Save sharing choice" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Course is private." })).toBeVisible();
    expect(await contains()).toBe(false);
    await second.reload();
    await expect(second.getByRole("region", { name: "FTM 1 course plan" })).toHaveCount(0);
    await expect(second.locator(`.course-card[data-course-id="${collection}"]`)).toHaveCount(0);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});
