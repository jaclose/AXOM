import { createHash, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ReviewSubmission } from "../src/lib/academicLibrary/reviewQueue";
import { library } from "../src/lib/academicLibrary/publicationFixture.testing";
import { academicPublishFixture } from "./academicPublishFixture";

const origin = "https://academic-publish.invalid";
interface Submission extends ReviewSubmission { template: string; pending: boolean }
interface QueueCursor { after_submitted_at: string | null; after_id: string | null }
interface PreviewRequest { collection: string; revision: string }
interface DecisionRequest { collection: string; approved: boolean; expected_revision: string }
interface FileRow { path: string; object_path: string; sha256: string; byte_size: number; mime_type: string }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function syntheticReviewFiles() {
  const { files, catalog } = await library();
  const source = catalog.sources.find(item => item.name === "cpr1-imcq.pdf");
  if (!source?.bankFile || !source.originalFile) throw new Error("Synthetic review source is incomplete.");
  const bankBytes = files.get(source.bankFile), sourceBytes = files.get(source.originalFile);
  if (!bankBytes || !sourceBytes) throw new Error("Synthetic review bytes are missing.");
  const bank = JSON.parse(Buffer.from(bankBytes).toString("utf8")) as { pkg: { questions: Array<Record<string, unknown>> } };
  bank.pkg.questions = bank.pkg.questions.map(question => ({ ...question,
    explanation: [{ type: "text", text: "Synthetic rationale checked against the invented source." }] }));
  const catalogBytes = Buffer.from(JSON.stringify({ ...catalog, templates: [], sources: [source] }));
  return new Map<string, { bytes: Buffer; mime: string }>([
    ["catalog.json", { bytes: catalogBytes, mime: "application/json" }],
    [source.bankFile, { bytes: Buffer.from(JSON.stringify(bank)), mime: "application/json" }],
    [source.originalFile, { bytes: Buffer.from(sourceBytes), mime: "application/pdf" }],
  ]);
}

/** Synthetic metadata and plan text only. Browser tests do not grant content
 * access; SQL permission and row-lock behavior are tested with PGlite. */
