// @vitest-environment node
/**
 * Opt-in, read-only integrity audit for the five original private GOER
 * collections. File paths originate from ignored source ledgers on the Mac.
 * Never commit copies of medical sources/figures or log their question text.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { assessBank } from "../question-content/assessBank";
import { readImageInfo, sha256 } from "../question-content/assets";
import { readPreparedBank } from "../privateLibrary/install";

type Entry = {
  bank_id: string;
  canonical_package: string;
  source_path: string;
  questions: number;
  referenced_assets: number;
  questions_sha256?: string;
};
const indexFile = process.env.AXOM_PRIVATE_GOER_INDEX;
describe.skipIf(!indexFile)("actual private GOER source / figures integrity audit (opt-in)", () => {
  it("validates 5 canonical banks, 155 figure files / 203 references, and refuses answer-field inflation", async () => {
    const entries = JSON.parse(readFileSync(indexFile!, "utf8")) as Entry[];
    expect(entries).toHaveLength(5);
    const byBank = new Set<string>();
    const physicalFigures = new Map<string, string>();
    const summaries = { uniqueCollections: 0, questions: 0, ready: 0, review: 0, figureRefs: 0, declaredAssetFiles: 0, uniqueFigures: 0, missing: 0 };
    for (const entry of entries) {
      expect(byBank.has(entry.bank_id)).toBe(false);
      byBank.add(entry.bank_id);
      const folder = resolve(entry.canonical_package);
      expect(existsSync(folder)).toBe(true);
      expect(existsSync(join(folder, "prepared-bank.json"))).toBe(true);
      const bank = readPreparedBank(JSON.parse(readFileSync(join(folder, "prepared-bank.json"), "utf8")));
      expect(bank.pkg.questions.length).toBe(entry.questions);
      const nativeQuestions = readFileSync(join(folder, "questions.json"));
      if (entry.questions_sha256) expect(await sha256(nativeQuestions))
        .toBe(`sha256:${entry.questions_sha256}`);
      const sourcePath = resolve(entry.source_path);
      if (!sourcePath.startsWith(folder + sep) || !existsSync(sourcePath))
        throw new Error("A canonical GOER bank's original source is unavailable in its private package.");
      const originalSha = await sha256(readFileSync(sourcePath));
      const images: { name: string }[] = [];
      const seenBankAssetNames = new Map<string, string>();
      for (const question of bank.pkg.questions) {
        const sourceCheck = question.provenance.sourceChecksum;
        expect(sourceCheck).toBe(originalSha);
        for (const asset of question.assets) {
          if (!asset.checksum || !/^sha256:[a-f0-9]{64}$/.test(asset.checksum))
            throw new Error("An original GOER figure has no usable source checksum.");
          const file = resolve(folder, "assets", asset.filename);
          if (!file.startsWith(resolve(folder, "assets") + sep) || !existsSync(file)) {
            summaries.missing++;
            continue;
          }
          const st = statSync(file);
          expect(st.isFile() && st.size > 0 && st.size <= 8 * 1024 * 1024).toBe(true);
          const bytes = new Uint8Array(readFileSync(file));
          const info = readImageInfo(bytes);
          expect(info?.mimeType).toBe(asset.mimeType);
          expect(await sha256(bytes)).toBe(asset.checksum);
          images.push({ name: asset.filename });
          const previous = seenBankAssetNames.get(asset.filename);
          if (previous && previous !== asset.checksum)
            throw new Error("A figure filename refers to conflicting bytes inside one medical question bank.");
          seenBankAssetNames.set(asset.filename, asset.checksum);
          summaries.figureRefs++;
          const hash = asset.checksum;
          if (!physicalFigures.has(hash)) physicalFigures.set(hash, file);
        }
      }
      // A present answer field is not automatically a reviewed, usable
      // question: retain the canonical assessor's exact ready/review verdict.
      const assessed = assessBank(bank.pkg, bank.issues, images);
      summaries.ready += assessed.counts.ready;
      summaries.review += assessed.counts["needs-review"] + assessed.counts.unresolved;
      summaries.questions += bank.pkg.questions.length;
      summaries.uniqueCollections++;
      expect(assessed.counts.ready + assessed.counts["needs-review"] + assessed.counts.unresolved)
        .toBe(bank.pkg.questions.length);
      expect(seenBankAssetNames.size).toBe(entry.referenced_assets);
      summaries.declaredAssetFiles += seenBankAssetNames.size;
    }
    summaries.uniqueFigures = physicalFigures.size;
    expect(summaries.missing).toBe(0);
    expect(summaries).toMatchObject({
      uniqueCollections: 5, questions: 72, ready: 28, review: 44, declaredAssetFiles: 155, missing: 0,
    });
    console.info(JSON.stringify(summaries)); // counts only; content stays off Git
  }, 120_000);
});
