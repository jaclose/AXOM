import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { completeSetup, deferPromisePrompt, QUIET_NUDGES } from "./fixtures";
import type { NoctyriumState, TrackerItem } from "../src/lib/types";
import type { QuestionRecord } from "../src/lib/questions";

const backupPath = process.env.AXOM_RESTORE_BACKUP;
const test = base.extend({ context: async ({ playwright }, use) => {
  const baseURL = process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187";
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Backup acceptance requires an isolated local application.");
  const profile = await mkdtemp(join(tmpdir(), "axom-backup-restore-"));
  const context = await playwright.chromium.launchPersistentContext(profile, {
    baseURL, channel: process.env.AXOM_E2E_CHANNEL, headless: true, reducedMotion: "reduce",
  });
  // An existing private backup is never allowed to contact hosted services.
  await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
  await context.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, QUIET_NUDGES);
  try { await use(context); } finally { await context.close(); }
} });
test.skip(!backupPath, "Set AXOM_RESTORE_BACKUP to an authorized existing ZIP backup.");
test.use({ trace: "off", screenshot: "off", video: "off" });

type ProtectedState = {
  questions: Pick<QuestionRecord, "id" | "notes" | "attempts">[];
  tracker: Pick<TrackerItem, "id" | "path" | "label" | "passes" | "ankiPasses" | "note">[];
  documents: { id: string }[];
  questionSets: { id: string; questionIds: string[] }[];
};
function protectedProgress(state: ProtectedState) {
  return {
    questions: state.questions.map(q => [q.id, q.notes ?? "", q.attempts.map(a => [a.at, a.status, a.answerKey, a.mode, a.quizSessionId])]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    tracker: state.tracker.map(t => [t.id, t.path, t.label, t.passes, t.ankiPasses, t.note ?? ""]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    documents: state.documents.map(d => d.id).sort(),
    sets: state.questionSets.map(s => [s.id, [...s.questionIds].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
}
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

test("an existing portable ZIP restores progress and every image through Settings, then reopens", async ({ page }) => {
  test.setTimeout(600_000);
  const started = Date.now();
  const zip = await JSZip.loadAsync(await readFile(backupPath!));
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("The selected file is not a workspace ZIP.");
  const original = JSON.parse(await workspace.async("string")) as ProtectedState & { media: { file: string; metadata: { blobKey: string } }[] };
  const expectedProgress = hash(JSON.stringify(protectedProgress(original)));
  const expectedMedia: { blobKey: string; bytes: number; sha256: string }[] = [];
  for (const entry of original.media) {
    const file = zip.file(entry.file);
    if (!file) throw new Error("The original backup is missing a media entry.");
    const bytes = await file.async("uint8array");
    expectedMedia.push({ blobKey: entry.metadata.blobKey, bytes: bytes.length, sha256: hash(bytes) });
  }
  expectedMedia.sort((a, b) => a.blobKey.localeCompare(b.blobKey));
  await page.goto("/?app=1#dashboard", { waitUntil: "networkidle" });
  await completeSetup(page, "Isolated backup acceptance");
  await deferPromisePrompt(page);
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Emergency recovery", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import / restore", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await (await chooser).setFiles(backupPath!);
  const settings = page.getByRole("dialog", { name: "Your AXOM Setup" });
  await expect(settings).toContainText("Saved on this device.", { timeout: 240_000 });
  await expect(settings).not.toContainText("Recovery did not finish.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const readProgress = async () => {
    await page.waitForFunction(() => Boolean((window as unknown as { __AXOM_DEV__?: unknown }).__AXOM_DEV__));
    return page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => NoctyriumState }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
      await dev.flushVault();
      const s = dev.useStore.getState();
      return { questions: s.questions.map(({ id, notes, attempts }) => ({ id, notes, attempts })),
        tracker: s.tracker.map(({ id, path, label, passes, ankiPasses, note }) => ({ id, path, label, passes, ankiPasses, note })),
        documents: s.documents.map(({ id }) => ({ id })), questionSets: s.questionSets.map(({ id, questionIds }) => ({ id, questionIds })) };
    });
  };
  expect(hash(JSON.stringify(protectedProgress(await readProgress())))).toBe(expectedProgress);
  await page.reload({ waitUntil: "networkidle" });
  expect(hash(JSON.stringify(protectedProgress(await readProgress())))).toBe(expectedProgress);
  const restoredMedia = await page.evaluate(async () => {
    const path = "/src/lib/questionAttachments.ts";
    const { listQuestionAttachmentBlobKeys, getQuestionAttachmentBlob } = await import(/* @vite-ignore */ path);
    const result: { blobKey: string; bytes: number; sha256: string }[] = [];
    for (const blobKey of await listQuestionAttachmentBlobKeys()) {
      const entry = await getQuestionAttachmentBlob(blobKey);
      if (!entry) throw new Error("A restored image is unavailable.");
      const bytes = await entry.blob.arrayBuffer();
      result.push({ blobKey, bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("") });
    }
    return result;
  });
  restoredMedia.sort((a, b) => a.blobKey.localeCompare(b.blobKey));
  expect(hash(JSON.stringify(restoredMedia))).toBe(hash(JSON.stringify(expectedMedia)));
  // Only aggregate evidence leaves the isolated profile. No source text or keys.
  console.info("Portable recovery acceptance", JSON.stringify({ archiveBytes: (await stat(backupPath!)).size,
    questions: original.questions.length, attempts: original.questions.reduce((n, q) => n + q.attempts.length, 0),
    activities: original.tracker.length, documents: original.documents.length, media: expectedMedia.length,
    mediaBytes: expectedMedia.reduce((n, entry) => n + entry.bytes, 0), elapsedMs: Date.now() - started }));
});
