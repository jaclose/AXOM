import type { Browser, Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isolateLiveAccountNetwork } from "./liveAccountNetwork";
import {
  assertUnusedEmail,
  dedicatedLiveProjectUrl,
  matchesRunOwnedUser,
  signupResponseUserId,
} from "../src/lib/liveAccountSafety";

/**
 * LIVE account test against a real Supabase project. Skipped unless every
 * value below is exported in the shell that runs Playwright:
 *
 *   AXOM_LIVE_ACCOUNTS=1
 *   AXOM_LIVE_EMAIL=you@example.com         # an address that can receive mail
 *   SUPABASE_SECRET_KEY=sb_secret_…         # test-runner only; never in .env files
 *   VITE_SUPABASE_URL=https://<test-ref>.supabase.co
 *   AXOM_LIVE_TEST_PROJECT_REF=<test-ref>    # must NOT be the production project
 *   (web/.env.local also holds the app publishable key)
 *
 * Never run this destructive test against AXOM production or an existing account.
 * An incomplete opted-in run fails closed rather than silently skipping.
 *
 * The admin credential verifies only the disposable test account if the
 * backend requires confirmation, then the test exercises password sign-in.
 * This does NOT prove real inbox delivery or confirmation-link acceptance.
 * A separate allowlisted end-to-end email test is required before activation.
 */
const live = process.env.AXOM_LIVE_ACCOUNTS === "1";
const email = process.env.AXOM_LIVE_EMAIL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const url = process.env.VITE_SUPABASE_URL;
const testProjectRef = process.env.AXOM_LIVE_TEST_PROJECT_REF;
const startedAtMs = Date.now();
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
// Network routing must remain observable; service workers can bypass Playwright routes.
test.use({ serviceWorkers: "block" });
test.skip(!live, "Destructive live account test is opt-in: set AXOM_LIVE_ACCOUNTS=1.");

let admin: SupabaseClient;
let dedicatedOrigin = "";
let userId: string | undefined;

test.beforeAll(async () => {
  // Validate the explicit test project BEFORE constructing an admin client.
  const dedicatedUrl = dedicatedLiveProjectUrl(url, testProjectRef);
  if (process.env.AXOM_E2E_BASE_URL) {
    throw new Error("Destructive account tests require AXOM's local dev server, not an external/reused hosted URL.");
  }
  dedicatedOrigin = dedicatedUrl;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is required for opted-in live-account acceptance.");
  admin = createClient(dedicatedUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  // The provider can paginate its user list. Never assume page one proves an address is unused.
  await assertUnusedEmail(email, (page, perPage) => admin.auth.admin.listUsers({ page, perPage }));
});

test.afterAll(async () => {
  // No signup-response ID means no account is proven owned by this run.
  if (!userId) return;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !matchesRunOwnedUser(data?.user, userId, email, startedAtMs)) {
    throw new Error("Refusing cleanup: the provider no longer proves the user belongs to this run.");
  }
  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) throw removed.error;
});

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
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await isolateSupabaseRequests(page);
  return { context, page };
}

async function isolateSupabaseRequests(page: Page) {
  // Use the same allowlist for both browser contexts, including redirects.
  await isolateLiveAccountNetwork(page.context(), dedicatedOrigin, "http://127.0.0.1:5187");
}

test("create with email and password, sign in, protect, merge, restore, devices, delete", async ({ page, browser }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await isolateSupabaseRequests(page);
  await openWorkspace(page, "From device A");
  await openAccount(page);

  await panel(page).getByRole("button", { name: "Create", exact: true }).click();
  await panel(page).getByLabel("Email", { exact: true }).fill(email);
  await panel(page).getByLabel(/^Password/).fill(password);
  // Capture the ID from THIS browser's signup request. Never recover it by email lookup.
  const signupReply = page.waitForResponse((response) => {
    try {
      const signupUrl = new URL(response.url());
      return signupUrl.origin === dedicatedOrigin && signupUrl.pathname === "/auth/v1/signup"
        && response.request().method() === "POST";
    } catch {
      return false;
    }
  });
  await panel(page).getByRole("button", { name: "Create account", exact: true }).click();
  const signupResponse = await signupReply;
  if (!signupResponse.ok()) throw new Error("Live signup did not succeed; refusing account mutation.");
  const signupId = signupResponseUserId(await signupResponse.json(), email);
  const { data: created, error: createdError } = await admin.auth.admin.getUserById(signupId);
  if (createdError || !matchesRunOwnedUser(created?.user, signupId, email, startedAtMs)) {
    throw new Error("Signup response is not confirmed as a newly created test user; refusing mutation.");
  }
  userId = signupId;
  const signOut = panel(page).getByRole("button", { name: "Sign out" });
  const linkNotice = panel(page).getByText(/account confirmation link/i);
  await expect(signOut.or(linkNotice)).toBeVisible();

  if (await linkNotice.isVisible()) {
    // Disposable-test-only confirmation avoids entering an OTP in the product UI.
    // Actual confirmation-link email delivery must be separately verified.
    const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw error;
    await panel(page).getByRole("button", { name: "Sign in", pressed: true }).click();
    await panel(page).getByLabel("Email", { exact: true }).fill(email);
    await panel(page).getByLabel(/^Password/).fill(password);
    await panel(page).getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(signOut).toBeVisible();

  await panel(page).getByRole("button", { name: "Sign out" }).click();
  await panel(page).getByLabel("Email", { exact: true }).fill(email);
  await panel(page).getByLabel(/^Password/).fill(password);
  await panel(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(signOut).toBeVisible();

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
