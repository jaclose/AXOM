import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, seedOnboarded } from "./fixtures";
import { preferences } from "../src/lib/communications/model";
import type { Page } from "@playwright/test";
const out = resolve(import.meta.dirname, "../../artifacts/communications");
mkdirSync(out, { recursive: true });
// Chromium trace snapshots attempt script injection into intentionally script-free frames.
// Keep the security sandbox intact and assert the normal browser console instead.
test.use({ trace: "off" });
const consoleIssues = new WeakMap<Page, string[]>();
const expectedConsoleIssues = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const issues: string[] = []; consoleIssues.set(page, issues);
  page.on("pageerror", error => issues.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) issues.push(message.text()); });
});
test.afterEach(({ page }) => { expect(consoleIssues.get(page)).toEqual(expectedConsoleIssues.get(page) ?? []); });

async function setup(page: Page) {
  let prefs = preferences("America/Grenada").map(p => ({ ...p, enabled: ["weekly_report", "monthly_report", "annual_pulse"].includes(p.category) }));
  let requests: { id: string; kind: string; status: string; scheduled_for?: string }[] = [];
  let campaign: Record<string, unknown> | null = null;
  await page.addInitScript(() => { (window as Window & { __AXOM_E2E_ACCOUNT__?: object }).__AXOM_E2E_ACCOUNT__ = { url: "https://communications-test.supabase.co", key: "synthetic-public-test-key" }; });
  await page.route("https://communications-test.supabase.co/**", async route => {
    const action = new URL(route.request().url()).searchParams.get("action"); const body = route.request().postDataJSON() ?? {};
    let response: unknown = [];
    if (action === "settings") response = { preferences: prefs, identity: { accent: "#c8a96a", theme: "dark" }, history: [{ id: "one", type: "weekly_report", status: "delivered", created_at: "2026-10-04T12:00:00Z" }], privacy: requests, admin: true, deliveryMode: "disabled", deletionEnabled: true, hasProtectedCopy: true };
    else if (action === "preferences") { prefs = body.preferences; response = { saved: true }; }
    else if (action === "unsubscribe-all") { prefs = prefs.map(p => ({ ...p, enabled: false })); response = { saved: true }; }
    else if (action === "pulse") response = { snapshot: null };
    else if (action === "request-export") { requests.push({ id: "export-1", kind: "export", status: "requested" }); response = { requested: true }; }
    else if (action === "request-deletion") { requests.push({ id: "delete-1", kind: "deletion", status: "scheduled", scheduled_for: "2026-10-17T12:00:00Z" }); response = { requested: true }; }
    else if (action === "cancel-deletion") { requests = requests.map(r => r.id === body.id ? { ...r, status: "cancelled" } : r); response = { cancelled: true }; }
    else if (action === "admin") response = { campaigns: campaign ? [campaign] : [], failures: [], deliveryMode: "disabled" };
    else if (action === "campaign-save") { campaign = { ...body, id: "campaign-1", status: "draft", recipient_count: 0 }; response = { id: "campaign-1", content: body.content }; }
    else if (action === "campaign-estimate") response = { eligible: 12, more: false };
    else if (action === "article-publish") response = { published: true };
    else if (action === "broadcast-export") response = { html: "<!doctype html><p>Synthetic Broadcast fixture</p>", text: "Fixture", subject: "Fixture", note: "Test download only" };
    else if (action === "send-test") response = { queued: true };
    else if (action === "campaign-schedule") { campaign = { ...campaign, status: "scheduled", recipient_count: 0 }; response = { scheduled: true }; }
    else if (action === "campaign-cancel") { campaign = { ...campaign, status: "cancelled" }; response = { cancelled: true }; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await seedOnboarded(page, { name: "Alex Morgan", experimentalFlags: { dailyGames: true } });
  await page.evaluate(async () => {
    type Dev = { useStore: { setState: (patch: object) => void; getState: () => { addQuestion: (value: unknown) => { ok: boolean } } }; useAccount: { setState: (patch: object) => void }; flushVault: () => Promise<void> };
    const dev = await (window as Window & { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const logs = Array.from({ length: 90 }, (_, i) => { const date = new Date(Date.UTC(2026, 0, 3 + i * 3)).toISOString(); return { id: `pulse-log-${i}`, dayKey: date.slice(0, 10), ts: date, type: "Study", minutes: 60 + i % 4 * 30, cards: 0, academic: true }; });
    dev.useStore.setState({ questions: [], logs, cardReviews: [], dailyWordPuzzles: [], courses: [{ id: "course-one", name: "Foundations of Clinical Reasoning", code: "FCR", termId: "term", files: 0, modules: [] }] });
    for (let i = 0; i < 400; i++) {
      const month = i % 10; const at = new Date(Date.UTC(2026, month, 1 + Math.floor(i / 10) % 8, 12)).toISOString();
      dev.useStore.getState().addQuestion({ id: `pulse-question-${i}`, stem: `Synthetic practice item ${i}. Select the recorded answer.`, options: [{ key: "A", text: "Option one" }, { key: "B", text: "Option two" }], correctKey: "A", source: "manual", courseId: "course-one", system: i % 2 ? "Cardiovascular" : "Renal", attempts: [{ at, status: (i % 10 < 3 ? i % 3 !== 0 : i % 7 !== 0) ? "correct" : "incorrect", answerKey: "A", mode: "exam" }], tags: [] });
    }
    await dev.flushVault();
    dev.useAccount.setState({ phase: "signed-in", user: { id: "11111111-1111-4111-8111-111111111111", email: "alex@example.invalid", displayName: "Alex Morgan" }, link: "unlinked" });
  });
}
async function captureLightAccent(page: Page, name: string) {
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = "light";
    const modulePath = "/src/lib/palette.ts";
    const { applyPalettePreference } = await import(/* @vite-ignore */ modulePath);
    applyPalettePreference({ id: "amethyst" });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${out}/${name}-light-amethyst.png`, fullPage: true });
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = "dark";
    const modulePath = "/src/lib/palette.ts";
    const { applyPalettePreference } = await import(/* @vite-ignore */ modulePath);
    applyPalettePreference({ id: "classic" });
  });
}
for (const width of [1440, 390]) test(`communications, privacy and Pulse at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", msg => { if (["error", "warning"].includes(msg.type())) errors.push(msg.text()); });
  await setup(page);
  // Follow the app's client-side navigation. This UI fixture uses a stand-in
  // account; a new document deliberately reinitializes real Auth and hydration.
  await page.evaluate(() => { location.hash = "communications"; });
  await expect(page.getByRole("heading", { name: "An inbox with intention." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save preferences", exact: true })).toBeEnabled();
  await page.getByRole("switch", { name: /Essays & Notes/ }).check();
  await page.getByLabel("Email timezone").fill("America/Grenada");
  await page.getByRole("button", { name: "Save preferences", exact: true }).click(); await expect(page.getByText("Email preferences saved.")).toBeVisible();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.querySelector(".surface-scroll")?.scrollTo(0, 0); });
  await page.getByRole("heading", { name: "An inbox with intention." }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/communications-${width}-dark.png`, fullPage: true });
  await captureLightAccent(page, `communications-${width}`);
  await page.getByRole("combobox", { name: "Template", exact: true }).selectOption("pulse"); await expect(page.frameLocator('iframe[title="AXOM email preview"]').getByRole("heading", { level: 1 })).toContainText("this was your year");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download this email preview" }).click(); expect((await download).suggestedFilename()).toBe("axom-pulse.html");
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await page.screenshot({ path: `${out}/email-pulse-${width}-light.png`, fullPage: true });
  await page.getByRole("button", { name: "Unsubscribe from all optional emails" }).click(); await expect(page.getByRole("switch", { name: /^Weekly Report/ })).not.toBeChecked();
  await page.getByRole("link", { name: "Privacy & Data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your data stays yours." })).toBeVisible();
  await page.getByRole("button", { name: "Request account export" }).click(); await expect(page.getByText("Account export requested.", { exact: false })).toBeVisible();
  const localBackup = page.waitForEvent("download"); await page.getByRole("button", { name: "Download local backup" }).click(); await localBackup;
  await page.getByRole("button", { name: "Delete account", exact: true }).click(); await expect(page.getByRole("heading", { name: "Would you like a copy first?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue without backup" }).click(); await page.getByLabel("Type DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT");
  await page.getByRole("button", { name: "Schedule deletion in 7 days" }).click(); await page.getByRole("button", { name: "Cancel deletion" }).click(); await expect(page.getByText("Deletion cancelled.", { exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Your data stays yours." }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/privacy-${width}.png`, fullPage: true });
  await captureLightAccent(page, `privacy-${width}`);
  await page.getByRole("link", { name: "Email preferences", exact: true }).click(); await page.getByRole("link", { name: /AXOM Pulse/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alex, this");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; window.scrollTo(0, 0); });
  await page.screenshot({ path: `${out}/pulse-hero-${width}-dark.png` });
  await page.getByRole("button", { name: "Read your record" }).click(); await expect(page.getByRole("heading", { name: "Small sessions. A substantial year." })).toBeVisible();
  for (const section of await page.locator(".pulse-reveal").all()) await section.scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Include my name on the share card")).not.toBeChecked();
  const cardDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download card" }).click(); const card = await cardDownload; await card.saveAs(`${out}/pulse-share-${width}.png`);
  await page.getByRole("button", { name: "Copy image", exact: true }).click(); await expect(page.getByRole("status")).toContainText(/copied|unavailable/);
  await page.evaluate(() => Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true }));
  const shareDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Share", exact: true }).click(); await shareDownload;
  await page.getByLabel("Include my name on the share card").check();
  const jsonDownload = page.waitForEvent("download"); await page.getByRole("button", { name: /Download the underlying record/ }).click(); expect((await jsonDownload).suggestedFilename()).toContain(".json");
  await page.getByText("What this record can tell you").click();
  const captureStyle = await page.addStyleTag({ content: "html,body,#root{height:auto!important;overflow:visible!important}.pulse-page{overflow:visible!important}" });
  await page.screenshot({ path: `${out}/pulse-full-${width}-dark.png`, fullPage: true });
  await captureStyle.evaluate(el => el.remove());
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; window.scrollTo(0, 0); });
  await page.locator(".pulse-top").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/pulse-hero-${width}-light.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("studio previews, validates an audience and schedules only after explicit review", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await setup(page);
  await page.evaluate(() => { location.hash = "communications-admin"; });
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("The work between the answers");
  await page.getByLabel("Short excerpt").fill("Medicine asks us to make room for uncertainty. A note on attention, revision and returning to difficult ideas.");
  await page.getByLabel("Full essay").fill("Progress rarely arrives as a single moment. It takes shape in the return.\n\nThis is a synthetic design and workflow fixture, not a published essay.");
  await page.getByLabel("Subject", { exact: true }).fill("A note on the work of learning, {{firstName}}");
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByLabel("Subject", { exact: true }).fill("{{unsupported}}"); await expect(page.getByRole("alert")).toContainText("Unsupported template variable");
  await page.getByLabel("Subject", { exact: true }).fill("A note on the work of learning, {{firstName}}");
  await page.getByLabel("Type PUBLISH ESSAY").fill("PUBLISH ESSAY"); await page.getByRole("button", { name: "Publish essay", exact: true }).click(); await expect(page.getByText("Essay published. The email is still a draft.", { exact: true })).toBeVisible();
  const broadcast = page.waitForEvent("download"); await page.getByRole("button", { name: "Export for Resend Broadcasts" }).click(); expect((await broadcast).suggestedFilename()).toContain("axom-resend-broadcast");
  await page.getByRole("button", { name: "Review audience" }).click(); await expect(page.getByText(/12 eligible recipients/)).toBeVisible();
  await page.getByRole("button", { name: "Queue a test" }).click(); await expect(page.getByText("Test queued for your allowlisted account.", { exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Something worth sending." }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/studio-desktop.png`, fullPage: true });
  await captureLightAccent(page, "studio-1440");
  await page.getByRole("combobox", { name: "Width", exact: true }).selectOption("mobile"); await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await page.getByLabel("Send at (your local time)").fill("2027-01-02T08:00"); await page.getByLabel("Type SCHEDULE EMAIL").fill("SCHEDULE EMAIL");
  await page.getByRole("button", { name: "Schedule email", exact: true }).click(); await expect(page.getByText("Campaign scheduled.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel remaining" }).click(); await expect(page.getByText("Remaining queued messages cancelled.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Something worth sending." }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${out}/studio-mobile.png` });
  await captureLightAccent(page, "studio-390");
});

test("Pulse remains readable with motion enabled and without history", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" }); await seedOnboarded(page, { name: "New learner" });
  await page.evaluate(async () => { const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { setState: (p: object) => void } }> }).__AXOM_DEV__; dev.useStore.setState({ questions: [], logs: [], cardReviews: [], dailyWordPuzzles: [] }); location.hash = "pulse?year=2026"; });
  const hero = page.locator(".pulse-hero-copy");
  await expect(hero).toHaveAttribute("data-optical-active", "true");
  expect(await hero.evaluate(el => getComputedStyle(el, "::after").animationPlayState)).toBe("running");
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  expect(await hero.evaluate(el => getComputedStyle(el, "::after").animationPlayState)).toBe("paused");
  await page.getByRole("button", { name: "Resume motion", exact: true }).click();
  const before = await hero.evaluate(el => getComputedStyle(el, "::after").transform);
  await expect.poll(() => hero.evaluate(el => getComputedStyle(el, "::after").transform)).not.toBe(before);
  await page.evaluate(() => { document.documentElement.dataset.motion = "reduce"; });
  expect(await hero.evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("none");
  await page.evaluate(() => { delete document.documentElement.dataset.motion; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await hero.evaluate(el => getComputedStyle(el, "::after").display)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("heading", { name: "Your record is beginning." })).toBeAttached(); await page.getByRole("button", { name: "Read your record" }).click();
  await expect(hero).toHaveAttribute("data-optical-active", "false");
  expect(await hero.evaluate(el => getComputedStyle(el, "::after").animationPlayState)).toBe("paused"); await expect(page.getByRole("heading", { name: "Your record is beginning." })).toBeVisible();
  expect(await page.locator(".pulse-page").evaluate(e => e.querySelectorAll(".pulse-number").length)).toBe(0);
});

test("failed deletion stays reviewable and privacy controls remain keyboard reachable", async ({ page }) => {
  // Chromium reports the deliberately injected HTTP rejection even though the UI handles it.
  expectedConsoleIssues.set(page, ["Failed to load resource: the server responded with a status of 403 (Forbidden)"]);
  await setup(page); await page.evaluate(() => { location.hash = "privacy"; });
  await page.route("**/functions/v1/communications?action=request-deletion", route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Sign in again to confirm." }) }));
  await page.getByRole("button", { name: "Delete account", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Continue without backup" }).click(); await page.getByLabel("Type DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT");
  await page.getByRole("button", { name: "Schedule deletion in 7 days" }).click();
  await expect(page.getByText("Sign in again to confirm.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm account deletion" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
});

test("privacy warns about omitted backup media and clears the warning after a complete retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(() => { location.hash = "privacy"; });
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: Array<{ id: string } & Record<string, unknown>> }; setState: (patch: object) => void }; useAccount: { setState: (patch: object) => void }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    dev.useAccount.setState({ phase: "signed-in", user: { id: "11111111-1111-4111-8111-111111111111", email: "alex@example.invalid", displayName: "Alex Morgan" }, link: "unlinked" });
    const questions = dev.useStore.getState().questions;
    dev.useStore.setState({ questions: [{ ...questions[0], attachments: [{ id: "missing-backup-media", blobKey: "missing-backup-media", fileName: "synthetic.png", mimeType: "image/png", byteSize: 68, altText: "Synthetic fixture", createdAt: "2026-10-13T12:00:00Z", updatedAt: "2026-10-13T12:00:00Z" }] }, ...questions.slice(1)] });
    await dev.flushVault();
  });
  const incompleteDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local backup", exact: true }).click();
  const incompletePath = await (await incompleteDownload).path();
  expect(incompletePath).toBeTruthy();
  const incomplete = JSON.parse(readFileSync(incompletePath!, "utf8"));
  expect(incomplete.questions[0].attachments[0].blobKey).toBe("missing-backup-media");
  await expect(page.getByRole("alert")).toContainText("1 image attachment is missing");
  await expect(page.getByRole("alert")).toContainText("Keep this device and your original files");
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${out}/privacy-incomplete-backup-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${out}/privacy-incomplete-backup-1440-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Continue without backup" }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator("form").getByRole("alert")).toContainText("1 image attachment is missing");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { questions: Array<{ id: string }> } } }> }).__AXOM_DEV__;
    const modulePath = "/src/lib/questionAttachments.ts";
    const { putQuestionAttachmentBlob } = await import(/* @vite-ignore */ modulePath);
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII="), char => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    await putQuestionAttachmentBlob("missing-backup-media", { blob, mimeType: "image/png", byteSize: blob.size, questionId: dev.useStore.getState().questions[0].id, updatedAt: "2026-10-13T12:00:00Z" });
  });
  const completeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local backup", exact: true }).focus();
  await page.getByRole("button", { name: "Download local backup", exact: true }).press("Enter");
  const completePath = await (await completeDownload).path();
  expect(completePath).toBeTruthy();
  const complete = readFileSync(completePath!, "utf8");
  expect(complete).toContain("iVBORw0KGgoAAAANSUhEUg");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Local backup downloaded." })).toContainText("Includes 1 image attachment.");
});

test("public essay uses the published canonical record and recovers from an unavailable link", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { (window as Window & { __AXOM_E2E_ACCOUNT__?: object }).__AXOM_E2E_ACCOUNT__ = { url: "https://communications-test.supabase.co", key: "synthetic-public-test-key" }; });
  await page.route("https://communications-test.supabase.co/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(route.request().url().includes("published-fixture") ? { title: "The work between the answers", excerpt: "A synthetic canonical article fixture.", body: "Progress takes shape in the return.\n\nThis is a browser acceptance fixture, not a published essay.", reading_minutes: 6 } : null) }));
  await page.goto("/#essay?id=published-fixture"); await expect(page.getByRole("heading", { level: 1 })).toHaveText("The work between the answers");
  await page.screenshot({ path: `${out}/essay-desktop.png`, fullPage: true });
  await captureLightAccent(page, "essay-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByRole("heading", { level: 1 })).toHaveText("The work between the answers");
  await page.screenshot({ path: `${out}/essay-mobile.png`, fullPage: true });
  await captureLightAccent(page, "essay-390");
  await page.evaluate(() => { location.hash = "essay?id=missing-fixture"; }); await expect(page.getByRole("alert")).toContainText("not published yet"); await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
});
