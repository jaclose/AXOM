import { readManifest, readQuestionsFile } from "../question-content/packageJson";
import { assessBank } from "../question-content/assessBank";
import { parseCourseTemplate } from "../course-engine/templateParse";
import { moduleKey } from "../course-engine/vocabulary";
import type { PackageIssue } from "../question-content/package";
import type { PreparedBank } from "../privateLibrary/types";
import type { CatalogEntry } from "./model";

/** Pure adapters to the EXISTING parsers, also used by the administrator CLI. */
export function parseCloudBank(value: unknown): PreparedBank {
  const b = value as PreparedBank | undefined;
  const issues: PackageIssue[] = [];
  const manifest = readManifest(b?.pkg?.manifest, issues);
  const questions = readQuestionsFile({ schemaVersion: 1, bankId: manifest?.bank.id, questions: b?.pkg?.questions }, issues);
  if (!b || !manifest || !questions || !Array.isArray(b.issues) || typeof b.sourceText?.rawText !== "string"
    || issues.some(i => i.severity === "error") || questions.questions.length !== b.pkg.questions.length
    || b.issues.some(i => !i || !["error", "warning"].includes(i.severity))) throw new Error("This published bank needs validation by its publisher.");
  return { ...b, issues: [...b.issues, ...issues], pkg: { manifest, questions: questions.questions } };
}
export function assertPublishedBank(entry: CatalogEntry, bank: PreparedBank, files: readonly { name: string }[]) {
  const manifest = bank.pkg.manifest;
  if (entry.kind !== "bank" || moduleKey(entry.module) !== moduleKey(manifest.course.name)
    || entry.term !== `Term ${manifest.course.term}` || entry.week !== manifest.course.week) throw new Error("The bank does not match its published course scope.");
  const assessment = assessBank(bank.pkg, bank.issues, files);
  const imageCount = bank.pkg.questions.filter(q => q.assets.length > 0).length;
  if (assessment.counts.ready !== entry.question_count || assessment.counts.ready !== bank.pkg.questions.length
    || imageCount !== entry.image_question_count || assessment.issues.some(i => i.severity === "error" && !i.questionId)) throw new Error("This published set's readiness changed. Its publisher needs to review it.");
  return assessment;
}
export function assertPublishedTemplate(entry: CatalogEntry, raw: string) {
  const section = parseCourseTemplate(raw, entry.source_label);
  if (entry.kind !== "template" || moduleKey(section.module) !== moduleKey(entry.module)
    || section.items.length !== entry.activity_count || section.problems.length
    || (section.term && section.term !== entry.term)) throw new Error("The course template does not match its published scope or activity count.");
  return section;
}
