import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

const source = process.env.AXOM_COURSE_PLAN;
test.skip(!source, "Set AXOM_COURSE_PLAN to a source-reviewed dated template.");
test.use({ trace: "off", screenshot: "off", video: "off" });
test("a dated real course plan loads every activity and preserves progress on repeat", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  const text = await readFile(source!, "utf8");
  const expected = text.split("\n").filter(line => /\[[^\]]+\]\s*$/.test(line)).length;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  async function open() {
    if (!new URL(page.url()).searchParams.has("course-library")) await page.getByRole("button", { name: "Course Library / Load Course" }).click();
    await page.getByText("Manage sources and custom courses", { exact: true }).click();
    await page.getByRole("button", { name: "Saved templates and imports", exact: true }).click();
    const form = page.getByRole("region", { name: "Load a course template", exact: true });
    await form.getByLabel("Choose course template files").setInputFiles({ name: basename(source!), mimeType: "text/plain", buffer: Buffer.from(text) });
    return form;
  }
  const form = await open();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await form.getByRole("button", { name: `Add ${expected} items`, exact: true }).click();
  await reloadAfterSave(page);
  const rows = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { tracker: {id:string;templateKey?:string;path:string;passes:number;note?:string}[]; updateTrackerItem:(id:string,patch:unknown)=>void } }; flushVault:()=>Promise<void> }> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    const rows = state.tracker.filter(row => row.templateKey?.startsWith("Fall 2026|rhps|"));
    if (!rows.length) throw new Error("No RHPS source rows installed");
    state.updateTrackerItem(rows[0].id, { passes: 2, note: "Acceptance note to preserve" });
    await dev.flushVault();
    return rows.map(row => ({ id: row.id, path: row.path }));
  });
  expect(rows).toHaveLength(expected);
  expect(rows.filter(row => row.path.endsWith("Unscheduled"))).toHaveLength(1);
  expect(rows.some(row => row.path.endsWith("Week 13"))).toBe(false);
  const again = await open();
  await expect(again.getByRole("button", { name: "Nothing to add", exact: true })).toBeDisabled();
  await again.getByRole("button", { name: "Cancel", exact: true }).click();
  await reloadAfterSave(page);
  const preserved = await page.evaluate(async id => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => {tracker:{id:string;passes:number;note?:string}[]} } }> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.find(row => row.id === id);
  }, rows[0].id);
  expect(preserved).toMatchObject({ passes: 2, note: "Acceptance note to preserve" });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ coursePlanAcceptance: { expected, persisted: rows.length, stableIds: true, progressPreserved: true, unscheduled: 1, missingWeek: 13 } }));
});
