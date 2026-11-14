import { readFile, stat } from "node:fs/promises";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

/**
 * Real Chromium download + portable restore, using only fabricated local data.
 * This supplements the existing authorized-private-ZIP acceptance spec, which
 * is intentionally skipped without an explicit AXOM_RESTORE_BACKUP input.
 * No Supabase account, private corpus, cloud write, or hosted service is used.
 */
test("a synthetic complete JSON backup is actually downloaded, opens, restores, and survives reload", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    throw new Error("Portable download acceptance must use an isolated loopback app.");
  }
  const blockExternal = (route: import("@playwright/test").Route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  await context.route("**/*", blockExternal);

  await page.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
  await seedOnboarded(page, { name: "Synthetic portable backup source" });
  const id = "axom-r100-local-export-recovery-sentinel";
  const note = "Only fabricated browser recovery evidence";
  await page.evaluate(async ({ id, note }) => {
    type RecordWithId = { id: string; notes?: string };
    type Dev = {
      useStore: {
        getState: () => { questions: RecordWithId[] };
        setState: (patch: Record<string, unknown>) => void;
      };
      flushVault: () => Promise<void>;
    };
    const { useStore, flushVault } =
      await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const original = useStore.getState().questions.filter(question => question.id !== id);
    useStore.setState({
      questions: [...original, {
        id, notes: note, stem: "Fabricated recovery check",
        source: "manual", correctKey: "A", status: "unseen",
        options: [{ key: "A", text: "Fabricated answer" }],
        tags: [], attempts: [], attachments: [],
        createdAt: "2026-11-14T00:00:00.000Z",
        updatedAt: "2026-11-14T00:00:00.000Z",
      }],
    });
    await flushVault();
  }, { id, note });
  await reloadAfterSave(page);
  await expect.poll(() => page.evaluate(async id => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: { id: string; notes?: string }[] } } }>;
    }).__AXOM_DEV__;
    return dev.useStore.getState().questions.some(question => question.id === id);
  }, id)).toBe(true);

  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  const requestedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export complete backup", exact: true }).click();
  const downloaded = await requestedDownload;
  expect(downloaded.suggestedFilename()).toMatch(/^axom-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadedPath = await downloaded.path();
  if (!downloadedPath) throw new Error("Chromium did not persist the requested backup bytes.");
  const file = await readFile(downloadedPath);
  expect((await stat(downloadedPath)).size).toBe(file.byteLength);
  const content = JSON.parse(file.toString("utf8")) as {
    _backupScope?: string;
    questions?: { id: string; notes?: string }[];
  };
  expect(content._backupScope).toBe("complete");
  expect(content.questions?.filter(question => question.id === id)).toHaveLength(1);
  expect(content.questions?.find(question => question.id === id)?.notes).toBe(note);
  await expect(page.locator(".backup-status")).toContainText("Check that the file exists");

  const recovery = await browser.newContext({ acceptDownloads: true, reducedMotion: "reduce" });
  try {
    await recovery.route("**/*", blockExternal);
    const restored = await recovery.newPage();
    await restored.goto(`${origin}/?app=1#dashboard`, { waitUntil: "networkidle" });
    await seedOnboarded(restored, { name: "Different synthetic recovery target" });
    const readNote = () => restored.evaluate(async id => {
      const dev = await (window as unknown as {
        __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: { id: string; notes?: string }[] } } }>;
      }).__AXOM_DEV__;
      return dev.useStore.getState().questions.find(question => question.id === id)?.notes ?? null;
    }, id);
    // Distinct Chromium profiles must not share the source's local workspace.
    expect(await readNote()).toBeNull();
    await restored.getByTitle("Settings", { exact: true }).click();
    await restored.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
    const chooser = restored.waitForEvent("filechooser");
    await restored.getByRole("button", { name: "Choose backup to restore", exact: true }).click();
    restored.once("dialog", dialog => void dialog.accept());
    await (await chooser).setFiles({
      name: downloaded.suggestedFilename(), mimeType: "application/json", buffer: file,
    });
    await expect(restored.locator(".backup-status")).toContainText("Saved on this device.", { timeout: 60_000 });
    expect(await readNote()).toBe(note);
    await reloadAfterSave(restored);
    expect(await readNote()).toBe(note);
  } finally {
    await recovery.close();
  }
});
