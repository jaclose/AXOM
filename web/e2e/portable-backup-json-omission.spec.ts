import { readFile } from "node:fs/promises";
import type { Page, Route } from "@playwright/test";
import { test, expect, reloadAfterSave, seedOnboarded } from "./fixtures";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const IMAGE_ID = "r110-legacy-json-image";
const QUESTION_ID = "r110-legacy-json-question";
const NOTE = "Fabricated R110 JSON recovery note";
const ATTACHMENT_KEY = "questionAttachmentPayloads";

async function openRecovery(page: Page, mobile = false) {
  if (mobile) {
    // A first-run tour offer is a nonmodal dialog, not a reason for the open
    // mobile drawer to become untappable. Reproduce the delayed offer before
    // opening the drawer with the keyboard so pointer interception is visible.
    const offer = page.getByRole("dialog", { name: "Want a 60-second tour?" });
    await expect(offer).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Open navigation menu" }).focus();
    await page.keyboard.press("Enter");
    await expect(offer).toBeHidden();
    await page.locator(".server-header").click();
    await page.getByRole("combobox", { name: "Settings section" }).selectOption("backup");
  } else {
    await page.getByTitle("Settings", { exact: true }).click();
    await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  }
}

async function chooseBackup(page: Page, name: string, buffer: Buffer, onDialog: (message: string) => boolean) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose backup to restore", exact: true }).click();
  const messages: string[] = [];
  page.once("dialog", dialog => {
    messages.push(dialog.message());
    void (onDialog(dialog.message()) ? dialog.accept() : dialog.dismiss());
  });
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer });
  await expect.poll(() => messages.length).toBe(1);
  return messages[0];
}

async function inspect(page: Page) {
  return page.evaluate(async ({ questionId, imageId }) => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => {
        questions: { id: string; notes?: string; attachments?: { id: string; blobKey?: string }[] }[];
      } } }>;
    }).__AXOM_DEV__;
    const question = dev.useStore.getState().questions.find(q => q.id === questionId);
    const { getQuestionAttachmentBlob } = await import(/* @vite-ignore */ "/src/lib/questionAttachments.ts");
    const bytes = await getQuestionAttachmentBlob(imageId, { localOnly: true });
    return {
      note: question?.notes ?? null,
      attachmentId: question?.attachments?.[0]?.id ?? null,
      attachmentBlobKey: question?.attachments?.[0]?.blobKey ?? null,
      imageBase64: bytes ? btoa(String.fromCharCode(...new Uint8Array(await bytes.blob.arrayBuffer()))) : null,
    };
  }, { questionId: QUESTION_ID, imageId: IMAGE_ID });
}

/**
 * Opening the mobile drawer must never silently accept or dismiss a hidden
 * onboarding offer on Escape. This is distinct from intentionally pressing
 * Escape while the offer is visible. No external API or learner data is used.
 */
test.describe("tour offer and drawer", () => {
  test.use({ quietNudges: false });

  test("mobile drawer Escape retains the hidden guide choice and returns focus", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      throw new Error("Guide keyboard regression requires isolated loopback.");
    }
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + "/?app=1#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(page, { name: "Synthetic guide keyboard target" });
    const offer = page.getByRole("dialog", { name: "Want a 60-second tour?" });
    await expect(offer).toBeVisible({ timeout: 8_000 });
    const readChoice = () => page.evaluate(() => localStorage.getItem("axom.guideOffer.v1"));
    const initialChoice = await readChoice();
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await menu.focus();
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(offer).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    expect(await readChoice()).toBe(initialChoice);
    await expect(offer).toBeVisible();
    // An intentional Escape *while visible* still postpones the tour.
    await page.keyboard.press("Escape");
    await expect(offer).toBeHidden();
    expect(await readChoice()).toBe("snoozed");

    // The one-time re-offer is triggered after cumulative scrolling. Escape
    // while its drawer hides it must not consume that final offer opportunity.
    await page.locator(".surface-scroll").evaluate(scroller => {
      for (const scrollTop of [80, 650, 1390]) {
        scroller.scrollTop = scrollTop;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await expect(offer).toBeVisible();
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(offer).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    expect(await readChoice()).toBe("snoozed");
    await expect(offer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(offer).toBeHidden();
    expect(await readChoice()).toBe("declined");
  });

  test("visible desktop guide intentionally dismisses with Escape", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      throw new Error("Guide keyboard regression requires isolated loopback.");
    }
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + "/?app=1#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(page, { name: "Synthetic desktop guide target" });
    const offer = page.getByRole("dialog", { name: "Want a 60-second tour?" });
    await expect(offer).toBeVisible({ timeout: 8_000 });
    expect(await page.evaluate(() => localStorage.getItem("axom.guideOffer.v1"))).toBeNull();
    await page.keyboard.press("Escape");
    await expect(offer).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("axom.guideOffer.v1"))).toBe("snoozed");
  });
});

