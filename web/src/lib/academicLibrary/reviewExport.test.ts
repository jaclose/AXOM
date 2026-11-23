// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { PRIVATE_LIBRARY_FORMAT } from "../privateLibrary/types";
import { zipLibraryReader } from "../privateLibrary/fileInput";
import { createStoredReviewArchive, createStoredSourceArchive } from "./reviewExport";
import { academicLibraryReader } from "./client";

const mocked = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./client", async original => ({ ...await original<typeof import("./client")>(), academicClient: (...args: unknown[]) => mocked.client(...args) }));
const account = "11111111-1111-4111-8111-111111111111";
const collection = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const course = { id: collection, current_revision_id: revision, module: "Example course" };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

async function fixture(extra: Record<string, Uint8Array> = {}) {
  const bank = '{ "questions": [], "reviewNote": "Preserve these exact stored bytes, including spacing." }\n';
  const catalog = { format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "review-example", version: "1", templates: [],
    sources: [{ id: "one", name: "Example.txt", sourcePath: "Example.txt", checksum: "a".repeat(64), module: "GOER",
      status: "prepared", reason: "Example", bankFile: "banks/one.json", ready: 0, review: 1 }] };
  const files = new Map<string, Uint8Array>([["catalog.json", encode(catalog)], ["banks/one.json", new TextEncoder().encode(bank)],
    ["originals/example.pdf", new TextEncoder().encode("%PDF-1.7 supplied original")], ...Object.entries(extra)]);
  const manifest = await Promise.all([...files].map(async ([path, bytes]) => {
    const hash = (await sha256(bytes)).slice(7);
    return { path, sha256: hash, byte_size: bytes.length, object_path: `${collection}/${hash}`,
      mime_type: path.endsWith(".json") ? "application/json" : path.endsWith(".pdf") ? "application/pdf"
        : path.endsWith(".png") ? "image/png" : "text/plain" };
  }));
  const state = { current: revision, hash: "b".repeat(64), status: "ready", withdrawn: false, denied: false,
    onRead: undefined as ((path: string) => void | Promise<void>) | undefined };
  const download = vi.fn(async (object: string) => {
    const file = manifest.find(row => row.object_path === object)!;
    await state.onRead?.(file.path);
    return { data: new Blob([files.get(file.path)! as BlobPart]), error: null };
  });
  const range = vi.fn(async (start: number, end: number) => ({ data: manifest.slice(start, end + 1), error: null }));
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query,
      range,
      single: async () => ({ error: state.denied ? { message: "Access denied" } : null, data: table === "academic_collections"
        ? { id: collection, current_revision_id: state.current, withdrawn: state.withdrawn }
        : { id: revision, collection_id: collection, status: state.status, content_hash: state.hash } }) };
    return query;
  }, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
  mocked.client.mockResolvedValue(client);
  return { bank, files, manifest, download, range, state };
}

const scope = () => ({ key: account, assertCurrent: () => {} });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

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

it("exports every exact manifest file and the normal ZIP reader selects only the stored package folder", async () => {
  const f = await fixture({ "images/figure.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    "templates/course.txt": new TextEncoder().encode("Week placement remains unassigned."),
    "images/retained-original.txt": new TextEncoder().encode("Stored but not referenced by the current bank.") });
  const progress = vi.fn();
  const result = await createStoredSourceArchive(course, scope(), progress);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  expect(result).toMatchObject({ includedFiles: f.files.size, omittedFiles: 0,
    fileName: `AXOM_Example_course_Source_Package_${revision}.zip` });
  expect(mocked.client).toHaveBeenCalledWith(account);
  expect(f.download).toHaveBeenCalledTimes(f.files.size);
  for (const [path, original] of f.files) {
    expect([...await zip.file(`stored-revision/${path}`)!.async("uint8array")]).toEqual([...original]);
  }
  expect(Object.values(zip.files).filter(file => !file.dir).length).toBe(f.files.size + 2);
  const receipt = JSON.parse(await zip.file("source-manifest.json")!.async("string"));
  expect(receipt).toMatchObject({ format: "axom-stored-source-package", collectionId: collection,
    revisionId: revision, contentHash: "b".repeat(64), binariesIncluded: true, includedFiles: f.files.size, omittedFiles: 0 });
  expect(receipt.files.every((file: { included: boolean }) => file.included)).toBe(true);
  expect(JSON.stringify(receipt)).not.toContain("object_path");
  expect(await zip.file("README.txt")!.async("string")).toContain("exact stored bytes");
  expect(progress).toHaveBeenCalledWith(`Preparing source package · ${f.files.size} of ${f.files.size}`);
  const file = new NativeFile([bytes], result.fileName, { type: "application/zip" });
  const read = await zipLibraryReader(file as unknown as File);
  for (const [path, original] of f.files) expect([...await read(path)]).toEqual([...original]);
  await expect(read("source-manifest.json")).rejects.toThrow(/missing/i);
  await expect(read("README.txt")).rejects.toThrow(/missing/i);
});

