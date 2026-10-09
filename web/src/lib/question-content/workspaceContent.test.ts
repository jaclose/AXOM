import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkspaceContent } from "./workspaceContent";
import { effectiveRole, isAssetVisible, visibleBlocks } from "./visibility";
import { parseImport, toPortableState } from "../backup";
import { makeSeed } from "../seed";
import { parsePackage } from "./packageJson";

const fixture = join(process.cwd(), "..", "fixtures/qbank/synthetic/multimodal-shapes");
const pkg = parsePackage(readFileSync(join(fixture, "manifest.json"), "utf8"), readFileSync(join(fixture, "questions.json"), "utf8")).package!;

describe("ordered workspace content", () => {
  it("survives portable export and restore with attachment identities and reveal restrictions", () => {
    const state = makeSeed();
    const content = pkg.questions.find(q => q.id === "syn-q03")!;
    state.questions = [{ id: "q1", source: "imported", stem: "Example", options: [], status: "unseen", tags: [], attempts: [], createdAt: "2026-10-08", updatedAt: "2026-10-08", content,
      attachments: [{ id: "a1", altText: "Source answer slide", assetId: content.assets[1].id, role: "answer_reveal", fileName: content.assets[1].filename, blobKey: "a1", mimeType: "image/png", byteSize: 10, createdAt: "2026-10-08", updatedAt: "2026-10-08" }] }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.questions[0].content).toEqual(content);
    expect(restored.questions[0].attachments?.[0]).toMatchObject({ assetId: content.assets[1].id, role: "answer_reveal" });
  });
  it("refuses malformed source content rather than silently stripping it", () => {
    expect(readWorkspaceContent({ stem: "bad" }).errors.length).toBeGreaterThan(0);
    const state = makeSeed();
    expect(() => parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state), questions: [{ id: "bad", stem: "Example", content: { stem: "bad" } }] }))).toThrow();
  });
  it("takes the most restrictive role when a placement disagrees with its image", () => {
    for (const role of ["answer_reveal", "explanation", "reference", "source_page"] as const) {
      const effective = effectiveRole("stem", role, "stem");
      expect(isAssetVisible(effective, "question")).toBe(false);
      expect(visibleBlocks([{ type: "image", assetId: "asset", role: "stem" }], "question", () => effective)).toEqual([]);
    }
    expect(isAssetVisible(effectiveRole("answer_reveal", "source_page", "stem"), "answered")).toBe(false);
  });
});
