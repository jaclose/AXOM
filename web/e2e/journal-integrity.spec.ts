import { expect, seedOnboarded, test } from "./fixtures";
import type { Page } from "@playwright/test";

const feedbackPrefix = "axom-journal-feedback-draft:";

function recordBrowserIssues(tab: Page, issues: string[]) {
  tab.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  tab.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      issues.push(`${message.type()}: ${message.text()}`);
  });
}

test("two Chromium tabs retain both feedback drafts during an interleaved write", async ({ page, context }) => {
  const browserIssues: string[] = [];
  recordBrowserIssues(page, browserIssues);
  context.on("page", (tab) => { if (tab !== page) recordBrowserIssues(tab, browserIssues); });
  await seedOnboarded(page);
  const { key, initialRaw, competingRaw } = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { profile: { userId: string } } };
    }> }).__AXOM_DEV__;
    const key = `axom-journal-feedback-draft:${dev.useStore.getState().profile.userId}`;
    const draft = { rating: 4, liked: "Original private draft", wantMore: "", missing: "", painPoints: "", comment: "" };
    const initialRaw = JSON.stringify(draft);
    const competingRaw = JSON.stringify({ ...draft, liked: "Newer private revision from tab B", __axomRevision: "b".repeat(32) });
    localStorage.setItem(key, initialRaw);
    return { key, initialRaw, competingRaw };
  });

  await page.goto("/#journal?feedback=1");
  const firstDialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  await expect(firstDialog.getByLabel("What do you like?")).toHaveValue("Original private draft");

  // A real second tab shares this Chromium context's origin storage. Its
  // Storage API runs between tab A's read and write, without a network service.
  const secondTabPromise = page.waitForEvent("popup");
  await page.evaluate(() => {
    const otherTab = window.open("/#journal?feedback=1", "journal-feedback-interleaving-tab");
    if (!otherTab) throw new Error("Chromium blocked the second Journal tab.");
    (window as Window & { __journalOtherTab?: Window }).__journalOtherTab = otherTab;
  });
  const secondTab = await secondTabPromise;
  await expect(secondTab.getByRole("dialog", { name: "How is the journal feeling?" })
    .getByLabel("What do you like?")).toHaveValue("Original private draft");
  expect(secondTab.context()).toBe(context);

  await page.evaluate(({ draftKey, competing }) => {
    const owner = window as Window & { __journalOtherTab?: Window; __journalInterleaved?: boolean };
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (!owner.__journalInterleaved && this === window.localStorage
        && name.startsWith(draftKey) && name !== `${draftKey}:submitted`) {
        owner.__journalInterleaved = true;
        if (!owner.__journalOtherTab) throw new Error("Second Journal tab is missing.");
        owner.__journalOtherTab.localStorage.setItem(draftKey, competing);
      }
      return originalSetItem.call(this, name, value);
    };
  }, { draftKey: key, competing: competingRaw });

  const firstEdit = "Tab A's private interleaved revision";
  await firstDialog.getByLabel("What do you like?").fill(firstEdit);
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as Window & { __journalInterleaved?: boolean }).__journalInterleaved))).toBe(true);
  await expect(firstDialog.getByLabel("What do you like?")).toHaveValue(firstEdit);

  const saved = await page.evaluate((draftKey) => {
    const entries: Array<{ key: string; raw: string }> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(draftKey) && key !== `${draftKey}:submitted`)
        entries.push({ key, raw: localStorage.getItem(key) ?? "" });
    }
    return { legacy: localStorage.getItem(draftKey), entries };
  }, key);
  expect(initialRaw).not.toBe(competingRaw);
  expect(saved.legacy).toBe(competingRaw);
  expect(saved.entries.some((entry) => {
    if (entry.key === key) return false;
    try { return (JSON.parse(entry.raw) as { liked?: string }).liked === firstEdit; }
    catch { return false; }
  })).toBe(true);
  expect(saved.entries.some((entry) => entry.raw === competingRaw)).toBe(true);
  expect(saved.entries.every((entry) => entry.key.startsWith(feedbackPrefix))).toBe(true);
  await secondTab.close();

  await page.reload({ waitUntil: "networkidle" });
  const reopened = page.getByRole("dialog", { name: "How is the journal feeling?" });
  await expect(reopened.getByLabel("What do you like?"))
    .toHaveValue("Newer private revision from tab B");
  await reopened.getByText("Other saved feedback copies (1)", { exact: true }).click();
  await reopened.getByRole("button", { name: "Open copy 1" }).click();
  await expect(reopened.getByLabel("What do you like?")).toHaveValue(firstEdit);
  expect(browserIssues).toEqual([]);
});

