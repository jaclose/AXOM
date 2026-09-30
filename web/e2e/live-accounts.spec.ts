import type { Browser, Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * LIVE account test against a real Supabase project. Skipped unless every
 * value below is exported in the shell that runs Playwright:
 *
 *   AXOM_LIVE_ACCOUNTS=1
 *   AXOM_LIVE_EMAIL=you@example.com         # an address that can receive mail
 *   SUPABASE_SECRET_KEY=sb_secret_…         # test-runner only; never in .env files
 *   (web/.env.local must hold VITE_SUPABASE_URL and the publishable key)
 *
 * The admin key only mints the same one-time codes the emails carry, so the
 * test does not need to read an inbox, and deletes the test user afterwards.
 * The UI still sends two real emails (confirmation + sign-in code), which checks
 * delivery and the templates; Supabase's built-in mailer allows only a few per
 * hour, so do not loop this test.
 */
const live = process.env.AXOM_LIVE_ACCOUNTS === "1";
const email = process.env.AXOM_LIVE_EMAIL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const url = process.env.VITE_SUPABASE_URL ?? "https://jofkmfwkidubxcutkwzf.supabase.co";
const password = `Axom-${Math.random().toString(36).slice(2, 10)}9`;

type DevWindow = Window & {
  __AXOM_DEV__: Promise<{
    useStore: {
      getState: () => { tasks: Array<{ id: string; title: string }> };
      setState: (patch: Record<string, unknown>) => void;
    };
  }>;
};

test.describe.configure({ mode: "serial" });
test.skip(!live || !email || !secret, "Live account test: set AXOM_LIVE_ACCOUNTS=1, AXOM_LIVE_EMAIL and SUPABASE_SECRET_KEY.");

let admin: SupabaseClient;
let userId: string | undefined;

test.beforeAll(async () => {
  admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existing) throw new Error(`${email} already has an account; use a fresh address so the test never touches real data.`);
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function mintCode(type: "signup" | "magiclink"): Promise<string> {
  const { data, error } = type === "signup"
    ? await admin.auth.admin.generateLink({ type, email, password })
    : await admin.auth.admin.generateLink({ type, email });
  if (error) throw error;
  userId = data.user.id;
  return data.properties.email_otp;
}

async function openWorkspace(page: Page, taskTitle: string) {
  await page.goto("/#dashboard", { waitUntil: "networkidle" });
  if (await completeSetup(page, "Live account test", { ifVisible: true })) {
    const later = page.getByRole("button", { name: "Review later", exact: true });
    if (await later.count()) await later.click();
  }
  await page.evaluate(async (title) => {
    const { useStore } = await (window as unknown as DevWindow).__AXOM_DEV__;
    useStore.setState({ tasks: [{ id: `live-${title}`, title, done: false, created: new Date().toISOString() }] });
  }, taskTitle);
}

async function openAccount(page: Page) {
  await page.getByTitle("Settings", { exact: true }).click();
  await panel(page).getByRole("tab", { name: "Account", exact: true }).click();
}

/** Account controls live in the Settings dialog; the top bar has look-alike buttons. */
const panel = (page: Page) => page.getByRole("dialog");

async function taskTitles(page: Page) {
  return page.evaluate(async () => {
    const { useStore } = await (window as unknown as DevWindow).__AXOM_DEV__;
    return useStore.getState().tasks.map((task) => task.title).sort();
  });
}

async function secondDevice(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("create, confirm by code, password and code sign-in, protect, merge, restore, devices, delete", async ({ page, browser }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await openWorkspace(page, "From device A");
  await openAccount(page);

  // Create the account; confirm with the code from the confirmation email.
  await panel(page).getByRole("tab", { name: "Create account" }).click();
  await panel(page).getByLabel("Email", { exact: true }).fill(email);
  await panel(page).getByLabel(/^Password/).fill(password);
  await panel(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(panel(page).getByText(/Confirmation code sent to/)).toBeVisible();
  await panel(page).locator(".account-code").fill(await mintCode("signup"));
  await panel(page).getByRole("button", { name: "Verify code" }).click();
  await expect(panel(page).getByRole("button", { name: "Sign out" })).toBeVisible();

  // Password sign-in, then passwordless code sign-in.
  await panel(page).getByRole("button", { name: "Sign out" }).click();
  await panel(page).getByLabel("Email", { exact: true }).fill(email);
  await panel(page).getByLabel(/^Password/).fill(password);
  await panel(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Sign out" }).click();
  await panel(page).getByRole("tab", { name: "Email me a code" }).click();
  await panel(page).getByLabel("Email", { exact: true }).fill(email);
  await panel(page).getByRole("button", { name: "Send code" }).click();
  await expect(panel(page).getByText(/Sign-in code sent to/)).toBeVisible();
  await panel(page).locator(".account-code").fill(await mintCode("magiclink"));
  await panel(page).getByRole("button", { name: "Verify code" }).click();
  await expect(panel(page).getByRole("button", { name: "Sign out" })).toBeVisible();

  // Protect device A.
  await panel(page).getByRole("button", { name: "Protect this workspace" }).click();
  await expect(panel(page).getByText("Protected versions")).toBeVisible();
  await expect(panel(page).locator(".account-version-list li")).toHaveCount(1);

  // Device B has different local work; protecting it must not overwrite A.
  const b = await secondDevice(browser);
  b.page.on("dialog", (dialog) => void dialog.accept());
  await openWorkspace(b.page, "From device B");
  await openAccount(b.page);
  await panel(b.page).getByLabel("Email", { exact: true }).fill(email);
  await panel(b.page).getByLabel(/^Password/).fill(password);
  await panel(b.page).getByRole("button", { name: "Sign in", exact: true }).click();
  await panel(b.page).getByRole("button", { name: "Protect this workspace" }).click();
  await expect(panel(b.page).getByText("Two versions need a decision")).toBeVisible();
  await panel(b.page).getByRole("button", { name: /Merge both/ }).click();
  await expect.poll(() => taskTitles(b.page)).toEqual(["From device A", "From device B"]);

  // Restore the first protected version on B; the restore becomes a new version.
  await panel(b.page).getByRole("button", { name: "Refresh" }).click();
  await panel(b.page).locator(".account-version-list li").last().getByRole("button", { name: "Restore" }).click();
  await expect.poll(() => taskTitles(b.page)).toEqual(["From device A"]);
  await panel(b.page).getByRole("button", { name: "Refresh" }).click();
  await expect(panel(b.page).locator(".account-version-list")).toContainText("Restore");

  // Both devices are registered; B can forget A.
  await expect(panel(b.page).locator(".account-device-list li")).toHaveCount(2);
  await panel(b.page).locator(".account-device-list li").filter({ hasNotText: "This device" }).getByRole("button", { name: "Remove" }).click();
  await expect(panel(b.page).locator(".account-device-list li")).toHaveCount(1);

  // Deleting cloud copies clears the server and leaves local work alone.
  await panel(b.page).getByText("Delete cloud copies", { exact: true }).first().click();
  await panel(b.page).getByRole("button", { name: "Delete cloud copies" }).click();
  await expect(panel(b.page).locator(".account-version-list")).toHaveCount(0);
  expect(await taskTitles(b.page)).toEqual(["From device A"]);
  const { count } = await admin.from("workspace_revisions").select("id", { count: "exact", head: true }).eq("user_id", userId!);
  expect(count).toBe(0);
  await b.context.close();
});