/**
 * Real offline Chromium JSON export + preflight + recovery, using fabricated
 * data in isolated browser profiles. No owner backup, cloud account or network.
 * R109 owns the underlying reader/UI; this separate file is a browser-only
 * release regression and is not permission to change R109's source files.
 */
test("an incomplete legacy JSON warns before replacement, cancellation preserves data, and a complete copy restores its image", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    throw new Error("JSON backup browser acceptance requires an isolated loopback app.");
  }
  const blockExternal = (route: Route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  await context.route("**/*", blockExternal);
  await page.goto(origin + "/?app=1#dashboard", { waitUntil: "networkidle" });
  await seedOnboarded(page, { name: "Synthetic legacy JSON source" });

  await page.evaluate(async ({ imageId, questionId, note, base64 }) => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: {
        getState: () => { questions: { id: string }[] };
        setState: (patch: Record<string, unknown>) => void;
      }; flushVault: () => Promise<void> }>;
    }).__AXOM_DEV__;
    const createdAt = "2026-11-15T00:00:00.000Z";
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const attachment = {
      // Historical record: ID is valid, blobKey field did not exist.
      id: imageId, fileName: "fabricated-legacy.png", mimeType: "image/png",
      byteSize: bytes.byteLength, altText: "Fabricated pixel",
      role: "question", createdAt, updatedAt: createdAt,
    };
    const question = {
      id: questionId, stem: "Synthetic media recovery prompt",
      options: [{ key: "A", text: "Synthetic answer" }], correctKey: "A",
      source: "manual", status: "unseen", tags: [], attempts: [], notes: note,
      attachments: [attachment], createdAt, updatedAt: createdAt,
    };
    dev.useStore.setState({
      questions: [...dev.useStore.getState().questions.filter(q => q.id !== questionId), question],
      documents: [], // No originals: request actual JSON rather than ZIP.
    });
    const { putQuestionAttachmentBlob } = await import(/* @vite-ignore */ "/src/lib/questionAttachments.ts");
    await putQuestionAttachmentBlob(imageId, {
      blob: new Blob([bytes], { type: "image/png" }), mimeType: "image/png",
      byteSize: bytes.byteLength, questionId, updatedAt: createdAt,
    });
    await dev.flushVault();
  }, { imageId: IMAGE_ID, questionId: QUESTION_ID, note: NOTE, base64: PNG_BASE64 });
  // Export the actual legacy in-memory record before any hydration routine
  // can normalize its old optional blobKey field to the supported ID fallback.
  const sourceMetadata = await page.evaluate(async questionId => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{ useStore: { getState: () => {
        questions: { id: string; attachments?: { id: string; blobKey?: string }[] }[];
      } } }>;
    }).__AXOM_DEV__;
    return dev.useStore.getState().questions.find(q => q.id === questionId)?.attachments?.[0] ?? null;
  }, QUESTION_ID);
  expect(sourceMetadata).toMatchObject({ id: IMAGE_ID });
  expect(sourceMetadata?.blobKey).toBeUndefined();
  await openRecovery(page);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export complete backup", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^axom-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("Chromium did not persist the complete JSON file.");
  const completeBytes = await readFile(downloadedPath);
  const original = JSON.parse(completeBytes.toString("utf8")) as {
    _backupScope?: string;
    questions: { id: string; attachments?: { id: string; blobKey?: string }[] }[];
    questionAttachmentPayloads: { blobKey: string; base64: string }[];
  };
  expect(original._backupScope).toBe("complete");
  expect(original.questions.find(q => q.id === QUESTION_ID)?.attachments?.[0])
    .toMatchObject({ id: IMAGE_ID });
  expect(original.questions.find(q => q.id === QUESTION_ID)?.attachments?.[0]?.blobKey).toBeUndefined();
  expect(original[ATTACHMENT_KEY]).toEqual([
    expect.objectContaining({ blobKey: IMAGE_ID, base64: PNG_BASE64 }),
  ]);

  const incompleteBytes = Buffer.from(JSON.stringify({ ...original, [ATTACHMENT_KEY]: [] }), "utf8");
  const partialContext = await browser.newContext({
    acceptDownloads: true, reducedMotion: "reduce", viewport: { width: 390, height: 844 },
  });
  const completeContext = await browser.newContext({ acceptDownloads: true, reducedMotion: "reduce" });
  try {
    await partialContext.route("**/*", blockExternal);
    const partialPage = await partialContext.newPage();
    await partialPage.goto(origin + "/?app=1#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(partialPage, { name: "Fresh incomplete JSON target" });
    // Give the recovery target its own fabricated saved data. A cancellation
    // must preserve the *existing* workspace, not merely omit the source item.
    const originalTargetNote = "R110 existing work must survive cancel";
    await partialPage.evaluate(async note => {
      const dev = await (window as unknown as {
        __AXOM_DEV__: Promise<{ useStore: {
          getState: () => { questions: { id: string }[] };
          setState: (patch: Record<string, unknown>) => void;
        }; flushVault: () => Promise<void> }>;
      }).__AXOM_DEV__;
      const createdAt = "2026-11-15T00:00:00.000Z";
      dev.useStore.setState({ questions: [
        ...dev.useStore.getState().questions.filter(q => q.id !== "r110-target-sentinel"),
        { id: "r110-target-sentinel", stem: "Existing synthetic target work",
          options: [{ key: "A", text: "Fabricated" }], correctKey: "A",
          source: "manual", status: "unseen", tags: [], attempts: [],
          notes: note, attachments: [], createdAt, updatedAt: createdAt },
      ] });
      await dev.flushVault();
    }, originalTargetNote);
    await reloadAfterSave(partialPage);
    const readTargetNote = () => partialPage.evaluate(async () => {
      const dev = await (window as unknown as {
        __AXOM_DEV__: Promise<{ useStore: { getState: () => {
          questions: { id: string; notes?: string }[];
        } } }>;
      }).__AXOM_DEV__;
      return dev.useStore.getState().questions.find(q => q.id === "r110-target-sentinel")?.notes ?? null;
    });
    expect(await readTargetNote()).toBe(originalTargetNote);
    expect(await inspect(partialPage)).toMatchObject({ note: null, imageBase64: null });
    await openRecovery(partialPage, true);

    const cancelled = await chooseBackup(partialPage, "missing-legacy-image.json", incompleteBytes, () => false);
    expect(cancelled).toContain("This JSON is incomplete: 1 referenced image attachment(s)");
    expect(cancelled).toContain("their bytes cannot be restored from this copy");
    await expect(partialPage.locator(".backup-status")).toContainText("Restore cancelled. No data changed.");
    expect(await readTargetNote()).toBe(originalTargetNote);
    expect(await inspect(partialPage)).toMatchObject({ note: null, imageBase64: null });

    const approved = await chooseBackup(partialPage, "missing-legacy-image.json", incompleteBytes, () => true);
    expect(approved).toContain("This JSON is incomplete: 1 referenced image attachment(s)");
    await expect(partialPage.locator(".backup-status")).toContainText("Saved on this device.", { timeout: 60_000 });
    await expect(partialPage.locator(".backup-status")).toContainText("This JSON is incomplete");
    expect(await inspect(partialPage)).toMatchObject({
      note: NOTE, attachmentId: IMAGE_ID, imageBase64: null,
    });
    await reloadAfterSave(partialPage);
    expect(await inspect(partialPage)).toMatchObject({
      note: NOTE, attachmentId: IMAGE_ID, imageBase64: null,
    });

    await completeContext.route("**/*", blockExternal);
    const completePage = await completeContext.newPage();
    await completePage.goto(origin + "/?app=1#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(completePage, { name: "Fresh complete JSON target" });
    await openRecovery(completePage);
    const positive = await chooseBackup(completePage, "complete-legacy-image.json", completeBytes, () => true);
    expect(positive).not.toContain("incomplete");
    await expect(completePage.locator(".backup-status")).toContainText("Saved on this device.", { timeout: 60_000 });
    expect(await inspect(completePage)).toMatchObject({
      note: NOTE, attachmentId: IMAGE_ID, imageBase64: PNG_BASE64,
    });
    await reloadAfterSave(completePage);
    expect(await inspect(completePage)).toMatchObject({
      note: NOTE, attachmentId: IMAGE_ID, imageBase64: PNG_BASE64,
    });
  } finally {
    await partialContext.close();
    await completeContext.close();
  }
});
