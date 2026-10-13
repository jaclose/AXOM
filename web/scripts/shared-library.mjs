// Reuse the installed TypeScript loader without reading the user's .env.
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: '/tmp/axom-shared-library-vite',
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { main } = await server.ssrLoadModule('/scripts/shared-library/cli.ts');
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Catalog operation failed.');
  process.exitCode = 1;
} finally { await server.close(); }
