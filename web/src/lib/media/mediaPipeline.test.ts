import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMediaAuditReport } from "./audit";
import { detectDuplicateMedia, fingerprintFile } from "./fingerprints";
import { BrowserMediaProcessor, DesktopMediaProcessor } from "./processor";

describe("media pipeline foundation", () => {
  const folders: string[] = [];

  afterEach(() => {
    for (const dir of folders) {
      rmSync(dir, { recursive: true, force: true });
    }
    folders.length = 0;
  });

  it("fingerprints identical content consistently and distinguishes different content", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-media-"));
    folders.push(tempDir);

    const first = join(tempDir, "focus-alpha.mp3");
    const second = join(tempDir, "focus-beta.mp3");
    const payload = Buffer.from("phony audio bytes with stable content\n");
    writeFileSync(first, payload);
    writeFileSync(second, Buffer.from("different content\n"));

    expect(await fingerprintFile(first)).toBe(await fingerprintFile(first));
    expect(await fingerprintFile(first)).not.toBe(await fingerprintFile(second));
  });

  it("detects same-content and same-name duplicate candidates", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-duplicate-"));
    folders.push(tempDir);

    const a = join(tempDir, "rain.mp3");
    const b = join(tempDir, "rain-copy.mp3");
    const c = join(tempDir, "rain-duplicate.mp3");
    const content = Buffer.from("same content for duplicate detection");
    writeFileSync(a, content);
    writeFileSync(b, content);
    writeFileSync(c, Buffer.from("other content"));

    const duplicates = await detectDuplicateMedia([
      { path: a, size: content.length },
      { path: b, size: content.length },
      { path: c, size: Buffer.byteLength("other content") },
    ]);

    expect(duplicates.some((item) => item.paths.includes(a) && item.paths.includes(b))).toBe(true);
    expect(duplicates.find((item) => item.paths.includes(a) && item.paths.includes(b))?.kind).toBe("same-content-different-filename");
  });

  it("distinguishes a same-name collision from identical content", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-name-collision-"));
    folders.push(tempDir);

    const first = join(tempDir, "lecture.mp3");
    const secondDir = join(tempDir, "copy");
    mkdirSync(secondDir);
    const second = join(secondDir, "lecture.mp3");
    writeFileSync(first, "first audio payload");
    writeFileSync(second, "different audio payload");

    const matches = await detectDuplicateMedia([
      { path: first, size: Buffer.byteLength("first audio payload") },
      { path: second, size: Buffer.byteLength("different audio payload") },
    ]);
    expect(matches).toEqual([expect.objectContaining({
      kind: "same-filename-different-content",
      paths: [first, second].sort(),
      hashes: expect.arrayContaining([expect.any(String), expect.any(String)]),
    })]);
  });

  it("reports real streaming progress and rejects stale inventory sizes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-fingerprint-progress-"));
    folders.push(tempDir);
    const file = join(tempDir, "large.bin");
    writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 7));
    const progress: Array<[number, number]> = [];
    await fingerprintFile(file, { onProgress: (done, total) => progress.push([done, total]) });
    expect(progress.at(-1)).toEqual([2 * 1024 * 1024, 2 * 1024 * 1024]);
    await expect(detectDuplicateMedia([{ path: file, size: 1 }])).rejects.toThrow(/size changed/i);
  });

  it("cancels a streaming fingerprint without returning a partial digest", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-fingerprint-cancel-"));
    folders.push(tempDir);
    const file = join(tempDir, "large.bin");
    writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 5));
    const controller = new AbortController();
    const hashing = fingerprintFile(file, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(hashing).rejects.toMatchObject({ name: "AbortError" });
  });

  it("builds a structured audit report with summary totals", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-audit-"));
    folders.push(tempDir);

    const audioPath = join(tempDir, "focus.mp3");
    const imagePath = join(tempDir, "background.png");
    writeFileSync(audioPath, Buffer.alloc(14 * 1024 * 1024));
    writeFileSync(imagePath, Buffer.alloc(1_500_000));

    const report = await buildMediaAuditReport([tempDir], [tempDir]);
    expect(report.summary.audioFiles).toBeGreaterThanOrEqual(1);
    expect(report.summary.backgroundImages).toBeGreaterThanOrEqual(1);
    expect(report.summary.totalBytes).toBeGreaterThan(0);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("classifies ogg audio as audio in the audit report", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-audit-ogg-"));
    folders.push(tempDir);

    const audioPath = join(tempDir, "ambient.ogg");
    writeFileSync(audioPath, Buffer.alloc(2 * 1024 * 1024));

    const report = await buildMediaAuditReport([tempDir], [tempDir]);
    const entry = report.findings.find((item) => item.path.endsWith("ambient.ogg"));
    expect(entry?.mediaType).toBe("audio");
    expect(report.summary.audioFiles).toBeGreaterThanOrEqual(1);
  });

  it("finds references from source roots and reports genuinely missing paths", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-reference-audit-"));
    folders.push(tempDir);
    const audioPath = join(tempDir, "focus.mp3");
    writeFileSync(audioPath, "audio bytes");
    writeFileSync(join(tempDir, "catalog.ts"), 'const src = "focus.mp3"; const absent = "scenes/missing.mp3"; // const sample = "scenes/comment.mp3";');

    const report = await buildMediaAuditReport([tempDir], [tempDir]);
    expect(report.findings[0]).toMatchObject({ referenced: true, source: expect.stringContaining("catalog.ts") });
    expect(report.missingReferences).toContainEqual(expect.objectContaining({
      path: "scenes/missing.mp3",
      sources: expect.arrayContaining([expect.stringContaining("catalog.ts")]),
    }));
    expect(report.missingReferences.some(({ path }) => path === "scenes/comment.mp3")).toBe(false);
    expect(report.summary.missingReferences).toBe(1);
  });

  it("resolves app-root and repository-root references without false missing paths", async () => {
    const repo = mkdtempSync(join(tmpdir(), "axom-audit-roots-"));
    folders.push(repo);
    const publicRoot = join(repo, "web", "public");
    const sourceRoot = join(repo, "web", "src");
    const scenes = join(publicRoot, "scenes");
    mkdirSync(scenes, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(scenes, "earth.mp4"), "scene");
    writeFileSync(join(sourceRoot, "sceneCatalog.ts"), 'const relative = "../public/scenes/earth.mp4"; const rooted = "/scenes/earth.mp4";');

    const report = await buildMediaAuditReport([publicRoot], [sourceRoot], [repo, join(repo, "web")]);
    expect(report.findings[0]).toMatchObject({ referenced: true });
    expect(report.missingReferences).toEqual([]);
  });

  it("resolves relative Tauri bundle icon references from the config directory", async () => {
    const repo = mkdtempSync(join(tmpdir(), "axom-tauri-audit-"));
    folders.push(repo);
    const publicRoot = join(repo, "web", "public");
    const tauriRoot = join(repo, "src-tauri");
    mkdirSync(join(tauriRoot, "icons"), { recursive: true });
    mkdirSync(publicRoot, { recursive: true });
    for (const name of ["32x32.png", "128x128.png", "128x128@2x.png"]) writeFileSync(join(tauriRoot, "icons", name), "icon");
    writeFileSync(join(tauriRoot, "tauri.conf.json"), JSON.stringify({ bundle: { icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png"] } }));

    const report = await buildMediaAuditReport([publicRoot], [tauriRoot], [repo]);
    expect(report.missingReferences).toEqual([]);
  });

  it("retains manifest provenance without treating a source credit as a license", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-provenance-audit-"));
    folders.push(tempDir);
    const assets = join(tempDir, "public");
    const sources = join(tempDir, "src");
    mkdirSync(join(assets, "scenes"), { recursive: true });
    mkdirSync(sources, { recursive: true });
    writeFileSync(join(assets, "scenes", "earth.mp4"), "scene");
    writeFileSync(join(sources, "scenes.json"), JSON.stringify([{ src: "scenes/earth.mp4", credit: "Pixabay" }]));

    const report = await buildMediaAuditReport([assets], [sources]);
    expect(report.findings[0]?.provenance).toMatchObject({ category: "external", sourceName: "Pixabay" });
    expect(report.findings[0]?.provenance.license).toBeUndefined();
    expect(report.summary.externalLicenseUnknown).toBe(1);
    expect(report.findings[0]?.recommendedAction).toMatch(/license is recorded/i);
  });

  it("does not report an explicit generated output path as a missing input", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "axom-generated-output-audit-"));
    folders.push(tempDir);
    const source = join(tempDir, "render.mjs");
    writeFileSync(source, 'const posterOutput = join(root, "generated/poster.png");');

    const report = await buildMediaAuditReport([tempDir], [tempDir]);
    expect(report.missingReferences).toEqual([]);
  });

  it("marks browser optimization as unavailable without pretending it compressed anything", async () => {
    const processor = new BrowserMediaProcessor();
    const result = await processor.optimize({
      id: "x",
      name: "Focus Mix.mp3",
      path: "/tmp/focus.mp3",
      kind: "audio",
      sizeBytes: 30 * 1024 * 1024,
      mimeType: "audio/mpeg",
    });

    expect(result.wasOptimized).toBe(false);
    expect(result.state).toBe("skipped");
    expect(result.optimizedSizeBytes).toBe(result.originalSizeBytes);
  });

  it("does not claim desktop optimization without a real transcoder", async () => {
    const processor = new DesktopMediaProcessor();
    const inspection = await processor.inspect({
      id: "desktop-check",
      name: "Focus.mp3",
      path: "/tmp/focus.mp3",
      kind: "audio",
      sizeBytes: 18 * 1024 * 1024,
      mimeType: "audio/mpeg",
    });

    expect(inspection.state).toBe("skipped");
    expect(inspection.optimizationCandidate).toBe(false);
    const result = await processor.optimize({
      id: "desktop-check",
      name: "Focus.mp3",
      path: "/tmp/focus.mp3",
      kind: "audio",
      sizeBytes: 18 * 1024 * 1024,
      mimeType: "audio/mpeg",
    });
    expect(result).toMatchObject({ state: "skipped", wasOptimized: false, optimizedSizeBytes: 18 * 1024 * 1024, spaceSavedBytes: 0 });
    expect(result.outputPath).toBeUndefined();
  });

  it("reports only the derivative size returned by a real desktop transcoder", async () => {
    const processor = new DesktopMediaProcessor(async () => ({
      outputPath: "/tmp/focus-playback.opus",
      outputSizeBytes: 4 * 1024 * 1024,
      codec: "opus",
      durationSeconds: 120,
    }));
    const result = await processor.optimize({
      id: "desktop-check",
      name: "Focus.wav",
      path: "/tmp/focus.wav",
      kind: "audio",
      sizeBytes: 18 * 1024 * 1024,
      mimeType: "audio/wav",
    });
    expect(result).toMatchObject({
      state: "ready",
      wasOptimized: true,
      originalSizeBytes: 18 * 1024 * 1024,
      optimizedSizeBytes: 4 * 1024 * 1024,
      spaceSavedBytes: 14 * 1024 * 1024,
      codec: "opus",
      outputPath: "/tmp/focus-playback.opus",
    });
    expect(result.outputPath).not.toBe(result.input.path);
  });

  it("rejects a transcoder that overwrites the original", async () => {
    const processor = new DesktopMediaProcessor(async (input) => ({ outputPath: input.path, outputSizeBytes: 10 }));
    const result = await processor.optimize({
      id: "desktop-check",
      name: "Focus.wav",
      path: "/tmp/focus.wav",
      kind: "audio",
      sizeBytes: 18 * 1024 * 1024,
    });
    expect(result.state).toBe("failed");
    expect(result.reason).toMatch(/separate derivative/i);
  });
});
