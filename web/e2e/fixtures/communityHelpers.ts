import type { Page } from "@playwright/test";
import { expect } from "../fixtures";

export async function refreshCommunity(page: Page) {
  const refresh = page.locator(".community-page").getByRole("button", { name: "Refresh", exact: true });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.getByText("Refreshing…", { exact: true })).toHaveCount(0);
}

export async function createCommunityProfile(page: Page, person: { handle: string; name: string }) {
  await page.locator(".community-onboard").getByRole("button", { name: "Create profile", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create your community profile" });
  await dialog.getByLabel("Public handle", { exact: false }).fill(person.handle);
  await dialog.getByLabel("Display name", { exact: true }).fill(person.name);
  await dialog.getByRole("button", { name: "Create profile", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".community-own-profile")).toContainText(person.name);
}

export async function setCommunityChoices(page: Page, discoverable: boolean, mode: "off" | "friends" | "community") {
  await page.getByRole("button", { name: "Account sharing settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const settings = dialog.getByRole("region", { name: "Community and leaderboards", exact: true });
  const discovery = settings.getByRole("checkbox", { name: /Appear in learner search/ });
  await expect(discovery).toBeEnabled();
  await discovery.setChecked(discoverable);
  const label = mode === "off" ? "Off" : mode === "friends" ? "Friends" : "Community";
  await settings.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
  const save = settings.getByRole("button", { name: "Save Community choices", exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await expect(settings.getByText("Community choices saved for your account.", { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await refreshCommunity(page);
}

export async function linkFixtureWorkspace(page: Page) {
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useAccount: { setState: (value: object) => void } }> }).__AXOM_DEV__;
    dev.useAccount.setState({ link: "linked", applyingRemote: false });
  });
}

export async function connectCommunityFriends(owner: Page, member: Page, memberHandle: string) {
  await owner.getByLabel("Find someone", { exact: true }).fill(memberHandle);
  await owner.locator(".community-people .community-person").filter({ hasText: memberHandle }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner.getByText("Friend request sent.", { exact: true })).toBeVisible();
  await refreshCommunity(member);
  await member.getByRole("region", { name: "Friend requests for you" }).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(member.getByText("You are now friends.", { exact: true })).toBeVisible();
  await refreshCommunity(owner);
}