export async function academicReviewFixture(page: Page, options: { reviewer?: boolean } = {}) {
  let reviewer = options.reviewer ?? true;
  await academicPublishFixture(page, { reviewer });
  const submissions = new Map<string, Submission>();
  const calls: string[] = [];
  const queueRequests: QueueCursor[] = [];
  const previewRequests: PreviewRequest[] = [];
  const decisionRequests: DecisionRequest[] = [];
  const attestationRequests: Array<Record<string, unknown>> = [];
  const attested = new Set<string>();
  const filesByRevision = new Map<string, FileRow[]>();
  const objects = new Map<string, Buffer>();
  const sourceFiles = await syntheticReviewFiles();
  const contentHash = hash(Buffer.concat([...sourceFiles.values()].map(file => file.bytes)));
  const unavailablePreviews = new Set<string>();
  const heldPreviews = new Map<string, Promise<void>>();
  let invalidQueue = false;

  await page.route(`${origin}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    calls.push(`${request.method()} ${path}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    const body = () => request.postDataJSON() as Record<string, unknown>;
    if (path.endsWith("/rest/v1/academic_files")) {
      const revision = new URL(request.url()).searchParams.get("revision_id")?.replace(/^eq\./, "") ?? "";
      const rows = reviewer ? filesByRevision.get(revision) ?? [] : [];
      if (request.method() === "HEAD") return route.fulfill({ status: 200, headers: { ...headers, "content-range": `0-${rows.length - 1}/${rows.length}` } });
      return json(rows);
    }
    if (path.includes("/storage/v1/object/academic-content/")) {
      const name = decodeURIComponent(path.split("/storage/v1/object/academic-content/")[1] ?? "");
      const bytes = reviewer ? objects.get(name) : undefined;
      return bytes ? route.fulfill({ status: 200, headers, body: bytes })
        : json({ message: "Review file unavailable" }, 404);
    }
    if (path.endsWith("/rpc/academic_is_reviewer")) return json(reviewer);
    if (path.endsWith("/rpc/academic_explanation_review_target")) {
      const input = body() as { collection: string; revision: string };
      const item = submissions.get(input.collection);
      return json(reviewer && item?.pending && item.current_revision_id === input.revision
        ? { collection_id: item.id, revision_id: item.current_revision_id, content_hash: contentHash,
          ready_questions: item.ready_questions } : null);
    }
    if (path.endsWith("/rpc/academic_attest_explanations")) {
      const input = body();
      attestationRequests.push(input);
      const item = submissions.get(String(input.collection));
      if (!reviewer || !item?.pending || item.current_revision_id !== input.revision
        || input.content_hash !== contentHash || input.observed_ready_questions !== item.ready_questions
        || input.observed_explained_questions !== item.ready_questions || input.rationale_reviewed !== true)
        return json({ message: "Exact revision explanation review required", code: "42501" }, 403);
      attested.add(`${item.id}:${item.current_revision_id}`);
      return route.fulfill({ status: 204, headers });
    }
    if (path.endsWith("/rpc/academic_review_queue")) {
      const cursor = request.postDataJSON() as QueueCursor;
      queueRequests.push(cursor);
      if (!reviewer) return json([]);
      if (invalidQueue) return json({ unavailable: true });
      const rows = [...submissions.values()].filter(item => item.pending && (!cursor.after_submitted_at || !cursor.after_id
        || item.submitted_at > cursor.after_submitted_at
        || (item.submitted_at === cursor.after_submitted_at && item.id > cursor.after_id)))
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id)).slice(0, 24);
      return json(rows.map(item => ({ id: item.id, title: item.title, module: item.module, term: item.term,
        current_revision_id: item.current_revision_id, owner_display_name: item.owner_display_name,
        ready_questions: item.ready_questions, review_questions: item.review_questions, submitted_at: item.submitted_at })));
    }
    if (path.endsWith("/rpc/academic_review_preview")) {
      const input = request.postDataJSON() as PreviewRequest;
      previewRequests.push(input);
      await heldPreviews.get(input.collection);
      const item = submissions.get(input.collection);
      if (!reviewer || !item?.pending || input.revision !== item.current_revision_id || unavailablePreviews.has(input.collection)) return json(null);
      return json({ id: item.current_revision_id, collection_id: item.id, template_text: item.template,
        ready_questions: item.ready_questions, review_questions: item.review_questions });
    }
    if (path.endsWith("/rpc/academic_review")) {
      const input = request.postDataJSON() as DecisionRequest;
      decisionRequests.push(input);
      const item = submissions.get(input.collection);
      if (!reviewer || !item?.pending || input.expected_revision !== item.current_revision_id)
        return json({ message: "Submission changed or reviewer access denied", code: "40001" }, 409);
      if (input.approved && !attested.has(`${item.id}:${item.current_revision_id}`))
        return json({ message: "Explanation review attestation required", code: "42501" }, 403);
      item.pending = false;
      return route.fulfill({ status: 204, headers });
    }
    return route.fallback();
  });

  return {
    calls, queueRequests, previewRequests, decisionRequests, attestationRequests,
    seedSubmission: (index: number, withPlan = true) => {
      const item: Submission = { id: randomUUID(), current_revision_id: randomUUID(), title: `Submitted course ${String(index + 1).padStart(2, "0")}`,
        module: index % 2 ? "GOER" : "NCRS", term: index % 2 ? "Term 5" : "Term 4",
        owner_display_name: index % 2 ? "Synthetic owner Rowan" : "Synthetic owner Taylor", ready_questions: 2,
        review_questions: 0, submitted_at: new Date(Date.UTC(2026, 9, 28, 9, 0, index)).toISOString(), pending: true,
        template: withPlan ? `Week 1:\nLecture 01 Synthetic submitted plan ${index + 1} [Lecture]\n` : "" };
      submissions.set(item.id, item);
      const rows: FileRow[] = [];
      for (const [path, file] of sourceFiles) {
        const digest = hash(file.bytes), object_path = `${item.id}/${digest}`;
        rows.push({ path, object_path, sha256: digest, byte_size: file.bytes.length, mime_type: file.mime });
        objects.set(object_path, file.bytes);
      }
      filesByRevision.set(item.current_revision_id, rows);
      return item;
    },
    setReviewer: (value: boolean) => { reviewer = value; },
    invalidateQueue: () => { invalidQueue = true; },
    recoverQueue: () => { invalidQueue = false; },
    unavailablePreview: (id: string) => { unavailablePreviews.add(id); },
    recoverPreview: (id: string) => { unavailablePreviews.delete(id); },
    holdPreview: (id: string) => {
      let release!: () => void;
      heldPreviews.set(id, new Promise<void>(resolve => { release = resolve; }));
      return () => { heldPreviews.delete(id); release(); };
    },
  };
}
