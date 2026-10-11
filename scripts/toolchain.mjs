import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkToolchain(root = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const minimum = config.engines.node.match(/^>=(\d+)\.(\d+)\.(\d+) <23$/);
  const version = process.versions.node.split('.').map(Number);
  if (!minimum || version[0] !== 22 ||
    version[1] < Number(minimum[2]) ||
    (version[1] === Number(minimum[2]) && version[2] < Number(minimum[3]))) {
    throw new Error(`Use Node ${config.engines.node}; found ${process.version}`);
  }
  const npm = execFileSync('npm', ['--version'], {
    encoding: 'utf8', shell: process.platform === 'win32',
  }).trim();
  if (`npm@${npm}` !== config.packageManager) {
    throw new Error(`Use ${config.packageManager}; found npm@${npm}`);
  }
  console.log(`Toolchain: Node ${process.versions.node}, npm ${npm}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { checkToolchain(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