it.each(["account", "current revision", "revision hash", "withdrawn", "revision status"])(
  "discards a full source export when %s changes during a binary read", async changed => {
    const f = await fixture(); let accountChanged = false;
    f.state.onRead = path => {
      if (!path.endsWith(".pdf")) return;
      if (changed === "account") accountChanged = true;
      else if (changed === "current revision") f.state.current = "44444444-4444-4444-8444-444444444444";
      else if (changed === "revision hash") f.state.hash = "c".repeat(64);
      else if (changed === "withdrawn") f.state.withdrawn = true;
      else f.state.status = "uploading";
    };
    await expect(createStoredSourceArchive(course, { key: account, assertCurrent: () => {
      if (accountChanged) throw new Error("The account changed");
    } })).rejects.toThrow(/changed|verified|accessible/);
  },
);

it.each(["session", "permission"])("does not read files without %s authorization", async denied => {
  const f = await fixture();
  if (denied === "session") mocked.client.mockRejectedValue(new Error("The signed-in account changed"));
  else f.state.denied = true;
  await expect(createStoredSourceArchive(course, scope())).rejects.toThrow(/changed|accessible/);
  expect(f.download).not.toHaveBeenCalled();
});

it.each(["hash", "size"])("refuses a binary with an incorrect %s", async incorrect => {
  const f = await fixture();
  const original = f.files.get("originals/example.pdf")!;
  const changed = incorrect === "hash" ? original.slice() : new Uint8Array(original.length + 1);
  changed[0] ^= 1;
  f.files.set("originals/example.pdf", changed);
  await expect(createStoredSourceArchive(course, scope())).rejects.toThrow("integrity check");
});

it.each(["../escape.pdf", "C:/escape.pdf", "originals/back\\slash.pdf", "originals/control\u0000.pdf",
  "originals/cafe\u0301.pdf", "a".repeat(1025)])("refuses an unsafe or noncanonical archive path %j", async path => {
  const f = await fixture();
  f.manifest[2].path = path;
  await expect(createStoredSourceArchive(course, scope())).rejects.toThrow(/path|Unsafe/);
  expect(f.download).not.toHaveBeenCalled();
});

it.each(["case", "directory"])("refuses a %s path collision before downloading", async collision => {
  const f = await fixture();
  f.manifest.push({ ...f.manifest[2], path: collision === "case" ? "CATALOG.JSON" : "banks" });
  await expect(createStoredSourceArchive(course, scope())).rejects.toThrow(/conflicting/);
  expect(f.download).not.toHaveBeenCalled();
});

it.each(["file count", "file size", "total size"])("enforces the existing %s bound before any file read", async limit => {
  const f = await fixture();
  if (limit === "file count") {
    while (f.manifest.length <= 1500) f.manifest.push({ ...f.manifest[2], path: `retained/${f.manifest.length}.pdf` });
  } else if (limit === "file size") f.manifest[2].byte_size = 50 * 1024 * 1024 + 1;
  else {
    f.manifest[2].byte_size = 50 * 1024 * 1024;
    for (let i = 0; i < 10; i++) f.manifest.push({ ...f.manifest[2], path: `retained/${i}.pdf` });
  }
  await expect(createStoredSourceArchive(course, scope())).rejects.toThrow(/manifest|supported download size/);
  expect(f.download).not.toHaveBeenCalled();
});

