import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type { PreparedBank } from "../src/lib/privateLibrary/types";
import type { CommunicationsSettings } from "../src/lib/communications/client";
import { seedOnboarded, expect } from "./fixtures";
const origin = "https://academic-fixture.invalid";
export const collection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revision = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** Browser contract only. Real service/source acceptance lives in *.local.spec.ts. */
export async function academicCatalogFixture(page: Page) {
  const template = Buffer.from("T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic catalog example [Lecture]\nLecture 02 Image interpretation [Lecture]\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const source = "A precedes B in the supplied pair.";
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "shared-catalog-test", title: "Synthetic published set", discipline: "Test" },
    source: { filename: "synthetic.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" },
    questions: [{ id: "shared-q1", source: { filename: "synthetic.txt", questionNumber: 1 },
      stem: [{ type: "text", text: "Which label appears first in the ordered pair A, B?" }, { type: "image", assetId: "figure", role: "question", alt: "Synthetic test image" }],
      choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "A" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "B" }] }],
      correctAnswer: { labels: ["A"], evidence: "printed-key" }, explanation: [{ type: "text", text: source }],
      assets: [{ id: "figure", filename: "figure.png", mimeType: "image/png", width: 1, height: 1, role: "question", questionId: "shared-q1", checksum: `sha256:${hash(png)}` }],
      provenance: { method: "authored", sourceChecksum: `sha256:${hash(source)}` } }] },
    issues: [], sourceText: { rawText: source }, sourceBytes: source.length, notes: [] };
  const catalog = { format: "axom-private-library", schemaVersion: 1, id: "canonical-fixture", version: "1", preparerVersion: "1",
    templates: [{ file: "templates/test.txt", name: "Course plan.txt", checksum: hash(template) }],
    sources: [{ id: "source", name: "synthetic.txt", sourcePath: "synthetic.txt", checksum: hash(source), module: "GOER", status: "prepared", reason: "Reviewed fixture", bankFile: "banks/test/bank.json", ready: 1, review: 0 }] };
  const files = [
    { path: "catalog.json", bytes: Buffer.from(JSON.stringify(catalog)), mime_type: "application/json" },
    { path: "templates/test.txt", bytes: template, mime_type: "text/plain" },
    { path: "banks/test/bank.json", bytes: Buffer.from(JSON.stringify(bank)), mime_type: "application/json" },
    { path: "banks/test/assets/figure.png", bytes: png, mime_type: "image/png" },
  ];
  const course = { id: collection, title: "Gastroenterology", module: "GOER", term: "Term 5", academic_term: "Reviewed test term", visibility: "shared", review_status: "approved", current_revision_id: revision, owned: false, ready_questions: 1, review_questions: 0 };
  const paths: string[] = [];
  const requests: string[] = [];
  let failCatalog = false;
  await page.addInitScript(({ origin, userId }) => {
    Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url: origin, key: "sb_publishable_fixture" } });
    const user = { id: userId, aud: "authenticated", role: "authenticated", email: "learner@example.test", email_confirmed_at: "2026-10-13T00:00:00Z", created_at: "2026-10-13T00:00:00Z", user_metadata: {}, app_metadata: {} };
    localStorage.setItem("sb-academic-fixture-auth-token", JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+86400, user }));
  }, { origin, userId });
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    requests.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    // Onboarding briefly mounts the dashboard's account notification inbox.
    if (request.method() === "POST" && path === "/functions/v1/communications" && url.searchParams.get("action") === "settings") return json({
      preferences: [], identity: { accent: "cyan", theme: "dark" }, history: [], privacy: [],
      admin: false, deliveryMode: "dry-run", deletionEnabled: false, hasProtectedCopy: false,
    } satisfies CommunicationsSettings);
    if (path.endsWith("/rpc/academic_catalog")) return failCatalog ? json({ message: "Fixture unavailable" },503) : json([course]);
    if (path.endsWith("/rpc/academic_course")) return json(course);
    if (path.endsWith("/rpc/academic_is_reviewer")) return json(false);
    if (path.endsWith("/academic_revisions")) return json({ id: revision, collection_id: collection, template_text: template.toString(), ready_questions: 1, review_questions: 0 });
    if (path.endsWith("/academic_files")) return json(files.map(file => ({ path: file.path, object_path: `${collection}/${hash(file.bytes)}`, sha256: hash(file.bytes), byte_size: file.bytes.length, mime_type: file.mime_type })));
    if (path.includes("/storage/v1/object/") && path.includes("/academic-content/")) {
      const file = files.find(file => path.endsWith(`/${hash(file.bytes)}`));
      if (file) { paths.push(file.path); return route.fulfill({ headers, body: file.bytes, contentType: file.mime_type }); }
    }
    if (path.endsWith("/rpc/academic_enroll") || path.endsWith("/rpc/touch_account_device")) return route.fulfill({ status: 204, headers });
    if (path.endsWith("/account_profiles")) return json({ display_name: "Catalog learner" });
    if (path.endsWith("/workspace_revisions") || path.endsWith("/account_devices")) return json([]);
    return json({ message: "Unexpected fixture request" },404);
  });
  await seedOnboarded(page);
  await page.goto("/#questions");
  await expect(page.getByRole("region", { name: "Available question banks" })).toBeVisible();
  return { paths, requests, fail: () => { failCatalog = true; }, recover: () => { failCatalog = false; } };
}
