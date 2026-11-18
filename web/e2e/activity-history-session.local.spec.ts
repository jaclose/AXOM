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
    // Standalone DIRECT must report a skip, while FORGE's explicit integration
    // gate must fail closed if the real Platform producer is absent.
    test.skip(typeof initialEpoch !== "number" && process.env.AXOM_REQUIRE_PLATFORM_EPOCH !== "1",
      "Requires Platform #736 identityEpoch producer; DIRECT-only parent cannot verify A→B→A.");
    expect(initialEpoch, "AXOM_REQUIRE_PLATFORM_EPOCH=1 needs the real numeric Platform producer").toEqual(expect.any(Number));
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
    // Do not turn an absent epoch producer into green CI in a FORGE combined gate.
    test.skip(typeof epoch !== "number" && process.env.AXOM_REQUIRE_PLATFORM_EPOCH !== "1",
      "Platform #736 epoch producer is not present in the standalone DIRECT branch.");
    expect(epoch, "AXOM_REQUIRE_PLATFORM_EPOCH=1 needs the real numeric Platform producer").toEqual(expect.any(Number));

    // Control: retained local A history really is renderable before the race.
    await page.goto("/#activity", { waitUntil: "networkidle" });
    await expect(page.getByText(note)).toBeVisible();
    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await expect(page.getByText(note)).toHaveCount(0);

    // Run A→B→A at History's own layout-effect boundary, before its account
    // listener is registered. This cannot accidentally intercept a different
    // component's subscription after the History DOM has been committed.
    await page.evaluate(async () => {
      type Capture = {
        fired: boolean; initial?: number; afterB?: number; afterA?: number;
        userId?: string; link?: string;
      };
      const w = window as unknown as {
        __AXOM_DEV__: Promise<Dev>;
        __AXOM_ACTIVITY_BEFORE_SUBSCRIBE__?: () => void;
        __AXOM_PRESUBSCRIBE_ABA__?: Capture;
      };
      const app = await w.__AXOM_DEV__;
      const capture: Capture = { fired: false };
      w.__AXOM_PRESUBSCRIBE_ABA__ = capture;
      w.__AXOM_ACTIVITY_BEFORE_SUBSCRIBE__ = () => {
        if (capture.fired) return;
        capture.fired = true;
        delete w.__AXOM_ACTIVITY_BEFORE_SUBSCRIBE__;
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
    // the epoch only to History while the DEV-only layout-effect hook fires.
    // There is no account/link change or B subscription notification; removing
    // both consumer epoch guards should make this case fail.
    await page.evaluate(async () => {
      type Capture = { fired: boolean; before: number; after: number };
      const w = window as unknown as {
        __AXOM_DEV__: Promise<Dev>;
        __AXOM_ACTIVITY_BEFORE_SUBSCRIBE__?: () => void;
        __AXOM_CONSUMER_EPOCH__?: Capture;
      };
      const app = await w.__AXOM_DEV__;
      const originalGetState = app.useAccount.getState;
      let syntheticEpoch = 7;
      const capture: Capture = { fired: false, before: syntheticEpoch, after: syntheticEpoch };
      w.__AXOM_CONSUMER_EPOCH__ = capture;
      app.useAccount.getState = () => ({ ...originalGetState(), identityEpoch: syntheticEpoch });
      w.__AXOM_ACTIVITY_BEFORE_SUBSCRIBE__ = () => {
        if (capture.fired) return;
        capture.fired = true;
        delete w.__AXOM_ACTIVITY_BEFORE_SUBSCRIBE__;
        capture.before = app.useAccount.getState().identityEpoch ?? -1;
        syntheticEpoch += 2;
        capture.after = app.useAccount.getState().identityEpoch ?? -1;
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


// R165: run the actual lazy workbook exporter after device-vault persistence.
// These are synthetic local browser tests, not authenticated Supabase acceptance.
for (const width of [1440, 390]) {
  test(`Activity History refuses rounded XLSX totals after vault reload at ${width}px`, async ({ page }) => {
    const notes = ["SYNTHETIC_R165_INTEGER_0", "SYNTHETIC_R165_INTEGER_1", "SYNTHETIC_R165_INTEGER_2"];
    const counts = [1e16, 5, -1e16];
    const downloads: string[] = [];
    const errors: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", async (dialog) => { await dialog.accept(); });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await dev(page);
    await page.evaluate(async ({ notes, counts }) => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      app.useStore.setState({ logs: counts.map((count, index) => ({
        id: `r165-rounded-${index}`, dayKey: "2026-11-14",
        ts: `2026-11-14T12:0${index}:00.000Z`, type: "Manual",
        minutes: count, cards: count, note: notes[index],
      })) });
      await app.flushVault();
    }, { notes, counts });

    await reloadAfterSave(page);
    await dev(page);
    const storedBefore = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return (app.useStore.getState().logs as Array<{
        id: string; minutes: number; cards: number; note: string;
      }>).map(({ id, minutes, cards, note }) => ({ id, minutes, cards, note }));
    });
    expect(storedBefore).toEqual(counts.map((count, index) => ({
      id: `r165-rounded-${index}`, minutes: count, cards: count, note: notes[index],
    })));

    await setSession(page, "B", "unlinked");
    await page.goto("/#activity", { waitUntil: "networkidle" });
    await expect(page.getByText("Device history needs confirmation")).toBeVisible();
    await page.getByRole("button", { name: "Show device history" }).click();
    await expect(page.getByText(notes[1], { exact: false })).toBeVisible();
    const exportButton = page.getByRole("button", { name: "Export .xlsx" });
    await exportButton.focus();
    await expect(exportButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Activity export stopped", { exact: true })).toBeVisible();
    await expect(page.getByText(/study numbers or totals cannot be represented reliably/i)).toBeVisible();
    await expect(exportButton).toBeEnabled();
    expect(downloads).toEqual([]);

    // A rejected export must not repair, delete, or reassign the original log bytes.
    const storedAfter = await page.evaluate(async () => {
      const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      return (app.useStore.getState().logs as Array<{
        id: string; minutes: number; cards: number; note: string;
      }>).map(({ id, minutes, cards, note }) => ({ id, minutes, cards, note }));
    });
    expect(storedAfter).toEqual(storedBefore);
    await setSession(page, "A", "linked");
    await expect(page.getByText("Activity History session changed")).toBeVisible();
    for (const note of notes) await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("Activity History XLSX roundtrips exactly represented large and fractional totals after reload", async ({ page }) => {
  const notes = ["SYNTHETIC_R165_EXACT_0", "SYNTHETIC_R165_EXACT_1", "SYNTHETIC_R165_EXACT_2"];
  const minutes = [1e16, 4, -1e16];
  const cards = [0.1, 0.2, 0.3];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { await dialog.accept(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await dev(page);
  await page.evaluate(async ({ notes, minutes, cards }) => {
    const app = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    app.useStore.setState({ logs: notes.map((note, index) => ({
      id: `r165-exact-${index}`, dayKey: "2026-11-14",
      ts: `2026-11-14T12:0${index}:00.000Z`, type: "Manual",
      minutes: minutes[index], cards: cards[index], note,
    })) });
    await app.flushVault();
  }, { notes, minutes, cards });
  await reloadAfterSave(page);
  await dev(page);
  await setSession(page, "B", "unlinked");
  await page.goto("/#activity", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Show device history" }).click();
  await expect(page.getByText(notes[0], { exact: false })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .xlsx" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^axom-activity-history-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const XLSX = (await import("xlsx-js-style")).default;
  const { readFile } = await import("node:fs/promises");
  const workbook = XLSX.read(await readFile(await download.path()), { type: "buffer" });
  expect(workbook.Sheets.Overview?.C2?.v).toBe(4);
  expect(workbook.Sheets.Overview?.D2?.v).toBeCloseTo(0.6, 12);
  const detail = workbook.Sheets["All Activity"];
  expect([detail?.D2?.v, detail?.D3?.v, detail?.D4?.v]).toEqual([...minutes].reverse());
  expect([detail?.E2?.v, detail?.E3?.v, detail?.E4?.v]).toEqual([...cards].reverse());
  expect([detail?.F2?.v, detail?.F3?.v, detail?.F4?.v]).toEqual([...notes].reverse());

  await setSession(page, "A", "linked");
  await expect(page.getByText("Activity History session changed")).toBeVisible();
  for (const note of notes) await expect(page.getByText(note)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export .xlsx" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
