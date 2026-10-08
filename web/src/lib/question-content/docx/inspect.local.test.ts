// A local tool, skipped unless asked for. It reads the .docx files under the
// folder named in AXOM_DOCX and prints what the reader found in each.
//
//   AXOM_DOCX=/path/to/folder npx vitest run src/lib/question-content/docx/inspect.local.test.ts
//
// It prints counts and shapes only, so it is safe to run on course files.
// AXOM_DOCX_SHOW=1 also prints the text: use that on invented files only.
// AXOM_DOCX_ORACLE=pandoc compares the words read with pandoc's own reader.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docxToQuestions } from "./docxToQuestions";
import { readDocxBody } from "./readDocxBody";

const root = process.env.AXOM_DOCX;
const show = process.env.AXOM_DOCX_SHOW === "1";
const oracle = process.env.AXOM_DOCX_ORACLE;

function filesUnder(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".docx") ? [path] : [];
  return readdirSync(path).sort().flatMap((name) => filesUnder(join(path, name)));
}

// Straight to the terminal: the test runner keeps a passing test's console output to itself.
const say = (...parts: unknown[]): void => void process.stdout.write(`${parts.join(" ")}\n`);

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

describe.skipIf(!root)("what the reader finds in local .docx files", () => {
  it("reads every file without failing", async () => {
    const recalls: number[] = [];
    for (const file of filesUnder(root!)) {
      const bytes = readFileSync(file);
      const body = await readDocxBody(bytes);
      const kinds = body.elements.map((element) => element.kind[0].toUpperCase()).join("").replace(/P+/g, (run) => `P${run.length > 1 ? run.length : ""}`);
      const converted = await docxToQuestions(bytes, { bankId: "local", sourceFilename: "local.docx" });
      const codes = [...new Set([...body.issues, ...converted.issues].map((issue) => `${issue.severity[0]}:${issue.code}`))].join(" ");
      let agreement = "";
      if (oracle === "pandoc") {
        const theirs = words(execFileSync("pandoc", [file, "-t", "plain", "--wrap=none"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
        const ours = new Map<string, number>();
        const text = body.elements.map((element) =>
          element.kind === "paragraph" ? `${element.listLabel ?? ""} ${element.text}` : element.kind === "table" ? element.rows.flat().join(" ").replace(/<[^>]+>/g, " ") : element.kind === "equation" ? element.plainText : element.alt ?? "").join("\n");
        for (const word of words(text)) ours.set(word, (ours.get(word) ?? 0) + 1);
        let found = 0;
        for (const word of theirs) {
          const left = ours.get(word) ?? 0;
          if (left > 0) {
            found += 1;
            ours.set(word, left - 1);
          }
        }
        const recall = theirs.length ? found / theirs.length : 1;
        recalls.push(recall);
        agreement = ` words pandoc also read: ${(recall * 100).toFixed(1)}% of ${theirs.length}`;
      }
      say(`${file.split("/").pop()}: ${body.elements.length} elements [${kinds.slice(0, 80)}] media ${body.media.size} questions ${converted.questions.length} by ${converted.readBy}${agreement}${codes ? ` | ${codes}` : ""}`);
      if (show) {
        for (const element of body.elements) say("   ", JSON.stringify(element).slice(0, 260));
        for (const question of converted.questions) say("  Q", JSON.stringify(question).slice(0, 900));
        for (const issue of [...body.issues, ...converted.issues]) say("  !", issue.severity, issue.code, issue.message.slice(0, 160));
      }
    }
    if (recalls.length) say(`mean agreement with pandoc over ${recalls.length} files: ${((recalls.reduce((sum, value) => sum + value, 0) / recalls.length) * 100).toFixed(1)}%`);
    expect(true).toBe(true);
  }, 300_000);
});
