import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../library";
import { communityReviewStatus, saveCommunityReference } from "./communityReference";

const revision = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  documents: [] as SourceDocument[],
  flush: vi.fn(async () => {}),
  assert: vi.fn(),
}));
vi.mock("../store", () => ({ useStore: { getState: () => ({ documents: state.documents,
  addDocument: (document: SourceDocument) => { state.documents = [document, ...state.documents.filter(item => item.id !== document.id)]; },
}) } }));
vi.mock("../localVault", () => ({ getVaultWriteCheckpoint: () => 0,
  flushLocalVaultWrites: state.flush, assertVaultWritesSince: state.assert }));

beforeEach(() => { state.documents = []; vi.clearAllMocks(); });

describe("community download status", () => {
  it("persists a pending warning before download and exact question IDs after completion", async () => {
    await saveCommunityReference(revision, "owner-1", undefined, () => {});
    expect(communityReviewStatus(state.documents, "owner-1")).toEqual({ questionIds: new Set(), pending: true });
    await saveCommunityReference(revision, "owner-1", ["q1", "q2"], () => {});
    expect(communityReviewStatus(state.documents, "owner-1")).toEqual({ questionIds: new Set(["q1", "q2"]), pending: false });
    expect(communityReviewStatus(state.documents, "owner-2")).toEqual({ questionIds: new Set(), pending: false });
    expect(state.flush).toHaveBeenCalledTimes(2);
    expect(state.assert).toHaveBeenCalledTimes(2);
  });

  it("retains known IDs when a later retry is incomplete and ignores a malformed marker", async () => {
    await saveCommunityReference(revision, "owner-1", ["q1"], () => {});
    await saveCommunityReference(revision, "owner-1", undefined, () => {});
    state.documents.push({ ...state.documents[0], id: "community-bad", rawText: "not JSON" });
    expect(communityReviewStatus(state.documents, "owner-1")).toEqual({ questionIds: new Set(["q1"]), pending: true });
  });
});
