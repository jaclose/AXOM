// @vitest-environment node
/**
 * Opt-in, metadata-only validation of REAL PRIVATE agent handoffs.
 *
 * Run with AXOM_ACADEMIC_PRIVATE_PORTABLE_ROOT pointing to an ignored
 * portable bundle on the authorized local machine. Never check in academic
 * question bytes, original files, or printed stems in test fixtures/logs.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { assessBank } from "../question-content/assessBank";
import { sha256 } from "../question-content/assets";
import { readCatalog, readPreparedBank, safeLibraryPath } from "../privateLibrary/install";

const root = process.env.AXOM_ACADEMIC_PRIVATE_PORTABLE_ROOT;
describe.skipIf(!root)("private prepared academic corpus intake (opt-in only)", () => {
  it("reconciles every source SHA, native package count, ready/review verdict and missing file explicitly", async () => {
    const parent = resolve(root!);
    const read = (file: string) => {
      const path = resolve(parent, safeLibraryPath(file));
      if (!path.startsWith(parent + sep)) throw new Error("Source escaped the selected private bundle.");
      if (!existsSync(path)) throw new Error("A referenced academic original, package, or figure is absent.");
      const metadata = statSync(path);
      if (!metadata.isFile() || metadata.size > 256 * 1024 * 1024)
        throw new Error("Source is not a regular file within the bounded offline auditor.");
      return new Uint8Array(readFileSync(path));
    };
    const catalog = readCatalog(JSON.parse(new TextDecoder().decode(read("catalog.json"))));
    let sources = 0, review = 0, ready = 0, images = 0, noBank = 0, errors = 0;
    const signatures = new Set<string>();
    for (const entry of catalog.sources) {
      expect(signatures.has(entry.checksum), "Each canonical catalog source must have unique SHA-256; mirrors belong in a duplicate map.")
        .toBe(false);
      signatures.add(entry.checksum);
      sources++;
      if (entry.originalFile) {
        const original = read(entry.originalFile);
        expect(await sha256(original), `Original SHA mismatch for source ${entry.id}`).toBe(`sha256:${entry.checksum}`);
      }
      if (!entry.bankFile) {
        noBank++;
        continue;
      }
      const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(read(entry.bankFile))));
      const names = [];
      for (const question of bank.pkg.questions) {
        const sourceHash = question.provenance.sourceChecksum?.replace(/^sha256:/, "");
        if (sourceHash) expect(sourceHash, `Question-to-source provenance SHA mismatch for source ${entry.id}`)
          .toBe(entry.checksum);
        for (const asset of question.assets) {
          names.push({ name: asset.filename });
          images++;
        }
      }
      const verdict = assessBank(bank.pkg, bank.issues, names);
      const held = verdict.counts["needs-review"] + verdict.counts.unresolved + (bank.unreadableQuestions ?? 0);
      expect([verdict.counts.ready, held], `Declared bank counts disagree with canonical assessment for source ${entry.id}`)
        .toEqual([entry.ready, entry.review]);
      ready += verdict.counts.ready;
      review += held;
      errors += verdict.issues.filter(issue => issue.severity === "error" && !issue.questionId).length;
    }
    expect(errors, "No bank-level errors are acceptable in a prepared private corpus.").toBe(0);
    expect(sources).toBe(catalog.sources.length);
    // Safe diagnostic: counts only, never raw question text, answers or paths.
    console.info(JSON.stringify({ sourceFiles: sources, bankFiles: sources - noBank,
      originalSHARechecked: catalog.sources.filter(s => !!s.originalFile).length,
      verifiedReady: ready, heldForReview: review, referencedFigures: images, bankLevelErrors: errors }));
  }, 120_000);
});
