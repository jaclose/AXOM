import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";

const ORIGIN = "https://community-signup.invalid";
const NEW_EMAIL = "new-learner@example.test";
const EXISTING_EMAIL = "returning-learner@example.test";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_ID = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "SyntheticPassword42";
const EXISTING_CHOICES = { discoverable: false, shareMode: "friends", revision: 7 };
type Choices = { discoverable: boolean; shareMode: "friends" | "community" };

/** Synthetic Auth transport only. No signup, verification or email reaches a service. */
async function signupFixture(page: Page) {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const unexpected: string[] = [];
  let metadata: Record<string, unknown> = {};
  let signedIn: "new" | "existing" | undefined;
  const user = (kind: "new" | "existing") => ({
    id: kind === "new" ? NEW_ID : EXISTING_ID,
    email: kind === "new" ? NEW_EMAIL : EXISTING_EMAIL,
    aud: "authenticated", role: "authenticated", app_metadata: {},
    created_at: "2026-01-01T00:00:00Z", email_confirmed_at: "2026-01-01T00:00:00Z",
    user_metadata: kind === "new" ? metadata : {
      display_name: "Returning learner",
      // Older signup metadata must not overwrite the account's later choices.
      axom_community_preferences: { discoverable: true, shareMode: "community" },
    },
  });
  const session = (kind: "new" | "existing") => {
    signedIn = kind;
    return { access_token: `synthetic-${kind}-access`, refresh_token: `synthetic-${kind}-refresh`,
      token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: user(kind) };
  };
  await page.addInitScript(url => { Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url, key: "synthetic-signup-key" } }); }, ORIGIN);
  // Fail closed if a configuration regression sends Auth to any other origin.
  await page.route("**/auth/v1/**", route => {
    unexpected.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });
  await page.route(`${ORIGIN}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    requests.push({ method, path, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    if (method === "POST" && (path === "/auth/v1/signup" || path === "/auth/v1/otp")) {
      metadata = structuredClone(body.data as Record<string, unknown>);
      return json(path.endsWith("/signup") ? { user: { ...user("new"), email_confirmed_at: null } } : {});
    }
    if (method === "POST" && path === "/auth/v1/verify" && body.email === NEW_EMAIL && body.token === "12345678") return json(session("new"));
    if (method === "POST" && path === "/auth/v1/token" && url.searchParams.get("grant_type") === "password"
      && body.email === EXISTING_EMAIL && body.password === PASSWORD) return json(session("existing"));
    if (signedIn) {
      if (method === "GET" && path === "/auth/v1/user") return json(user(signedIn));
      if (method === "POST" && path === "/rest/v1/rpc/axom_community_preferences") return json(signedIn === "existing"
        ? EXISTING_CHOICES : { ...(metadata.axom_community_preferences as Choices), revision: 1 });
      if (method === "POST" && path === "/rest/v1/rpc/axom_operator_role") return json(null);
      if (method === "GET" && path === "/rest/v1/account_profiles") return json({ display_name: signedIn === "new" ? "Community learner" : "Returning learner" });
      if (method === "GET" && ["/rest/v1/workspace_revisions", "/rest/v1/account_devices"].includes(path)) return json([]);
      if (method === "POST" && path === "/functions/v1/communications" && url.searchParams.get("action") === "settings") return json({
        preferences: [], identity: { accent: "gold", theme: "dark" }, history: [], privacy: [], admin: false,
        deliveryMode: "disabled", deletionEnabled: false, hasProtectedCopy: false,
      });
    }
    unexpected.push(`${method} ${path}`);
    return json({ message: "Request is outside the synthetic signup fixture" }, 404);
  });
  return { requests, unexpected, metadata: () => metadata };
}

for (const scenario of [
  { flow: "password", width: 1440, height: 900, choices: { discoverable: true, shareMode: "community" } },
  { flow: "email-code", width: 390, height: 844, choices: { discoverable: false, shareMode: "friends" } },
] as const) {
  test(`Community choices survive ${scenario.flow} signup at ${scenario.width}px`, async ({ page }, testInfo) => {
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    const backend = await signupFixture(page);
    await seedOnboarded(page, { name: "Community learner" });
    const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByTitle("Account and protection", { exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const methods = dialog.getByRole("group", { name: "Account access method", exact: true });
    await methods.getByRole("button", { name: scenario.flow === "password" ? "Create" : "Email code", exact: true }).click();
    const choices = dialog.getByRole("region", { name: "Community and leaderboards", exact: true });
    const discovery = choices.getByRole("checkbox", { name: "Appear in learner search", exact: true });
    await expect(discovery).not.toBeChecked();
    await expect(choices.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
    const capture = async (stage: string) => {
      await choices.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await dialog.locator(".account-form").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const path = `/tmp/axom-community-signup-${scenario.flow}-${scenario.width}-${stage}.png`;
      await page.screenshot({ path, animations: "disabled" });
      await testInfo.attach(`Signup ${scenario.flow} ${stage}`, { path, contentType: "image/png" });
    };
    await capture("defaults");
    await choices.getByRole("radio", { name: scenario.choices.shareMode === "community" ? "Community" : "Friends", exact: true }).check();
    await expect(discovery).not.toBeChecked();
    if (scenario.choices.discoverable) await discovery.check();
    if (scenario.flow === "password") {
      await dialog.getByLabel("Name on your account", { exact: true }).fill("Community learner");
      await dialog.getByLabel(/^Password/).fill(PASSWORD);
    } else await expect(choices).toContainText("Existing accounts keep their saved choices.");
    await dialog.getByLabel("Email", { exact: true }).fill(NEW_EMAIL);
    await capture("selected");
    await dialog.getByRole("button", { name: scenario.flow === "password" ? "Create account" : "Send code", exact: true }).focus();
    await page.keyboard.press("Enter");
    const code = dialog.getByLabel(`${scenario.flow === "password" ? "Confirmation" : "Sign-in"} code sent to ${NEW_EMAIL}`, { exact: true });
    await expect(code).toBeVisible();
    await expect(choices).toHaveCount(0);
    const authPath = scenario.flow === "password" ? "/auth/v1/signup" : "/auth/v1/otp";
    const created = backend.requests.filter(request => request.path === authPath);
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject(scenario.flow === "password" ? { email: NEW_EMAIL, password: PASSWORD } : { email: NEW_EMAIL, create_user: true });
    expect(backend.metadata()).toEqual({ ...(scenario.flow === "password" ? { display_name: "Community learner" } : {}), axom_community_preferences: scenario.choices });

    if (scenario.flow === "password") {
      // Switching to an existing account cannot reuse this form's signup consent.
      await dialog.getByRole("button", { name: "Use a different email", exact: true }).click();
      await methods.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(choices).toHaveCount(0);
      await dialog.getByLabel("Email", { exact: true }).fill(EXISTING_EMAIL);
      await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await dialog.locator(".account-form").getByRole("button", { name: "Sign in", exact: true }).focus();
    } else {
      await code.fill("12345678");
      await dialog.getByRole("button", { name: "Verify code", exact: true }).focus();
    }
    await page.keyboard.press("Enter");
    await expect(choices.getByRole("radio", { name: "Friends", exact: true })).toBeChecked();
    await expect(discovery).not.toBeChecked();
    await expect(choices.getByRole("button", { name: "Save Community choices", exact: true })).toBeDisabled();
    await page.waitForLoadState("networkidle");
    expect(backend.requests.filter(request => request.path === "/rest/v1/rpc/axom_save_community_preferences"
      || (request.path === "/auth/v1/user" && request.method === "PUT"))).toEqual([]);
    expect(backend.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
