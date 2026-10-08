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
      const { adapted } = first;
      say(`\n=== ${pkg.manifest.bank.id}`);
      say(`  package: ${pkg.questions.length} questions  READY ${readiness.ready}  NEEDS REVIEW ${readiness["needs-review"]}  UNRESOLVED ${readiness.unresolved}`);
      say(`  filing: ${adapted.filing.module}, week ${adapted.filing.week}, term ${adapted.filing.term}; the curriculum puts ${adapted.filing.module} in ${adapted.filing.curriculumTerm ?? "no term it knows"}: ${adapted.filing.agrees ? "agrees" : "DISAGREES"}`);
      say(`  offered to the import: ${adapted.questionIds.length}  held back: ${adapted.held.length}  renumbered in running order: ${adapted.renumbered ? "yes" : "no"}`);
      say(`  pictures offered: ${adapted.imageNames.length}  pictures withheld until a record can hide them: ${adapted.withheldAssets.length}`);
      expect(adapted.filing.agrees).toBe(true);
      expect(adapted.questionIds.length).toBe(readiness.ready);

      if (adapted.questionIds.length === 0) {
        say(`  nothing ready, so nothing was saved: ${first.prepared.ok ? "UNEXPECTEDLY PREPARED" : first.prepared.reason}`);
        expect(first.saved).toBeUndefined();
        expect((await workspaceOnDisk()).questions).toHaveLength(0);
        return;
      }
      expect(first.saved?.ok).toBe(true);
      if (!first.saved?.ok) return;
      say(`  saved: ${first.saved.questionIds.length} questions in 1 set  pictures attached ${first.saved.images.attached}, missing ${first.saved.images.missing}, problems ${first.saved.images.problems.length}`);

      const disk = await workspaceOnDisk();
      const set = disk.questionSets[0];
      const filed = disk.questions.filter((question) => question.module === adapted.filing.module && question.week === adapted.filing.week && question.setId === set.id).length;
      const keyed = disk.questions.filter((question) => question.correctKey && question.options.some((option) => option.key === question.correctKey)).length;
      const savedIds = first.saved.questionIds;
      const sameKey = adapted.questionIds.filter((packageId, index) => {
        const saved = disk.questions.find((question) => question.id === savedIds[index]);
        return saved !== undefined && saved.correctKey === pkg.questions.find((question) => question.id === packageId)?.correctAnswer?.labels[0];
      }).length;
      say(`  on disk: ${disk.questions.length} questions, ${disk.questionSets.length} set, ${disk.documents.length} documents; set scope ${JSON.stringify(set.scope)}; filed under it ${filed}; with a key that is one of their choices ${keyed}; key equal to the package's ${sameKey}`);
      say(`  pictures: ${disk.questions.reduce((sum, question) => sum + (question.attachments?.length ?? 0), 0)} linked to questions, ${await storedImageCount()} stored`);
      expect(set.scope).toEqual({ module: adapted.filing.module, week: adapted.filing.week });
      expect(filed).toBe(adapted.questionIds.length);
      expect(sameKey).toBe(adapted.questionIds.length);
      expect(first.saved.images.attached).toBe(adapted.imageNames.length);

      const reloaded = await reloadWorkspace();
      const same = reloaded.questions.filter((question) => {
        const before = disk.questions.find((other) => other.id === question.id);
        return before && before.stem === question.stem && before.correctKey === question.correctKey && (before.attachments?.length ?? 0) === (question.attachments?.length ?? 0);
      }).length;
      say(`  after a reload: ${reloaded.questions.length} questions, ${same} unchanged, ${reloaded.questionSets.length} set`);
      expect(same).toBe(disk.questions.length);

      const again = await importPackage(pkg, issues, files);
      const after = await workspaceOnDisk();
      say(`  second import: ${again.saved?.ok ? (again.saved.reused ? "reused the first, wrote nothing" : "WROTE AGAIN") : "refused"}; now ${after.questions.length} questions, ${after.questionSets.length} set, ${await storedImageCount()} pictures stored`);
      expect(again.saved).toMatchObject({ ok: true, reused: true });
      expect([after.questions.length, after.questionSets.length]).toEqual([disk.questions.length, 1]);
      expect(await storedImageCount()).toBe(first.saved.images.attached);
    });
  }
});
