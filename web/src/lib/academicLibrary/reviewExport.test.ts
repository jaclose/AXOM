// @vitest-environment jsdom
import { Blob as NativeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { PRIVATE_LIBRARY_FORMAT } from "../privateLibrary/types";
import { createStoredReviewArchive } from "./reviewExport";

const mocked = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./client", async original => ({ ...await original<typeof import("./client")>(), academicClient: (...args: unknown[]) => mocked.client(...args) }));
const account = "11111111-1111-4111-8111-111111111111";
const collection = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const course = { id: collection, current_revision_id: revision, module: "Example course" };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

async function fixture() {
  const bank = '{ "questions": [], "reviewNote": "Preserve these exact stored bytes, including spacing." }\n';
  const catalog = { format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "review-example", version: "1", templates: [],
    sources: [{ id: "one", name: "Example.txt", sourcePath: "Example.txt", checksum: "a".repeat(64), module: "GOER",
      status: "prepared", reason: "Example", bankFile: "banks/one.json", ready: 0, review: 1 }] };
  const files = new Map<string, Uint8Array>([["catalog.json", encode(catalog)], ["banks/one.json", new TextEncoder().encode(bank)],
    ["originals/example.pdf", new TextEncoder().encode("%PDF-1.7 supplied original")]]);
  const manifest = await Promise.all([...files].map(async ([path, bytes]) => {
    const hash = (await sha256(bytes)).slice(7);
    return { path, sha256: hash, byte_size: bytes.length, object_path: `${account}/${hash}`,
      mime_type: path.endsWith(".json") ? "application/json" : "application/pdf" };
  }));
  const state = { current: revision, hash: "b".repeat(64), onRead: undefined as ((path: string) => void) | undefined };
  const download = vi.fn(async (object: string) => {
    const file = manifest.find(row => row.object_path === object)!;
    state.onRead?.(file.path);
    return { data: new Blob([files.get(file.path)! as BlobPart]), error: null };
  });
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query,
      range: async (start: number, end: number) => ({ data: manifest.slice(start, end + 1), error: null }),
      single: async () => ({ error: null, data: table === "academic_collections"
        ? { id: collection, current_revision_id: state.current, withdrawn: false }
        : { id: revision, collection_id: collection, status: "ready", content_hash: state.hash } }) };
    return query;
  }, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
  mocked.client.mockResolvedValue(client);
  return { bank, files, manifest, download, state };
}

beforeEach(() => { vi.stubGlobal("Blob", NativeBlob); mocked.client.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("exports exact declared JSON and an explicit complete manifest without installing or exporting binaries", async () => {
  const f = await fixture();
  const result = await createStoredReviewArchive(course, { key: account, assertCurrent: () => {} });
  const zip = await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer()));
  expect(result).toMatchObject({ includedFiles: 2, omittedFiles: 1 });
  expect(await zip.file("stored-revision/banks/one.json")!.async("string")).toBe(f.bank);
  expect([...await zip.file("stored-revision/catalog.json")!.async("uint8array")]).toEqual([...f.files.get("catalog.json")!]);
  expect(zip.file("catalog.json")).toBeNull();
  expect(Object.keys(zip.files).some(path => path.endsWith(".pdf"))).toBe(false);
  const receipt = JSON.parse(await zip.file("review-manifest.json")!.async("string"));
  expect(receipt).toMatchObject({ collectionId: collection, revisionId: revision, contentHash: "b".repeat(64), binariesIncluded: false, omittedFiles: 1 });
  expect(receipt.files.find((file: { path: string }) => file.path.endsWith(".pdf"))).toMatchObject({ included: false });
  expect(JSON.stringify(receipt)).not.toContain("object_path");
  expect(await zip.file("README.txt")!.async("string")).toContain("not intended as a complete course package or a learner backup");
  expect(f.download).toHaveBeenCalledTimes(2);
});

it.each(["current revision", "revision hash", "account"]) ("discards the export when the %s changes during verified reads", async changed => {
  const f = await fixture(); let accountChanged = false;
  f.state.onRead = path => {
    if (path !== "banks/one.json") return;
    if (changed === "current revision") f.state.current = "44444444-4444-4444-8444-444444444444";
    else if (changed === "revision hash") f.state.hash = "c".repeat(64);
    else accountChanged = true;
  };
  await expect(createStoredReviewArchive(course, { key: account, assertCurrent: () => {
    if (accountChanged) throw new Error("The account changed");
  } })).rejects.toThrow(/changed|verified/);
});

it("refuses altered source bytes against the immutable manifest", async () => {
  const f = await fixture();
  f.files.set("banks/one.json", new TextEncoder().encode("changed"));
  await expect(createStoredReviewArchive(course, { key: account, assertCurrent: () => {} })).rejects.toThrow("integrity check");
});
