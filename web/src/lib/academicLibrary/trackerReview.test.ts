import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveStoredTrackerRevision, inspectStoredTrackerRevision, inspectTrackerPlan, trackerManifestHash } from "./trackerReview";
import { ACADEMIC_PLAN_SECTION_BREAK } from "./coursePlan";

const mocks = vi.hoisted(() => ({ userId: "reviewer", assertCurrent: vi.fn(), rpc: vi.fn(), reader: vi.fn() }));
vi.mock("../account/supabase", () => ({ accountOperationClient: async () => ({
  userId: mocks.userId, assertCurrent: mocks.assertCurrent, client: { rpc: mocks.rpc },
}) }));
vi.mock("./client", () => ({ academicLibraryReader: mocks.reader }));
const collection = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const encode = (text: string) => new TextEncoder().encode(text);
const plan = "T1 - SAMPLE - Course plan:\n@week-policy: explicit\n@source: Synthetic example; week placement unverified\nWeek 2:\nOne [Lecture]\nUnscheduled:\nTwo [Small Group]";

beforeEach(() => {
  vi.clearAllMocks(); mocks.userId = "reviewer";
  mocks.assertCurrent.mockReset().mockResolvedValue(undefined);
  mocks.rpc.mockReset(); mocks.reader.mockReset();
});

async function fixture() {
  const catalog: Record<string, unknown> = { format: "axom-private-library", schemaVersion: 1, id: "synthetic", version: "one",
    templates: [{ file: "templates/plan.txt", name: "Plan", checksum: hash(plan) }], sources: [] };
  const bytes = new Map<string, Uint8Array>([["catalog.json", encode(JSON.stringify(catalog))], ["templates/plan.txt", encode(plan)]]);
  const files = [...bytes].map(([path, value]) => ({ path, sha256: hash(value), byte_size: value.length,
    mime_type: path === "catalog.json" ? "application/json" : "text/plain", object_path: `${collection}/${hash(value)}` }));
  const read = Object.assign(vi.fn(async (path: string) => bytes.get(path)!), { files });
  const row = { collection_id: collection, revision_id: revision, reviewer_id: "reviewer", content_hash: "a".repeat(64), template_hash: hash(plan),
    manifest_hash: await trackerManifestHash(files, collection), template_text: plan, module: "SAMPLE", term: "Term 1",
    ready_questions: 0, review_questions: 0, shape: { activities: 2, stated_week_activities: 1, unstated_week_activities: 1, sections: 1 } };
  mocks.rpc.mockImplementation(async name => name === "academic_tracker_review_target" ? { data: row, error: null } : {
    data: { collection_id: collection, revision_id: revision, reviewer_id: "reviewer", content_hash: row.content_hash,
      template_hash: row.template_hash, manifest_hash: row.manifest_hash, reviewed_at: "2026-11-22T00:00:00Z" }, error: null,
  });
  mocks.reader.mockResolvedValue(read);
  const changeCatalog = async (edit: (catalog: Record<string, unknown>) => void) => {
    edit(catalog); const value = encode(JSON.stringify(catalog)); bytes.set("catalog.json", value);
    Object.assign(files[0], { sha256: hash(value), byte_size: value.length, object_path: `${collection}/${hash(value)}` });
    row.manifest_hash = await trackerManifestHash(files, collection);
  };
  return { row, files, bytes, read, changeCatalog };
}

describe("tracker-only plan observations", () => {
  it("retains uncertain source text and counts named weeks without inferring a schedule", () => {
    expect(inspectTrackerPlan(plan, { module: "SAMPLE", term: "Term 1" })).toEqual({ activities: 2,
      statedWeekActivities: 1, unstatedWeekActivities: 1, sections: 1, warnings: [expect.stringContaining("does not certify week placement")] });
    const source = "SAMPLE - Lecture sequence:\nFirst [Lecture]\n\nSecond [Lecture]";
    expect(inspectTrackerPlan(source, { module: "SAMPLE", term: "Term 1" })).toMatchObject({ activities: 2, statedWeekActivities: 0, unstatedWeekActivities: 2 });
  });

  it("validates multi-section filing, kind syntax and week ranges", () => {
    const second = "T1 - SAMPLE - Labs:\nUnscheduled:\nExample lab [Lab]";
    expect(inspectTrackerPlan(plan + ACADEMIC_PLAN_SECTION_BREAK + second, { module: "SAMPLE", term: "Term 1" }))
      .toMatchObject({ activities: 3, sections: 2, statedWeekActivities: 1, unstatedWeekActivities: 2 });
    for (const text of ["", "Just a heading", "SAMPLE - Empty:", "Week 1:\nActivity [Lecture]", "SAMPLE - Plan:\nUnreadable",
      "SAMPLE - Plan:\nBad [Unknown]", "SAMPLE - Plan:\nWeek 61:\nBad [Lecture]", "SAMPLE - Plan:\nBad Week 61 [Lecture]",
      "T2 - SAMPLE - Plan:\nDifferent term [Lecture]", "T1 - FOREIGN - Plan:\nForeign module [Lecture]"]) {
      expect(() => inspectTrackerPlan(text, { module: "SAMPLE", term: "Term 1" })).toThrow();
    }
  });
});

