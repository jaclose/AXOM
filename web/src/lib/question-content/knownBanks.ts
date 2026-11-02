import type { PackageManifest } from "./package";
import type { Course, Term } from "../types";
import { inferSourceMapping } from "../course-engine/sourceMapping";
import { vocabularyFromCourses } from "../course-engine/vocabulary";
import { moduleAliases } from "../course-engine/templateParse";

// Keep source-audit fixtures outside the production graph. These projections
// intentionally contain only fields AXOM needs to identify and file a bank.
export const knownBankManifests: PackageManifest[] = [
  {
    schemaVersion: 1,
    course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "goer-t5-w2-biostats-epidemiology", title: "Biostatistics & Epidemiology", discipline: "Biostatistics / Epidemiology" },
    source: { filename: "Biostats+and+Epidemiology+PQ.pdf", sourceWeekDeclared: false, axomAssignedWeek: 2 },
    questionsFile: "questions.json",
    assetsDirectory: "assets/",
  },
  {
    schemaVersion: 1,
    course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "goer-t5-w2-endocrine-pathophysiology", title: "Endocrine Pathophysiology", discipline: "Pathophysiology", topic: "Endocrinology" },
    source: { filename: "PRACTICE+QUE_PATHOPHYS-ENDOCRINOLOGY.pdf", sourceWeekDeclared: false, axomAssignedWeek: 2 },
    questionsFile: "questions.json",
    assetsDirectory: "assets/",
  },
  {
    schemaVersion: 1,
    course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "goer-t5-w2-pharmacodynamics-pk", title: "Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics", discipline: "Pharmacology" },
    source: {
      filename: "Pharmacodynamics%2C+Pharmacokinetics+and+Clinical+Pharmacokinetics+PQ.pdf",
      declaredTitle: "PCM2 GOER Module Pharmacology",
      declaredTerm: "Fall Term 2026",
      sourceWeekDeclared: false,
      axomAssignedWeek: 2,
    },
    questionsFile: "questions.json",
    assetsDirectory: "assets/",
  },
];
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