test("two mounted tabs can edit and reopen their own private feedback copies", async ({ page, context }) => {
  const browserIssues: string[] = [];
  recordBrowserIssues(page, browserIssues);
  context.on("page", (tab) => { if (tab !== page) recordBrowserIssues(tab, browserIssues); });
  await seedOnboarded(page);
  await page.goto("/#journal?feedback=1");
  const firstDialog = page.getByRole("dialog", { name: "How is the journal feeling?" });
  const firstInput = firstDialog.getByLabel("What do you like?");
  const firstDraft = "Tab A keeps its own quiet revision";
  const secondDraft = "Tab B keeps a different private revision";
  const finalFirstDraft = "Tab A's final private revision";
  await firstInput.fill(firstDraft);
  await expect.poll(() => page.evaluate(() => {
    const copies: Array<{ key: string; raw: string }> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("axom-journal-feedback-draft:"))
        copies.push({ key, raw: localStorage.getItem(key) ?? "" });
    }
    return copies;
  })).toEqual(expect.arrayContaining([expect.objectContaining({ raw: expect.stringContaining(firstDraft) })]));

  const secondTabPromise = page.waitForEvent("popup");
  await page.evaluate(() => {
    if (!window.open("/#journal?feedback=1", "journal-feedback-ui-second-tab"))
      throw new Error("Chromium blocked the second Journal tab.");
  });
  const secondTab = await secondTabPromise;
  expect(secondTab.context()).toBe(context);
  const secondInput = secondTab.getByRole("dialog", { name: "How is the journal feeling?" })
    .getByLabel("What do you like?");
  await expect(secondInput).toHaveValue(firstDraft);
  await secondInput.fill(secondDraft);
  await expect.poll(() => secondTab.evaluate((text) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("axom-journal-feedback-draft:") || !key.includes(":writer:")) continue;
      try { if ((JSON.parse(localStorage.getItem(key) ?? "") as { liked?: string }).liked === text) return true; }
      catch { /* Keep checking other saved copies. */ }
    }
    return false;
  }, secondDraft)).toBe(true);

  await firstInput.fill(finalFirstDraft);
  await expect.poll(() => page.evaluate(() => {
    const copies: Array<{ key: string; liked: string }> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("axom-journal-feedback-draft:") || !key.includes(":writer:")) continue;
      try {
        const liked = (JSON.parse(localStorage.getItem(key) ?? "") as { liked?: unknown }).liked;
        if (typeof liked === "string") copies.push({ key, liked });
      } catch { /* An unrelated unreadable copy must not hide these valid copies. */ }
    }
    return copies;
  })).toEqual(expect.arrayContaining([
    expect.objectContaining({ liked: finalFirstDraft }),
    expect.objectContaining({ liked: secondDraft }),
  ]));
  await secondTab.close();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("dialog", { name: "How is the journal feeling?" })
    .getByRole("button", { name: "Not now" }).click();
  const setup = page.getByRole("dialog", { name: "Make this notebook yours" });
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Feedback" }).click();
  const reopened = page.getByRole("dialog", { name: "How is the journal feeling?" });
  const reopenedInput = reopened.getByLabel("What do you like?");
  const openedText = await reopenedInput.inputValue();
  expect([finalFirstDraft, secondDraft]).toContain(openedText);
  await reopened.getByText("Other saved feedback copies (1)", { exact: true }).click();
  await reopened.getByRole("button", { name: "Open copy 1" }).click();
  const recoveredText = await reopened.getByLabel("What do you like?").inputValue();
  expect(new Set([openedText, recoveredText])).toEqual(new Set([finalFirstDraft, secondDraft]));
  expect(browserIssues).toEqual([]);
});

