// @vitest-environment node
/**
 * Opt-in dry run of Publish a prepared library on a REAL prepared library, on
 * the authorized local machine. It plans every course and prepares each one
 * exactly as publishing would, but uploads nothing. Run from web/ with
 *
 *   AXOM_PUBLISH_LIBRARY_ROOT=<prepared folder> \
 *   AXOM_PUBLISH_REPORT=<report.json outside the repository> \
 *   AXOM_PUBLISH_TERMS='{"<module key>":"Term 1"}' \
 *   AXOM_PUBLISH_DECISIONS=<filing decisions .json from the unfiled source review> \
 *   npx vitest run src/lib/academicLibrary/publicationPlan.local.test.ts --reporter=verbose
 *
 * AXOM_PUBLISH_TERMS is optional and holds terms a reviewer confirmed, keyed by
 * the module keys the report lists. AXOM_PUBLISH_DECISIONS is optional and files
 * each reviewed source as decided, exactly as the publisher's "Add filing
 * decisions" does; the library folder itself is never changed. The report and console carry counts,
 * module labels, reasons and source names only, never question text, answers
 * or file bytes. Source names can be private: keep the report out of Git.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { safeLibraryPath, type LibraryReader } from "../privateLibrary/install";
import type { ReviewedFiling } from "../privateLibrary/types";
import { applyFilingDecisions, readFilingDecisions } from "./filingDecisions";
import {
  PUBLICATION_INPUT_LIMITS, planPublication, publicationJobs, readPublicationInventory, type PlannedCourse,
} from "./publication";

type Term = ReviewedFiling["term"];
const TERMS = new Set<string>(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"]);
const root = process.env.AXOM_PUBLISH_LIBRARY_ROOT;

function confirmedTerms(): Record<string, Term> {
  const terms = JSON.parse(process.env.AXOM_PUBLISH_TERMS || "{}") as Record<string, unknown>;
  if (!terms || typeof terms !== "object" || Array.isArray(terms)
    || Object.values(terms).some(term => typeof term !== "string" || !TERMS.has(term)))
    throw new Error("AXOM_PUBLISH_TERMS must map module keys to Term 1-5.");
  return terms as Record<string, Term>;
}

describe.skipIf(!root)("dry run of publishing a real prepared library (opt-in only)", () => {
  it("plans every course and prepares each one without uploading", async () => {
    const parent = realpathSync(resolve(root!));
    const fromDisk: LibraryReader = async (file: string) => {
      const path = resolve(parent, safeLibraryPath(file));
      if (!path.startsWith(parent + sep)) throw new Error("A library path escaped the selected folder.");
      if (!existsSync(path)) throw new Error("A file the library references is missing.");
      const metadata = statSync(path);
      if (!metadata.isFile() || metadata.size > PUBLICATION_INPUT_LIMITS.maxFileBytes)
        throw new Error("A library file is not a regular file within the publishing limit.");
      return new Uint8Array(readFileSync(path));
    };
    const report = process.env.AXOM_PUBLISH_REPORT && resolve(process.env.AXOM_PUBLISH_REPORT);
    const repository = resolve(__dirname, "../../../..");
    if (report && (report + sep).startsWith(repository + sep))
      throw new Error("Write the dry-run report outside the repository: it can name private sources.");

    const decisionsFile = process.env.AXOM_PUBLISH_DECISIONS;
    const filed = decisionsFile
      ? await applyFilingDecisions(fromDisk, readFilingDecisions(JSON.parse(readFileSync(resolve(decisionsFile), "utf8"))))
      : undefined;
    const read = filed?.read ?? fromDisk;
    if (filed) console.log(`filing decisions  ${filed.summary.filed} filed, ${filed.summary.keptUnfiled} kept unfiled`);
    const inventory = await readPublicationInventory(read);
    const plan = planPublication(inventory, confirmedTerms());
    const ready = plan.courses.filter(course => course.termBasis !== "proposed");
    const { jobs, notes } = publicationJobs(read, inventory, ready);
    const sources = new Map<string, string>();
    const label = (course: Pick<PlannedCourse, "term" | "module">) => `${course.term} ${course.module}`;
    const checked = [];
    for (const [index, job] of jobs.entries()) {
      const course = ready[index];
      const summary = { catalogId: course.catalogId, term: course.term, module: course.module, moduleKey: course.moduleKey,
        termBasis: course.termBasis, sections: course.sections.map(section => section.name), activities: course.activities,
        sourceCount: course.sourceIds.length };
      try {
        const upload = await job.prepare();
        // Publishing refuses a source that another course in the run already holds.
        const repeated = upload.provenance.sourceChecksums.find(sha => sources.has(sha));
        if (repeated) throw new Error(`It shares a source file with ${sources.get(repeated)}.`);
        for (const sha of upload.provenance.sourceChecksums) sources.set(sha, label(course));
        checked.push({ ...summary, ok: true as const, readyQuestions: Number(upload.metadata.ready_questions),
          reviewQuestions: Number(upload.metadata.review_questions), files: upload.files.length,
          bytes: upload.files.reduce((sum, file) => sum + file.byte_size, 0),
          keptLocal: notes.keptLocal.get(job.key) ?? 0, overLimit: upload.localOnlyOriginals.length });
      } catch (cause) {
        checked.push({ ...summary, ok: false as const,
          reason: notes.failures.get(job.key) ?? (cause instanceof Error ? cause.message : "This course could not be prepared.") });
      }
    }
    const needsTerm = plan.courses.filter(course => course.termBasis === "proposed").map(course => ({
      moduleKey: course.moduleKey, module: course.module, proposedTerm: course.term, reason: course.proposalReason,
      sections: course.sections.map(section => section.name),
    }));
    const result = {
      library: inventory.library, checkedAt: new Date().toISOString(), ...(filed ? { filingDecisions: filed.summary } : {}),
      totals: {
        courses: plan.courses.length, checked: checked.length, readyToPublish: checked.filter(course => course.ok).length,
        needAttention: checked.filter(course => !course.ok).length, needTerm: needsTerm.length,
        blockedPlanSections: plan.blocked.length, sourcesLeftOut: plan.excluded.length,
        readyQuestions: checked.reduce((sum, course) => sum + (course.ok ? course.readyQuestions : 0), 0),
        reviewQuestions: checked.reduce((sum, course) => sum + (course.ok ? course.reviewQuestions : 0), 0),
      },
      courses: checked, needsTerm, blocked: plan.blocked, excluded: plan.excluded,
    };
    if (report) {
      mkdirSync(dirname(report), { recursive: true });
      writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result.totals));
    for (const course of checked) console.log(course.ok
      ? `ready  ${label(course)}: ${course.readyQuestions} ready, ${course.reviewQuestions} awaiting review, ${course.files} files`
      : `attention  ${label(course)}: ${course.reason}`);
    for (const course of needsTerm) console.log(`needs term  ${course.module} (${course.moduleKey}): proposed ${course.proposedTerm}`);
    expect(plan.courses.length + plan.blocked.length + plan.excluded.length).toBeGreaterThan(0);
  }, 3_600_000);
});
