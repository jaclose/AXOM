import { test, expect } from "@playwright/test";
import { completeSetup, deferPromisePrompt, QUIET_NUDGES } from "./fixtures";
import type { NoctyriumState } from "../src/lib/types";

// No historical learner archive or signed-in account is involved. This journey
// exercises the Settings consent boundary that the decoder-only tests cannot.
test("future-schema JSON is refused before Replace or Merge and leaves local work intact", async ({ page }) => {
  const baseURL = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187");
  if (baseURL.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(baseURL.hostname)) {
    throw new Error("Synthetic backup recovery tests require an isolated local app.");
  }
  await page.route("**/*", route => new URL(route.request().url()).origin === baseURL.origin
    ? route.continue() : route.abort());
  await page.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, QUIET_NUDGES);

  await page.goto("/?app=1#dashboard", { waitUntil: "networkidle" });
  await completeSetup(page, "Synthetic recovery guard");
  await deferPromisePrompt(page);

  const readEvidence = async () => {
    await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
    return page.evaluate(async () => {
      const app = window as unknown as {
        __AXOM_DEV__: Promise<{
          useStore: { getState: () => NoctyriumState };
          flushVault: () => Promise<void>;
        }>;
      };
      const dev = await app.__AXOM_DEV__;
      await dev.flushVault();
      const state = dev.useStore.getState();
      // Exact synthetic identities and learner evidence, not volatile UI state.
      return {
        owner: state.profile.userId,
        name: state.profile.name,
        terms: state.terms.map(t => t.id),
        tracker: state.tracker.map(t => [t.id, t.passes, t.ankiPasses]),
        questions: state.questions.map(q => [q.id, q.attempts.length]),
        documents: state.documents.map(d => d.id),
        sessions: state.quizSessions.map(s => s.id),
        sets: state.questionSets.map(s => s.id),
      };
    });
  };

  const before = await readEvidence();
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();

  const unexpectedPrompts: string[] = [];
  page.on("dialog", dialog => {
    unexpectedPrompts.push(dialog.message());
    void dialog.dismiss();
  });
  const payload = Buffer.from(JSON.stringify({
    _app: "AXOM",
    schemaVersion: 999999,
    terms: [],
    profile: { name: "THIS MUST NOT REPLACE THE LOCAL PROFILE", userId: "forged-future-owner" },
    questions: [],
    tracker: [],
    futureOnlyLearnerRecords: [{ id: "do-not-discard" }],
  }));

  for (const button of ["Choose backup to restore", "Choose backup to merge"]) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles({
      name: "synthetic-future-axom.json",
      mimeType: "application/json",
      buffer: payload,
    });
    await expect(page.locator(".backup-status[role=status]")).toContainText(
      "Recovery did not finish. This backup uses a newer AXOM data version. Update AXOM before restoring it.",
    );
    expect(unexpectedPrompts).toEqual([]);
    expect(await readEvidence()).toEqual(before);
  }

  await page.reload({ waitUntil: "networkidle" });
  expect(await readEvidence()).toEqual(before);
});
