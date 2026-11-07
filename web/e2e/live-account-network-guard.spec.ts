import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { isolateLiveAccountNetwork } from "./liveAccountNetwork";

const testRef = "abcdefghijklmnopqrst";
const dedicatedOrigin = `https://${testRef}.supabase.co`;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

async function stop(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

test("live-account route blocks cross-origin redirects and custom backends in Chromium", async ({ browser }) => {
  let blockedHits = 0;
  let allowedHits = 0;
  const blocked = createServer((_request, response) => {
    blockedHits += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<h1>Forbidden backend reached</h1>");
  });
  let blockedOrigin = "";
  const app = createServer((request, response) => {
    if (request.url === "/" || request.url === "/handoff") allowedHits += 1;
    if (request.url === "/handoff") {
      response.writeHead(307, { Location: `${blockedOrigin}/unauthorized` });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<h1>Allowed local app</h1>");
  });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    blockedOrigin = await listen(blocked);
    const appOrigin = await listen(app);
    context = await browser.newContext({ serviceWorkers: "block" });
    await isolateLiveAccountNetwork(context, dedicatedOrigin, appOrigin);
    const page = await context.newPage();

    await page.goto(appOrigin + "/");
    await expect(page.getByRole("heading", { name: "Allowed local app" })).toBeVisible();

    await expect(page.goto(appOrigin + "/handoff")).rejects.toThrow();
    expect(allowedHits).toBe(2);
    expect(blockedHits).toBe(0);

    await expect(page.goto(blockedOrigin + "/direct")).rejects.toThrow();
    expect(blockedHits).toBe(0);
  } finally {
    await context?.close();
    await stop(app);
    await stop(blocked);
  }
});
