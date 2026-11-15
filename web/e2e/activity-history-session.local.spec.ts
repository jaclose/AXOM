import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Synthetic session changes exercise the actual mounted React page in Chromium.
// They do not contact Supabase or assert authenticated production behavior.
type Dev = {
  useStore: {
    setState: (patch: object) => void;
    getState: () => { logs: unknown[] };
  };
  useAccount: { setState: (patch: object) => void };
  flushVault: () => Promise<void>;
};

async function dev(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
}

async function setSession(page: Page, account: "A" | "B", link: "linked" | "unlinked") {
  await page.evaluate(async ({ account, link }) => {
    const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    app.useAccount.setState({
      phase: "signed-in",
      user: {
        id: `browser-synthetic-${account}`, email: `${account.toLowerCase()}@example.test`,
        displayName: `Synthetic ${account}`, emailConfirmed: true,
      },
      link,
    });
  }, { account, link });
}

for (const width of [1440, 390]) {
  test(`Activity History browser privacy and keyboard revocation at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await dev(page);
    await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      app.useStore.setState({ logs: [{
        id: "browser-private-A", dayKey: "2026-11-14",
        ts: "2026-11-14T18:45:00.000Z", type: "Review",
        minutes: 17, cards: 42, note: "SYNTHETIC_A_HISTORY_NOTE_R134",
      }] });
      await app.flushVault();
    });
    await reloadAfterSave(page);
    await dev(page);
    await setSession(page, "B", "unlinked");
    // Hash navigation preserves the synthetic in-memory account.
    await page.goto("/#activity", { waitUntil: "networkidle" });

    await expect(page.getByText("Device history needs confirmation")).toBeVisible();
    await expect(page.getByText("SYNTHETIC_A_HISTORY_NOTE_R134")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    await expect(page.locator(".grid-stats")).toHaveCount(0);

    const reveal = page.getByRole("button", { name: "Show device history" });
    await reveal.focus();
    await expect(reveal).toBeFocused();
    await page.keyboard.press("Enter");
    const ledger = page.getByRole("region", { name: "Activity History" });
    await expect(ledger).toBeFocused();
    await expect(ledger.getByText("SYNTHETIC_A_HISTORY_NOTE_R134")).toBeVisible();
    const exportButton = page.getByRole("button", { name: "Export .xlsx" });
    await exportButton.focus();
    await expect(exportButton).toBeFocused();

    await setSession(page, "A", "linked");
    const revoked = page.getByRole("status").filter({ hasText: "Activity History session changed" });
    await expect(revoked.getByText("Activity History session changed")).toBeVisible();
    await expect(revoked).toBeFocused();
    await expect(page.getByText("SYNTHETIC_A_HISTORY_NOTE_R134")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    await setSession(page, "B", "unlinked");
    await expect(revoked.getByText("Activity History session changed")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
