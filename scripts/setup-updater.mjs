#!/usr/bin/env node
// One-time setup for signed in-app desktop updates. Run it yourself, in a
// terminal, from the repository root:
//
//   node scripts/setup-updater.mjs
//
// 1. Creates (or reuses) the Tauri updater key at ~/.tauri/axom-updater.key.
//    Tauri asks for a password; keep it and back up the key — losing it
//    strands every installed app on its current version.
// 2. Stores the private key + password as GitHub Actions secrets and the
//    public key + feed URL as repository variables (via your `gh` login).
// Nothing secret is printed. The key never enters the repository.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.AXOM_UPDATER_KEY_PATH ?? join(homedir(), '.tauri', 'axom-updater.key');
const cli = join(root, 'web/node_modules/@tauri-apps/cli/tauri.js');

function gh(args, input) {
  const result = spawnSync('gh', args, { cwd: root, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function askHidden(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (text) => { if (text.includes(question)) write?.(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolveAnswer(answer); });
  });
}

const repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner,visibility']));
if (repo.visibility !== 'PUBLIC') throw new Error('Release assets must be publicly downloadable; this repository is not public.');
const feed = `https://github.com/${repo.nameWithOwner}/releases/download/update-feed/latest.json`;

if (existsSync(keyPath)) {
  console.log(`Reusing the existing updater key at ${keyPath} (never regenerate it: installed apps trust its public key).`);
} else {
  console.log(`Creating the updater key at ${keyPath}. Choose a password you will keep.`);
  const result = spawnSync(process.execPath, [cli, 'signer', 'generate', '-w', keyPath], { stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(keyPath)) throw new Error('Key generation did not finish.');
}
const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
const password = await askHidden('Updater key password (hidden): ');

gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '--repo', repo.nameWithOwner], readFileSync(keyPath, 'utf8'));
gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '--repo', repo.nameWithOwner], password);
gh(['variable', 'set', 'AXOM_UPDATER_PUBLIC_KEY', '--repo', repo.nameWithOwner, '--body', publicKey]);
gh(['variable', 'set', 'AXOM_UPDATER_ENDPOINT', '--repo', repo.nameWithOwner, '--body', feed]);

console.log(`\nDone for ${repo.nameWithOwner}.
  Feed URL: ${feed}
Ship an update:
  npm --prefix web run release:version -- <next version>   # e.g. 0.0.3-prebeta
  add a "## <version>" section to CHANGELOG.md, commit
  git tag v<version> && git push origin main v<version>
  → GitHub builds, signs and drafts the release; press Publish when it looks right.
  → Installed apps download it in the background and show "Update now".
Optional: add APPLE_* secrets for a notarized macOS build (see docs/DESKTOP-RELEASE.md).`);
