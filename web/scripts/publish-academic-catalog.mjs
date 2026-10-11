import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
// Reuse the same TS/parser runtime as private-library preparation. No new SDK.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const server=await createServer({root,configFile:false,cacheDir:resolve(tmpdir(),"axom-publisher-vite"),optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:"custom"});
try{await server.ssrLoadModule("/scripts/academic-catalog/cli.ts");}finally{await server.close();}
