import type { Page } from "@playwright/test";
import type { StudyLog } from "../src/lib/types";
import { expect, seedOnboarded, test } from "./fixtures";
import { createPlatformDatabase, PLATFORM_USERS } from "./fixtures/platformDatabase";

type Dev = { useStore: { getState: () => { logs: StudyLog[] }; setState: (patch: object) => void }; flushVault: () => Promise<void> };

async function refreshCommunity(page: Page) {
  await page.locator(".community-page").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Loading shared activity…", { exact: true })).toHaveCount(0);
}
async function seedPrivateProgress(page: Page) {
  const day = await page.getByLabel("Study day", { exact: true }).inputValue();
  await page.evaluate(async dayKey => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    dev.useStore.setState({ logs: [{ id: "fixture-private-progress", dayKey, ts: new Date().toISOString(), type: "Manual",
      minutes: 45, cards: 12, quantity: 9, quantityKind: "questions", academic: true,
      note: "PRIVATE FIXTURE NOTE MUST NEVER ENTER A SOCIAL POST" }] });
    await dev.flushVault();
  }, day);
}
async function inspectResponsive(page: Page, area: "community" | "host") {
  for (const [width, height, theme] of [[1440, 900, "dark"], [390, 844, "light"]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: width === 390 ? "reduce" : "no-preference" });
    await page.evaluate(value => { localStorage.setItem("axom.theme", value); document.documentElement.dataset.theme = value; }, theme);
    const scroller = page.locator(".surface-scroll");
    await scroller.evaluate(element => { element.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator(`.${area}-page`).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-pr30-${area}-${width}-${theme}.png` });
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await scroller.evaluate(element => { element.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("Host and Community persist across two synthetic accounts with real SQL authorization", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const database = await createPlatformDatabase();
  console.info("Platform fixture: full migration replay complete.");
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const errors: string[] = [];
  const unexpected: string[][] = [];
  for (const target of [page, other]) {
    target.setDefaultTimeout(15_000);
    target.on("pageerror", error => errors.push(error.message));
    target.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    target.on("dialog", dialog => dialog.accept());
  }
  const [owner, member] = PLATFORM_USERS;
  try {
    for (const [index, target] of [page, other].entries()) {
      unexpected.push(await database.attach(target, index as 0 | 1));
      await target.goto(`${baseURL}/#community`);
      console.info(`Platform fixture: browser ${index + 1} opened.`);
      await seedOnboarded(target, { dailyLoopReminders: { checkInEnabled: false, closeoutEnabled: false } });
      await expect(target.getByRole("heading", { name: "Join Community", exact: true })).toBeVisible();
    }

    // No identity gets an operator role from a display name or a client request.
    await expect(database.rpc(member.id, "axom_operator_accounts", { query_text: "" })).rejects.toThrow(/access required/i);
    await expect(database.asUser(member.id, "insert into public.axom_operator_roles(user_id,role) values($1,'owner')", [member.id])).rejects.toThrow(/permission denied/i);
    await other.goto(`${baseURL}/#host`);
    await expect(other.getByRole("heading", { name: "Operator permission required" })).toBeVisible();
    await other.goto(`${baseURL}/#community`);

    await page.getByLabel("Public handle", { exact: true }).fill(owner.handle);
    await page.getByLabel("Display name", { exact: true }).fill(owner.name);
    await expect(page.getByRole("checkbox", { name: /discoverable/i })).not.toBeChecked();
    await page.getByRole("button", { name: "Create profile", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hidden from discovery", { exact: true })).toBeVisible();
    await other.getByLabel("Public handle", { exact: true }).fill(member.handle);
    await other.getByLabel("Display name", { exact: true }).fill(member.name);
    await other.getByRole("checkbox", { name: /discoverable/i }).check();
    await other.getByRole("button", { name: "Create profile", exact: true }).click();
    expect(await database.asUser(member.id, "select user_id from public.social_profiles where user_id=$1", [owner.id])).toEqual([]);
    await page.reload();
    await expect(page.getByText("Hidden from discovery", { exact: true })).toBeVisible();
    console.info("Platform fixture: profiles and discovery consent checked.");

    // Progress exists privately before the explicit publish action; notes never enter a post.
    await seedPrivateProgress(page);
    expect(await database.asUser(owner.id, "select id from public.social_posts")).toEqual([]);
    await expect(page.getByRole("combobox", { name: "Who can see this?", exact: true })).toHaveValue("private");
    await page.getByLabel("Write a note (optional)", { exact: true }).fill("A private fixture reflection.");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator(".community-post").filter({ hasText: "A private fixture reflection." })).toBeVisible();
    await refreshCommunity(other);
    await expect(other.getByText("A private fixture reflection.", { exact: true })).toHaveCount(0);
    expect(await database.asUser(member.id, "select id from public.social_posts")).toEqual([]);
    const privatePost = page.locator(".community-post").filter({ hasText: "A private fixture reflection." });
    await privatePost.getByRole("button", { name: "Delete", exact: true }).click();
    await privatePost.getByRole("button", { name: "Remove my post", exact: true }).click();
    await expect(privatePost).toHaveCount(0);
    console.info("Platform fixture: private post and removal checked.");
    await page.getByRole("button", { name: "Show me", exact: true }).click();
    await refreshCommunity(other);
    await page.getByLabel("Find someone", { exact: true }).fill(member.handle);
    await page.locator(".community-people .community-person").filter({ hasText: member.handle }).getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
    await refreshCommunity(other);
    await other.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(other.getByText("Friend request accepted.", { exact: true })).toBeVisible();
    for (const target of [page, other]) {
      await target.reload();
      await expect(target.getByRole("button", { name: "Friends · remove", exact: true })).toBeVisible();
    }
    expect(await database.asUser(member.id, "select status from public.social_connections")).toEqual([{ status: "accepted" }]);
    console.info("Platform fixture: friendship persisted across both reloads.");

    await page.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("friends");
    await page.getByLabel("Write a note (optional)", { exact: true }).fill("A focused study block, shared with friends.");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Update shared.", { exact: true })).toBeVisible();
    await refreshCommunity(other);
    const sharedPost = other.locator(".community-post").filter({ hasText: "A focused study block, shared with friends." });
    await expect(sharedPost).toContainText("45");
    await expect(sharedPost).toContainText("9");
    await expect(other.getByText(/Self-shared totals, not independently verified/)).toBeVisible();
    await expect(other.locator(".community-rank").filter({ hasText: owner.name })).toContainText("9 questions");
    await expect(other.getByText("PRIVATE FIXTURE NOTE MUST NEVER ENTER A SOCIAL POST", { exact: true })).toHaveCount(0);
    await sharedPost.getByRole("button", { name: /Kudos/ }).click();
    await expect(other.getByText("Reaction saved.", { exact: true })).toBeVisible();
    await other.reload();
    await expect(sharedPost.getByRole("button", { name: /Kudos/ })).toHaveAttribute("aria-pressed", "true");
    expect(await database.asUser(owner.id, "select count(*)::integer as count from public.social_reactions")).toEqual([{ count: 1 }]);
    console.info("Platform fixture: Kudos persisted after acknowledgement and reload.");
    await inspectResponsive(other, "community");

    await sharedPost.getByRole("button", { name: "Report", exact: true }).click();
    await sharedPost.getByRole("combobox", { name: "Reason for reporting", exact: true }).selectOption("other");
    await sharedPost.getByRole("button", { name: "Submit report", exact: true }).click();
    await expect(other.getByText("Report sent to moderators.", { exact: true })).toBeVisible();
    await page.goto(`${baseURL}/#host`);
    await expect(page.getByRole("button", { name: "Dismiss report", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss report", exact: true }).click();
    await expect(page.getByText("Report dismissed and audited.", { exact: true })).toBeVisible();

    await page.getByLabel("Find account", { exact: true }).fill(member.name);
    const accountRow = page.locator(".host-account").filter({ hasText: member.name });
    await accountRow.getByRole("combobox", { name: "Role", exact: true }).selectOption("moderator");
    await accountRow.getByRole("textbox", { name: /^Reason for changing Fixture Briar/ }).fill("Synthetic acceptance: grant moderation access.");
    await accountRow.getByRole("button", { name: "Apply role", exact: true }).click();
    await expect(page.getByText("Role updated and audited.", { exact: true })).toBeVisible();
    expect(await database.rpc(member.id, "axom_operator_role")).toBe("moderator");
    await expect(database.rpc(member.id, "axom_operator_accounts", { query_text: "" })).rejects.toThrow(/access required/i);
    await other.goto(`${baseURL}/#host`);
    await expect(other.locator(".host-page").getByText("Moderator", { exact: true }).first()).toBeVisible();
    await expect(other.getByRole("heading", { name: "Accounts & AI", exact: true })).toHaveCount(0);
    await accountRow.getByRole("combobox", { name: "Role", exact: true }).selectOption("member");
    await accountRow.getByRole("textbox", { name: /^Reason for changing Fixture Briar/ }).fill("Synthetic acceptance: revoke moderation access.");
    await accountRow.getByRole("button", { name: "Apply role", exact: true }).click();
    await expect.poll(() => database.rpc(member.id, "axom_operator_role")).toBeNull();
    await other.reload();
    await expect(other.getByRole("heading", { name: "Operator permission required" })).toBeVisible();
    await other.goto(`${baseURL}/#community`);

    await accountRow.getByLabel("Daily AI request cap", { exact: true }).fill("2");
    await accountRow.getByRole("textbox", { name: /^Reason for changing Fixture Briar/ }).fill("Synthetic acceptance: cap AI requests at two.");
    await accountRow.getByRole("button", { name: "Apply AI policy", exact: true }).click();
    await expect(page.getByText("AI policy saved and audited.", { exact: true })).toBeVisible();
    expect(await database.rpc(member.id, "consume_ai_quota")).toBe(1);
    expect(await database.rpc(member.id, "consume_ai_quota")).toBe(0);
    expect(await database.rpc(member.id, "consume_ai_quota")).toBe(-1);
    await accountRow.getByRole("combobox", { name: "Cloud AI", exact: true }).selectOption("disabled");
    await accountRow.getByRole("textbox", { name: /^Reason for changing Fixture Briar/ }).fill("Synthetic acceptance: revoke Cloud AI access.");
    await accountRow.getByRole("button", { name: "Apply AI policy", exact: true }).click();
    await expect.poll(async () => (await database.asUser<{ enabled: boolean }>(owner.id,
      "select enabled from public.axom_ai_entitlements where user_id=$1", [member.id]))[0]?.enabled).toBe(false);
    await inspectResponsive(page, "host");

    // Removal immediately closes friends-only post and reaction reads on the database.
    await other.getByRole("button", { name: "Friends · remove", exact: true }).click();
    await other.reload();
    await expect(sharedPost).toHaveCount(0);
    expect(await database.asUser(member.id, "select id from public.social_posts where user_id=$1", [owner.id])).toEqual([]);
    expect(await database.asUser(member.id, "select post_id from public.social_reactions")).toEqual([]);
    expect(unexpected.flat()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await database.close();
  }
});
