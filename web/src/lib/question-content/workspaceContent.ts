import type { PackageIssue, PackageQuestion } from "./package";
import { readQuestionsFile } from "./packageJson";

/** The package reader also guards the optional workspace field. Malformed
 * content rejects an import rather than quietly replacing it with plain text. */
export function readWorkspaceContent(value: unknown): { content?: PackageQuestion; errors: string[] } {
  if (value === undefined) return { errors: [] };
  const issues: PackageIssue[] = [];
  const parsed = readQuestionsFile({ schemaVersion: 1, bankId: "workspace-content", questions: [value] }, issues);
  const errors = issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
  if (!parsed?.questions[0] && !errors.length) errors.push("The ordered question content could not be read.");
  return { content: parsed?.questions[0], errors };
}
