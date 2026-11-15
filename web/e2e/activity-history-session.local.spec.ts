import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Synthetic session changes exercise the actual mounted React page in Chromium.
// They do not contact Supabase or assert authenticated production behavior.
type Dev = {
  useStore: {
    setState: (patch: object) => void;
    getState: () => { logs: unknown[] };
  };
  useAccount: {
    setState: (patch: object) => void;
    subscribe: (listener: (state: unknown, previous: unknown) => void) => () => void;
    getState: () => {
      identityEpoch?: number;
      phase: string;
      link: string;
      user: { id: string; email: string; displayName: string; emailConfirmed: boolean } | null;
    };
  };
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

test("Activity History separately confirms and downloads retained-device XLSX with synthetic records", async ({ page }) => {
  const note = "SYNTHETIC_EXPORT_CONSENT_R135";
  const dialogs: string[] = [];
  const downloads: string[] = [];
  let approveExport = false;
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (approveExport) await dialog.accept();
    else await dialog.dismiss();
  });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));

  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await dev(page);
  await page.evaluate(async (privateNote) => {
    const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    app.useStore.setState({ logs: [{
      id: "browser-export-consent-A", dayKey: "2026-11-14",
      ts: "2026-11-14T18:45:00.000Z", type: "Review",
      minutes: 23, cards: 32, note: privateNote,
    }] });
    await app.flushVault();
  }, note);
  await reloadAfterSave(page);
  await dev(page);
  await setSession(page, "B", "unlinked");
  await page.goto("/#activity", { waitUntil: "networkidle" });

  await expect(page.getByText("Device history needs confirmation")).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);

  await page.getByRole("button", { name: "Show device history" }).click();
  await expect(page.getByText(note)).toBeVisible();
  const exportButton = page.getByRole("button", { name: "Export .xlsx" });

  // Revealing device history is not permission to save its contents as a workbook.
  await exportButton.click();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toMatch(/different account/i);
  expect(downloads).toEqual([]);
  await expect(exportButton).toBeEnabled();
  await expect(page.getByText(note)).toBeVisible();

  approveExport = true;
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(dialogs).toHaveLength(2);
  expect(dialogs[1]).toMatch(/different account/i);
  expect(download.suggestedFilename()).toMatch(/^axom-activity-history-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const { readFile } = await import("node:fs/promises");
  // Node ESM wraps CommonJS exports under default; the named namespace has no read().
  const XLSX = (await import("xlsx-js-style")).default;
  const workbook = XLSX.read(await readFile(await download.path()), { type: "buffer" });
  expect(workbook.SheetNames).toContain("All Activity");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["All Activity"], { header: 1 });
  expect(JSON.stringify(rows)).toContain(note);
  expect(downloads).toHaveLength(1);

  await setSession(page, "A", "linked");
  await expect(page.getByText("Activity History session changed")).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`Activity History revokes producer-driven same-tick A→B→A after mounting at ${width}px}`, async ({ page }) => {
    const note = "SYNTHETIC_EPOCH_ONLY_PRIVATE_R137";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await dev(page);
    await page.evaluate(async (privateNote) => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      app.useStore.setState({ logs: [{
        id: "synthetic-epoch-only-A", dayKey: "2026-11-14",
        ts: "2026-11-14T18:45:00.000Z", type: "Review",
        minutes: 31, cards: 51, note: privateNote,
      }] });
      await app.flushVault();
    }, note);
    await reloadAfterSave(page);
    await dev(page);
    await setSession(page, "A", "linked");
    // The DIRECT parent intentionally omits MOTHERSHIP's Platform epoch producer.
    // Report SKIPPED, not green, until FORGE tests the literal combined source.
    const initialEpoch = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return app.useAccount.getState().identityEpoch;
    });
    test.skip(typeof initialEpoch !== "number", "Requires Platform #736 identityEpoch producer; DIRECT-only parent cannot verify A→B→A.");
    await page.goto("/#activity", { waitUntil: "networkidle" });

    await expect(page.getByText(note)).toBeVisible();
    const exportButton = page.getByRole("button", { name: "Export .xlsx" });
    await exportButton.focus();
    await expect(exportButton).toBeFocused();

    // Both transitions occur before React can render an intermediate account.
    // The Platform producer must increment twice even though the final identity
    // and link match the mounted snapshot; never inject the epoch directly.
    const transition = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const before = app.useAccount.getState();
      const ownerA = before.user;
      if (!ownerA) throw new Error("Missing synthetic owner A");
      app.useAccount.setState({
        phase: "signed-in",
        user: { ...ownerA, id: "browser-synthetic-B", email: "b@example.test", displayName: "Synthetic B" },
        link: "linked-elsewhere",
      });
      const afterB = app.useAccount.getState();
      app.useAccount.setState({ phase: "signed-in", user: ownerA, link: "linked" });
      const afterA = app.useAccount.getState();
      return {
        initial: before.identityEpoch,
        afterB: afterB.identityEpoch,
        afterA: afterA.identityEpoch,
        userId: afterA.user?.id,
        link: afterA.link,
      };
    });
    expect(transition.afterB).toBe((transition.initial ?? 0) + 1);
    expect(transition.afterA).toBe((transition.initial ?? 0) + 2);
    expect(transition.userId).toBe("browser-synthetic-A");
    expect(transition.link).toBe("linked");
    const notice = page.getByRole("status").filter({ hasText: "Activity History session changed" });
    await expect(notice).toBeVisible();
    await expect(notice).toBeFocused();
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    await expect(page.locator(".grid-stats")).toHaveCount(0);

    // An unchanged-account write must not increment the counter or restore
    // an already revoked mounted view.
    const epochAfterNoChange = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const current = app.useAccount.getState();
      app.useAccount.setState({ phase: current.phase, user: current.user, link: current.link });
      return app.useAccount.getState().identityEpoch;
    });
    expect(epochAfterNoChange).toBe(transition.afterA);
    await expect(notice).toBeVisible();
    await expect(page.getByText(note)).toHaveCount(0);
    const count = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return app.useStore.getState().logs.length;
    });
    expect(count).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  test(`Activity History catches pre-subscription A→B→A without an intermediate listener at ${width}px`, async ({ page }) => {
    const note = "SYNTHETIC_PRESUBSCRIBE_PRIVATE_R143";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await dev(page);
    await page.evaluate(async (privateNote) => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      app.useStore.setState({ logs: [{
        id: "synthetic-presubscribe-A", dayKey: "2026-11-14",
        ts: "2026-11-14T18:45:00.000Z", type: "Review",
        minutes: 19, cards: 27, note: privateNote,
      }] });
      await app.flushVault();
    }, note);
    await reloadAfterSave(page);
    await dev(page);
    await setSession(page, "A", "linked");
    const epoch = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return app.useAccount.getState().identityEpoch;
    });
    test.skip(typeof epoch !== "number", "Platform #736 epoch producer is not present in the standalone DIRECT branch.");

    // Control: retained local A history really is renderable before the race.
    await page.goto("/#activity", { waitUntil: "networkidle" });
    await expect(page.getByText(note)).toBeVisible();
    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await expect(page.getByText(note)).toHaveCount(0);

    // Observe account subscriptions as the History view mounts. On the first
    // registration with its region already committed to the DOM, transition
    // A→B→A *before* forwarding the listener to Zustand. No intermediate B
    // notification can reach this just-registering listener. Its layout-effect
    // reconciliation must detect the producer's +2 epoch despite identical
    // final account ID and device link.
    await page.evaluate(async () => {
      type Capture = {
        fired: boolean; initial?: number; afterB?: number; afterA?: number;
        userId?: string; link?: string;
      };
      const w = window as unknown as {
        __AXOM_DEV__: Promise<Dev>;
        __AXOM_PRESUBSCRIBE_ABA__?: Capture;
      };
      const app = await w.__AXOM_DEV__;
      const originalSubscribe = app.useAccount.subscribe;
      const capture: Capture = { fired: false };
      w.__AXOM_PRESUBSCRIBE_ABA__ = capture;
      app.useAccount.subscribe = (listener) => {
        if (!capture.fired && document.querySelector('[role="region"][aria-label="Activity History"]')) {
          capture.fired = true;
          const before = app.useAccount.getState();
          const ownerA = before.user;
          if (!ownerA) throw new Error("Missing synthetic A before History subscription");
          capture.initial = before.identityEpoch;
          app.useAccount.setState({
            phase: "signed-in",
            user: { ...ownerA, id: "browser-synthetic-B", email: "b@example.test", displayName: "Synthetic B" },
            link: "linked-elsewhere",
          });
          capture.afterB = app.useAccount.getState().identityEpoch;
          app.useAccount.setState({ phase: "signed-in", user: ownerA, link: "linked" });
          const afterA = app.useAccount.getState();
          capture.afterA = afterA.identityEpoch;
          capture.userId = afterA.user?.id;
          capture.link = afterA.link;
          app.useAccount.subscribe = originalSubscribe;
        }
        return originalSubscribe(listener);
      };
    });
    await page.goto("/#activity", { waitUntil: "networkidle" });
    const transition = await page.evaluate(() => (
      window as unknown as { __AXOM_PRESUBSCRIBE_ABA__?: {
        fired: boolean; initial?: number; afterB?: number; afterA?: number;
        userId?: string; link?: string;
      } }
    ).__AXOM_PRESUBSCRIBE_ABA__);
    expect(transition?.fired).toBe(true);
    expect(transition?.afterB).toBe((transition?.initial ?? 0) + 1);
    expect(transition?.afterA).toBe((transition?.initial ?? 0) + 2);
    expect(transition?.userId).toBe("browser-synthetic-A");
    expect(transition?.link).toBe("linked");
    await expect(page.getByRole("status").filter({ hasText: "Activity History session changed" })).toBeVisible();
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.locator(".grid-stats")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return app.useStore.getState().logs.length;
    })).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  test(`Activity History reconciles a pre-subscription consumer epoch at ${width}px`, async ({ page }) => {
    const note = "SYNTHETIC_CONSUMER_EPOCH_PRIVATE_R143";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await dev(page);
    await page.evaluate(async (privateNote) => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      app.useStore.setState({ logs: [{
        id: "synthetic-consumer-epoch-A", dayKey: "2026-11-14",
        ts: "2026-11-14T18:45:00.000Z", type: "Review",
        minutes: 29, cards: 37, note: privateNote,
      }] });
      await app.flushVault();
    }, note);
    await reloadAfterSave(page);
    await dev(page);
    await setSession(page, "A", "linked");
    await page.goto("/#activity", { waitUntil: "networkidle" });
    await expect(page.getByText(note)).toBeVisible();
    await page.goto("/#productivity", { waitUntil: "networkidle" });

    // Standalone consumer-contract check: a test-local getState shim supplies
    // the missing transition counter without altering production Platform.
    // There is no account/link change or subscribed B event to revoke the view.
    // Removing ActivityHistoryPage's epoch comparisons should make this fail.
    await page.evaluate(async () => {
      type Capture = { fired: boolean; before: number; after: number };
      const w = window as unknown as {
        __AXOM_DEV__: Promise<Dev>;
        __AXOM_CONSUMER_EPOCH__?: Capture;
      };
      const app = await w.__AXOM_DEV__;
      const originalGetState = app.useAccount.getState;
      const originalSubscribe = app.useAccount.subscribe;
      let syntheticEpoch = 7;
      const capture: Capture = { fired: false, before: syntheticEpoch, after: syntheticEpoch };
      w.__AXOM_CONSUMER_EPOCH__ = capture;
      app.useAccount.getState = () => ({ ...originalGetState(), identityEpoch: syntheticEpoch });
      app.useAccount.subscribe = (listener) => {
        if (!capture.fired && document.querySelector('[role="region"][aria-label="Activity History"]')) {
          capture.fired = true;
          capture.before = app.useAccount.getState().identityEpoch ?? -1;
          syntheticEpoch += 2;
          capture.after = app.useAccount.getState().identityEpoch ?? -1;
          app.useAccount.subscribe = originalSubscribe;
        }
        return originalSubscribe(listener);
      };
    });
    await page.goto("/#activity", { waitUntil: "networkidle" });
    const proof = await page.evaluate(async () => {
      const w = window as unknown as {
        __AXOM_DEV__: Promise<Dev>;
        __AXOM_CONSUMER_EPOCH__?: { fired: boolean; before: number; after: number };
      };
      const app = await w.__AXOM_DEV__;
      const current = app.useAccount.getState();
      return { ...w.__AXOM_CONSUMER_EPOCH__, userId: current.user?.id, link: current.link };
    });
    expect(proof.fired).toBe(true);
    expect(proof.before).toBe(7);
    expect(proof.after).toBe(9);
    expect(proof.userId).toBe("browser-synthetic-A");
    expect(proof.link).toBe("linked");
    await expect(page.getByRole("status").filter({ hasText: "Activity History session changed" })).toBeVisible();
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.locator(".grid-stats")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return app.useStore.getState().logs.length;
    })).toBe(1);
    expect(errors).toEqual([]);
  });
}
