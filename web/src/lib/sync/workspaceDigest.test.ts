import { describe, expect, it } from "vitest";
import { canonicalJson } from "../compressedText";
import { workspaceDigest } from "./workspaceDigest";

describe("incremental canonical workspace digest", () => {
  it("matches across reloads and key order while measuring exact UTF-8 JSON bytes", async () => {
    const original = { z: [null, undefined, "figuré 🧠", 0, false], a: { omitted: undefined, nested: "\n\"" } };
    const text = canonicalJson(original);
    const result = await workspaceDigest(original);
    expect(await workspaceDigest(JSON.parse(text))).toEqual(result);
    expect(result.bytes).toBe(new TextEncoder().encode(text).length);
    expect((await workspaceDigest({ ...original, z: [...original.z, 1] })).hash).not.toBe(result.hash);
  });
  it("does not revisit an unchanged source graph when a learner answer changes", async () => {
    let reads = 0;
    const document = { id: "source", get rawText() { reads++; return "Large source. ".repeat(100000); } };
    const documents = [document];
    const first = await workspaceDigest({ documents, answer: "A" }); const before = reads;
    const next = await workspaceDigest({ documents, answer: "B" });
    expect(reads).toBe(before); expect(next.hash).not.toBe(first.hash); expect(next.bytes).toBe(first.bytes);
  });
  it("refuses cycles instead of hanging the outbox", async () => {
    const value: { child?: unknown } = {}; value.child = value;
    await expect(workspaceDigest(value)).rejects.toThrow(/circular/);
  });
});
