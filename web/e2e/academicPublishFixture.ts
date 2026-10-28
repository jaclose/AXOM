import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { CommunicationsSettings } from "../src/lib/communications/client";

const origin = "https://academic-publish.invalid";
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
interface FileRow { path: string; object_path: string; sha256: string; byte_size: number; mime_type: string }
interface Revision {
  id: string; collection_id: string; content_hash: string; status: "uploading" | "ready"; template_text: string;
  source_revision: string | null; ready_questions: number; review_questions: number; approved_at: string | null; files: FileRow[];
}
interface Collection {
  id: string; title: string; module: string; term: string; academic_term: string | null; cohort: string | null;
  visibility: "private" | "group" | "shared"; review_status: "pending" | "approved" | "rejected"; current_revision_id: string | null;
}
const termRank = (term: string) => Number(term.match(/^Term (\d{1,2})$/)?.[1] ?? 1000);

/**
 * Browser contract only: an in-memory stand-in for the academic RPCs, REST
 * rows and Storage objects the real uploader, readback and installer call.
 * Hosted RLS, review and migrations are covered by the PGlite suites.
 */
export async function academicPublishFixture(page: Page, options: { reviewer?: boolean } = {}) {
  const collections = new Map<string, Collection>();
  const revisions = new Map<string, Revision>();
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const current = (collection: Collection) => collection.current_revision_id ? revisions.get(collection.current_revision_id) : undefined;
  const course = (collection: Collection) => {
    const revision = current(collection)!;
    return { id: collection.id, title: collection.title, module: collection.module, term: collection.term,
      academic_term: collection.academic_term, cohort: collection.cohort, visibility: collection.visibility,
      review_status: collection.review_status, current_revision_id: collection.current_revision_id, owned: true,
      ready_questions: revision.ready_questions, review_questions: revision.review_questions };
  };
  await page.addInitScript(({ origin, userId }) => {
    Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url: origin, key: "sb_publishable_fixture" } });
    const user = { id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test", email_confirmed_at: "2026-10-27T00:00:00Z",
      created_at: "2026-10-27T00:00:00Z", user_metadata: {}, app_metadata: {} };
    localStorage.setItem("sb-academic-publish-auth-token", JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh",
      token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 86400, user }));
  }, { origin, userId });
  await page.route(`${origin}/**`, async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*",
      "access-control-expose-headers": "*" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    calls.push(`${method} ${path}`);
    const json = (value: unknown, status = 200, extra: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { ...headers, ...extra }, contentType: "application/json", body: JSON.stringify(value) });
    const empty = () => route.fulfill({ status: 204, headers });
    const body = () => request.postDataJSON() as Record<string, unknown>;
    const idParam = (name: string) => url.searchParams.get(name)?.replace(/^eq\./, "") ?? "";
    if (method === "POST" && path === "/functions/v1/communications") return json({
      preferences: [], identity: { accent: "cyan", theme: "dark" }, history: [], privacy: [],
      admin: false, deliveryMode: "dry-run", deletionEnabled: false, hasProtectedCopy: false,
    } satisfies CommunicationsSettings);
    if (path === "/auth/v1/user") return json({ id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test",
      app_metadata: {}, user_metadata: {}, created_at: "2026-10-27T00:00:00Z" });
    if (path.endsWith("/rpc/academic_is_reviewer")) return json(Boolean(options.reviewer));
    if (path.endsWith("/rpc/academic_review_queue")) {
      if (!options.reviewer) return json([]);
      const { after_id = null } = body() as { after_id?: string | null };
      return json([...collections.values()].filter(collection => collection.current_revision_id
        && collection.visibility === "shared" && collection.review_status === "pending"
        && (!after_id || collection.id > after_id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 24)
        .map(collection => ({ id: collection.id, title: collection.title, module: collection.module, term: collection.term,
          current_revision_id: collection.current_revision_id, owner_display_name: "Library owner",
          ready_questions: current(collection)!.ready_questions, review_questions: current(collection)!.review_questions,
          submitted_at: "2026-10-28T00:00:00Z" })));
    }
    if (path.endsWith("/rpc/academic_create_revision")) {
      const input = body() as { metadata: Record<string, string | number | undefined>; template: string; files: Omit<FileRow, "object_path">[]; content_hash: string; collection: string };
      let collection = collections.get(input.collection);
      if (!collection) {
        collection = { id: input.collection, title: String(input.metadata.title), module: String(input.metadata.module), term: String(input.metadata.term),
          academic_term: (input.metadata.academic_term as string | undefined) ?? null, cohort: (input.metadata.cohort as string | undefined) ?? null,
          visibility: "private", review_status: "pending", current_revision_id: null };
        collections.set(collection.id, collection);
      } else if (collection.term !== input.metadata.term || collection.module !== input.metadata.module)
        return json({ message: "Academic collection classification does not match" }, 400);
      const existing = [...revisions.values()].find(revision => revision.collection_id === collection!.id && revision.content_hash === input.content_hash);
      const revision = existing ?? { id: randomUUID(), collection_id: collection.id, content_hash: input.content_hash, status: "uploading" as const,
        template_text: input.template, source_revision: (input.metadata.source_revision as string | undefined) ?? null,
        ready_questions: Number(input.metadata.ready_questions), review_questions: Number(input.metadata.review_questions), approved_at: null,
        files: input.files.map(file => ({ ...file, object_path: `${collection!.id}/${file.sha256}` })) };
      revisions.set(revision.id, revision);
      return json({ collection_id: collection.id, revision_id: revision.id });
    }
    if (path.includes("/storage/v1/object/academic-content/")) {
      const name = decodeURIComponent(path.split("/storage/v1/object/academic-content/")[1]);
      if (method === "POST") {
        if (objects.has(name)) return json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, 400);
        objects.set(name, request.postDataBuffer() ?? Buffer.alloc(0));
        return json({ Key: `academic-content/${name}`, Id: randomUUID() });
      }
      const bytes = objects.get(name);
      return bytes ? route.fulfill({ status: 200, headers, body: bytes }) : json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
    }
    if (path.endsWith("/rpc/academic_finish_revision")) {
      const revision = revisions.get(String(body().revision))!;
      if (revision.files.some(file => objects.get(file.object_path)?.length !== file.byte_size)) return json({ message: "Upload incomplete; keep local originals and retry" }, 400);
      if (revision.status !== "ready") {
        revision.status = "ready";
        const collection = collections.get(revision.collection_id)!;
        collection.current_revision_id = revision.id;
        collection.review_status = "pending";
      }
      return empty();
    }
    if (path.endsWith("/rest/v1/academic_revisions")) {
      const revision = revisions.get(idParam("id"));
      if (!revision) return json({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, 406);
      return json({ id: revision.id, collection_id: revision.collection_id, content_hash: revision.content_hash, status: revision.status,
        template_text: revision.template_text, source_revision: revision.source_revision, ready_questions: revision.ready_questions,
        review_questions: revision.review_questions, approved_at: revision.approved_at });
    }
    if (path.endsWith("/rest/v1/academic_files")) {
      const files = [...(revisions.get(idParam("revision_id"))?.files ?? [])].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (method === "HEAD") return route.fulfill({ status: 200, headers: { ...headers, "content-range": files.length ? `0-${files.length - 1}/${files.length}` : "*/0" } });
      const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? files.length);
      return json(files.slice(offset, offset + limit).map(({ path, object_path, sha256, byte_size, mime_type }) => ({ path, object_path, sha256, byte_size, mime_type })));
    }
    if (path.endsWith("/rest/v1/academic_collections")) {
      const collection = collections.get(idParam("id"));
      return collection ? json({ current_revision_id: collection.current_revision_id }) : json({ message: "No rows", code: "PGRST116" }, 406);
    }
    if (path.endsWith("/rpc/academic_course")) {
      const collection = collections.get(String(body().collection));
      return collection?.current_revision_id ? json(course(collection)) : json(null);
    }
    if (path.endsWith("/rpc/academic_catalog")) {
      const { search = "", term_filter = "" } = body() as { search?: string; term_filter?: string };
      return json([...collections.values()].filter(collection => collection.current_revision_id
        && (!term_filter || collection.term === term_filter)
        && `${collection.title} ${collection.module}`.toLowerCase().includes(String(search).toLowerCase()))
        .sort((a, b) => termRank(a.term) - termRank(b.term) || a.module.localeCompare(b.module) || a.title.localeCompare(b.title))
        .slice(0, 24).map(course));
    }
    if (path.endsWith("/rpc/academic_set_visibility")) {
      const input = body() as { collection: string; visibility: Collection["visibility"] };
      const collection = collections.get(input.collection);
      if (!collection) return json({ message: "Collection unavailable", code: "42501" }, 403);
      collection.visibility = input.visibility;
      return empty();
    }
    if (path.endsWith("/rpc/academic_review")) {
      if (!options.reviewer) return json({ message: "Reviewer access required", code: "42501" }, 403);
      const input = body() as { collection: string; approved: boolean };
      const collection = collections.get(input.collection)!;
      collection.review_status = input.approved ? "approved" : "rejected";
      current(collection)!.approved_at = input.approved ? new Date().toISOString() : null;
      return empty();
    }
    if (path.endsWith("/rpc/academic_enroll") || path.endsWith("/rpc/touch_account_device")) return empty();
    if (path.endsWith("/account_profiles")) return json({ display_name: "Library owner" });
    if (path.endsWith("/workspace_revisions") || path.endsWith("/account_devices")) return json([]);
    return json({ message: "Unexpected fixture request" }, 404);
  });
  return {
    calls,
    objects,
    collections: () => [...collections.values()].map(collection => ({ ...collection, revision: current(collection) })),
  };
}
