import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { zipLibraryReader } from "../privateLibrary/install";
import { prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "./upload";

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
const pilot = process.env.AXOM_ACADEMIC_PILOT;
describe.skipIf(!statusFile || !pilot)("real local academic Auth, REST and Storage", () => {
  let admin: SupabaseClient; let a: SupabaseClient; let b: SupabaseClient;
  let owner: string; let upload: AcademicUpload;
  let revision: { collection_id: string; revision_id: string };
  beforeAll(async () => {
    const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
    const url = new URL(env.API_URL);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("This acceptance test only permits a loopback Supabase project.");
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient(url.href, env.SERVICE_ROLE_KEY, options);
    const users = [];
    for (const alias of ["alpha", "beta"]) {
      const email = `academic-${alias}-${randomUUID()}@example.test`; const password = `${randomUUID()}-Axom1!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Local test account creation failed: ${created.error?.message}`);
      const client = createClient(url.href, env.ANON_KEY, options);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error(`Local test sign-in failed: ${signed.error.message}`);
      users.push({ client, id: created.data.user.id });
    }
    a = users[0].client; b = users[1].client; owner = users[0].id;
    const file = new File([readFileSync(pilot!)], "pilot.zip", { type: "application/zip" });
    upload = await prepareAcademicUpload(await zipLibraryReader(file as unknown as globalThis.File));
  }, 120_000);

  it("uploads privately, verifies retries, shares only after review, and isolates enrollment and media", async () => {
    revision = await uploadAcademicCourse(a, owner, upload, () => {}, () => {});
    const repeated = await uploadAcademicCourse(a, owner, upload, () => {}, () => {});
    expect(repeated).toEqual(revision);
    const catalog = await a.rpc("academic_catalog"); expect(catalog.error).toBeNull();
    expect(catalog.data.some((c: { id: string }) => c.id === revision.collection_id)).toBe(true);
    const hidden = await b.rpc("academic_catalog"); expect(hidden.error).toBeNull();
    expect(hidden.data.some((c: { id: string }) => c.id === revision.collection_id)).toBe(false);
    const image = upload.files.find(file => file.mime_type.startsWith("image/")); expect(image).toBeDefined();
    const object = `${revision.collection_id}/${image!.sha256}`;
    expect((await b.storage.from("academic-content").download(object)).error).not.toBeNull();
    expect((await b.rpc("academic_set_visibility", { collection: revision.collection_id, visibility: "shared" })).error).not.toBeNull();
    expect((await a.rpc("academic_set_visibility", { collection: revision.collection_id, visibility: "shared" })).error).toBeNull();
    expect((await a.rpc("academic_review", { collection: revision.collection_id, approved: true })).error).not.toBeNull();
    expect((await b.from("academic_revisions").select("id").eq("id", revision.revision_id)).data).toEqual([]);
    expect((await admin.from("academic_reviewers").insert({ user_id: owner })).error).toBeNull();
    expect((await a.rpc("academic_review", { collection: revision.collection_id, approved: true })).error).toBeNull();
    const shared = await b.rpc("academic_catalog"); expect(shared.error).toBeNull();
    expect(shared.data.some((c: { id: string }) => c.id === revision.collection_id)).toBe(true);
    const media = await b.storage.from("academic-content").download(object); expect(media.error).toBeNull();
    expect(new Uint8Array(await media.data!.arrayBuffer())).toEqual(image!.bytes);
    expect((await b.storage.from("academic-content").upload(object, image!.bytes, { upsert: true })).error).not.toBeNull();
    for (const [client, weeks] of [[a, [1]], [b, [2]]] as const) {
      expect((await client.rpc("academic_enroll", { collection: revision.collection_id, revision: revision.revision_id, weeks })).error).toBeNull();
      expect((await client.from("academic_enrollments").select("weeks").eq("collection_id", revision.collection_id)).data).toEqual([{ weeks }]);
    }
    expect((await a.rpc("academic_withdraw", { collection: revision.collection_id, withdrawn: true })).error).toBeNull();
    expect((await b.storage.from("academic-content").download(object)).error).not.toBeNull();
    expect((await b.from("academic_revisions").select("id").eq("id", revision.revision_id)).data).toEqual([]);
    // Aggregate sizes only. Never log credentials, source text or account IDs.
    console.info(JSON.stringify({ environment: "loopback Supabase", catalogBytes: new TextEncoder().encode(JSON.stringify(catalog.data)).length,
      contentBytes: upload.files.reduce((sum, file) => sum + file.byte_size, 0), contentFiles: upload.files.length,
      enrollmentRequestBytes: new TextEncoder().encode(JSON.stringify({ collection: revision.collection_id, revision: revision.revision_id, weeks: [1] })).length }));
  }, 120_000);
});
