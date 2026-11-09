// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { makeSeed } from "../seed";
import { saveCloudMediaIndex } from "./cloudMediaCache";
import { saveSyncBaseline } from "./syncBaseline";
import { SupabaseSyncTransport } from "./supabaseTransport";
import type { SnapshotEnvelope } from "./syncTypes";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));
vi.mock("./syncBaseline", () => ({ readSyncBaseline: vi.fn(async () => undefined), saveSyncBaseline: vi.fn(async () => undefined) }));
vi.mock("./cloudContent", async original => ({ ...(await original<object>()), uploadCloudContent: vi.fn(async () => undefined) }));
vi.mock("./cloudMedia", async original => ({
  ...(await original<object>()), findMissingWorkspaceMedia: vi.fn(async () => []), uploadCloudMedia: vi.fn(async () => []),
}));
vi.mock("./cloudOriginals", () => ({ ORIGINALS_BUCKET: "workspace-originals", uploadCloudOriginals: vi.fn(async () => undefined) }));
vi.mock("./cloudMediaCache", () => ({ saveCloudMediaIndex: vi.fn(async () => undefined) }));

const owner = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);

function fixture(boundary: "none" | "after-readback" | "after-index" = "none") {
  let readbackCompleted = false;
  let guardsAfterReadback = 0;
  const assertCurrent = vi.fn(async () => {
    if (readbackCompleted) guardsAfterReadback++;
    if (boundary === "after-readback" && guardsAfterReadback === 2) {
      throw new Error("The account session was refreshed. Your local work is safe; retry the upload.");
    }
    if (boundary === "after-index" && vi.mocked(saveCloudMediaIndex).mock.calls.length > 0) {
      throw new Error("The signed-in account changed. This operation was stopped.");
    }
  });
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: null, status: 200 })),
    single: vi.fn(async () => {
      readbackCompleted = true;
      return { data: { id: "revision-id", revision: 72, content_hash: hash, reason: "manual" }, error: null, status: 200 };
    }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const rpc = vi.fn(async () => ({ data: { status: "accepted", revision: 72, revision_id: "revision-id", content_hash: hash, idempotent: true }, error: null, status: 200 }));
  const client = { from: vi.fn(() => chain), rpc } as unknown as SupabaseClient;
  vi.mocked(accountOperationClient).mockResolvedValue({ client, userId: owner, assertCurrent,
    resumable: { endpoint: "https://example.invalid/storage/v1/upload/resumable", headers: { authorization: "fixture", apikey: "fixture" } } });
  const state = makeSeed();
  const text = JSON.stringify(state);
  const envelope: SnapshotEnvelope = { accountUserId: owner, schemaVersion: 35, contentHash: hash, payload: state,
    packed: { _axomCloudFormat: 2, _axomDeltaFormat: 1, _axomHashFormat: 2, content: text, expandedBytes: text.length, media: [], sources: [] },
    contentObjects: [], payloadBytes: text.length, deviceId: "fixture-device", baseRevision: 71,
    idempotencyKey: "fixture-retry-key", reason: "manual" };
  return { envelope, chain, rpc };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveCloudMediaIndex).mockResolvedValue(undefined); });

it("retains receipt stage when the verified server save cannot persist its local image index", async () => {
  const x = fixture();
  vi.mocked(saveCloudMediaIndex).mockRejectedValueOnce(new DOMException("private fixture detail", "QuotaExceededError"));
  const error = await new SupabaseSyncTransport().push(x.envelope).catch(value => value);
  expect(x.chain.single).toHaveBeenCalledOnce();
  expect(error).toMatchObject({ failure: { kind: "network", status: 0, phase: "receipt" } });
  expect(JSON.stringify(error)).not.toContain("private fixture detail");
  expect(saveSyncBaseline).not.toHaveBeenCalled();
});

it("retains refreshed-session classification immediately after verified readback", async () => {
  const x = fixture("after-readback");
  await expect(new SupabaseSyncTransport().push(x.envelope)).rejects.toMatchObject({
    failure: { kind: "auth", status: 0, phase: "receipt", reason: "session-refreshed" },
  });
  expect(saveCloudMediaIndex).not.toHaveBeenCalled();
  expect(saveSyncBaseline).not.toHaveBeenCalled();
});

it("retains account-change classification after the image index and stops baseline persistence", async () => {
  const x = fixture("after-index");
  await expect(new SupabaseSyncTransport().push(x.envelope)).rejects.toMatchObject({
    failure: { kind: "auth", status: 0, phase: "receipt", reason: "account-changed" },
  });
  expect(saveCloudMediaIndex).toHaveBeenCalledOnce();
  expect(saveSyncBaseline).not.toHaveBeenCalled();
});

it("acknowledges an intact idempotent save only after exact server readback and local bookkeeping", async () => {
  const x = fixture();
  await expect(new SupabaseSyncTransport().push(x.envelope)).resolves.toMatchObject({
    status: "accepted", revision: 72, contentHash: hash, idempotent: true,
  });
  expect(x.chain.single).toHaveBeenCalledOnce();
  expect(saveCloudMediaIndex).toHaveBeenCalledOnce();
  expect(saveSyncBaseline).toHaveBeenCalledWith(owner, expect.objectContaining({ revision: 72, contentHash: hash }));
});