it("includes files beyond the first manifest page without parallel binary reads", async () => {
  const extra = Object.fromEntries(Array.from({ length: 498 }, (_, i) => [`retained/${i}.txt`, encode(i)]));
  const f = await fixture(extra);
  let reading = 0, peak = 0;
  f.state.onRead = async () => { reading++; peak = Math.max(peak, reading); await Promise.resolve(); reading--; };
  const result = await createStoredSourceArchive(course, scope());
  const zip = await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer()));
  expect(result.includedFiles).toBe(501);
  expect(f.range.mock.calls).toEqual([[0, 499], [500, 999]]);
  expect(f.download).toHaveBeenCalledTimes(501);
  expect(await zip.file("stored-revision/retained/497.txt")!.async("string")).toBe("497");
  expect(peak).toBe(1);
});

it("prevents simultaneous source and review exports and releases the lock after failure", async () => {
  const f = await fixture(); const pending = deferred(); const started = deferred();
  f.state.onRead = async path => { if (path === "catalog.json") { started.resolve(); await pending.promise; } };
  const first = createStoredSourceArchive(course, scope());
  await started.promise;
  await expect(createStoredReviewArchive(course, scope())).rejects.toThrow("Another course export");
  expect(mocked.client).toHaveBeenCalledTimes(1);
  f.state.withdrawn = true; pending.resolve();
  await expect(first).rejects.toThrow("no longer accessible");
  f.state.withdrawn = false; f.state.onRead = undefined;
  await expect(createStoredReviewArchive(course, scope())).resolves.toMatchObject({ includedFiles: 2 });
});

it("rechecks account scope after archive construction before returning any download", async () => {
  await fixture(); let invalid = false;
  await expect(createStoredSourceArchive(course, { key: account, assertCurrent: () => {
    if (invalid) throw new Error("The account changed");
  } }, message => { if (message === "Building the source package…") invalid = true; })).rejects.toThrow("account changed");
});


// R206: the shared download reader must reject manifest paths that cannot round-trip
// through a portable source package, before fetching any original learner media.
it.each([
  ["case-insensitive duplicate", "CATALOG.JSON", "append"],
  ["NFC alias", "originals/cafe\u0301.pdf", "replace"],
  ["file-directory conflict", "banks", "append"],
  ["Windows drive path", "C:/course.pdf", "replace"],
] as const)("rejects a %s at the shared academic reader boundary", async (_name, path, mode) => {
  const f = await fixture();
  if (mode === "append") f.manifest.push({ ...f.manifest[2], path });
  else f.manifest[2].path = path;
  await expect(academicLibraryReader(await mocked.client(), revision)).rejects.toThrow(/Invalid course file manifest/);
  expect(f.download).not.toHaveBeenCalled();
});

it("accepts a valid canonical nested manifest and reads its exact bytes", async () => {
  const f = await fixture();
  const reader = await academicLibraryReader(await mocked.client(), revision);
  expect(reader.files.map(file => file.path)).toEqual(f.manifest.map(file => file.path));
  expect([...await reader("banks/one.json")]).toEqual([...f.files.get("banks/one.json")!]);
  expect(f.download).toHaveBeenCalledTimes(1);
});


// R207: cloud academic manifests must be usable as portable source-package paths.
// Reject unsafe metadata before any source/original binary is downloaded.
it.each([
  ["Windows device name", "originals/CON.pdf"],
  ["Windows reserved device with extension", "originals/com1.txt"],
  ["alternate data stream delimiter", "originals/lecture:notes.pdf"],
  ["Windows wildcard", "originals/scan?.png"],
  ["Windows terminal dot", "originals/notes."],
  ["Windows terminal space", "originals/notes "],
  ["overlong UTF-8 component", `originals/${"é".repeat(128)}.pdf`],
] as const)("refuses a %s in a cloud source manifest before any binary read", async (_kind, path) => {
  const f = await fixture();
  f.manifest[2].path = path;
  await expect(academicLibraryReader(await mocked.client(), revision)).rejects.toThrow(/Invalid course file manifest.*path/);
  expect(f.download).not.toHaveBeenCalled();
});

it("keeps ordinary source filenames with spaces, # and canonical Unicode intact", async () => {
  const named = "originals/Café #3 study notes.pdf";
  const bytes = new TextEncoder().encode("Unmodified stored source bytes");
  const f = await fixture({ [named]: bytes });
  const reader = await academicLibraryReader(await mocked.client(), revision);
  expect(reader.files.some(file => file.path === named)).toBe(true);
  expect([...await reader(named)]).toEqual([...bytes]);
  expect(f.download).toHaveBeenCalledTimes(1);
});
