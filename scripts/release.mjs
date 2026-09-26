#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, stat, statfs, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostTarget, TARGETS, sha256, validateVersion, validateUpdaterSettings, verifySignature } from './release-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const cli = join(web, 'node_modules/@tauri-apps/cli/tauri.js');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requireWeb = createRequire(join(web, 'package.json'));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const args = process.argv.slice(2);

function run(command, argv, cwd = root, env = process.env) {
  const result = spawnSync(command, argv, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
  if (result.error || result.status !== 0) throw new Error(`${basename(command)} failed (${result.status ?? result.error?.message}). Release stopped; no release was published.`);
}

function available(command, argv = ['--version']) {
  return spawnSync(command, argv, { stdio: 'ignore' }).status === 0;
}

async function filesIn(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Symlinks and special files are not allowed in web release input: ${path}`);
  }
  return files;
}

async function archiveWeb(output, version) {
  const JSZip = requireWeb('jszip');
  const zip = new JSZip();
  const dist = join(web, 'dist');
  for (const file of await filesIn(dist)) zip.file(file.slice(dist.length + 1).replaceAll('\\', '/'), await readFile(file));
  zip.file('README.txt', `AXOM ${version}\n\nServe this directory over HTTPS, or run: node serve.mjs\nThen open http://127.0.0.1:4173. Do not open index.html via file://.\nKeep the same scheme, host and port to keep the same browser vault.\nApp updates replace code; browser data is per origin. Export a portable\nbackup from Settings before changing origins, browser, device or wrapper.\nUploaded question images are included by the portable backup export.\nFor hosting, deploy atomically and keep prior hashed assets during rollout.\nDo not cache version.json, sw.js or HTML indefinitely; see _headers.\n`);
  zip.file('serve.mjs', await readFile(join(root, 'scripts/serve-web.mjs')));
  await writeFile(join(output, `AXOM-${version}-web.zip`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
}

async function writeManifest(output, metadata, extra) {
  const files = [];
  for (const file of (await readdir(output)).sort()) {
    const bytes = await readFile(join(output, file));
    files.push({ name: file, sha256: sha256(bytes), bytes: bytes.length });
  }
  await writeJson(join(output, 'release-manifest.json'), { version: metadata.version, buildId: metadata.buildId, builtAt: metadata.builtAt, ...extra, files });
  await writeFile(join(output, 'SHA256SUMS.txt'), files.map((file) => `${file.sha256}  ${file.name}`).join('\n') + '\n');
}

async function publishLocal(stage, destination) {
  await mkdir(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    const previous = `${destination}.previous-${Date.now()}`;
    await rename(destination, previous);
    console.log(`Previous local output retained: ${previous}`);
  }
  await rename(stage, destination);
  console.log(`Package verified: ${destination}`);
}

async function main() {
  if (args.includes('--help')) {
    console.log('AXOM local release: node scripts/release.mjs [--web-only | --native-only] [--signed] [--target RUST_TARGET] [--bundles app,dmg] [--doctor]\nVersion: node scripts/release.mjs --version 0.1.0-beta.1\nNo command in this script publishes or uploads anything.');
    return;
  }
  const allowed = new Set(['--web-only', '--native-only', '--signed', '--target', '--bundles', '--doctor', '--version']);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
    if (['--target', '--bundles', '--version'].includes(args[index])) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${args[index]} requires a value.`);
      index += 1;
    }
  }
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const pkg = await readJson(join(web, 'package.json'));
  const version = validateVersion(pkg.version);
  if (value('--version')) {
    const next = validateVersion(value('--version'));
    for (const file of ['package.json', 'package-lock.json', 'web/package.json', 'web/package-lock.json']) {
      const path = join(root, file);
      const json = await readJson(path);
      json.version = next;
      if (json.packages?.['']) json.packages[''].version = next;
      await writeJson(path, json);
    }
    const cargo = join(root, 'src-tauri/Cargo.toml');
    await writeFile(cargo, (await readFile(cargo, 'utf8')).replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${next}"`));
    const lock = join(root, 'src-tauri/Cargo.lock');
    await writeFile(lock, (await readFile(lock, 'utf8')).replace(/(\[\[package\]\]\nname = "axom"\nversion = )"[^"]+"/, `$1"${next}"`));
    console.log(`Version set to ${next}. Review and commit the version files with your app changes.`);
    return;
  }
  if (args.includes('--web-only') && args.includes('--native-only')) throw new Error('Choose either --web-only or --native-only.');
  const native = !args.includes('--web-only');
  const signed = args.includes('--signed');
  if (!native && signed) throw new Error('--signed requires a native build.');
  const target = value('--target') ?? hostTarget(process.platform, process.arch);
  if (!TARGETS[target]) throw new Error(`Unsupported target: ${target}`);
  const platform = TARGETS[target];
  // MSI cannot represent normal text SemVer prereleases. NSIS is the default
  // Windows installer and updater format; MSI remains an explicit opt-in.
  const bundles = value('--bundles') ?? (platform.startsWith('windows-') ? 'nsis' : undefined);
  if (bundles && !/^(app|dmg|nsis|msi|deb|rpm|appimage)(,(app|dmg|nsis|msi|deb|rpm|appimage))*$/.test(bundles)) throw new Error('Unsupported bundle selection.');
  const problems = [];
  const disk = await statfs(root);
  const freeBytes = disk.bavail * disk.bsize;
  const minimumBytes = (native ? 2 : 0.25) * 1024 ** 3;
  if (freeBytes < minimumBytes) problems.push(`Insufficient free disk space: ${(freeBytes / 1024 ** 3).toFixed(1)} GiB available. Free at least ${native ? '2 GiB (4+ GiB recommended for a first Rust build)' : '256 MiB'} before building.`);
  const node = process.versions.node.split('.').map(Number);
  if (node[0] < 22 || (node[0] === 22 && node[1] < 12)) problems.push('Install Node 22.12+ (Node 22 LTS recommended).');
  if (!existsSync(join(web, 'node_modules/typescript/bin/tsc')) || !existsSync(cli)) problems.push('Run npm --prefix web ci to install pinned build tools.');
  if (native && !available('cargo')) problems.push('Install Rust using rustup; cargo is required for desktop builds.');
  if (native && process.platform === 'darwin' && !available('xcode-select', ['-p'])) problems.push('Install Xcode command line tools: xcode-select --install');
  const cargoText = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  if (cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) problems.push('Version drift: run npm --prefix web run release:version -- ' + version);
  let updater;
  if (signed) {
    try { updater = validateUpdaterSettings(process.env); } catch (error) { problems.push(error.message); }
    if (process.platform === 'darwin') {
      if (!process.env.APPLE_SIGNING_IDENTITY) problems.push('Signed macOS releases require APPLE_SIGNING_IDENTITY (Developer ID Application).');
      if (!(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID) && !(process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY_PATH)) problems.push('Signed macOS releases require Apple notarization credentials (Apple ID/password/team or API key/issuer/path).');
    }
  }
  console.log(`AXOM ${version} · ${native ? platform : 'web'} · ${signed ? 'signed release' : 'local build'}`);
  console.log(`Free disk space: ${(freeBytes / 1024 ** 3).toFixed(1)} GiB`);
  if (args.includes('--doctor')) {
    console.log(`Canonical native project: ${join(root, 'src-tauri')}\nWeb dependencies: ${existsSync(cli) ? 'installed' : 'missing'}\nRust: ${available('cargo') ? 'available' : 'missing'}\nUpdater credentials: ${['AXOM_UPDATER_PUBLIC_KEY', 'AXOM_UPDATER_ENDPOINT', 'TAURI_SIGNING_PRIVATE_KEY'].every((key) => Boolean(process.env[key])) ? 'present (use --signed --doctor to validate)' : 'not configured; local builds work, in-app desktop updates disabled'}`);
    if (problems.length) throw new Error(problems.join('\n'));
    console.log('Preflight passed.');
    return;
  }
  if (problems.length) throw new Error(problems.join('\n'));
  const releaseRoot = join(root, 'dist/releases');
  await mkdir(releaseRoot, { recursive: true });
  const staging = await mkdtemp(join(releaseRoot, '.staging-'));
  run(npm, ['run', 'build'], web);
  const metadata = await readJson(join(web, 'dist/version.json'));
  if (metadata.version !== version || !metadata.buildId) throw new Error('Build metadata mismatch.');
  const webStage = join(staging, 'web');
  if (!args.includes('--native-only')) {
    await mkdir(webStage);
    await archiveWeb(webStage, version);
    await writeManifest(webStage, metadata, { platform: 'web', target: 'web', signed: false });
  }
  if (native) {
    // One artwork source for web and desktop; never ship a stale native brand.
    run(process.execPath, [cli, 'icon', 'web/public/icon-512.png', '--output', 'src-tauri/icons']);
    const overlay = { build: { beforeBuildCommand: '' }, bundle: { createUpdaterArtifacts: signed, ...(!signed && process.platform === 'darwin' ? { macOS: { signingIdentity: '-' } } : {}) }, ...(updater ? { plugins: { updater } } : {}) };
    const configPath = join(staging, 'tauri.release.json');
    await writeJson(configPath, overlay);
    const buildArgs = [cli, 'build', '--config', configPath, '--', '--locked'];
    if (value('--target')) buildArgs.splice(-2, 0, '--target', target);
    if (bundles) buildArgs.splice(-2, 0, '--bundles', bundles);
    const start = Date.now();
    run(process.execPath, buildArgs);
    const bundleRoot = join(root, 'src-tauri/target', ...(value('--target') ? [target] : []), 'release/bundle');
    const nativeStage = join(staging, platform);
    await mkdir(nativeStage);
    const candidates = [];
    for (const directory of await readdir(bundleRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      for (const entry of await readdir(join(bundleRoot, directory.name), { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(dmg|exe|msi|deb|rpm|AppImage|app\.tar\.gz)$/.test(entry.name)) continue;
        const source = join(bundleRoot, directory.name, entry.name);
        if ((await stat(source)).mtimeMs < start - 2000) continue;
        candidates.push(source);
      }
    }
    if (process.platform === 'darwin') {
      const app = join(bundleRoot, 'macos/AXOM.app');
      if (!existsSync(app)) throw new Error('Native build did not produce AXOM.app.');
      run('codesign', ['--verify', '--deep', '--strict', app]);
      if (signed) { run('xcrun', ['stapler', 'validate', app]); run('spctl', ['--assess', '--type', 'execute', app]); }
      run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, join(nativeStage, `AXOM-${version}-${platform}.app.zip`)]);
    }
    let updaterArtifact;
    for (const source of candidates) {
      const suffix = source.endsWith('.app.tar.gz') ? 'app.tar.gz' : source.split('.').at(-1);
      const name = `AXOM-${version}-${platform}.${suffix}`;
      if (existsSync(join(nativeStage, name))) throw new Error(`Duplicate native output: ${name}`);
      await cp(source, join(nativeStage, name));
      const isUpdate = /\.app\.tar\.gz$|\.AppImage$|\.exe$/.test(source);
      if (signed && isUpdate) {
        const signature = (await readFile(`${source}.sig`, 'utf8')).trim();
        verifySignature(await readFile(source), signature, updater.pubkey, version);
        await writeFile(join(nativeStage, `${name}.sig`), signature + '\n');
        if (updaterArtifact) throw new Error('Multiple updater artifacts selected; use one installer format per platform.');
        updaterArtifact = { file: name, signature };
      }
    }
    if (!(await readdir(nativeStage)).length) throw new Error('No fresh native bundles were produced.');
    if (signed && !updaterArtifact) throw new Error('Signed release did not produce a verified updater artifact.');
    await writeManifest(nativeStage, metadata, { platform, target, signed, ...(updaterArtifact ? { updater: updaterArtifact } : {}) });
    await publishLocal(nativeStage, join(releaseRoot, version, platform));
  }
  if (!args.includes('--native-only')) await publishLocal(webStage, join(releaseRoot, version, 'web'));
  console.log(signed ? 'Signed packages verified. Upload through the draft-release workflow when ready.' : 'Local packages complete. Desktop auto-update is disabled until a signed build is configured.');
}

main().catch((error) => { console.error(`\nRelease failed: ${error.message}`); process.exitCode = 1; });
