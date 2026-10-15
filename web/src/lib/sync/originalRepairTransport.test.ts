// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeSeed } from "../seed";
import type { SnapshotEnvelope } from "./syncTypes";
import { accountOperationClient } from "../account/supabase";
import { repairMissingCloudOriginals, uploadCloudOriginals } from "./cloudOriginals";
import { readSyncBaseline } from "./syncBaseline";
import { SupabaseSyncTransport } from "./supabaseTransport";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));
vi.mock("./syncBaseline", () => ({
  readSyncBaseline: vi.fn(async () => undefined),
  saveSyncBaseline: vi.fn(async () => undefined),
}));
vi.mock("./cloudContent", async importOriginal => ({
  ...(await importOriginal<object>()),
  uploadCloudContent: vi.fn(async () => undefined),
}));
vi.mock("./cloudMedia", async importOriginal => ({
  ...(await importOriginal<object>()),
  uploadCloudMedia: vi.fn(async () => []),
}));
vi.mock("./cloudOriginals", () => ({
  ORIGINALS_BUCKET: "workspace-originals",
  uploadCloudOriginals: vi.fn(async () => undefined),
  repairMissingCloudOriginals: vi.fn(async () => 1),
}));
vi.mock("./cloudMediaCache", () => ({ saveCloudMediaIndex: vi.fn(async () => undefined) }));

const owner = "11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);

function setup(fail: { code: string; message: string }, repaired: number = 1) {
  vi.mocked(repairMissingCloudOriginals).mockResolvedValue(repaired);
  const requests: Array<{ name: string; args: Record<string, unknown> }> = [];
  let attempts = 0;
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    requests.push({ name, args }); attempts++;
    if (attempts === 1) return Promise.resolve({ data: null, error: fail, status: 409 });
    return Promise.resolve({ data: { status: "accepted", revision: 1, revision_id: "recovered-id", idempotent: false }, error: null, status: 200 });
  });
  const chain = {
    select: vi.fn(), neq: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { media: [], sources: [], content: "{\\\"documents\\\":[]}" }, error: null })),
    single: vi.fn(async () => ({ data: { id: "recovered-id", revision: 1, content_hash: digest, reason: "automatic" }, error: null, status: 200 })),
  };
  for (const method of ["select", "neq", "order", "limit", "eq"] as const) chain[method].mockReturnValue(chain);
  const client = { rpc, from: vi.fn(() => chain) } as unknown as SupabaseClient;
  const assertCurrent = vi.fn(async () => undefined);
  vi.mocked(accountOperationClient).mockImplementation(async () => ({
    client, userId: owner, assertCurrent,
    resumable: { endpoint: "https://example.storage.supabase.co/storage/v1/upload/resumable",
      headers: { authorization: "Bearer test", apikey: "public" } },
  }));
  const state = makeSeed();
  const text = JSON.stringify(state);
  const envelope: SnapshotEnvelope = {
    accountUserId: owner, schemaVersion: 34, contentHash: digest, payload: state,
    packed: { _axomCloudFormat: 2, _axomDeltaFormat: 1, _axomHashFormat: 2, content: text,
      expandedBytes: new TextEncoder().encode(text).length, media: [], sources: [] },
    contentObjects: [], payloadBytes: new TextEncoder().encode(text).length,
    deviceId: "22222222-2222-4222-8222-222222222222", baseRevision: 0,
    idempotencyKey: "33333333-3333-4333-8333-333333333333", reason: "automatic",
  };
  return { client, rpc, requests, assertCurrent, envelope };
}

beforeEach(() => vi.clearAllMocks());

describe("workspace cloud-original repair acknowledgement", () => {
  it("recovers exactly once after missing-original PT409 and replays the same idempotency key", async () => {
    const fixture = setup({ code: "PT409", message: "original source upload is incomplete" });
    const receipt = await new SupabaseSyncTransport().push(fixture.envelope);
    expect(receipt).toMatchObject({ status: "accepted", revision: 1, contentHash: digest });
    expect(vi.mocked(repairMissingCloudOriginals)).toHaveBeenCalledOnce();
    expect(vi.mocked(repairMissingCloudOriginals).mock.calls[0]?.slice(0, 3))
      .toEqual([fixture.client, owner, fixture.envelope.payload]);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests.map(item => item.name)).toEqual(["push_workspace_revision_v2", "push_workspace_revision_v2"]);
    expect(fixture.requests[0].args.p_idempotency_key).toBe(fixture.requests[1].args.p_idempotency_key);
    expect(fixture.assertCurrent).toHaveBeenCalled();
    expect(uploadCloudOriginals).toHaveBeenCalledOnce();
  });

  it("recovers after a delta-form retry is refused, switching to one full replay without changing the idempotency key", async () => {
    const fixture = setup({ code: "PT409", message: "original source upload is incomplete" });
    vi.mocked(readSyncBaseline).mockResolvedValueOnce({
      revision: 0, contentHash: digest, packed: fixture.envelope.packed!,
    });
    await expect(new SupabaseSyncTransport().push(fixture.envelope))
      .resolves.toMatchObject({ status: "accepted", revision: 1 });
    expect(fixture.requests.map(item => item.name)).toEqual(["push_workspace_delta_v2", "push_workspace_revision_v2"]);
    expect(fixture.requests[0].args.p_idempotency_key).toBe(fixture.requests[1].args.p_idempotency_key);
    expect(repairMissingCloudOriginals).toHaveBeenCalledTimes(1);
  });

  it("does not loop when a second server acknowledgement is still rejected after repair", async () => {
    const fixture = setup({ code: "PT409", message: "original source upload is incomplete" });
    fixture.rpc.mockImplementation(async () => ({
      data: null, error: { code: "PT409", message: "original source upload is incomplete" }, status: 409,
    }));
    await expect(new SupabaseSyncTransport().push(fixture.envelope)).rejects.toThrow(/incomplete/);
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(repairMissingCloudOriginals).toHaveBeenCalledTimes(1);
  });

  it("does not repair unrelated PT409 validation refusals or retry an unrepairable original", async () => {
    const other = setup({ code: "PT409", message: "academic source is unavailable or incomplete" });
    await expect(new SupabaseSyncTransport().push(other.envelope)).rejects.toThrow(/unavailable/);
    expect(repairMissingCloudOriginals).not.toHaveBeenCalled();
    expect(other.rpc).toHaveBeenCalledTimes(1);
    const stuck = setup({ code: "PT409", message: "original source upload is incomplete" }, 0);
    await expect(new SupabaseSyncTransport().push(stuck.envelope)).rejects.toThrow(/no recoverable object/);
    expect(stuck.rpc).toHaveBeenCalledTimes(1);
  });
});
