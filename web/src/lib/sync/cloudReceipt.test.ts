// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SyncPushError } from "./syncFailure";
import { readPushResult, verifyCloudRevisionReceipt } from "./supabaseTransport";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function fixture(row?: object, error: object | null = null, status = 200) {
  const result = { data: row ?? null, error, status };
  const chain = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => result),
  };
  chain.eq.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  const guard = vi.fn(async () => undefined);
  const accepted = { revision: 7, revisionId: "server-revision", idempotent: false };
  const rowValue = { id: "server-revision", revision: 7, content_hash: HASH_A, reason: "automatic", ...row };
  chain.single.mockResolvedValue({ ...result, data: error ? null : rowValue });
  return { client, guard, chain, accepted };
}

describe("cloud revision readback and acknowledgement", () => {
  it("requires an owner-scoped persisted revision with exact server hash before marking cloud-confirmed", async () => {
    const x = fixture();
    await expect(verifyCloudRevisionReceipt(x.client, "account-owner", x.accepted, HASH_A, x.guard))
      .resolves.toBe(HASH_A);
    expect(x.client.from).toHaveBeenCalledWith("workspace_revisions");
    expect(x.chain.select).toHaveBeenCalledWith("id,revision,content_hash,reason");
    expect(x.chain.eq).toHaveBeenCalledWith("user_id", "account-owner");
    expect(x.chain.eq).toHaveBeenCalledWith("id", "server-revision");
    expect(x.guard).toHaveBeenCalledTimes(2);
  });

  it("returns the actual older stored hash on an idempotent replay so new local edits can be retried", async () => {
    const x = fixture();
    await expect(verifyCloudRevisionReceipt(x.client, "account-owner",
      { ...x.accepted, idempotent: true, contentHash: HASH_A }, HASH_B, x.guard))
      .resolves.toBe(HASH_A);
  });

  it.each([
    [{ id: "wrong-revision" }, "id"],
    [{ revision: 8 }, "revision"],
    [{ content_hash: HASH_B }, "content"],
    [{ content_hash: "not-a-hash" }, "content"],
    [{ reason: "conflict" }, "content"],
  ] as const)("rejects forged successful RPC receipts (%j, %s)", async (row, _field) => {
    const x = fixture(row);
    await expect(verifyCloudRevisionReceipt(x.client, "account-owner", x.accepted, HASH_A, x.guard))
      .rejects.toMatchObject({ failure: { kind: "rejected", rejection: "refused", status: 409 } });
  });

  it("fails closed and allows a safe retry when the server row is not readable yet", async () => {
    const x = fixture(undefined, { code: "PGRST116", message: "row missing" }, 406);
    await expect(verifyCloudRevisionReceipt(x.client, "account-owner", x.accepted, HASH_A, x.guard))
      .rejects.toMatchObject({ failure: { kind: "server", status: 406 } });
  });

  it("classifies expired authorization separately and stops immediately if the account changes during readback", async () => {
    const x = fixture(undefined, { code: "PGRST301", message: "JWT expired" }, 401);
    await expect(verifyCloudRevisionReceipt(x.client, "account-owner", x.accepted, HASH_A, x.guard))
      .rejects.toMatchObject({ failure: { kind: "auth", status: 401 } });
    const y = fixture();
    y.guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("The account changed"));
    await expect(verifyCloudRevisionReceipt(y.client, "account-owner", y.accepted, HASH_A, y.guard))
      .rejects.toThrow(/account changed/);
  });

  it("does not trust an accepted response without a meaningful revision ID or safe integer revision", () => {
    for (const value of [
      { status: "accepted", revision: 3 },
      { status: "accepted", revision: 0, revision_id: "r" },
      { status: "accepted", revision: -2, revision_id: "r" },
      { status: "accepted", revision: 1.5, revision_id: "r" },
      { status: "accepted", revision: Number.MAX_SAFE_INTEGER + 1, revision_id: "r" },
      { status: "accepted", revision: 1, revision_id: "" },
    ]) expect(() => readPushResult(value)).toThrow(SyncPushError);
    expect(readPushResult({ status: "accepted", revision: 3, revision_id: "r" }))
      .toMatchObject({ status: "accepted", revision: 3, revisionId: "r" });
  });
});
