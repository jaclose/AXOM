import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The layers of docs/features/decode.md, held by reading the imports. Source
// analysis (lib/decode) and learner analysis (lib/learning-intelligence) do not
// import each other, and neither is imported by the course engine below them.
// A ranker or an analysis can then be replaced without the others changing.

const LIB = join(__dirname, "..");
const sources = (folder: string) => readdirSync(join(LIB, folder))
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => ({ name: `${folder}/${name}`, imports: [...readFileSync(join(LIB, folder, name), "utf8").matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]) }));
const importing = (folder: string, pattern: RegExp) => sources(folder).filter((file) => file.imports.some((specifier) => pattern.test(specifier))).map((file) => file.name);

describe("the layers stay apart", () => {
  it("Decode reads nothing about the learner", () => {
    expect(importing("decode", /learning-intelligence/)).toEqual([]);
  });

  it("learning intelligence reads no source analysis", () => {
    expect(importing("learning-intelligence", /\/decode(?:\/|$)/)).toEqual([]);
  });

  it("the course engine depends on neither", () => {
    expect(importing("course-engine", /learning-intelligence|\/decode(?:\/|$)/)).toEqual([]);
  });

  it("Decode keeps no scope of its own: it does not define a module, week or assignment type", () => {
    const text = sources("decode").map((file) => readFileSync(join(LIB, file.name), "utf8")).join("\n");
    expect(text).not.toMatch(/interface\s+(?:LearningScope|QuestionAssignment|DecodeState)\b/);
  });
});
