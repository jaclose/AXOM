import biostats from "../../../../fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json";
import endocrine from "../../../../fixtures/qbank/goer/t5/week-02/endocrine-pathophysiology/manifest.json";
import pharma from "../../../../fixtures/qbank/goer/t5/week-02/pharmacodynamics-pk/manifest.json";
import type { PackageManifest } from "./package";
import type { Course, Term } from "../types";
import { inferSourceMapping } from "../course-engine/sourceMapping";
import { vocabularyFromCourses } from "../course-engine/vocabulary";
import { moduleAliases } from "../course-engine/templateParse";

export const knownBankManifests: PackageManifest[] = [biostats, endocrine, pharma];
export function manifestForFile(name: string, terms: Term[], courses: Course[]): PackageManifest {
  const known = knownBankManifests.find((manifest) => manifest.source.filename.toLowerCase() === name.toLowerCase());
  if (known) return structuredClone(known);
  const mapped = inferSourceMapping(name, vocabularyFromCourses(terms, courses, moduleAliases));
  const title = name.replace(/\.[^.]+$/, "");
  return {
    schemaVersion: 1, course: { name: mapped.module?.value ?? "", term: Number(mapped.term?.value.match(/\d+/)?.[0]) || 0, week: mapped.week?.value ?? 0 },
    bank: { id: `import-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "questions"}`, title, discipline: "Imported" },
    source: { filename: name, sourceWeekDeclared: Boolean(mapped.week), axomAssignedWeek: mapped.week?.value },
    questionsFile: "questions.json", assetsDirectory: "assets/",
  };
}
