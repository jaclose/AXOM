import { describe, expect, it, vi } from "vitest";
import { MediaAssetService, type MediaFingerprintService, type MediaMetadataInspector } from "./assetService";
import { MediaJobQueue } from "./jobs";
import type { MediaAsset, MediaAssetRepository } from "./model";

const HASH = "c".repeat(64);

function memoryRepository() {
  const assets = new Map<string, MediaAsset>();
  let writes = 0;
  const repository: MediaAssetRepository = {
    async findByHash(hash) { return assets.get(hash); },
    async insertOriginalIfAbsent(asset, _blob) {
      const existing = assets.get(asset.original.sha256);
      if (existing) return { asset: existing, created: false };
      writes += 1;
      assets.set(asset.original.sha256, asset);
      return { asset, created: true };
    },
  };
  return { repository, get writes() { return writes; } };
}

function fingerprintService(): MediaFingerprintService {
  return {
    async fingerprint(blob, options) {
      options?.onProgress?.({ processedBytes: blob.size, totalBytes: blob.size, fraction: 1 });
      return { sha256: HASH, sizeBytes: blob.size };
    },
    dispose() {},
  };
}

const inspector: MediaMetadataInspector = {
  async inspect() { return { durationSeconds: 123.5, inspection: "complete" }; },
};

describe("MediaAssetService", () => {
  it("runs fingerprint and inspection jobs, returning a content-addressed original", async () => {
    const repository = memoryRepository();
    const queue = new MediaJobQueue({ createId: (() => { let id = 0; return () => `media-${++id}`; })() });
    const seen: string[] = [];
    const service = new MediaAssetService({ jobs: queue, fingerprinter: fingerprintService(), inspector, repository: repository.repository, onJob: (job) => seen.push(`${job.type}:${job.state}`) });
    const blob = new Blob(["one canonical original"], { type: "audio/mpeg" });
    const result = await service.ingest({ blob, name: "Focus Mix.mp3", declaredMimeType: "audio/mpeg", kind: "audio", provenance: { category: "user-supplied" } });

    expect(result.duplicate).toBe(false);
    expect(result.asset).toMatchObject({
      id: `sha256:${HASH}`,
      kind: "audio",
      original: { name: "Focus Mix.mp3", byteSize: blob.size, sha256: HASH },
      metadata: { durationSeconds: 123.5, inspection: "complete" },
      derivatives: [],
      provenance: { category: "user-supplied" },
      sync: { state: "local-only" },
    });
    expect(repository.writes).toBe(1);
    expect(seen).toContain("fingerprint:running");
    expect(seen).toContain("inspect:completed");
    service.dispose();
    queue.dispose();
  });

  it("deduplicates by exact content before storing a second original", async () => {
    const repository = memoryRepository();
    const queue = new MediaJobQueue({ concurrency: 2 });
    const service = new MediaAssetService({ jobs: queue, fingerprinter: fingerprintService(), inspector, repository: repository.repository });
    const first = await service.ingest({ blob: new Blob(["same bytes"]), name: "First.wav", declaredMimeType: "audio/wav", kind: "audio", provenance: { category: "user-supplied" } });
    const second = await service.ingest({ blob: new Blob(["same bytes"]), name: "Renamed copy.wav", declaredMimeType: "audio/wav", kind: "audio", provenance: { category: "user-supplied" } });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.original.name).toBe("First.wav");
    expect(repository.writes).toBe(1);
    service.dispose();
    queue.dispose();
  });

  it("lets the repository resolve concurrent duplicate imports atomically", async () => {
    const repository = memoryRepository();
    const queue = new MediaJobQueue({ concurrency: 2 });
    const service = new MediaAssetService({ jobs: queue, fingerprinter: fingerprintService(), inspector: { inspect: vi.fn(async () => ({ inspection: "partial", warnings: ["duration unavailable"] })) }, repository: repository.repository });
    const makeInput = (name: string) => ({ blob: new Blob(["race"]), name, declaredMimeType: "audio/unknown", kind: "audio" as const, provenance: { category: "user-supplied" as const } });
    const results = await Promise.all([service.ingest(makeInput("a.mp3")), service.ingest(makeInput("b.mp3"))]);

    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0].asset.id).toBe(results[1].asset.id);
    expect(repository.writes).toBe(1);
    service.dispose();
    queue.dispose();
  });

  it("preserves original metadata when browser inspection is partial", async () => {
    const service = new MediaAssetService({
      jobs: new MediaJobQueue(),
      fingerprinter: fingerprintService(),
      inspector: { inspect: async () => ({ inspection: "partial", warnings: ["codec not decoded"] }) },
    });
    const result = await service.inspect({ blob: new Blob(["opaque"]), name: "Unknown.aac", declaredMimeType: "audio/aac", kind: "audio", provenance: { category: "unknown" } });

    expect(result).toMatchObject({ sha256: HASH, declaredMimeType: "audio/aac", inspection: "partial", warnings: ["codec not decoded"] });
    service.dispose();
  });
});
