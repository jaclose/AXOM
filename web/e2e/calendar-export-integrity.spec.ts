import { readFile } from "node:fs/promises";
import { expect, seedOnboarded, test } from "./fixtures";

for (const width of [1440, 390]) {
  test("calendar export handles malformed saved dates and downloads UTF-8 safely at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await seedOnboarded(page);
    const saveTask = async (day: string) => {
      await page.evaluate(async (due) => {
        const dev = await (window as unknown as {
          __AXOM_DEV__: Promise<{
            useStore: { setState: (state: Record<string, unknown>) => void };
            flushVault: () => Promise<void>;
          }>;
        }).__AXOM_DEV__;
        dev.useStore.setState({
          tasks: [{
            id: "calendar-e2e-uid", title: "مراجعة 🧠".repeat(30),
            due, done: false, archived: false, created: "2026-11-06",
          }],
        });
        await dev.flushVault();
      }, day);
    };
    await saveTask("2026-12-32"); // Invalid Gregorian day, still future in the filter.
    await page.goto("/#integrations", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create calendar file" }).click();
    const panel = page.locator(".calendar-export");
    await panel.getByRole("checkbox", { name: /Exam dates/ }).uncheck();
    const action = panel.getByRole("button", { name: "Download .ics" });
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("alert")).toContainText("invalid date or identifier");
    await expect(action).toBeVisible();

    // A corrected source must clear the obsolete error without closing the
    // panel. The current mounted button must download the repaired event.
    await saveTask("2026-12-31");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    const liveDownloadPromise = page.waitForEvent("download");
    await action.click();
    const liveDownload = await liveDownloadPromise;
    const livePath = await liveDownload.path();
    expect(livePath).toBeTruthy();
    const liveText = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(livePath!));
    expect(liveText).toContain("DTSTART;VALUE=DATE:20261231");
    expect(liveText).not.toContain("20261232");

    // The correction also survives save and reload with the same event UID.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create calendar file" }).click();
    const repaired = page.locator(".calendar-export");
    await repaired.getByRole("checkbox", { name: /Exam dates/ }).uncheck();
    const downloadPromise = page.waitForEvent("download");
    await repaired.getByRole("button", { name: "Download .ics" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("axom-study-plan.ics");
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = await readFile(path!);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((line) => line === "END:VEVENT")).toHaveLength(1);
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(text).toContain("UID:task-calendar-e2e-uid@axom.local");
    expect(text).toContain("DTSTART;VALUE=DATE:20261231");
    expect(text).toContain("DTEND;VALUE=DATE:20270101");
    expect(text.replace(/\r\n /g, "")).toContain("SUMMARY:Due: مراجعة 🧠");
    expect(pageErrors).toEqual([]);
  });
}
