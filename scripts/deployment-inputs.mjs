import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const bankRegistry = 'web/src/lib/question-content/knownBanks.ts';

// readdir, unlike existsSync, checks exact spelling even on a case-insensitive Mac.
export function requireExactFile(root, file) {
  let directory = resolve(root);
  const parts = file.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid deployment input path: ${file}`);
  }
  for (const part of parts) {
    const entries = readdirSync(directory);
    if (!entries.includes(part)) {
      const alternate = entries.find(entry => entry.toLowerCase() === part.toLowerCase());
      throw new Error(alternate
        ? `Deployment input case mismatch: ${file} (found ${alternate}, expected ${part})`
        : `Missing deployment input: ${file}`);
    }
    directory = resolve(directory, part);
  }
  if (!statSync(directory).isFile()) throw new Error(`Deployment input is not a file: ${file}`);
}

export function requiredManifests(root) {
  requireExactFile(root, bankRegistry);
  const source = ts.createSourceFile(bankRegistry,
    readFileSync(resolve(root, bankRegistry), 'utf8'), ts.ScriptTarget.Latest, true);
  return [...new Set(source.statements
    .filter(ts.isImportDeclaration)
    .map(statement => statement.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map(specifier => specifier.text)
    .filter(specifier => specifier.endsWith('/manifest.json'))
    .map(specifier => relative(root, resolve(root, dirname(bankRegistry), specifier)).split(sep).join('/')))]
    .sort();
}

export function checkDeploymentInputs(root) {
  const manifests = requiredManifests(root);
  const required = [
    'package.json', 'package-lock.json', 'web/package.json', 'web/package-lock.json',
    'vercel.json', 'scripts/deployment-inputs.mjs', 'scripts/toolchain.mjs',
    'scripts/release-notes.mjs', 'scripts/release-notes.d.mts',
    'web/scripts/verify-daily-games-bundle.mjs', bankRegistry, ...manifests,
  ];
  for (const file of required) requireExactFile(root, file);
  return manifests;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const manifests = checkDeploymentInputs(process.cwd());
    console.log(`Deployment inputs: registry and ${manifests.length} external manifest import(s), exact filenames verified`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
