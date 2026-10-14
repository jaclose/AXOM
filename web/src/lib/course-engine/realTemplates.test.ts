import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate } from "./templateParse";
import { canonicalModuleKey } from "./vocabulary";

// Deliberately opt-in: official/private academic source files stay outside
// the public repository and are never copied into test fixtures.
// Run with AXOM_TEMPLATE_ROOT=/path/to/authorized/template-folder.
const root = process.env.AXOM_TEMPLATE_ROOT ?? "";
const available = root !== "" && existsSync(root);
const files = available
  ? readdirSync(root).filter((name) => /^\d{2}_.+\.txt$/i.test(name)).sort()
  : [];
const sections = files.map((name) => parseCourseTemplate(readFileSync(join(root, name), "utf8"), name));

describe.skipIf(!available)("locally supplied course templates (private-source verification)", () => {
  it("reads all 22 template files, 11 modules and 547 activity entries without dropped rows", () => {
    expect(files).toHaveLength(22);
    expect(sections).toHaveLength(22);
    expect(sections.flatMap((section) => section.problems)).toEqual([]);
    expect(new Set(sections.map((section) => canonicalModuleKey(section.module))).size).toBe(11);
    expect(sections.reduce((sum, section) => sum + section.items.length, 0)).toBe(547);
  });

  it("reconciles every parsed row or visibly reports an identity conflict", () => {
    const modules = new Map<string, typeof sections>();
    for (const section of sections) {
      const key = canonicalModuleKey(section.module);
      modules.set(key, [...(modules.get(key) ?? []), section]);
    }
    let planned = 0;
    let classified = 0;
    for (const group of modules.values()) {
      const plan = planCourseTemplate(group);
      const result = reconcileCourseTemplate(plan, []);
      planned += plan.items.length;
      classified += result.create.length + (result.review?.length ?? 0);
      // Reimport existing, source-owned rows without changing learner progress.
      const rows = result.create.map((item, index) => ({
        id: `source-${plan.module}-${index}`,
        path: item.path, label: item.label, templateKey: item.templateKey,
        weekSource: item.weekSource, passes: 3, attendance: "attended" as const,
      }));
      const repeated = reconcileCourseTemplate(plan, rows);
      expect(repeated.create).toEqual([]);
      expect(repeated.update).toEqual([]);
      expect(repeated.unchanged + (repeated.review?.length ?? 0)).toBe(plan.items.length);
    }
    expect(planned).toBe(547);
    expect(classified).toBe(547);
  });


  it("uses source-stated Week 4/5 anchors to avoid misfiling post-midterm work as Week 1/2", () => {
    const pre = sections.filter((section) => canonicalModuleKey(section.module) === "premidterm");
    const post = sections.filter((section) => canonicalModuleKey(section.module) === "postmidterm");
    const prePlan = planCourseTemplate(pre, { term: "Term 3" });
    const postPlan = planCourseTemplate(post, { term: "Term 3" });
    expect(prePlan.items.filter((item) => item.weekBasis === "stated").map((item) => item.week)).toEqual([1, 2, 3]);
    expect(postPlan.items.filter((item) => item.weekBasis === "stated").map((item) => item.week)).toEqual([4, 5]);
    expect(postPlan.items.some((item) => item.label.startsWith("SG 07") && item.week === 4 && item.weekBasis === "group-order")).toBe(true);
    expect(postPlan.items.some((item) => item.label.startsWith("SG 09") && item.week === 5 && item.weekBasis === "group-order")).toBe(true);
    expect(postPlan.items.some((item) => item.label.startsWith("SG 11") && item.week === 6 && item.weekBasis === "group-order")).toBe(true);
    expect(new Set(postPlan.items.flatMap((item) => item.week === undefined ? [] : [item.week]))).toEqual(new Set([4, 5, 6]));
    expect(prePlan.problems).toEqual([]);
    expect(postPlan.problems).toEqual([]);
  });

  it("preserves the compound CPR 19/20/21 lecture's original line identity", () => {
    const cpr = sections.filter((section) => canonicalModuleKey(section.module) === "cpr1");
    const plan = planCourseTemplate(cpr, { term: "Term 1" });
    const compound = plan.items.find((item) => item.label.includes("19, 20, 21"));
    expect(compound).toMatchObject({
      activity: "lecture", templateKey: "cpr1|lecture|combined-19-20-21",
      sourceName: "01_CPR1_Lectures_DLA.txt", sourceLine: 39,
    });
    expect(compound?.weekSource).toBe("inferred");
    const originalRow = [{
      id: "studied-old-compound", path: compound!.path, label: compound!.label,
      templateKey: "cpr1|lecture|19", weekSource: "learner" as const,
    }];
    const reconciliation = reconcileCourseTemplate(plan, originalRow);
    expect(reconciliation.create.some((item) => item.templateKey === compound!.templateKey)).toBe(false);
    expect(reconciliation.review?.find((item) => item.item.templateKey === compound?.templateKey)?.candidateIds).toContain("studied-old-compound");
  });

  it("never mistakes blank-line group placement for source-confirmed academic dates", () => {
    const plans = new Map<string, typeof sections>();
    for (const section of sections) {
      const key = canonicalModuleKey(section.module);
      plans.set(key, [...(plans.get(key) ?? []), section]);
    }
    for (const group of plans.values()) {
      const plan = planCourseTemplate(group);
      expect(plan.items.every((item) =>
        item.weekBasis === "stated" ? item.weekSource === "template"
          : item.weekSource !== "template")).toBe(true);
    }
  });
});
