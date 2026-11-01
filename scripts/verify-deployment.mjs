import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { vercelIgnore } from './vercel-ignore.mjs';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

// Use Vercel's exact ignore parser/defaults, including parent negation rules.
// Never read ignored/untracked local files into a deployment candidate.
export async function deploymentFiles(root, ref, ignoreText) {
  const files = git(root, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean);
  const ig = vercelIgnore(ignoreText, { rustRoot: files.includes('Cargo.toml') });
  return files.filter(file => !ig.ignores(file));
}

export async function materializeDeployment(root, ref, target, ignoreText) {
  const files = await deploymentFiles(root, ref, ignoreText);
  if (!files.length) throw new Error('Deployment filtering selected no files');
  // Stream the archive: no full checkout, ignored assets, build cache or node_modules.
  const archive = join(target, 'source.tar');
  const child = spawn('git', ['-C', root, 'archive', '--format=tar', ref, '--', ...files], { stdio: ['ignore', 'pipe', 'inherit'] });
  const completed = new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept() : reject(new Error(`git archive exited ${code}`)));
  });
  await Promise.all([pipeline(child.stdout, createWriteStream(archive)), completed]);
  execFileSync('tar', ['-xf', archive, '-C', target]);
  rmSync(archive);
  return files;
}

export function assertDeploymentPrivacy(files) {
  const fixture = files.find(file => file.startsWith('fixtures/'));
  if (fixture) throw new Error(`Deployment privacy violation: ${fixture}`);
}

function command(commandText, cwd, env) {
  console.log(`\n$ ${commandText}`);
  const result = spawnSync(commandText, { cwd, env, shell: true, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${commandText}`);
}

export async function verifyDeployment(root, {
  ref = 'HEAD', ignoreRef, withFixtureProbe = false, expectPrivacyFailure = false,
} = {}) {
  const sha = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  let ignoreText = git(root, ['show', `${ignoreRef || sha}:.vercelignore`]);
  if (withFixtureProbe) ignoreText += '\n!/fixtures/\n!/fixtures/**\n';
  const target = mkdtempSync(join(tmpdir(), 'axom-deployment-'));
  try {
    const files = await materializeDeployment(root, sha, target, ignoreText);
    console.log(`Deployment source: ${sha}; ${files.length} filtered files; ${target}`);
    let privacyError;
    try {
      assertDeploymentPrivacy(files);
    } catch (error) {
      privacyError = error;
    }
    if (expectPrivacyFailure) {
      if (!privacyError) throw new Error('Expected fixture deployment privacy failure was not reproduced');
      console.log(`EXPECTED FAILURE: ${privacyError.message}`);
      return;
    }
    if (privacyError) throw privacyError;
    const config = JSON.parse(readFileSync(join(target, 'vercel.json'), 'utf8'));
    if (!config.installCommand || !config.buildCommand) throw new Error('Explicit Vercel install/build commands required');
    // Match remote commit metadata without relying on an enclosing local .git directory.
    const env = { ...process.env, VERCEL_GIT_COMMIT_SHA: sha };
    command(config.installCommand, target, env);
    command(config.buildCommand, target, env);
    console.log(`PASS: clean Vercel-filtered install and build (${sha})`);
  } finally {
    // Only this run's generated scratch tree; never the source checkout or user data.
    rmSync(target, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      ref: { type: 'string', default: 'HEAD' },
      'ignore-ref': { type: 'string' },
      'with-fixture-probe': { type: 'boolean', default: false },
      'expect-privacy-failure': { type: 'boolean', default: false },
    } });
    await verifyDeployment(process.cwd(), {
      ref: values.ref, ignoreRef: values['ignore-ref'],
      withFixtureProbe: values['with-fixture-probe'], expectPrivacyFailure: values['expect-privacy-failure'],
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
