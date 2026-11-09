import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { TRACKER_KIND_FOR_ACTIVITY } from "../src/lib/course-engine/activity";
import { courseTemplateVersions, savedCourseTemplates } from "../src/lib/course-engine/templateLibrary";
import { parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate, type CourseTemplateSection } from "../src/lib/course-engine/templateParse";
import { canonicalModuleKey } from "../src/lib/course-engine/vocabulary";
import type { SourceDocument } from "../src/lib/library";
import type { TrackerItem } from "../src/lib/types";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Opt-in private-source acceptance. Paths and file contents never enter Git.
const roots: string[] = JSON.parse(process.env.AXOM_TEMPLATE_ROOTS ?? "[]");
function expectedCount(name: string, allowZero = false): number | undefined {
  const input = process.env[name];
  if (input === undefined) return undefined;
  const count = Number(input);
  if (!(allowZero ? /^(0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(input) || !Number.isSafeInteger(count)) {
    throw new Error(`${name} must be a ${allowZero ? "nonnegative" : "positive"} integer.`);
  }
  return count;
}
const independentlyExpectedActivities = expectedCount("AXOM_TEMPLATE_EXPECTED_ACTIVITIES");
const independentlyExpectedApplicable = expectedCount("AXOM_TEMPLATE_EXPECTED_APPLICABLE_ACTIVITIES");
const expectedHeld = expectedCount("AXOM_TEMPLATE_EXPECTED_HELD_ACTIVITIES", true) ?? 0;

async function workspace(page: Page) {
  return page.evaluate(async () => {
    type State = { documents: SourceDocument[]; tracker: TrackerItem[] };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => State } }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    return { documents: state.documents, tracker: [...state.tracker].sort((left, right) => left.id.localeCompare(right.id)) };
  });
}

