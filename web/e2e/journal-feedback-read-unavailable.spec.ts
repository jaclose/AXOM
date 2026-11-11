import { readFile } from "node:fs/promises";
import { expect, seedOnboarded, test } from "./fixtures";
import { DEFAULT_JOURNAL_NOTEBOOK } from "../src/lib/journalNotebook";
import { userIdFromName } from "../src/lib/userIdentity";

test("feedback remains locally recoverable when browser reads fail, then retries without replacing older bytes", async ({ page }) => {
  const browserIssues: string[] = [];
  page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserIssues.push(`${message.type()}: ${message.text()}`);
  });

  await seedOnboarded(page, { journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true } });
  const draftKey = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  });
  const oldDraft = JSON.stringify({
    rating: 3, liked: "The older private browser draft", wantMore: "",
    missing: "", painPoints: "", comment: "",
  });
  await page.evaluate(({ key, old }) => localStorage.setItem(key, old), { key: draftKey, old: oldDraft });

  // Browser state is synthetic and private to the Playwright context. Do not
  // disable the app's vault or tamper with existing user/browser profiles.
  await page.addInitScript((key) => {
    const nativeGet = Storage.prototype.getItem;
    (window as Window & { __axomBlockFeedbackRead?: boolean }).__axomBlockFeedbackRead = true;
    Storage.prototype.getItem = function (storageKey: string) {
      if (this === window.localStorage
        && storageKey.startsWith(key)
        && (window as Window & { __axomBlockFeedbackRead?: boolean }).__axomBlockFeedbackRead)
        throw new Error("Synthetic localStorage read denied");
      return nativeGet.call(this, storageKey);
    };
  }, draftKey);
  await page.goto("/#journal?feedback=1", { waitUntil: "networkidle" });
  expect(await page.evaluate((key) => { try { localStorage.getItem(key); return "readable"; } catch { return "denied"; } }, draftKey)).toBe("denied");
  const dialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  const liked = dialog.getByLabel("What do you like?");
  await expect(liked).toBeEditable();
  await expect(dialog.getByText(/AXOM cannot read saved feedback/)).toBeVisible();
  await liked.fill("An unsaved in-tab recovery draft");
  await expect(dialog.getByRole("button", { name: "Download draft" })).toBeVisible();
  const exportReady = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download draft" }).click();
  const exported = await exportReady;
  expect(exported.suggestedFilename()).toBe("axom-journal-feedback-draft.json");
  const exportedText = await readFile(await exported.path(), "utf8");
  expect(JSON.parse(exportedText).liked).toBe("An unsaved in-tab recovery draft");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(dialog.getByLabel("What do you like?")).toHaveValue("An unsaved in-tab recovery draft");

  // Hash navigation is a same-document SPA route change, unlike page.goto
  // or reload. The Journal page unmounts, but this tab must retain the draft.
  await dialog.getByRole("button", { name: "Not now" }).click();
  await page.evaluate(() => { window.location.hash = "#dashboard"; });
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "#journal"; });
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await expect(dialog.getByLabel("What do you like?")).toHaveValue("An unsaved in-tab recovery draft");

  // Repeated denied reads must retain both focus and private in-tab writing.
  const blockedRetry = dialog.getByRole("button", { name: "Retry reading saved feedback" });
  await blockedRetry.focus();
  await blockedRetry.press("Enter");
  await expect(blockedRetry).toBeFocused();
  await expect(liked).toHaveValue("An unsaved in-tab recovery draft");
  await page.evaluate(() => {
    (window as Window & { __axomBlockFeedbackRead?: boolean }).__axomBlockFeedbackRead = false;
  });
  await dialog.getByRole("button", { name: "Retry reading saved feedback" }).click();
  const state = await page.evaluate((key) => {
    const legacy = localStorage.getItem(key);
    const writerKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((value): value is string => Boolean(value?.startsWith(`${key}:writer:`)));
    return { legacy, writerKeys, writer: writerKeys.length === 1 ? localStorage.getItem(writerKeys[0]) : null };
  }, draftKey);
  expect(state.legacy).toBe(oldDraft);
  expect(state.writerKeys).toHaveLength(1);
  expect(JSON.parse(state.writer ?? "{}").liked).toBe("An unsaved in-tab recovery draft");

  await dialog.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(dialog.getByLabel("What do you like?")).toHaveValue("An unsaved in-tab recovery draft");
  await expect(dialog.getByText("Other saved feedback copies (1)")).toBeVisible();
  await dialog.getByText("Other saved feedback copies (1)").click();
  await expect(dialog.getByRole("button", { name: "Download copy 1" })).toBeVisible();

  for (const [width, theme] of [[320, "light"], [390, "dark"], [1440, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    await expect(dialog.getByLabel("What do you like?")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth, page: document.documentElement.scrollWidth,
      modal: document.querySelector(".journal-feedback-modal")?.getBoundingClientRect().width ?? 0,
    }));
    expect(dimensions.page, `horizontal document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.modal).toBeLessThanOrEqual(width + 1);
  }
  expect(browserIssues).toEqual([]);
  // Explicit Send never clicked; no outbound feedback or account/provider mutation.
});

test("retries a blocked submission receipt read without editing the older feedback", async ({ page }) => {
  const browserIssues: string[] = [];
  page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserIssues.push(`${message.type()}: ${message.text()}`);
  });
  await seedOnboarded(page, { journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true } });
  const draftKey = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  });
  const older = JSON.stringify({
    rating: 4, liked: "A previous private draft", wantMore: "",
    missing: "", painPoints: "", comment: "",
  });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: draftKey, raw: older });
  await page.addInitScript((key) => {
    const originalGet = Storage.prototype.getItem;
    (window as Window & { __axomBlockReceipt?: boolean }).__axomBlockReceipt = true;
    Storage.prototype.getItem = function (storageKey: string) {
      if (this === window.localStorage && storageKey === `${key}:submitted`
        && (window as Window & { __axomBlockReceipt?: boolean }).__axomBlockReceipt)
        throw new Error("Synthetic feedback marker read denied");
      return originalGet.call(this, storageKey);
    };
  }, draftKey);
  await page.goto("/#journal?feedback=1", { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  const liked = dialog.getByLabel("What do you like?");
  await expect(liked).toHaveAttribute("readonly", "");
  const retry = dialog.getByRole("button", { name: "Retry reading saved feedback" });
  await expect(retry).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download saved copy" })).toBeVisible();

  for (const [width, theme] of [[320, "dark"], [390, "light"], [1440, "dark"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    await expect(retry).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      dialog: document.querySelector(".journal-feedback-modal")?.getBoundingClientRect().width ?? 0,
    }));
    expect(dimensions.document, `page overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(dimensions.dialog, `dialog overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
  }

  await page.evaluate(() => {
    (window as Window & { __axomBlockReceipt?: boolean }).__axomBlockReceipt = false;
  });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect(liked).toBeEditable();
  await expect(liked).toHaveValue("A previous private draft");
  await expect(liked).toBeFocused();
  await expect(dialog.getByRole("status")).toHaveText("Saved feedback is readable again.");
  const retained = await page.evaluate((key) => ({
    raw: localStorage.getItem(key),
    writers: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((value) => value?.startsWith(`${key}:writer:`)),
  }), draftKey);
  expect(retained.raw).toBe(older);
  expect(retained.writers).toEqual([]);
  expect(browserIssues).toEqual([]);
  // The test never presses Send and uses no real signed-in account or provider.
});

test("a name-only workspace rename retains in-tab feedback during denied reads", async ({ page }) => {
  const browserIssues: string[] = [];
  page.on("pageerror", (error) => browserIssues.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserIssues.push(message.text());
  });
  await seedOnboarded(page, {
    name: "Journal Rename Before",
    journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true },
  });
  const originalKey = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  });
  const oldDraft = JSON.stringify({
    rating: 3, liked: "Older unchanged private words", wantMore: "",
    missing: "", painPoints: "", comment: "",
  });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: originalKey, raw: oldDraft });
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    (window as Window & { __axomBlockRenameReads?: boolean }).__axomBlockRenameReads = true;
    Storage.prototype.getItem = function (key: string) {
      if (this === window.localStorage && key.startsWith("axom-journal-feedback-draft:")
        && (window as Window & { __axomBlockRenameReads?: boolean }).__axomBlockRenameReads)
        throw new Error("Synthetic feedback read denied across name edit");
      return originalGet.call(this, key);
    };
  });
  await page.goto("/#journal?feedback=1", { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  await expect(dialog.getByLabel("What do you like?")).toBeEditable();
  await dialog.getByLabel("What do you like?").fill("Private feedback written before my display name changed");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await page.evaluate(() => { window.location.hash = "#dashboard"; });
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toHaveCount(0);
  const renamedKey = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => {
        updateProfile: (value: { name: string }) => void;
        profile: { userId: string };
      } };
    }> }).__AXOM_DEV__;
    dev.useStore.getState().updateProfile({ name: "Journal Rename After" });
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  });
  expect(renamedKey).not.toBe(originalKey);
  await page.evaluate(() => { window.location.hash = "#journal"; });
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await expect(dialog.getByLabel("What do you like?"))
    .toHaveValue("Private feedback written before my display name changed");
  await expect(dialog.getByRole("button", { name: "Download draft" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog.getByLabel("What do you like?")).toBeVisible();

  await page.evaluate(() => {
    (window as Window & { __axomBlockRenameReads?: boolean }).__axomBlockRenameReads = false;
  });
  await dialog.getByRole("button", { name: "Retry reading saved feedback" }).click();
  const recovered = await page.evaluate(({ oldKey, newKey }) => {
    const writers = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key) => key?.startsWith(`${newKey}:writer:`));
    return {
      legacy: localStorage.getItem(oldKey),
      writers,
      copy: writers.length === 1 ? localStorage.getItem(writers[0]!) : null,
    };
  }, { oldKey: originalKey, newKey: renamedKey });
  expect(recovered.legacy).toBe(oldDraft);
  expect(recovered.writers).toHaveLength(1);
  expect(JSON.parse(recovered.copy ?? "{}").liked)
    .toBe("Private feedback written before my display name changed");
  expect(browserIssues).toEqual([]);
  // Local synthetic data only. No account session or feedback submission.
});


test("saved feedback from a prior display name remains explicitly recoverable after browser reload", async ({ page }) => {
  await seedOnboarded(page, {
    name: "Journal Rename R24 Before",
    journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true },
  });
  await page.goto("/#journal", { waitUntil: "networkidle" });
  const before = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => {
        profile: { userId: string };
        updateProfile: (value: { name: string }) => void;
      } };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const base = `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
    const saved = JSON.stringify({
      rating: 4, liked: "The earlier name's existing saved feedback.",
      wantMore: "", missing: "", painPoints: "", comment: "",
    });
    localStorage.setItem(base, saved);
    dev.useStore.getState().updateProfile({ name: "Journal Rename R24 After" });
    const renamed = `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
    // This waits for the existing local-first profile persistence gate, not
    // a simulated account/provider save.
    await dev.flushVault();
    return { base, renamed, saved };
  });
  expect(before.renamed).not.toBe(before.base);
  const alias = await page.evaluate((key) => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((item) => item?.startsWith(`${key}:name-alias:v1:`)), before.renamed);
  expect(alias).toHaveLength(1);

  await page.reload({ waitUntil: "networkidle" });
  const ownerAfterReload = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  });
  expect(ownerAfterReload).toBe(before.renamed);
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  await expect(dialog.getByText("Other saved feedback copies (1)")).toBeVisible();
  await dialog.getByText("Other saved feedback copies (1)").click();
  await dialog.getByRole("button", { name: "Open copy 1" }).click();
  await expect(dialog.getByLabel("What do you like?"))
    .toHaveValue("The earlier name's existing saved feedback.");
  const unchanged = await page.evaluate((key) => localStorage.getItem(key), before.base);
  expect(unchanged).toBe(before.saved);
  // No feedback was submitted or migrated. Original writer and saved bytes remain.
});


test("two explicit retries after a partially recovered historical-name alias preserve the original copy", async ({ page }) => {
  const browserIssues: string[] = [];
  page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserIssues.push(`console: ${message.text()}`);
  });
  const firstName = "Journal R29 Original Feedback";
  const middleName = "Journal R29 Middle Feedback";
  const lastName = "Journal R29 Latest Feedback";
  await seedOnboarded(page, {
    name: firstName,
    journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true },
  });
  // The Journal must mount once to install its same-tab rename observer.
  await page.goto("/#journal", { waitUntil: "networkidle" });
  const saved = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    const key = `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
    const raw = JSON.stringify({
      rating: 4, liked: "Unchanged historical feedback after both retries",
      wantMore: "", missing: "", painPoints: "", comment: "",
    });
    localStorage.setItem(key, raw);
    return { key, raw };
  });
  const middleKey = `axom-journal-feedback-draft:${userIdFromName(middleName)}`;
  const lastKey = `axom-journal-feedback-draft:${userIdFromName(lastName)}`;
  expect(new Set([saved.key, middleKey, lastKey]).size).toBe(3);

  // Deny only the intermediate owner-key read. C->B can persist while B->A
  // remains unavailable. The test never clears storage or touches a real user.
  await page.evaluate((blockedKey) => {
    const nativeGet = Storage.prototype.getItem;
    (window as Window & { __axomR29BlockMiddle?: boolean }).__axomR29BlockMiddle = true;
    Storage.prototype.getItem = function (key: string) {
      if (this === window.localStorage && key.startsWith(blockedKey)
        && (window as Window & { __axomR29BlockMiddle?: boolean }).__axomR29BlockMiddle)
        throw new Error("Synthetic intermediate-name read denied");
      return nativeGet.call(this, key);
    };
  }, middleKey);
  const currentKey = await page.evaluate(async ({ middleName: middle, lastName: last }) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => {
        updateProfile: (value: { name: string }) => void;
        profile: { userId: string };
      } };
    }> }).__AXOM_DEV__;
    dev.useStore.getState().updateProfile({ name: middle });
    dev.useStore.getState().updateProfile({ name: last });
    return `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
  }, { middleName, lastName });
  expect(currentKey).toBe(lastKey);

  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  const retry = dialog.getByRole("button", { name: "Retry reading saved feedback" });
  await expect(retry).toBeVisible();
  await retry.focus();
  await retry.press("Enter");
  // First retry must not discard the earlier blocked tail.
  await expect(retry).toBeVisible();
  const partial = await page.evaluate(({ priorKey, middle, current }) => ({
    original: localStorage.getItem(priorKey),
    middleLinks: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key) => key?.startsWith(`${middle}:name-alias:v1:`)),
    currentLinks: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key) => key?.startsWith(`${current}:name-alias:v1:`)),
  }), { priorKey: saved.key, middle: middleKey, current: lastKey });
  expect(partial.original).toBe(saved.raw);
  expect(partial.middleLinks).toHaveLength(0);
  expect(partial.currentLinks).toHaveLength(1);

  await page.evaluate(() => {
    (window as Window & { __axomR29BlockMiddle?: boolean }).__axomR29BlockMiddle = false;
  });
  await retry.focus();
  await retry.press("Enter");
  await expect(dialog.getByText("Other saved feedback copies (1)")).toBeVisible();
  await dialog.getByText("Other saved feedback copies (1)").click();
  await dialog.getByRole("button", { name: "Open copy 1" }).click();
  await expect(dialog.getByLabel("What do you like?"))
    .toHaveValue("Unchanged historical feedback after both retries");
  const recovered = await page.evaluate(({ priorKey, middle }) => ({
    original: localStorage.getItem(priorKey),
    middleLinks: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key) => key?.startsWith(`${middle}:name-alias:v1:`)),
  }), { priorKey: saved.key, middle: middleKey });
  expect(recovered.original).toBe(saved.raw);
  expect(recovered.middleLinks).toHaveLength(1);

  for (const [width, theme] of [[320, "light"], [390, "dark"], [1440, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    await expect(dialog.getByLabel("What do you like?")).toBeVisible();
    const size = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
      modal: document.querySelector(".journal-feedback-modal")?.getBoundingClientRect().width ?? 0,
    }));
    expect(size.page).toBeLessThanOrEqual(size.viewport + 1);
    expect(size.modal).toBeLessThanOrEqual(width + 1);
  }
  expect(browserIssues).toEqual([]);
  // No Send, account session, provider call, deletion or learner-data reset.
});
