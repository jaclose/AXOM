import type { ImportPackage, PackageIssue } from "./package";
import { questionReadiness, type Readiness, type ReadinessVerdict } from "./readiness";
import { validatePackage } from "./validate";

export interface BankAssessment {
  issues: PackageIssue[];
  verdicts: Map<string, ReadinessVerdict>;
  counts: Record<Readiness, number>;
}

/** The package checks and each question's verdict. Run it again after a question changes. */
export function assessBank(pkg: ImportPackage, conversionIssues: readonly PackageIssue[], files: readonly { name: string; size?: number }[]): BankAssessment {
  const assetFileSizes = new Map(files.flatMap(file => typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0 ? [[file.name, file.size] as const] : []));
  const issues = [...conversionIssues, ...validatePackage(pkg, { assetFiles: new Set(files.map((file) => file.name)), assetFileSizes })];
  const verdicts = new Map(pkg.questions.map((question) => [question.id, questionReadiness(question, issues)]));
  const counts: Record<Readiness, number> = { ready: 0, "needs-review": 0, unresolved: 0 };
  for (const verdict of verdicts.values()) counts[verdict.readiness] += 1;
  return { issues, verdicts, counts };
}