test.skip(!roots.length, "Set AXOM_TEMPLATE_ROOTS to a JSON array of local template directories.");
test("every supplied template applies, reloads, and reimports without losing progress", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const files = (await Promise.all(roots.map(async (root) => (await readdir(root)).filter((name) => name.endsWith(".txt")).sort().map((name) => join(root, name))))).flat();
  expect(files.length).toBeGreaterThan(0);
  const sources = await Promise.all(files.map(async (file) => ({ name: basename(file), text: await readFile(file, "utf8") })));
  const sections = sources.map((source) => parseCourseTemplate(source.text, source.name));
  expect(sections.flatMap((section) => section.problems)).toEqual([]);
  const parsedActivities = sections.reduce((total, section) => total + section.items.length, 0);
  const expectedActivities = independentlyExpectedActivities ?? parsedActivities;
  expect(parsedActivities).toBe(expectedActivities);
  const expectedApplicable = independentlyExpectedApplicable ?? expectedActivities - expectedHeld;
  expect(expectedApplicable).toBeGreaterThan(0);
  expect(expectedApplicable + expectedHeld).toBe(expectedActivities);
  const byModule = new Map<string, CourseTemplateSection[]>();
  for (const section of sections) {
    const key = `${section.term ?? ""}|${canonicalModuleKey(section.module)}`;
    byModule.set(key, [...(byModule.get(key) ?? []), section]);
  }
  const heldGroups = [...byModule.values()].map((group) => {
    const plan = planCourseTemplate(group);
    return { module: plan.module, issues: reconcileCourseTemplate(plan, []).review ?? [] };
  }).filter((group) => group.issues.length);
  const heldSourceLines = new Set(heldGroups.flatMap((group) => group.issues.map(({ item }) => JSON.stringify([item.sourceName, item.sourceLine]))));
  expect(heldSourceLines.size).toBe(expectedHeld);
  const assertHeldReview = async (dialog: Locator) => {
    await expect(dialog.getByRole("region", { name: /^Identity conflicts for / })).toHaveCount(heldGroups.length);
    for (const group of heldGroups) {
      const region = dialog.getByRole("region", { name: `Identity conflicts for ${group.module}`, exact: true });
      await expect(region).toBeVisible();
      await expect(region.getByRole("status")).toContainText(`${group.issues.length} ambiguous template activities need identity review.`);
      for (const label of new Set(group.issues.map(({ item }) => item.label))) {
        await expect(region.getByText(label, { exact: true })).toHaveCount(group.issues.filter(({ item }) => item.label === label).length);
      }
    }
  };
  const assertSavedSources = (documents: SourceDocument[]) => {
    const saved = savedCourseTemplates(documents);
    expect(saved).toHaveLength(files.length);
    expect(saved.reduce((total, item) => total + item.section.items.length, 0)).toBe(expectedActivities);
    for (const source of sources) {
      const matches = saved.filter(({ document }) => document.fileName === source.name && document.rawText === source.text);
      expect(matches).toHaveLength(1);
      // Includes every held line: saving and applying must not prune the source.
      expect(matches[0].section).toEqual(parseCourseTemplate(source.text, source.name));
    }
    return saved;
  };

  await seedOnboarded(page);
  // This acceptance run starts with an empty tracker in its isolated browser
  // context. Refuse unexpected data instead of clearing a real workspace.
  await page.evaluate(async () => {
    type Store = { getState: () => { tracker: TrackerItem[] }; setState: (patch: { tracker: TrackerItem[] }) => void };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: Store; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    if (dev.useStore.getState().tracker.some((row) => !row.label.startsWith("Example "))) {
      throw new Error("Private template acceptance requires a fresh workspace containing only seed examples.");
    }
    dev.useStore.setState({ tracker: [] });
    await dev.flushVault();
  });
  await page.goto("/#tracker");
  const openTemplateLibrary = async () => {
    if (!await page.getByRole("button", { name: "Saved templates and imports", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Course Library / Load Course", exact: true }).click();
    }
    await page.getByRole("button", { name: "Saved templates and imports", exact: true }).click();
  };
  await openTemplateLibrary();
  const dialog = page.getByRole("region", { name: "Load a course template", exact: true });
  await dialog.getByLabel("Choose course template files").setInputFiles(files);
  await expect(dialog.getByLabel("Choose course template files")).toBeEnabled();
  await expect(dialog.getByRole("region", { name: /^Template for / }).first()).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await assertHeldReview(dialog);
  const saved = assertSavedSources((await workspace(page)).documents);
  expect(saved.filter((item) => /^(T|Term)\s*\d+$/i.test(item.section.module))).toHaveLength(0);
  const addAll = dialog.getByRole("button", { name: `Add ${expectedApplicable} item${expectedApplicable === 1 ? "" : "s"}`, exact: true });
  await expect(addAll).toBeEnabled();
  await addAll.click();
  await expect(dialog).toHaveCount(0);
  await reloadAfterSave(page);

  const installed = await workspace(page);
  assertSavedSources(installed.documents);
  expect(installed.tracker).toHaveLength(expectedApplicable);
  expect(new Set(installed.tracker.map((row) => row.id)).size).toBe(expectedApplicable);
  const matchedIds = new Set<string>();
  for (const section of sections) {
    for (const item of section.items) {
      const matches = installed.tracker.filter((row) => {
        const segments = row.path.split("/");
        return canonicalModuleKey(segments.at(-2) ?? "") === canonicalModuleKey(section.module)
          && (!section.term || segments[0] === section.term)
          && row.label === item.label && row.activity === item.activity;
      });
      if (heldSourceLines.has(JSON.stringify([section.sourceName, item.line]))) {
        expect(matches).toHaveLength(0);
        continue;
      }
      expect(matches).toHaveLength(1);
      const row = matches[0];
      matchedIds.add(row.id);
      expect(row.templateKey).toBeTruthy();
      expect(row.kind).toBe(TRACKER_KIND_FOR_ACTIVITY[item.activity]);
      if (item.statedWeek !== undefined) {
        expect(row.path.endsWith(`/Week ${item.statedWeek}`)).toBe(true);
        expect(row.weekSource).toBe("template");
      } else if (section.context?.weekPolicy === "explicit") {
        expect(row.path.endsWith("/Unscheduled")).toBe(true);
        expect(row.weekSource).toBeUndefined();
      } else {
        expect(row.weekSource).not.toBe("template");
      }
    }
  }
  expect(matchedIds.size).toBe(expectedApplicable);

  const progressId = installed.tracker[0].id;
  await page.evaluate(async (id) => {
    type State = { updateTrackerItem: (id: string, patch: Partial<TrackerItem>) => void };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => State }; flushVault: () => Promise<void> }> }).__AXOM_DEV__;
    dev.useStore.getState().updateTrackerItem(id, { passes: 2, ankiPasses: 1, yield: "high", note: "Synthetic acceptance progress" });
    await dev.flushVault();
  }, progressId);
  const beforeReimport = await workspace(page);
  expect(beforeReimport.tracker.find((row) => row.id === progressId)).toMatchObject({ passes: 2, ankiPasses: 1, yield: "high", note: "Synthetic acceptance progress" });

  await openTemplateLibrary();
  const persisted = assertSavedSources(beforeReimport.documents);
  await expect(dialog.getByRole("button", { name: /^Use saved / })).toHaveCount(courseTemplateVersions(persisted).length);
  await dialog.getByLabel("Choose course template files").setInputFiles(files);
  await expect(dialog.getByLabel("Choose course template files")).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await assertHeldReview(dialog);
  await expect(dialog.getByRole("button", { name: "Nothing to add", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await reloadAfterSave(page);
  const afterReimport = await workspace(page);
  expect(afterReimport.tracker).toEqual(beforeReimport.tracker);
  expect(afterReimport.tracker).toHaveLength(expectedApplicable);
  assertSavedSources(afterReimport.documents);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ privateTemplateAcceptance: {
    files: files.length, modules: new Set(sections.map((section) => canonicalModuleKey(section.module))).size,
    parsedActivities, applicableActivities: afterReimport.tracker.length, heldActivities: heldSourceLines.size,
    independentlyExpectedActivities, independentlyExpectedApplicable,
    reimportAdded: 0, progressPreserved: true,
  } }));
});
