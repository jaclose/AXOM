import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";
import { createPlatformDatabase, PLATFORM_USERS } from "./fixtures/platformDatabase";
import { connectCommunityFriends, createCommunityProfile, linkFixtureWorkspace, refreshCommunity, setCommunityChoices } from "./fixtures/communityHelpers";

async function loggedDay(page: Page, minutes: number) {
  await page.evaluate(async amount => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { setState: (patch: object) => void }; flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const now = new Date();
    const dayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    dev.useStore.setState({ logs: [{ id: "community-acceptance-log", dayKey, ts: now.toISOString(), type: "Manual",
      academic: true, minutes: amount, cards: amount, quantity: amount, quantityKind: "questions", note: "PRIVATE COMMUNITY ACCEPTANCE NOTE" }] });
    await dev.flushVault();
  }, minutes);
}

test("community conversations, profile edits and audience withdrawal work across accounts", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const database = await createPlatformDatabase();
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const errors: string[] = [];
  const unexpected: string[][] = [];
  const [owner, member] = PLATFORM_USERS;
  try {
    for (const [index, target] of [page, other].entries()) {
      target.setDefaultTimeout(15_000);
      target.on("pageerror", error => errors.push(error.message));
      target.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      unexpected.push(await database.attach(target, index as 0 | 1));
      await target.goto(`${baseURL}/#communities`);
      await seedOnboarded(target, { dailyLoopReminders: { checkInEnabled: false, closeoutEnabled: false } });
      await createCommunityProfile(target, PLATFORM_USERS[index]);
      await setCommunityChoices(target, true, "off");
    }
    await connectCommunityFriends(page, other, member.handle);

    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit community profile" });
    await editor.getByLabel("Biography", { exact: true }).fill("Learning together, one good question at a time.");
    await editor.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await refreshCommunity(other);
    await other.locator(".community-people").getByRole("button", { name: `View ${owner.name}'s profile` }).click();
    const profile = other.getByRole("dialog", { name: `${owner.name}'s profile` });
    await expect(profile).toContainText("Learning together, one good question at a time.");
    await expect(profile).toContainText("Everyone can take part without sharing their progress.");
    await other.keyboard.press("Escape");
    await expect(profile).toHaveCount(0);

    await page.getByRole("button", { name: "Study together", exact: true }).click();
    await page.getByLabel("Your study invitation", { exact: true }).fill("Renal review at 18:00. Reply with one question to discuss.");
    await page.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("friends");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Your post is shared.", { exact: true })).toBeVisible();
    await refreshCommunity(other);
    const invitation = other.locator(".community-post").filter({ hasText: "Renal review at 18:00." });
    await invitation.getByRole("button", { name: "Replies", exact: true }).click();
    await invitation.getByLabel("Write a reply", { exact: true }).fill("I can join. Let’s start with acid-base reasoning.");
    await invitation.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(invitation.getByText("Your reply is posted.", { exact: true })).toBeVisible();
    await other.reload();
    await invitation.getByRole("button", { name: "Replies", exact: true }).click();
    await expect(invitation).toContainText("I can join. Let’s start with acid-base reasoning.");
    await invitation.getByRole("button", { name: "Edit reply", exact: true }).click();
    await invitation.getByLabel("Edit your reply", { exact: true }).fill("I can join at 18:15. Let’s start with acid-base reasoning.");
    await invitation.getByRole("button", { name: "Save reply", exact: true }).click();
    await expect(invitation).toContainText("I can join at 18:15.");
    await invitation.scrollIntoViewIfNeeded();
    await other.screenshot({ path: "/tmp/axom-community-conversation-desktop.png", animations: "disabled" });

    const ownPost = page.locator(".community-post").filter({ hasText: "Renal review at 18:00." });
    await ownPost.getByRole("button", { name: "Edit post", exact: true }).click();
    await ownPost.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("private");
    await ownPost.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your post is updated.", { exact: true })).toBeVisible();
    await refreshCommunity(other);
    await expect(invitation).toHaveCount(0);
    expect(await database.asUser(member.id, "select id from public.social_comments")).toEqual([]);

    // Explicit edits may widen a manual post again; comments follow its audience.
    await ownPost.getByRole("button", { name: "Edit post", exact: true }).click();
    await ownPost.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("friends");
    await ownPost.getByRole("button", { name: "Save changes", exact: true }).click();
    await refreshCommunity(other);
    await invitation.getByRole("button", { name: "Replies", exact: true }).click();
    await invitation.getByRole("button", { name: "Delete reply", exact: true }).click();
    await invitation.getByRole("button", { name: "Remove reply", exact: true }).click();
    await expect(invitation.getByText("I can join at 18:15. Let’s start with acid-base reasoning.", { exact: true })).toHaveCount(0);

    // A post's author can remove another learner's reply, but cannot edit it.
    await invitation.getByLabel("Write a reply", { exact: true }).fill("A second reply for the post owner to moderate.");
    await invitation.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(invitation).toContainText("A second reply for the post owner to moderate.");
    await refreshCommunity(page);
    await ownPost.getByRole("button", { name: "Replies", exact: true }).click();
    await expect(ownPost).toContainText("A second reply for the post owner to moderate.");
    await expect(ownPost.getByRole("button", { name: "Edit reply", exact: true })).toHaveCount(0);
    await ownPost.getByRole("button", { name: "Delete reply", exact: true }).click();
    await ownPost.getByRole("button", { name: "Remove reply", exact: true }).click();
    await expect.poll(() => database.asUser(owner.id, "select id from public.social_comments")).toEqual([]);
    await refreshCommunity(other);
    await expect(invitation.getByText("A second reply for the post owner to moderate.", { exact: true })).toHaveCount(0);

    await loggedDay(page, 45);
    await page.getByRole("button", { name: "Daily progress", exact: true }).click();
    await page.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("friends");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await refreshCommunity(other);
    await expect(other.locator(".community-board-row").filter({ hasText: owner.name })).toContainText("45 min");
    await other.locator(".community-board-row").filter({ hasText: owner.name }).getByRole("button", { name: /profile/ }).click();
    const studiedProfile = other.getByRole("dialog", { name: `${owner.name}'s profile` });
    await expect(studiedProfile).toContainText("1-day shared streak");
    await expect(studiedProfile).not.toContainText("PRIVATE COMMUNITY ACCEPTANCE NOTE");
    await other.screenshot({ path: "/tmp/axom-community-profile-desktop.png", animations: "disabled" });
    await other.setViewportSize({ width: 390, height: 844 });
    await other.screenshot({ path: "/tmp/axom-community-profile-mobile.png", animations: "disabled" });
    await other.keyboard.press("Escape");

    for (const width of [320, 390, 768, 1440]) {
      for (const theme of ["dark", "light"] as const) {
        await other.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await other.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await other.evaluate(value => {
          document.documentElement.dataset.theme = value;
          document.querySelector(".surface-scroll")?.scrollTo({ top: 0, behavior: "instant" });
        }, theme);
        expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await other.locator(".community-page").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await other.screenshot({ path: `/tmp/axom-community-circle-${width}-${theme}.png`, animations: "disabled" });
      }
    }
    expect(unexpected.flat()).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await otherContext.close(); await database.close(); }
});

