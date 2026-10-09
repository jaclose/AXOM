// @vitest-environment jsdom
// A local tool, skipped unless asked for. It takes each real bank that
// buildBank.local.test.ts has built on this machine through the same import
// and save code the app uses, into an in-memory workspace, and prints counts.
//
//   AXOM_QBANK_PERSIST=1 npx vitest run src/lib/question-content/pdf/persistBank.local.test.ts
//
// Nothing a question says is printed, and nothing is written outside memory.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePackage } from "../packageJson";
import { closeWorkspace, importPackage, openEmptyWorkspace, reloadWorkspace, storedImageCount, workspaceOnDisk } from "../persistenceHarness.testing";
import { countReadiness } from "../readiness";
import { validatePackage } from "../validate";

const fixtures = join(process.cwd(), "..", "fixtures", "qbank");
const say = (...parts: unknown[]): void => void process.stdout.write(`${parts.join(" ")}\n`);

function built(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "synthetic" || !statSync(path).isDirectory()) return [];
    return existsSync(join(path, "questions.json")) ? [path] : built(path);
  });
}

beforeEach(openEmptyWorkspace);
afterEach(closeWorkspace);

describe.skipIf(!process.env.AXOM_QBANK_PERSIST)("real banks through the canonical import, in memory only", () => {
  for (const directory of built(fixtures)) {
    it(`imports, reloads and retries ${directory.split("/").pop()}`, async () => {
      const parsed = parsePackage(readFileSync(join(directory, "manifest.json"), "utf8"), readFileSync(join(directory, "questions.json"), "utf8"));
      const pkg = parsed.package!;
      const names = readdirSync(join(directory, "assets")).filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name));
      const issues = [...parsed.issues, ...validatePackage(pkg, { assetFiles: new Set(names) })];
      const files = names.map((name) => new File([new Uint8Array(readFileSync(join(directory, "assets", name)))], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" }));
      const readiness = countReadiness(pkg.questions, issues);

      const first = await importPackage(pkg, issues, files);
      say(`\n=== ${pkg.manifest.bank.id}`);
      say(`  package: ${pkg.questions.length} questions  READY ${readiness.ready}  NEEDS REVIEW ${readiness["needs-review"]}  UNRESOLVED ${readiness.unresolved}`);
      say(`  filing: ${first.filing.module}, week ${first.filing.week}, term ${first.filing.term}; the curriculum puts ${first.filing.module} in ${first.filing.curriculumTerm ?? "no term it knows"}: ${first.filing.agrees ? "agrees" : "DISAGREES"}`);
      say(`  import: ${first.status}  sets ${first.sections.map((section) => `${section.set ?? "-"}:${section.savedIds.length}`).join(" ") || "none"}  held ${first.held.length}  pictures withheld ${first.withheldAssets.length}  errors ${first.errors.length}`);
      expect(first.filing.agrees).toBe(true);
      expect(first.errors).toEqual([]);
      const offered = first.sections.reduce((sum, section) => sum + section.savedIds.length, 0);
      expect(offered).toBe(readiness.ready);

      if (offered === 0) {
        expect(first.status).toBe("nothing-ready");
        expect((await workspaceOnDisk()).questions).toHaveLength(0);
        return;
      }
      const disk = await workspaceOnDisk();
      const sameKey = first.sections.reduce((sum, section) => sum + section.questionIds.filter((packageId, index) => {
        const saved = disk.questions.find((question) => question.id === section.savedIds[index]);
        const from = pkg.questions.find((question) => question.id === packageId)!;
        return saved !== undefined && saved.correctKey === from.correctAnswer?.labels[0] && saved.questionNumber === from.source.questionNumber;
      }).length, 0);
      const filed = disk.questions.filter((question) => question.module === first.filing.module && question.week === first.filing.week).length;
      say(`  on disk: ${disk.questions.length} questions, ${disk.questionSets.length} sets, ${disk.documents.length} documents; filed under the module and week ${filed}; key and own number equal to the package's ${sameKey}`);
      say(`  pictures: ${disk.questions.reduce((sum, question) => sum + (question.attachments?.length ?? 0), 0)} linked to questions, ${await storedImageCount()} stored`);
      expect(disk.questionSets).toHaveLength(first.sections.length);
      expect(filed).toBe(offered);
      expect(sameKey).toBe(offered);

      const reloaded = await reloadWorkspace();
      const same = reloaded.questions.filter((question) => {
        const before = disk.questions.find((other) => other.id === question.id);
        return before && before.stem === question.stem && before.correctKey === question.correctKey && (before.attachments?.length ?? 0) === (question.attachments?.length ?? 0);
      }).length;
      say(`  after a reload: ${reloaded.questions.length} questions, ${same} unchanged, ${reloaded.questionSets.length} sets`);
      expect(same).toBe(disk.questions.length);

      const again = await importPackage(pkg, issues, files);
      const after = await workspaceOnDisk();
      say(`  second import: ${again.status}; now ${after.questions.length} questions, ${after.questionSets.length} sets, ${await storedImageCount()} pictures stored`);
      expect(again.status).toBe("already-saved");
      expect([after.questions.length, after.questionSets.length]).toEqual([disk.questions.length, disk.questionSets.length]);
    });
  }
});
