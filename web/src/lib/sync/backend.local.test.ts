import { materializeState } from "./contentDownloads";
// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../seed";
import { workspaceDigest } from "./workspaceDigest";
import { canonicalJson, compressText, sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { snapshotWorkspace } from "./workspaceSnapshot";
import { prepareCloudSnapshot, decodeCloudSnapshot } from "./cloudSnapshot";
import { clearCloudContentCache, hydrateCloudContent, uploadCloudContent } from "./cloudContent";
import { uploadCloudMedia, validateWorkspaceMedia } from "./cloudMedia";
import { SupabaseSyncTransport } from "./supabaseTransport";
import type { SupabaseClient } from "@supabase/supabase-js";

const operation = vi.hoisted(() => ({ client: null as SupabaseClient | null, userId: "" }));
// Only the app's session lookup is supplied by the harness. Every data request
// still reaches real local Auth/REST/Storage under that account's actual JWT.
vi.mock("../account/supabase", () => ({ loadSupabase: async () => operation.client,
  accountOperationClient: async () => ({ ...operation, assertCurrent: async () => {} }) }));

const statusFile = process.env.AXOM_LOCAL_SUPABASE_STATUS;
afterEach(() => vi.unstubAllGlobals());
describe.skipIf(!statusFile)("recovery against local Supabase Auth, REST and Storage", () => {
  it("round-trips private sources and images, isolates accounts and acknowledges retries once", async () => {
    const { env } = JSON.parse(readFileSync(statusFile!, "utf8"));
    const url = new URL(env.API_URL);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Recovery acceptance requires a loopback backend.");
    vi.stubGlobal("indexedDB", indexedDB); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(url.href, env.SERVICE_ROLE_KEY, options);
    const users = [];
    for (let i = 0; i < 2; i++) {
      const email = `recovery-${randomUUID()}@example.test`; const password = `${randomUUID()}-Axom1!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Synthetic recovery account creation failed.");
      const client = createClient(url.href, env.ANON_KEY, options);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error("Synthetic recovery sign-in failed.");
      users.push({ client, id: created.data.user.id });
    }
    const [a, b] = users; const state = makeSeed(); const now = new Date().toISOString();
    state.documents = [{ id: "private-source", title: "Synthetic source", fileName: "test.txt", fileType: "text/plain", sizeBytes: 160000, rawText: "Synthetic source. ".repeat(10000), uploadedAt: now, tags: [], linkedQuestionSetIds: [], libraryOnly: false }];
    // A real, valid PNG; test data only.
    const image = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=", "base64")], { type: "image/png" });
    const attachment = { id: "image", blobKey: randomUUID(), fileName: "figure.png", mimeType: "image/png" as const, byteSize: image.size, altText: "Synthetic figure", createdAt: now, updatedAt: now };
    state.questions = [{ id: "private-question", stem: "Synthetic question", options: [{ key: "A", text: "Synthetic answer" }], correctKey: "A", source: "manual", status: "unseen", tags: [], attempts: [], notes: "Personal note", attachments: [attachment], createdAt: now, updatedAt: now }];
    await putQuestionAttachmentBlob(attachment.blobKey, { ...attachment, questionId: state.questions[0].id, blob: image });
    const envelope = await prepareCloudSnapshot(await snapshotWorkspace(state, { accountUserId: a.id, deviceId: randomUUID(), baseRevision: 0, reason: "manual" }));
    const guard = async () => {};
    await uploadCloudContent(a.client, a.id, envelope.contentObjects!, [], guard);
    const media = await uploadCloudMedia(a.client, a.id, state, guard);
    const payload = { ...envelope.packed!, media };
    const legacyHash = await sha256(new TextEncoder().encode(canonicalJson(state)));
    const legacy = { ...payload, _axomHashFormat: undefined, _axomDeltaFormat: undefined, content: await compressText(payload.content) };
    const args = { p_base_revision: 0, p_schema_version: state.schemaVersion, p_content_hash: legacyHash, p_snapshot_payload: legacy, p_device_id: envelope.deviceId, p_idempotency_key: envelope.idempotencyKey, p_reason: "manual" };
    expect((await b.client.rpc("push_workspace_revision_v2", args)).error).not.toBeNull();
    const accepted = await a.client.rpc("push_workspace_revision_v2", args);
    expect(accepted.error).toBeNull(); expect(accepted.data).toMatchObject({ status: "accepted", revision: 1 });
    expect((await a.client.rpc("push_workspace_revision_v2", args)).data).toMatchObject({ status: "accepted", revision: 1, idempotent: true });
    expect((await b.client.from("workspace_revisions").select("id").eq("user_id", a.id)).data).toEqual([]);
    for (const [bucket, hash] of [["workspace-media", media[0].hash], ["workspace-content", payload.sources[0].hash]]) {
      const path = `${a.id}/${hash}`;
      expect((await b.client.storage.from(bucket).download(path)).error).not.toBeNull();
      expect((await b.client.storage.from(bucket).upload(path, new Blob(["other"], { type: "text/plain" }), { upsert: true })).error).not.toBeNull();
      expect((await a.client.storage.from(bucket).upload(path, new Blob(["overwrite"], { type: "text/plain" }), { upsert: true })).error).not.toBeNull();
    }
    const saved = await a.client.from("workspace_revisions").select("snapshot_payload").eq("id", accepted.data.revision_id).single();
    expect(saved.error).toBeNull(); clearCloudContentCache();
    const decoded = await decodeCloudSnapshot(saved.data!.snapshot_payload);
    const restored = await hydrateCloudContent(a.client, a.id, decoded.payload, decoded.sources, guard);
    expect((await workspaceDigest(restored)).hash).toBe((await workspaceDigest(state)).hash);
    expect(restored.questions[0].notes).toBe("Personal note"); validateWorkspaceMedia(restored, decoded.media);
    const restoredImage = await a.client.storage.from("workspace-media").download(`${a.id}/${media[0].hash}`);
    expect(restoredImage.error).toBeNull(); expect(await restoredImage.data!.arrayBuffer()).toEqual(await image.arrayBuffer());
    // Repeating the transfer uses server acknowledgements and never needs a
    // duplicate object. No fixture account or unrelated storage is reset.
    await uploadCloudContent(a.client, a.id, envelope.contentObjects!, payload.sources, guard);
    expect(await uploadCloudMedia(a.client, a.id, state, guard, media)).toEqual(media);
    console.info(JSON.stringify({ environment: url.origin, checkpointBytes: new TextEncoder().encode(JSON.stringify(payload)).length,
      sourceBytes: envelope.contentObjects!.reduce((sum, object) => sum + object.reference.byteSize, 0), mediaBytes: image.size }));
    operation.client = a.client; operation.userId = a.id;
    const transport = new SupabaseSyncTransport();
    expect((await transport.revision(accepted.data.revision_id)).payload).toEqual(state);
    const first = await transport.push({ ...envelope, baseRevision: 1, idempotencyKey: randomUUID() });
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("Expected initial protected version.");
    const answered = { ...state, questions: [{ ...state.questions[0], userAnswerKey: "A", notes: "Updated personal note" }] };
    const answer = await snapshotWorkspace(answered, { accountUserId: a.id, deviceId: envelope.deviceId, baseRevision: first.revision, reason: "automatic" });
    const synced = await transport.push(answer);
    expect(synced.status).toBe("accepted"); expect(synced.transferBytes).toBeLessThan(900);
    if (synced.status !== "accepted") throw new Error("Expected saved answer.");
    expect(await transport.push(answer)).toMatchObject({ status: "accepted", revision: synced.revision, idempotent: true });
    const downloaded = await transport.revision(synced.revisionId);
    expect(downloaded.payload.questions).toEqual([]);
    const materialized = await materializeState(downloaded.payload);
    expect(materialized.questions[0].notes).toBe("Updated personal note");
    expect(materialized.documents[0].rawText).toBe(state.documents[0].rawText);
    expect(downloaded.contentHash).toBe((await prepareCloudSnapshot(answer)).contentHash);
    console.info(JSON.stringify({ environment: url.origin, initialSaveBytes: first.transferBytes, oneAnswerSaveBytes: synced.transferBytes }));
    if (process.env.AXOM_SYNC_EVIDENCE) writeFileSync(process.env.AXOM_SYNC_EVIDENCE, JSON.stringify({ environment: url.origin,
      initialSaveBytes: first.transferBytes, oneAnswerSaveBytes: synced.transferBytes,
      sourceBytes: envelope.contentObjects!.reduce((sum, object) => sum + object.reference.byteSize, 0), imageBytes: image.size,
      result: "real legacy compressed restore, incremental transfer, tenant denial, retry and exact recovery passed" }, null, 2));
  }, 120_000);
});
