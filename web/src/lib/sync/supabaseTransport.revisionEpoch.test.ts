// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { makeSeed } from "../seed";
import { contentCheckpointHash, decodeCloudSnapshot } from "./cloudSnapshot";
import { SupabaseSyncTransport } from "./supabaseTransport";

vi.mock("../account/supabase", () => ({
  accountOperationClient: vi.fn(),
  loadSupabase: vi.fn(),
}));
vi.mock("./cloudSnapshot", () => ({
  prepareCloudSnapshot: vi.fn(),
  decodeCloudSnapshot: vi.fn(),
  contentCheckpointHash: vi.fn(),
}));
const accountA = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);

function fixture() {
  let switched = false;
  const assertCurrent = vi.fn(async () => {
    if (switched) throw new Error("The signed-in account changed. This operation was stopped.");
  });
  const row = {
    id: "revision-a", revision: 72, schema_version: 35, content_hash: hash,
    snapshot_payload: { synthetic: true }, reason: "manual", created_at: "2026-11-11T00:00:00Z",
  };
  const chain = {
    select: vi.fn(), eq: vi.fn(),
    single: vi.fn(async () => ({ data: row, error: null, status: 200 })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  vi.mocked(accountOperationClient).mockResolvedValue({
    client, userId: accountA, assertCurrent,
    resumable: { endpoint: "https://example.invalid/storage/v1/upload/resumable", headers: { authorization: "fixture", apikey: "fixture" } },
  });
  vi.mocked(decodeCloudSnapshot).mockResolvedValue({ payload: { ...makeSeed(), questions: [], documents: [] }, sources: [], hashFormat: 2 });
  vi.mocked(contentCheckpointHash).mockResolvedValue(hash);
  return { assertCurrent, chain, switchAccount: () => { switched = true; } };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("account-scoped protected revision reads", () => {
  it("returns an integrity-checked revision while the initiating account remains active", async () => {
    const x = fixture();
    const revision = await new SupabaseSyncTransport().revision("revision-a");
    expect(revision).toMatchObject({ id: "revision-a", revision: 72, contentHash: hash });
    expect(x.chain.eq).toHaveBeenCalledWith("id", "revision-a");
    expect(contentCheckpointHash).toHaveBeenCalledOnce();
    expect(x.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it("refuses a prior account's revision after a switch during asynchronous hash validation", async () => {
    const x = fixture();
    let entered!: () => void;
    let release!: () => void;
    const validating = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(contentCheckpointHash).mockImplementation(async () => {
      entered();
      await gate;
      return hash;
    });
    const pending = new SupabaseSyncTransport().revision("revision-a");
    await validating;
    x.switchAccount();
    release();
    await expect(pending).rejects.toThrow("The signed-in account changed.");
    expect(x.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it("refuses a legacy revision after a switch during asynchronous decoding", async () => {
    const x = fixture();
    let entered!: () => void;
    let release!: () => void;
    const decoding = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(decodeCloudSnapshot).mockImplementation(async () => {
      entered();
      await gate;
      return { payload: makeSeed() };
    });
    const pending = new SupabaseSyncTransport().revision("revision-a");
    await decoding;
    x.switchAccount();
    release();
    await expect(pending).rejects.toThrow("The signed-in account changed.");
    expect(x.assertCurrent).toHaveBeenCalledTimes(2);
    expect(contentCheckpointHash).not.toHaveBeenCalled();
  });
});
