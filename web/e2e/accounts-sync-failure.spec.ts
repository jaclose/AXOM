import type { Page, Route } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";

/**
 * The production failure of 2026-09-30, replayed in a real browser against a
 * stand-in account backend (every request is answered here; nothing leaves the
 * machine). The account refused each upload as HTTP 500 / SQLSTATE 54000 and
 * the app re-sent the whole workspace: after every local change, and on a
 * one-minute clock. It must now send it once, say why, and recover by itself.
 */
const ACCOUNT_URL = "https://axom-e2e.invalid";
const USER_ID = "8f1d7a52-3c44-4f0e-9d3a-5b1f0c7e2a11";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const HISTORY_FULL = { code: "54000", details: null, hint: null, message: "workspace snapshot storage limit reached; reduce the snapshot size before syncing" };

type Answer = (route: Route) => Promise<void>;
const json = (status: number, body: unknown): Answer => (route) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });

async function standInAccount(page: Page, push: { answer: Answer; bodies: Array<Record<string, unknown>> }) {
  const unexpected: string[] = [];
  await page.addInitScript(({ url, userId }) => {
    (window as unknown as { __AXOM_E2E_ACCOUNT__: unknown }).__AXOM_E2E_ACCOUNT__ = { url, key: "sb_publishable_e2e" };
    const user = { id: userId, aud: "authenticated", role: "authenticated", email: "learner@example.com", email_confirmed_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", user_metadata: { display_name: "E2E Learner" }, app_metadata: {} };
    localStorage.setItem("sb-axom-e2e-auth-token", JSON.stringify({ access_token: "e2e-access", refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400, user }));
    // What the affected device held: linked, a day behind, upload pending, old retry counter at its cap.
    if (!localStorage.getItem("axom.sync.metadata.v1")) {
      localStorage.setItem("axom.sync.metadata.v1", JSON.stringify({
        deviceId: "0b0e3a1c-7c1d-4e0a-9a53-0f6d2f1f5e10", accountUserId: userId, baseRevision: 71, pending: true,
        pendingIdempotencyKey: "5f0c7e2a-3c44-4f0e-9d3a-8f1d7a520001", attempt: 6, lastProtectedAt: new Date(Date.now() - 86_400_000).toISOString(),
      }));
    }
  }, { url: ACCOUNT_URL, userId: USER_ID });
  await page.route(`${ACCOUNT_URL}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (path === "/rest/v1/rpc/push_workspace_revision") {
      push.bodies.push(request.postDataJSON() as Record<string, unknown>);
      return push.answer(route);
    }
    if (path === "/rest/v1/rpc/touch_account_device") return route.fulfill({ status: 204, headers: CORS });
    if (path === "/rest/v1/account_profiles") return json(200, { display_name: "E2E Learner" })(route);
    if (path === "/rest/v1/workspace_revisions" || path === "/rest/v1/account_devices") return json(200, [])(route);
    unexpected.push(`${request.method()} ${path}`);
    return json(404, { message: "not part of the stand-in account" })(route);
  });
  return unexpected;
}

async function changeWorkspace(page: Page, title: string) {
  await page.evaluate(async (taskTitle) => {
    type Dev = { useStore: { getState: () => { tasks: unknown[] }; setState: (patch: Record<string, unknown>) => void } };
    const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    useStore.setState({ tasks: [...useStore.getState().tasks, { id: `e2e-${taskTitle}`, title: taskTitle, done: false, created: new Date().toISOString() }] });
  }, title);
}

const statusDot = (page: Page) => page.getByTitle("Account and protection");

test("a refused account upload is sent once, explained, and recovers", async ({ page }) => {
  test.setTimeout(120_000);
  const push = { answer: json(500, HISTORY_FULL), bodies: [] as Array<Record<string, unknown>> };
  const unexpected = await standInAccount(page, push);
  await seedOnboarded(page);

  // One upload resumes the pending save; the account refuses it.
  await expect(statusDot(page)).toHaveAttribute("data-status", "blocked", { timeout: 20_000 });
  const sentAtRefusal = push.bodies.length;
  expect(sentAtRefusal).toBeGreaterThanOrEqual(1);
  expect(push.bodies[0]).toMatchObject({ p_base_revision: 71, p_reason: "automatic", p_idempotency_key: "5f0c7e2a-3c44-4f0e-9d3a-8f1d7a520001" });

  // The old client sent the workspace again 8 s after any change and on a
  // 1 s to 60 s clock. Local changes, a reconnect and a reload now send nothing.
  await changeWorkspace(page, "first change after the refusal");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(10_000);
  await changeWorkspace(page, "second change after the refusal");
  await page.reload({ waitUntil: "networkidle" });
  await expect(statusDot(page)).toHaveAttribute("data-status", "blocked");
  await page.waitForTimeout(3_000);
  expect(push.bodies.length).toBe(sentAtRefusal);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("axom.sync.metadata.v1") ?? "{}"));
  expect(stored).toMatchObject({ pending: true, lastError: { kind: "rejected", rejection: "storage-limit", status: 500, code: "54000" } });
  expect(Date.parse(stored.nextAttemptAt) - Date.now()).toBeGreaterThan(50 * 60_000);
  expect(JSON.stringify(stored)).not.toContain("storage limit");

  // Settings says what happened in plain words, with the codes behind the disclosure.
  await statusDot(page).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Not protected").first()).toBeVisible();
  const detail = panel.locator(".account-protection-detail");
  await expect(detail).toContainText("version history is full");
  await expect(detail).toContainText("Your work is saved on this device.");
  await expect(detail).toContainText("tries again by itself around");
  await panel.getByText("Technical details").click();
  await expect(panel.getByText(/Last upload failed .*refused \(storage-limit\), HTTP 500, code 54000\./)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  // "Try again" is the learner's call. Still refused: exactly one more upload.
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => push.bodies.length).toBe(sentAtRefusal + 1);
  await expect(detail).toContainText("version history is full");

  // The account is repaired (migration 20261001090000): the same button protects the workspace.
  push.answer = json(200, { status: "accepted", revision: 72, revision_id: "7a520001-3c44-4f0e-9d3a-8f1d5f0c7e2a", idempotent: false });
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.locator(".account-protection b")).toHaveText("Protected");
  await expect(panel.locator(".account-protection-detail")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Protect now" })).toBeVisible();
  expect(push.bodies.at(-1)).toMatchObject({ p_base_revision: 71, p_reason: "manual" });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(statusDot(page)).toHaveAttribute("data-status", "protected");
  expect(unexpected).toEqual([]);
});

test("a large profile photo is stored at display size", async ({ page }) => {
  await seedOnboarded(page);
  const before = await page.evaluate(async () => {
    // A noisy 1600 x 1200 PNG: about the weight of a phone photo, and it does not compress.
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 1) image.data[index] = index % 4 === 3 ? 255 : (index * 2_654_435_761) % 251;
    context.putImageData(image, 0, 0);
    const photo = canvas.toDataURL("image/png");
    type Dev = { useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } } };
    const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    useStore.getState().updateProfile({ avatarDataUrl: photo });
    return photo.length;
  });
  expect(before).toBeGreaterThan(500_000);

  const stored = () => page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { profile: { avatarDataUrl?: string } } } };
    const { useStore } = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return useStore.getState().profile.avatarDataUrl ?? "";
  });
  await expect.poll(async () => (await stored()).length).toBeLessThan(120_000);
  const size = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, await stored());
  expect(size).toEqual({ width: 341, height: 256 });
  // The sidebar shows the stored photo.
  await expect(page.locator(".user-id .avatar img")).toHaveJSProperty("naturalHeight", 256);
});
