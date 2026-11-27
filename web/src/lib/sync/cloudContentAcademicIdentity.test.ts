// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudContentCache, hydrateCloudContent, readContentReferences, type ContentReference } from "./cloudContent";

// Real manifest, download and SHA checks; deterministic bank parser and adapter.
vi.mock("../privateLibrary/install", async (importOriginal) => ({
  ...await importOriginal<typeof import("../privateLibrary/install")>(),
  readPreparedBank: vi.fn(() => ({})),
}));
vi.mock("../academicLibrary/contentReferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("../academicLibrary/contentReferences")>(),
  academicRecord: vi.fn(() => ({ stem: "Synthetic source" })),
}));

const REV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PATH = "banks/source.json";
const OWNER = "synthetic-account";
const PACKED = JSON.stringify({ stem: "Synthetic source" });
const BANK = "{}";
const guard = async () => {};

async function fixture() {
  const assetHash = await sha256(new TextEncoder().encode(BANK));
  const hash = await sha256(new TextEncoder().encode(PACKED));
  const denied = new Set<string>();
  const checked: string[] = [];
  const downloads: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "academic_files") throw new Error("Unexpected table");
      return {
        select() {
          let revision = "";
          let path = "";
          const query = {
            eq(column: string, value: string) {
              if (column === "revision_id") revision = value.toLowerCase();
              else if (column === "path") path = value;
              else throw new Error("Unexpected filter");
              return query;
            },
            async single() {
              checked.push(revision + ":" + path);
              return denied.has(revision)
                ? { data: null, error: { message: "Synthetic denied" } }
                : { data: { object_path: revision + "/" + path, sha256: assetHash, byte_size: BANK.length, mime_type: "application/json" }, error: null };
            },
          };
          return query;
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            downloads.push(bucket + "/" + path);
            if (bucket === "academic-content") return { data: new Blob([BANK]), error: null };
            if (bucket === "workspace-content") return { data: new Blob([PACKED]), error: null };
            throw new Error("Unexpected bucket");
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  function ref(id: string, revision = REV_A, sha = assetHash): ContentReference {
    return { collection: "questions", id, hash, byteSize: PACKED.length, expandedBytes: PACKED.length,
      academic: { revisionId: revision, path: PATH, sha256: sha, adapterVersion: 1, kind: "question", questionId: id, reviewedAt: "2026-11-01T00:00:00Z" } };
  }
  function stateFor(refs: ContentReference[]) {
    const state = makeSeed();
    state.documents = [];
    state.questions = refs.map(ref => ({ id: ref.id, notes: "Keep learner overlay" }) as NoctyriumState["questions"][number]);
    return state;
  }
  return { client, denied, checked, downloads, ref, stateFor };
}

beforeEach(() => clearCloudContentCache());

describe("academic source hydration binds immutable asset identity", () => {
  it.each([false, true])("rejects conflicting file hashes before I/O (reverse=%s)", async reverse => {
    const { client, checked, downloads, ref, stateFor } = await fixture();
    const refs = [ref("a"), ref("b", REV_A, "f".repeat(64))];
    if (reverse) refs.reverse();
    const state = stateFor(refs);
    const before = JSON.stringify(state);
    expect(() => readContentReferences(refs)).toThrow(/conflicting academic file hashes/);
    await expect(hydrateCloudContent(client, OWNER, state, refs, guard)).rejects.toThrow(/conflicting academic file hashes/);
    expect(checked).toEqual([]);
    expect(downloads).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("recognizes UUID case aliases without rewriting reference metadata", async () => {
    const { ref } = await fixture();
    const refs = [ref("a"), ref("b", REV_A.toUpperCase(), "f".repeat(64))];
    const before = JSON.stringify(refs);
    expect(() => readContentReferences(refs)).toThrow(/conflicting academic file hashes/);
    expect(JSON.stringify(refs)).toBe(before);
  });

  it("reuses one verified file within a call, preserving distinct records and overlays", async () => {
    const { client, checked, downloads, ref, stateFor } = await fixture();
    const refs = [ref("a"), ref("b")];
    const state = stateFor(refs);
    const before = JSON.stringify(state);
    const result = await hydrateCloudContent(client, OWNER, state, refs, guard);
    expect(result.questions.map(q => [q.id, q.stem, q.notes])).toEqual([
      ["a", "Synthetic source", "Keep learner overlay"], ["b", "Synthetic source", "Keep learner overlay"],
    ]);
    expect(checked).toEqual([REV_A + ":" + PATH]);
    expect(downloads).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("checks distinct revisions even if reconstructed text and asset bytes match", async () => {
    const { client, checked, ref, stateFor } = await fixture();
    const refs = [ref("a"), ref("b", REV_B)];
    await hydrateCloudContent(client, OWNER, stateFor(refs), refs, guard);
    expect(checked.sort()).toEqual([REV_A + ":" + PATH, REV_B + ":" + PATH]);
  });

  it("cannot reuse a prior academic hydration after access is denied", async () => {
    const { client, checked, denied, ref, stateFor } = await fixture();
    const refs = [ref("a")];
    const state = stateFor(refs);
    const before = JSON.stringify(state);
    await hydrateCloudContent(client, OWNER, state, refs, guard);
    denied.add(REV_A);
    await expect(hydrateCloudContent(client, OWNER, state, refs, guard)).rejects.toThrow(/unavailable to your account/);
    expect(checked).toHaveLength(2);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("does not let private cached text authorize an academic revision", async () => {
    const { client, checked, downloads, denied, ref, stateFor } = await fixture();
    const privateRef = { ...ref("private"), academic: undefined };
    const privateState = stateFor([privateRef]);
    await hydrateCloudContent(client, OWNER, privateState, [privateRef], guard);
    await hydrateCloudContent(client, OWNER, privateState, [privateRef], guard);
    expect(downloads).toHaveLength(1);
    denied.add(REV_B);
    const refs = [ref("academic", REV_B)];
    await expect(hydrateCloudContent(client, OWNER, stateFor(refs), refs, guard)).rejects.toThrow(/unavailable to your account/);
    expect(checked).toEqual([REV_B + ":" + PATH]);
  });

  it("refuses a mismatched asset claim despite a previously verified source projection", async () => {
    const { client, checked, ref, stateFor } = await fixture();
    const refs = [ref("a")];
    const state = stateFor(refs);
    await hydrateCloudContent(client, OWNER, state, refs, guard);
    await expect(hydrateCloudContent(client, OWNER, state, [ref("a", REV_A, "f".repeat(64))], guard)).rejects.toThrow(/unavailable to your account/);
    expect(checked).toHaveLength(2);
  });

  it("preserves the input when the account guard fails at final adoption", async () => {
    const { client, ref, stateFor } = await fixture();
    const refs = [ref("a")];
    const state = stateFor(refs);
    const before = JSON.stringify(state);
    let checks = 0;
    await expect(hydrateCloudContent(client, OWNER, state, refs, async () => {
      if (++checks > 1) throw new Error("Account changed");
    })).rejects.toThrow(/Account changed/);
    expect(JSON.stringify(state)).toBe(before);
  });
});
