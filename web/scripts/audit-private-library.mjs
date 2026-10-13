// Read-only corpus audit. Source names and paths must remain outside public Git.
import { createServer } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve, sep } from 'node:path';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
const [library, inventory, output] = process.argv.slice(2);
if (!library || !inventory || !output) throw new Error('Usage: node scripts/audit-private-library.mjs <private-library> <inventory.json> <new-private-report.json>');
const repository = fileURLToPath(new URL('../../', import.meta.url));
if (resolve(output).startsWith(repository) || /(?:^|\/)(?:public|dist)(?:\/|$)/.test(resolve(output)) || resolve(output).startsWith(`${resolve(library)}${sep}`)) {
  throw new Error('Write the audit outside the source collection, repository and public assets.');
}
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  cacheDir: '/tmp/axom-corpus-audit-vite', optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { auditPrivateLibrary } = await server.ssrLoadModule('/scripts/private-library-audit.ts');
  const report = await auditPrivateLibrary(resolve(library), resolve(inventory));
  await writeFile(resolve(output), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report.summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Audit failed.'); process.exitCode = 1;
} finally { await server.close(); }
