import { expect, test } from "@playwright/test";

test("experience preview expands without reloading and retains timer controls in fullscreen", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  let documents = 0;
  for (const url of ["https://paveldogreat.github.io/WebGL-Fluid-Simulation/", "https://madebyevan.com/webgl-water/"]) {
    await page.route(url, (route) => {
      documents++;
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Interactive world fixture</title><style>body{background:#153339;color:#d6e7d7;font:20px system-ui;margin:40px}button{padding:20px}</style><h1>A small world</h1><button onclick="this.textContent=\'Changed\'">Interact</button>' });
    });
  }
  await page.goto("/#soundscapes");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await page.evaluate(() => { location.hash = "soundscapes"; });
  const intro = page.getByRole("heading", { name: "Room to wander." });
  await intro.scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Choose an experience").locator("option")).toHaveCount(20);
  expect(documents).toBe(0);
  await page.evaluate(async () => {
    type Dev = Window & { __AXOM_DEV__?: Promise<{ usePomodoro: typeof import("../src/lib/pomodoro").usePomodoro }> };
    (await (window as Dev).__AXOM_DEV__!).usePomodoro.getState().start();
  });
  await page.getByRole("button", { name: "Open experience", exact: true }).click();
  const host = page.getByRole("region", { name: "Active focus space" });
  const frame = host.locator("iframe");
  await expect(host).toHaveClass(/compact/);
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
  await frame.evaluate((node) => node.setAttribute("data-identity", "original"));
  await page.evaluate(() => { location.hash = "productivity"; });
  await expect(frame).toHaveAttribute("data-identity", "original");
  await page.getByRole("button", { name: "Expand experience", exact: true }).click();
  await expect(host).not.toHaveClass(/compact/);
  await expect(frame).toHaveAttribute("data-identity", "original");
  await page.frameLocator(".experience-host iframe").getByRole("button", { name: "Interact" }).click();
  await expect(page.frameLocator(".experience-host iframe").getByRole("button", { name: "Changed" })).toBeVisible();
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(page.getByRole("region", { name: "Focus dock" })).toBeVisible();
  await expect(frame).toHaveAttribute("data-identity", "original");
  expect(documents).toBe(1);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const bounds = await host.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Next experience", exact: true })).toBeInViewport();
    await expect(page.getByRole("region", { name: "Focus dock" })).toBeInViewport();
    if ([1440, 390].includes(width)) await page.screenshot({ path: info.outputPath(`experience-${width}.png`) });
  }
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.getByRole("button", { name: "Next experience", exact: true }).click();
  await expect(frame).toHaveAttribute("title", "A pool of light");
  await expect(frame).toHaveCount(1);
  await page.getByRole("button", { name: "Stop experience", exact: true }).click();
  await expect(frame).toHaveCount(0);
  await page.getByRole("button", { name: "Start again", exact: true }).click();
  await expect(frame).toHaveCount(1);
  await page.getByRole("button", { name: "Close focus space", exact: true }).click();
  await expect(host).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Focus dock" })).toBeVisible();
  await page.reload();
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});
