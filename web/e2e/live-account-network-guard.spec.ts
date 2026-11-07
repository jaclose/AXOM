import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { isolateLiveAccountNetwork, permitsLiveAccountWebSocket } from "./liveAccountNetwork";

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


test("WebSocket egress allows only the dedicated Supabase or local application origin", () => {
  const app = "http://127.0.0.1:5187";
  expect(permitsLiveAccountWebSocket("ws://127.0.0.1:5187/socket", dedicatedOrigin, app)).toBe(true);
  expect(permitsLiveAccountWebSocket(`wss://${testRef}.supabase.co/realtime/v1/websocket`, dedicatedOrigin, app)).toBe(true);
  expect(permitsLiveAccountWebSocket(`wss://${testRef}.storage.supabase.co/upload`, dedicatedOrigin, app)).toBe(true);
  expect(permitsLiveAccountWebSocket("ws://127.0.0.1:5188/socket", dedicatedOrigin, app)).toBe(false);
  expect(permitsLiveAccountWebSocket("wss://other-project.supabase.co/socket", dedicatedOrigin, app)).toBe(false);
  expect(permitsLiveAccountWebSocket(`ws://${testRef}.supabase.co/socket`, dedicatedOrigin, app)).toBe(false);
  expect(permitsLiveAccountWebSocket("wss://127.0.0.1:5187/socket", dedicatedOrigin, app)).toBe(false);
  expect(permitsLiveAccountWebSocket("https://127.0.0.1:5187/socket", dedicatedOrigin, app)).toBe(false);
  expect(permitsLiveAccountWebSocket("not-a-url", dedicatedOrigin, app)).toBe(false);
});

test("live-account guard blocks foreign WebSocket handshakes in real Chromium", async ({ browser }) => {
  let forbiddenUpgrades = 0;
  let approvedUpgrades = 0;
  const forbidden = createServer((_request, response) => {
    response.writeHead(200).end("Forbidden endpoint");
  });
  forbidden.on("upgrade", (_request, socket) => {
    forbiddenUpgrades += 1;
    socket.destroy();
  });
  const app = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>App</h1>");
  });
  app.on("upgrade", (request, socket) => {
    approvedUpgrades += 1;
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\\r\\n"
      + "Upgrade: websocket\\r\\nConnection: Upgrade\\r\\n"
      + `Sec-WebSocket-Accept: ${accept}\\r\\n\\r\\n`,
    );
    socket.on("data", () => socket.destroy());
    socket.setTimeout(2500, () => socket.destroy());
  });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const forbiddenOrigin = await listen(forbidden);
    const appOrigin = await listen(app);
    context = await browser.newContext({ serviceWorkers: "block" });
    // Intercept before the first page exists; both contexts in the live test use this helper.
    await isolateLiveAccountNetwork(context, dedicatedOrigin, appOrigin);
    const page = await context.newPage();
    await page.goto(appOrigin + "/");
    const open = (endpoint: string) => page.evaluate((url) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(url);
        let settled = false;
        const timer = window.setTimeout(() => {
          socket.close();
          finish("timeout");
        }, 2500);
        function finish(value: string) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
        socket.addEventListener("open", () => { finish("open"); socket.close(); }, { once: true });
        socket.addEventListener("close", () => finish("closed"), { once: true });
        socket.addEventListener("error", () => finish("error"), { once: true });
      }), endpoint);

    expect(await open(appOrigin.replace("http:", "ws:") + "/socket")).toBe("open");
    expect(approvedUpgrades).toBe(1);
    expect(await open(forbiddenOrigin.replace("http:", "ws:") + "/socket")).not.toBe("open");
    // An error/close is insufficient: the forbidden socket server must see zero handshakes.
    expect(forbiddenUpgrades).toBe(0);
  } finally {
    await context?.close();
    await stop(app);
    await stop(forbidden);
  }
});
