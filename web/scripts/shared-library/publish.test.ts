// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digest, sealPlan } from "./prepare";
import { publishPlan } from "./publish";
const bytes = new TextEncoder().encode("synthetic payload");
const plan = sealPlan({ format: "axom-shared-publication", schemaVersion: 1, catalog_key: "test", version: "1", title: "Synthetic catalog",
  audience: "authenticated", rights_reference: "Authored test data", grant_user_ids: [],
  files: [{ path: "bank.json", sha256: digest(bytes), byte_size: bytes.length, mime_type: "application/json" }],
  entries: [{ id: "bank", kind: "bank", title: "Synthetic practice", module: "TEST", term: "Term 1", week: 1,
    question_count: 1, image_question_count: 0, activity_count: 0, payload_path: "bank.json", source_label: "test.txt" }] });
function clientFixture() {
  const state = { status: "staging", exists: false, mismatch: false, corrupt: false, uploadFailure: false };
  const insert = vi.fn(async () => { state.exists = true; return { error: null }; });
  const upsert = vi.fn(async () => ({ error: null }));
  const lookup = () => ({ id: state.mismatch ? "different" : plan.release_id, manifest_sha256: plan.manifest_sha256, status: state.status });
  const upload = vi.fn(async () => ({ error: state.uploadFailure ? { message: "Already exists or interrupted" } : null }));
  const download = vi.fn(async () => ({ error: null, data: new Blob([state.corrupt ? new Uint8Array(bytes.length) : bytes]) }));
  const rpc = vi.fn(async () => { state.status = "published"; return { error: null }; });
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.exists ? lookup() : null, error: null }),
      single: async () => ({ data: lookup(), error: null }), insert, upsert };
    return query;
  }, storage: { from: () => ({ upload, download }) }, rpc } as unknown as SupabaseClient;
  return { state, client, insert, upsert, upload, download, rpc };
}
describe("operator-only atomic publication", () => {
  it("requires approval of the exact reviewed release before any backend write", async () => {
    const f = clientFixture();
    await expect(publishPlan(f.client, plan, { approveRelease: "wrong", read: async () => bytes })).rejects.toThrow(/approval/);
    expect(f.insert).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("verifies stored bytes and only then publishes", async () => {
    const f = clientFixture();
    const result = await publishPlan(f.client, plan, { approveRelease: plan.release_id, read: async () => bytes });
    expect(result).toEqual({ releaseId: plan.release_id, alreadyPublished: false });
    expect(f.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(f.rpc).toHaveBeenCalledWith("publish_academic_release", { wanted: plan.release_id, expected_entries: 1, expected_files: 1 });
  });
  it("resumes an already uploaded object only when bytes match", async () => {
    const f = clientFixture(); f.state.exists = true; f.state.uploadFailure = true;
    await expect(publishPlan(f.client, plan, { approveRelease: plan.release_id, read: async () => bytes })).resolves.toMatchObject({ alreadyPublished: false });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("keeps failed integrity checks unpublished", async () => {
    const f = clientFixture(); f.state.corrupt = true;
    await expect(publishPlan(f.client, plan, { approveRelease: plan.release_id, read: async () => bytes })).rejects.toThrow(/verification failed/);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not rewrite an already published release or reuse a conflicting version", async () => {
    const f = clientFixture(); f.state.exists = true; f.state.status = "published";
    await expect(publishPlan(f.client, plan, { approveRelease: plan.release_id, read: async () => bytes })).resolves.toMatchObject({ alreadyPublished: true });
    expect(f.upload).not.toHaveBeenCalled();
    f.state.mismatch = true;
    await expect(publishPlan(f.client, plan, { approveRelease: plan.release_id, read: async () => bytes })).rejects.toThrow(/different content/);
  });
});
