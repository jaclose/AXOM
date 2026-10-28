import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ReviewSubmission } from "../src/lib/academicLibrary/reviewQueue";
import { academicPublishFixture } from "./academicPublishFixture";

const origin = "https://academic-publish.invalid";
interface Submission extends ReviewSubmission { template: string; pending: boolean }
interface QueueCursor { after_submitted_at: string | null; after_id: string | null }
interface PreviewRequest { collection: string; revision: string }
interface DecisionRequest { collection: string; approved: boolean; expected_revision: string }

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
  const unavailablePreviews = new Set<string>();
  const heldPreviews = new Map<string, Promise<void>>();
  let invalidQueue = false;

  await page.route(`${origin}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    calls.push(`${request.method()} ${path}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    if (path.endsWith("/rpc/academic_is_reviewer")) return json(reviewer);
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
      item.pending = false;
      return route.fulfill({ status: 204, headers });
    }
    return route.fallback();
  });

  return {
    calls, queueRequests, previewRequests, decisionRequests,
    seedSubmission: (index: number, withPlan = true) => {
      const item: Submission = { id: randomUUID(), current_revision_id: randomUUID(), title: `Submitted course ${String(index + 1).padStart(2, "0")}`,
        module: index % 2 ? "GOER" : "NCRS", term: index % 2 ? "Term 5" : "Term 4",
        owner_display_name: index % 2 ? "Synthetic owner Rowan" : "Synthetic owner Taylor", ready_questions: index + 2,
        review_questions: index % 3, submitted_at: new Date(Date.UTC(2026, 9, 28, 9, 0, index)).toISOString(), pending: true,
        template: withPlan ? `Week 1:\nLecture 01 Synthetic submitted plan ${index + 1} [Lecture]\n` : "" };
      submissions.set(item.id, item);
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
