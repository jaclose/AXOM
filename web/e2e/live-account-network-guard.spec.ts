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


test("destructive-account isolation prevents every browser WebSocket upgrade", async ({ browser }) => {
  let foreignUpgrades = 0;
  let localUpgrades = 0;
  const foreign = createServer((_request, response) => {
    response.writeHead(200).end("Foreign endpoint");
  });
  foreign.on("upgrade", (_request, socket) => {
    foreignUpgrades += 1;
    socket.destroy();
  });
  const app = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Allowed app</h1>");
  });
  app.on("upgrade", (_request, socket) => {
    localUpgrades += 1;
    socket.destroy();
  });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const foreignOrigin = await listen(foreign);
    const appOrigin = await listen(app);
    context = await browser.newContext({ serviceWorkers: "block" });
    // Install the network boundary before any page or app scripts exist.
    await isolateLiveAccountNetwork(context, dedicatedOrigin, appOrigin);
    const page = await context.newPage();
    await page.goto(appOrigin + "/");
    await expect(page.getByRole("heading", { name: "Allowed app" })).toBeVisible();

    const probe = (url: string) => page.evaluate((endpoint) => new Promise<string>((resolve) => {
      const socket = new WebSocket(endpoint);
      const timer = window.setTimeout(() => {
        socket.close();
        resolve("timeout");
      }, 2500);
      socket.addEventListener("close", () => { clearTimeout(timer); resolve("closed"); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); resolve("error"); }, { once: true });
    }), url);

    // Both an ordinarily permitted local HMR endpoint and a forbidden project
    // must have ZERO remote handshakes. No Realtime connection is needed here.
    expect(await probe(appOrigin.replace("http:", "ws:") + "/socket")).not.toBe("timeout");
    expect(await probe(foreignOrigin.replace("http:", "ws:") + "/socket")).not.toBe("timeout");
    expect(localUpgrades).toBe(0);
    expect(foreignUpgrades).toBe(0);
  } finally {
    await context?.close();
    await stop(app);
    await stop(foreign);
  }
});
