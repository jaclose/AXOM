import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root: root + 'web', configFile: root + 'web/vite.config.ts', cacheDir: root + 'artifacts/communications/vite-cache', server: { host: '127.0.0.1', port: Number(process.env.AXOM_COMMS_PORT ?? 5196), strictPort: true } });
await server.listen();
server.printUrls();
console.log('Open /#communications or /#pulse?year=2026. Delivery remains governed by server configuration.');
