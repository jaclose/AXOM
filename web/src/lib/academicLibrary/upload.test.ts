import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicCollectionId, prepareAcademicUpload, uploadAcademicCourse } from "./upload";

async function fixture() {
  const bytes = new TextEncoder().encode("T1 - SAMPLE - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]");
  const catalog = { format: "axom-private-library", schemaVersion: 1, id: "sample-course", version: "1", attempts: ["private answer"], accountId: "private account",
    templates: [{ name: "plan.txt", file: "templates/plan.txt", checksum: (await sha256(bytes)).slice(7) }], sources: [] };
  const files = new Map([["catalog.json", new TextEncoder().encode(JSON.stringify(catalog))], ["templates/plan.txt", bytes]]);
  const read = async (path: string) => { const bytes = files.get(path); if (!bytes) throw new Error("Missing fixture"); return bytes; };
  return { read, files };
}
it("prepares only referenced academic files and omits unrelated learner fields", async () => {
  const f = await fixture(); f.files.set("private-backup.json", new TextEncoder().encode("private workspace"));
  const upload = await prepareAcademicUpload(f.read);
  expect(upload.metadata).toMatchObject({ module: "SAMPLE", term: "Term 1" });
  expect(upload.files.map(file => file.path)).toEqual(["catalog.json", "templates/plan.txt"]);
  expect(new TextDecoder().decode(upload.files[0].bytes)).not.toMatch(/attempts|accountId|private answer/);
  expect((await prepareAcademicUpload(f.read)).hash).toBe(upload.hash);
  expect(await academicCollectionId("account-a", upload.catalogId)).toBe(await academicCollectionId("account-a", upload.catalogId));
  expect(await academicCollectionId("account-b", upload.catalogId)).not.toBe(await academicCollectionId("account-a", upload.catalogId));
});
it("refuses altered source bytes before registering an upload", async () => {
  const f = await fixture(); f.files.set("templates/plan.txt", new TextEncoder().encode("changed"));
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow("integrity");
});
it("accepts a retry only after verifying the server bytes and acknowledgement", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const collection = await academicCollectionId("account-a", upload.catalogId);
  const rpc = vi.fn().mockResolvedValue({ data: { collection_id: collection, revision_id: "revision" }, error: null });
  const bucket = { upload: vi.fn().mockResolvedValue({ error: new Error("Lost response") }), download: vi.fn(async (path: string) => ({ data: new Blob([upload.files.find(file => path.endsWith(file.sha256))!.bytes as BlobPart]), error: null })) };
  const client = { rpc, storage: { from: () => bucket } } as unknown as SupabaseClient;
  await expect(uploadAcademicCourse(client, "account-a", upload, () => {}, () => {})).resolves.toMatchObject({ revision_id: "revision" });
  expect(rpc).toHaveBeenLastCalledWith("academic_finish_revision", { revision: "revision" });
  bucket.download.mockImplementation(async () => ({ data: new Blob(["wrong bytes"]), error: null })); rpc.mockClear();
  await expect(uploadAcademicCourse(client, "account-a", upload, () => {}, () => {})).rejects.toThrow("incomplete");
  expect(rpc).toHaveBeenCalledTimes(1);
});
