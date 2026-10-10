import type { Plugin } from "vite";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Local development transfer only. No assets or private paths enter the public build. */
export function privateLibraryPlugin(): Plugin {
  return { name: "axom-private-library", apply: "serve", configureServer(server) {
    const root = process.env.AXOM_PRIVATE_LIBRARY ? resolve(process.env.AXOM_PRIVATE_LIBRARY) : undefined;
    server.middlewares.use("/__axom_private_library", (req, res) => {
      const host = req.headers.host ?? "";
      if (!root) { res.statusCode = 204; res.end(); return; }
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) { res.statusCode = 403; res.end(); return; }
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers["x-axom-library"] !== "local" || (req.headers.origin && req.headers.origin !== `http://${host}`) || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) { res.statusCode = 403; res.end(); return; }
      let path: string;
      try { path = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, ""); } catch { res.statusCode = 400; res.end(); return; }
      const file = resolve(root, path);
      if (!file.startsWith(`${root}${sep}`) || path.split("/").some(p => p === "..") || !existsSync(file) || !statSync(file).isFile() || !realpathSync(file).startsWith(`${realpathSync(root)}${sep}`)) { res.statusCode = 204; res.end(); return; }
      res.setHeader("Cache-Control", "no-store"); res.setHeader("Cross-Origin-Resource-Policy", "same-origin"); res.setHeader("Content-Type", "application/octet-stream");
      createReadStream(file).pipe(res);
    });
  } };
}
