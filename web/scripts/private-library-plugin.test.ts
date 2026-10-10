// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privateLibraryPlugin } from "./private-library-plugin";

let server: ViteDevServer | undefined;
let folder: string | undefined;
afterEach(async () => { await server?.close(); if (folder) await rm(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it("serves explicit private development content only to same-origin loopback requests", async () => {
  folder = await mkdtemp(join(tmpdir(), "axom-private-route-test-"));
  const root = join(folder, "content");
  const { mkdir } = await import("node:fs/promises"); await mkdir(root);
  await writeFile(join(root, "catalog.json"), '{"sample":true}');
  await writeFile(join(folder, "outside.txt"), "not a library asset");
  await symlink(join(folder, "outside.txt"), join(root, "linked.txt"));
  vi.stubEnv("AXOM_PRIVATE_LIBRARY", root);
  server = await createServer({ configFile: false, root: folder, cacheDir: join(folder, "cache"), plugins: [privateLibraryPlugin()], server: { host: "127.0.0.1", port: 0, hmr: false }, optimizeDeps: { noDiscovery: true } });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { "X-AXOM-Library": "local", Origin: origin, "Sec-Fetch-Site": "same-origin" };
  const read = (path: string, requestHeaders = headers) => fetch(`${origin}/__axom_private_library/${path}`, { headers: requestHeaders });
  const valid = await read("catalog.json"); expect(valid.status).toBe(200); expect(await valid.json()).toEqual({ sample: true }); expect(valid.headers.get("cache-control")).toBe("no-store");
  expect((await read("catalog.json", { ...headers, Origin: "https://outside.example" })).status).toBe(403);
  expect((await read("catalog.json", { ...headers, "X-AXOM-Library": "" })).status).toBe(403);
  expect((await read("linked.txt")).status).toBe(204);
  expect((await read("..%2Foutside.txt")).status).toBe(204);
});