test("automatic sharing corrects totals, revokes server access and keeps deliberate posts", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const database = await createPlatformDatabase();
  const otherContext = await browser.newContext({ reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const [owner, member] = PLATFORM_USERS;
  try {
    for (const [index, target] of [page, other].entries()) {
      await database.attach(target, index as 0 | 1);
      await target.goto(`${baseURL}/#communities`);
      await seedOnboarded(target, { dailyLoopReminders: { checkInEnabled: false, closeoutEnabled: false } });
      await createCommunityProfile(target, PLATFORM_USERS[index]);
      await setCommunityChoices(target, true, "off");
    }
    await connectCommunityFriends(page, other, member.handle);
    await page.getByLabel("Your update", { exact: true }).fill("A deliberate message that stays shared when automatic sharing stops.");
    await page.getByRole("combobox", { name: "Who can see this?", exact: true }).selectOption("friends");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await loggedDay(page, 40);
    await setCommunityChoices(page, true, "friends");
    // Choosing sharing does not link a retained local workspace or publish its logs.
    expect(await database.asUser(owner.id, "select id from public.social_posts where kind='progress'")).toEqual([]);
    await linkFixtureWorkspace(page);
    await expect.poll(() => database.asUser(owner.id, "select minutes from public.social_posts where kind='progress'"), { timeout: 25_000 }).toEqual([{ minutes: 40 }]);
    await loggedDay(page, 10);
    await expect.poll(() => database.asUser(owner.id, "select minutes from public.social_posts where kind='progress'"), { timeout: 25_000 }).toEqual([{ minutes: 10 }]);
    await refreshCommunity(other);
    await expect(other.locator(".community-board-row").filter({ hasText: owner.name })).toContainText("10 min");
    const consent = await database.rpc(owner.id, "axom_community_preferences");
    const [daily] = await database.asUser<{ activity_day: string; revision: number }>(owner.id, "select activity_day,revision from public.social_posts where kind='progress'");
    await setCommunityChoices(page, true, "off");
    await expect(database.rpc(owner.id, "axom_sync_community_day", { p_day: daily.activity_day, p_minutes: 50, p_cards: 50, p_questions: 50,
      p_consent_revision: consent.revision, p_expected_revision: daily.revision })).rejects.toThrow(/permission changed/i);
    await refreshCommunity(other);
    await expect(other.locator(".community-board-row").filter({ hasText: owner.name })).toHaveCount(0);
    await expect(other.getByText("A deliberate message that stays shared when automatic sharing stops.", { exact: true })).toBeVisible();
    expect(await database.asUser(member.id, "select id from public.social_posts where kind='progress'")).toEqual([]);

    await other.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { profile: object }; setState: (patch: object) => void }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
      dev.useStore.setState({ profile: { ...dev.useStore.getState().profile, dashboardLayout: {
        version: 1, preset: "custom", defaultsRevision: 3, order: ["community"], hiddenWidgetIds: [],
        widgets: { community: { size: "large", enabledFields: ["friends", "activity"], preferences: {} } },
      } } });
      await dev.flushVault();
    });
    await other.goto(`${baseURL}/#dashboard`);
    const widget = other.locator(".community-widget");
    await expect(widget).toContainText("A deliberate message that stays shared when automatic sharing stops.");
    await expect(widget.getByRole("link", { name: /Open Community/ })).toHaveAttribute("href", "#communities");
    await other.screenshot({ path: "/tmp/axom-community-dashboard-widget.png", animations: "disabled" });
  } finally { await otherContext.close(); await database.close(); }
});
