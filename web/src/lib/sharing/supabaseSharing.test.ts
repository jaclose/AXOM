import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { createQuestionSetShare } from "./questionSetShare";
import { listQuestionSetShares, publishShare, resolveShare, revokeShare } from "./supabaseSharing";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));

const SHARE_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(48);
const NOW = "2026-10-15T12:00:00.000Z";
const EXPIRES = "2026-10-22T12:00:00.000Z";

function snapshot() {
  return createQuestionSetShare({
    id: "source-set",
    title: "Synthetic share",
    sourceDocumentIds: [],
    createdAt: NOW,
    questionIds: ["q1"],
    tags: [],
    aiEnhanced: false,
    parserWarnings: [],
  }, [{
    id: "q1",
    source: "manual",
    stem: "Synthetic question?",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "A",
    correctAnswerText: "Alpha",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: NOW,
    updatedAt: NOW,
  }], NOW);
}

function serverShare(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    source_question_set_id: "source-set",
    share_token: TOKEN,
    title: "Synthetic share",
    question_count: 1,
    created_at: NOW,
    expires_at: EXPIRES,
    idempotent: false,
    ...overrides,
  };
}

function configured(
  rpc: ReturnType<typeof vi.fn>,
  user: object | null = { id: "owner" },
  from?: ReturnType<typeof vi.fn>,
) {
  const service = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    rpc,
    from,
  };
  const assertCurrent = vi.fn().mockResolvedValue(undefined);
  vi.mocked(loadSupabase).mockResolvedValue(service as never);
  if (user) {
    vi.mocked(accountOperationClient).mockResolvedValue({
      client: service,
      userId: "id" in user ? String(user.id) : "owner",
      assertCurrent,
      resumable: { endpoint: "https://example.invalid/upload", headers: {} },
    } as never);
  } else {
    vi.mocked(accountOperationClient).mockRejectedValue(new Error("Sign in again to protect this workspace."));
  }
  return { assertCurrent, service };
}

beforeEach(() => vi.clearAllMocks());

describe("question-share Supabase boundary", () => {
  it("returns the server share UUID plus a validated content digest", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: SHARE_ID,
        title: value.title,
        question_count: value.questions.length,
        share_format_version: 1,
        snapshot_payload: value,
      }],
      error: null,
    });
    configured(rpc);

    const resolved = await resolveShare(TOKEN);

    expect(resolved).toMatchObject({ id: SHARE_ID, snapshot: value });
    expect(resolved.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(rpc).toHaveBeenCalledWith("resolve_question_set_share", { p_token: TOKEN });
  });

  it("rejects forged nested fields before the snapshot reaches UI state", async () => {
    const value = snapshot() as unknown as { title: string; questions: Array<Record<string, unknown>> };
    value.questions[0].courseId = "forged-course";
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: SHARE_ID,
        title: value.title,
        question_count: value.questions.length,
        share_format_version: 1,
        snapshot_payload: value,
      }],
      error: null,
    });
    configured(rpc);

    await expect(resolveShare(TOKEN)).rejects.toThrow(/unsupported field/i);
  });

  it("rejects server metadata that disagrees with the snapshot", async () => {
    const value = snapshot();
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: SHARE_ID,
        title: value.title,
        question_count: value.questions.length + 1,
        share_format_version: 1,
        snapshot_payload: value,
      }],
      error: null,
    });
    configured(rpc);

    await expect(resolveShare(TOKEN)).rejects.toThrow(/metadata does not match/i);
  });

  it("validates an outbound snapshot before any authenticated RPC write", async () => {
    const value = snapshot() as unknown as { questions: Array<Record<string, unknown>> };
    value.questions[0].attachments = [];
    const rpc = vi.fn();
    configured(rpc);

    await expect(publishShare("source-set", value as never)).rejects.toThrow(/unsupported field/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns bounded server metadata for a published owner link", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: serverShare(), error: null });
    const operation = configured(rpc);

    await expect(publishShare("source-set", snapshot())).resolves.toEqual({
      id: SHARE_ID,
      sourceId: "source-set",
      token: TOKEN,
      title: "Synthetic share",
      questionCount: 1,
      createdAt: NOW,
      expiresAt: EXPIRES,
      idempotent: false,
    });
    expect(rpc).toHaveBeenCalledWith("create_question_set_share", expect.objectContaining({
      p_source_id: "source-set",
    }));
    expect(operation.assertCurrent).toHaveBeenCalledTimes(2);
    expect(loadSupabase).not.toHaveBeenCalled();
  });

  it("rejects a stale owner response after an account switch instead of returning its link", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: serverShare(), error: null });
    const operation = configured(rpc);
    operation.assertCurrent.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The signed-in account changed. This operation was stopped."));

    await expect(publishShare("source-set", snapshot())).rejects.toThrow(/account changed/i);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects published metadata for a different snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: serverShare({ title: "A different set" }),
      error: null,
    });
    configured(rpc);

    await expect(publishShare("source-set", snapshot())).rejects.toThrow(/identity or summary/i);
  });

  it("lists only the bounded management fields requested for the signed-in owner", async () => {
    const query = {
      select: vi.fn(),
      is: vi.fn(),
      gt: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [serverShare({ idempotent: undefined })], error: null });
    const from = vi.fn().mockReturnValue(query);
    configured(vi.fn(), { id: "owner" }, from);

    const shares = await listQuestionSetShares();

    expect(shares).toEqual([{
      id: SHARE_ID,
      sourceId: "source-set",
      token: TOKEN,
      title: "Synthetic share",
      questionCount: 1,
      createdAt: NOW,
      expiresAt: EXPIRES,
    }]);
    expect(from).toHaveBeenCalledWith("question_set_shares");
    expect(query.select).toHaveBeenCalledWith(
      "id,source_question_set_id,share_token,title,question_count,created_at,expires_at",
    );
    expect(query.is).toHaveBeenCalledWith("revoked_at", null);
    expect(query.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(20);
  });

  it("rejects an owner management row without a bounded expiry", async () => {
    const query = {
      select: vi.fn(), is: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [serverShare({ expires_at: null })], error: null });
    configured(vi.fn(), { id: "owner" }, vi.fn().mockReturnValue(query));

    await expect(listQuestionSetShares()).rejects.toThrow(/invalid link record/i);
  });

  it("rejects a management row whose bearer capability exceeds seven days", async () => {
    const query = {
      select: vi.fn(), is: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [serverShare({ expires_at: "2026-10-23T12:00:00.000Z" })],
      error: null,
    });
    configured(vi.fn(), { id: "owner" }, vi.fn().mockReturnValue(query));

    await expect(listQuestionSetShares()).rejects.toThrow(/invalid link record/i);
  });

  it("pins share revocation to its starting account and confirms the session afterwards", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const operation = configured(rpc);

    await revokeShare(SHARE_ID);

    expect(rpc).toHaveBeenCalledWith("revoke_question_set_share", { p_share_id: SHARE_ID });
    expect(operation.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it("describes created links as unlisted when authentication is missing", async () => {
    const rpc = vi.fn();
    configured(rpc, null);

    await expect(publishShare("source-set", snapshot())).rejects.toThrow(/unlisted share link/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed tokens without contacting Supabase", async () => {
    const rpc = vi.fn();
    configured(rpc);

    await expect(resolveShare("short")).rejects.toThrow(/incomplete/i);
    expect(loadSupabase).not.toHaveBeenCalled();
  });
});
