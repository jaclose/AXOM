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

  // Seed genuinely nonempty synthetic QBank and source records to protect.
  // No real medical content, original binary or account is involved.
  await page.evaluate(async () => {
    const app = window as unknown as {
      __AXOM_DEV__: Promise<{
        useStore: {
          getState: () => NoctyriumState;
          setState: (patch: Partial<NoctyriumState>) => void;
        };
        flushVault: () => Promise<void>;
      }>;
    };
    const dev = await app.__AXOM_DEV__;
    const state = dev.useStore.getState();
    const at = "2026-11-18T09:00:00.000Z";
    dev.useStore.setState({
      terms: [...state.terms, { id: "synthetic-term", name: "Synthetic term to retain" }],
      tracker: [...state.tracker, {
        id: "synthetic-tracker", path: "Synthetic/Week 1", label: "Synthetic attendance",
        kind: "Lecture", passes: 2, ankiPasses: 1, yield: "review",
        attendance: "attended", weekSource: "learner", note: "Preserve this note", updated: at,
      }],
      questions: [...state.questions, {
        id: "synthetic-question", source: "manual", stem: "Which letter is A?",
        options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
        correctKey: "A", sourceDocumentId: "synthetic-document",
        status: "needs-review", needsReview: true, tags: ["synthetic"],
        attempts: [{ at, answerKey: "B", status: "incorrect" }],
        createdAt: at, updatedAt: at,
      }],
      documents: [...state.documents, {
        id: "synthetic-document", title: "Synthetic source", fileName: "synthetic.txt",
        fileType: "text/plain", uploadedAt: at, rawText: "Only synthetic test evidence.",
        sizeBytes: 29, checksum: "a".repeat(64), tags: [],
        linkedQuestionSetIds: ["synthetic-set"], libraryOnly: false,
      }],
      questionSets: [...state.questionSets, {
        id: "synthetic-set", title: "Synthetic review set", createdAt: at,
        sourceDocumentIds: ["synthetic-document"], questionIds: ["synthetic-question"],
        tags: [], aiEnhanced: false, parserWarnings: [],
      }],
    });
    await dev.flushVault();
  });
  // Normalize any first-hydration defaults before establishing the baseline.
  await page.reload({ waitUntil: "networkidle" });

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
      // Every JSON-persisted learner field matters here, not only record IDs.
      // Exclude only device-clock-derived fields that can legitimately change on reload.
      // Source text/checksums, question content/review flags, attendance and media
      // references remain in the snapshot without touching original blob bytes.
      return JSON.parse(JSON.stringify({
        ...state,
        activeDayKey: undefined,
        lastActiveLocalDate: undefined,
        lastTimezoneOffset: undefined,
      })) as Omit<NoctyriumState, "activeDayKey" | "lastActiveLocalDate" | "lastTimezoneOffset">;
    });
  };

  const before = await readEvidence();
  expect(before.terms.some(term => term.id === "synthetic-term" && term.name === "Synthetic term to retain")).toBe(true);
  expect(before.tracker.some(item => item.id === "synthetic-tracker" &&
    item.attendance === "attended" && item.weekSource === "learner")).toBe(true);
  expect(before.questions.some(question => question.id === "synthetic-question" &&
    question.stem === "Which letter is A?" && question.needsReview === true &&
    question.attempts.length === 1)).toBe(true);
  expect(before.documents.some(doc => doc.id === "synthetic-document" &&
    doc.rawText === "Only synthetic test evidence." &&
    doc.checksum === "a".repeat(64))).toBe(true);
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
