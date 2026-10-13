import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_CATEGORY } from '../supabase/functions/communications/service.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(root + 'supabase/functions/communications/source-manifest.json', 'utf8'));
const previewsManifest = JSON.parse(await readFile(root + 'artifacts/communications/preview-manifest.json', 'utf8'));
assert.equal(previewsManifest.version, 1);
for (const [path, expected] of Object.entries(previewsManifest.sources)) {
  assert.equal(sha(await readFile(root + path)), expected, `${path} changed: regenerate the visual gallery.`);
}
for (const [path, expected] of Object.entries(previewsManifest.generated)) {
  assert.equal(sha(await readFile(root + 'artifacts/communications/' + path)), expected, `${path}: generated preview drift.`);
}
assert.equal(manifest.version, 1);
assert.ok(Object.keys(manifest.sources).length > 10, 'Build must track transitive canonical source inputs.');
for (const [path, expected] of Object.entries({ ...manifest.sources, ...manifest.authTemplates, [manifest.bundle.path]: manifest.bundle.sha256 })) {
  assert.equal(sha(await readFile(root + path)), expected, `${path} changed: regenerate the Edge bundle and auth templates.`);
}
const files = await readdir(root + 'supabase/functions/communications');
assert.deepEqual(files.sort(), ['deno.json','deno.lock','index.ts','service.js','source-manifest.json']);
assert.equal(Object.keys(manifest.authTemplates).length, 7);
for (const name of ['confirmation','magic_link','recovery','invite','email_change','reauthentication']) {
  const html = await readFile(root + `supabase/templates/communications/${name}.html`, 'utf8');
  assert.ok(html.includes('{{ .Token }}'), `${name} lost its OTP.`);
  assert.equal(html.includes('{{ .ConfirmationURL }}'), name !== 'reauthentication', `${name} secure link mismatch.`);
  assert.ok(!html.includes('<script'), `${name} must be script-free.`);
}
let previews = 0;
for (const type of Object.keys(TEMPLATE_CATEGORY)) for (const theme of ['dark','light']) for (const accent of ['gold','teal','violet','rose']) {
  const html = await readFile(root + `artifacts/communications/emails/${type}-${theme}-${accent}.html`, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script|NaN|undefined|javascript:/i.test(html), `${type} has invalid output.`);
  assert.ok(html.includes('alt="AXOM Orb"'), `${type} lost the current Orb fallback.`);
  assert.ok((await readFile(root + `artifacts/communications/emails/${type}.txt`, 'utf8')).trim());
  previews++;
}
console.log(`Artifact integrity passed: ${Object.keys(manifest.sources).length} source inputs, ${Object.keys(manifest.authTemplates).length} auth/security files, ${Object.keys(TEMPLATE_CATEGORY).length} email types, ${previews} preview variants.`);
