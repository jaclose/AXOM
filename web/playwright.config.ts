import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.AXOM_E2E_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:5187";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    // AXOM_E2E_CHANNEL=chrome runs against installed Google Chrome when the
    // bundled Playwright Chromium is not downloaded (npm run test:e2e:chrome).
    ...(process.env.AXOM_E2E_CHANNEL ? { channel: process.env.AXOM_E2E_CHANNEL } : {}),
    baseURL,
    headless: true,
    // A context option: at the top of \`use\` Playwright ignores it silently, so
    // the opening film used to play (and hold the app inert) in every spec.
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 5187 --strictPort",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
