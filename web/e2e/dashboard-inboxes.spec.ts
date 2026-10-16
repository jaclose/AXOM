import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

for (const width of [1440, 768, 390]) {
  test(`reflection and notification inboxes stay calm and contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await page.evaluate(async () => {
      type Dev = {
        useStore: {
          getState: () => { activeDayKey: string };
          setState: (patch: object) => void;
        };
      };
      const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const today = new Date(`${useStore.getState().activeDayKey}T12:00:00`);
      const prior = (offset: number) => {
        const day = new Date(today);
        day.setDate(day.getDate() - offset);
        return day.toISOString().slice(0, 10);
      };
      const recent = prior(1);
      const older = prior(4);
      const syncMetadata = JSON.parse(localStorage.getItem("axom.sync.metadata.v1") ?? "{}") as { deviceId?: string };
      if (syncMetadata.deviceId) {
        const courtesyScope = `device:${syncMetadata.deviceId}:account:local`;
        localStorage.removeItem(`axom.reflectionInbox.v1:${encodeURIComponent(courtesyScope)}`);
      }
      useStore.setState({
        dayPlans: [
          { dayKey: recent, intention: "Finish the cardiology lectures", wins: [], createdAt: `${recent}T08:00:00.000Z` },
          { dayKey: older, intention: "Complete a question block", wins: [], createdAt: `${older}T08:00:00.000Z` },
        ],
        logs: [
          { id: "reflection-recent", dayKey: recent, ts: `${recent}T16:00:00.000Z`, type: "Study", minutes: 45, cards: 0 },
          { id: "reflection-older", dayKey: older, ts: `${older}T16:00:00.000Z`, type: "Questions", minutes: 30, cards: 0 },
        ],
        journal: [],
      });
    });

    const inbox = page.getByRole("region", { name: "Reflection inbox" });
    await expect(inbox).toBeVisible();
    await expect(inbox).toContainText("2 days are ready when you are");
    await expect(page.getByText(/prior reflections are still open/i)).toHaveCount(0);
    await page.getByRole("button", { name: "View all 2" }).click();
    await expect(inbox.getByText("Complete a question block")).toBeVisible();

    await page.getByRole("button", { name: "Notifications" }).click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Sign in for account notices");

    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(width === 390 ? 844 : 900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeFocused();

    await inbox.getByRole("button", { name: "Not today" }).click();
    await expect(inbox).toBeHidden();
    await page.evaluate(async () => {
      type Dev = {
        useStore: { getState: () => { updateProfile: (patch: { name: string }) => void } };
        flushVault: () => Promise<void>;
      };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.getState().updateProfile({ name: "Renamed AXOM E2E" });
      await dev.flushVault();
    });
    await reloadAfterSave(page);
    await expect(inbox).toBeHidden();
  });
}