describe("stored tracker readback and approval", () => {
  it("reads and hashes every template/catalog byte before returning a session-bound observation", async () => {
    const f = await fixture();
    const receipt = await inspectStoredTrackerRevision(collection, revision, "reviewer");
    expect(receipt).toMatchObject({ collectionId: collection, revisionId: revision, reviewerId: "reviewer",
      templateText: plan, activities: 2, statedWeekActivities: 1, unstatedWeekActivities: 1, templateHash: hash(plan) });
    expect(f.read.mock.calls.map(call => call[0])).toEqual(["catalog.json", "templates/plan.txt"]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("academic_tracker_review_target", { collection, revision });
  });

  it("submits one atomic tracker decision with exact hashes, never an explanation attestation", async () => {
    const f = await fixture();
    const receipt = await inspectStoredTrackerRevision(collection, revision, "reviewer");
    await approveStoredTrackerRevision(receipt, "reviewer", true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("academic_approve_tracker", { collection, revision,
      content_hash: f.row.content_hash, template_hash: f.row.template_hash, manifest_hash: f.row.manifest_hash,
      observed_activities: 2, observed_stated_week_activities: 1, plan_reviewed: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects declared banks, held content, and embedded unknown question fields despite valid bytes", async () => {
    for (const edit of [
      (c: Record<string, unknown>) => { c.sources = [{ id: "bank", name: "Bank", sourcePath: "bank.pdf", checksum: "b".repeat(64),
        reason: "Undeclared questions", status: "prepared", bankFile: "bank.json", ready: 0, review: 0 }]; },
      (c: Record<string, unknown>) => { c.questions = []; },
      (c: Record<string, unknown>) => { c.templates = [{ file: "templates/plan.txt", name: "Plan", checksum: hash(plan), questions: [] }]; },
    ]) {
      const f = await fixture(); await f.changeCatalog(edit);
      await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
    }
    const f = await fixture(); f.row.review_questions = 1; mocks.reader.mockClear();
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
    expect(mocks.reader).not.toHaveBeenCalled();
  });

  it("rejects extra JSON, a foreign storage owner, changed manifest hashes and duplicate template references", async () => {
    const f = await fixture();
    await expect(trackerManifestHash([...f.files, { ...f.files[0], path: "banks/q.json" }], collection)).rejects.toThrow();
    await expect(trackerManifestHash([{ ...f.files[0], object_path: `foreign/${f.files[0].sha256}` }, f.files[1]], collection)).rejects.toThrow();
    f.row.manifest_hash = "b".repeat(64);
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
    const other = await fixture();
    await other.changeCatalog(c => { c.templates = [(c.templates as unknown[])[0], (c.templates as unknown[])[0]]; });
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
  });

  it("rejects missing, corrupted and mismatched template bytes without returning an approval receipt", async () => {
    for (const path of ["catalog.json", "templates/plan.txt"]) {
      const f = await fixture(); f.bytes.set(path, encode("corrupted"));
      await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
    }
    const f = await fixture(); f.row.template_text = plan.replace("One", "Changed"); f.row.template_hash = hash(f.row.template_text);
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
  });

  it("rejects metadata count or filing disagreement even when the plan hash is valid", async () => {
    for (const mutate of [(row: Awaited<ReturnType<typeof fixture>>["row"]) => { row.shape.activities = 3; },
      (row: Awaited<ReturnType<typeof fixture>>["row"]) => { row.module = "FOREIGN"; },
      (row: Awaited<ReturnType<typeof fixture>>["row"]) => { row.term = "Term 2"; }]) {
      const f = await fixture(); mutate(f.row);
      await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow();
    }
  });

  it("stops on an account mismatch or session change during readback", async () => {
    await fixture(); mocks.userId = "other";
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow(/account changed/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const f = await fixture(); mocks.userId = "reviewer";
    f.read.mockImplementation(async path => { mocks.assertCurrent.mockRejectedValue(new Error("The account session changed.")); return f.bytes.get(path)!; });
    await expect(inspectStoredTrackerRevision(collection, revision, "reviewer")).rejects.toThrow(/session changed/);
    expect(mocks.rpc.mock.calls.every(call => call[0] === "academic_tracker_review_target")).toBe(true);
  });

  it("refuses unreviewed or different-reviewer receipts and any changed plan before the decision RPC", async () => {
    await fixture(); const receipt = await inspectStoredTrackerRevision(collection, revision, "reviewer");
    await expect(approveStoredTrackerRevision(receipt, "reviewer", false)).rejects.toThrow();
    await expect(approveStoredTrackerRevision(receipt, "other-reviewer", true)).rejects.toThrow();
    await expect(approveStoredTrackerRevision({ ...receipt, templateText: plan.replace("One", "Changed") }, "reviewer", true)).rejects.toThrow();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not report a stale or unconfirmed server decision as approved", async () => {
    await fixture(); const receipt = await inspectStoredTrackerRevision(collection, revision, "reviewer");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
    await expect(approveStoredTrackerRevision(receipt, "reviewer", true)).rejects.toThrow(/could not be confirmed/);
    mocks.rpc.mockResolvedValueOnce({ data: { reviewer_id: "other-reviewer" }, error: null });
    await expect(approveStoredTrackerRevision(receipt, "reviewer", true)).rejects.toThrow(/could not be confirmed/);
  });
});