test("local A draft stays hidden through A to B to A without a hydration receipt", async ({ page }) => {
  const browserIssues: string[] = [];
  recordBrowserIssues(page, browserIssues);
  // Synthetic account identities remain local to this browser test. All
  // non-local requests are blocked so this cannot submit or sync learner data.
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1") await route.continue();
    else await route.abort();
  });
  await seedOnboarded(page);
  const originalId = "journal-browser-A-original-id";
  await page.evaluate(async (id) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => {
        addJournal: (entry: Record<string, unknown>) => void;
      } };
      flushVault: () => Promise<void>;
    }> }).__AXOM_DEV__;
    const date = new Date();
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")].join("-");
    dev.useStore.getState().addJournal({ id, date: `${day}T12:00:00`, today: "A saved page",
      tomorrow: "", blockers: "", energy: "Medium", rating: "Useful",
      freeWriting: "A saved private line", notebookStatus: "draft" });
    await dev.flushVault();
  }, originalId);

  await page.evaluate(() => { location.hash = "#journal"; });
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();
  await page.getByRole("button", { name: "Write full page" }).click();
  const unsavedA = "A's newer in-tab private writing";
  await page.getByLabel("Free writing").fill(unsavedA);

  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useAccount: { setState: (patch: Record<string, unknown>) => void };
    }> }).__AXOM_DEV__;
    dev.useAccount.setState({ phase: "signed-in", link: "unlinked", protection: "local-only",
      user: { id: "journal-browser-account-A", email: "a@example.invalid", displayName: "A", emailConfirmed: true } });
  });
  await expect(page.getByRole("heading", { name: "Journal paused" })).toBeVisible();
  await expect(page.getByLabel("Free writing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } };
      useAccount: { setState: (patch: Record<string, unknown>) => void };
    }> }).__AXOM_DEV__;
    dev.useAccount.setState({ phase: "signed-in", link: "unlinked", protection: "local-only",
      user: { id: "journal-browser-account-B", email: "b@example.invalid", displayName: "B", emailConfirmed: true } });
    dev.useStore.getState().updateProfile({ name: "Journal Browser B" });
  });
  await expect(page.getByRole("heading", { name: "Journal paused" })).toBeVisible();
  await expect(page.getByLabel("Free writing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await page.evaluate(async (id) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { updateJournal: (id: string, patch: Record<string, unknown>) => void } };
    }> }).__AXOM_DEV__;
    dev.useStore.getState().updateJournal(id, { today: "A delayed save after B sign-in" });
  }, originalId);
  await expect(page.getByRole("heading", { name: "Journal paused" })).toBeVisible();
  await expect(page.getByText("A saved private line")).toHaveCount(0);
  await expect(page.getByLabel("Free writing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  // Returning to A also waits for authoritative workspace activation. A
  // changed array alone cannot identify who owns the hydrated notebook.
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } };
      useAccount: { setState: (patch: Record<string, unknown>) => void };
    }> }).__AXOM_DEV__;
    dev.useAccount.setState({ phase: "signed-in", link: "unlinked", protection: "local-only",
      user: { id: "journal-browser-account-A", email: "a@example.invalid", displayName: "A", emailConfirmed: true } });
    dev.useStore.getState().updateProfile({ name: "AXOM E2E" });
  });
  await expect(page.getByRole("heading", { name: "Journal paused" })).toBeVisible();
  await expect(page.getByLabel("Free writing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  const savedId = await page.evaluate(async (id) => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      useStore: { getState: () => { journal: Array<{ id: string }> } };
    }> }).__AXOM_DEV__;
    return dev.useStore.getState().journal.find((entry) => entry.id === id)?.id;
  }, originalId);
  expect(savedId).toBe(originalId);
  expect(browserIssues).toEqual([]);
});
